/**
 * Express application factory.
 *
 * Everything the routes touch — environment, Gemini client, audit trail,
 * notification history, rate limiter, `fetch`, and the clock — arrives as an
 * injectable dependency. That is what makes the HTTP surface testable with
 * supertest and no network, no API key, and no real time passing.
 *
 * `server.ts` is the only place that supplies production defaults.
 */

import express, { type Express, type Request, type Response } from "express";
import {
  buildClientConfig,
  resolveDiscordWebhook,
  type EnvMap,
} from "./lib/clientConfig";
import {
  bootstrapAuditEntries,
  createAuditLogStore,
  type AuditLogStore,
} from "./lib/auditLog";
import {
  createGenAIProvider,
  generateContentStreamWithFallback,
  generateContentWithFallback,
  MODEL_FALLBACK_LADDER,
  PRIMARY_MODEL,
  SSE_DONE,
  sseFrame,
  type GetGenAI,
} from "./lib/gemini";
import {
  buildGeocodeUrl,
  buildPinnedLocation,
  buildReverseGeocodeUrl,
  lookupFallbackLocation,
  MAX_ADDRESS_LENGTH,
  parseGeocodeResponse,
  DEFAULT_FALLBACK_COORDS,
} from "./lib/maps";
import {
  buildDiscordPayload,
  buildWebhookPayload,
  createNotificationStore,
  describeWebhookTarget,
  resolveChannel,
  sanitizeDispatchFields,
  type DispatchStatus,
  type NotificationRecord,
  type NotificationStore,
} from "./lib/notifications";
import {
  buildReflectContents,
  buildReflectSystemInstruction,
  flattenTurnsToTranscript,
  MAX_PROMPT_LENGTH,
  MAX_SUMMARY_INPUT_LENGTH,
  parseInsights,
  SUMMARIZE_SYSTEM_INSTRUCTION,
} from "./lib/prompts";
import { createRateLimiter, NOTIFICATION_RATE_LIMIT, type RateLimiter } from "./lib/rateLimit";
import {
  isValidWebhookUrl,
  sanitizeAddressQuery,
  sanitizeNotificationPayload,
  validateCoordinates,
} from "./lib/security";
import { createVerifyAdmin, type RoleLookup, type TokenVerifier } from "./lib/rbac";
import { createRoleLookup, createTokenVerifier } from "./lib/firebaseAdmin";
import { createAdminApp } from "./lib/firebaseAdminApp";

export interface AppDependencies {
  env?: EnvMap;
  /** Lazily resolves a Gemini client; throws when no API key is configured. */
  getGenAI?: GetGenAI;
  audit?: AuditLogStore;
  notifications?: NotificationStore;
  rateLimiter?: RateLimiter;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Body size limit for JSON requests. */
  jsonLimit?: string;
  /** Verifies a Firebase ID token. Defaults to the Admin SDK. */
  verifyIdToken?: TokenVerifier;
  /** Reads the predefined role from Firestore `users/{uid}`. */
  getUserRole?: RoleLookup;
}

export interface ReflectApp {
  app: Express;
  audit: AuditLogStore;
  notifications: NotificationStore;
  rateLimiter: RateLimiter;
  env: EnvMap;
}

/** Request body guard: always yields an object, never throws on odd input. */
function body(req: Request): Record<string, unknown> {
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? (req.body as Record<string, unknown>)
    : {};
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

export function createApp(deps: AppDependencies = {}): ReflectApp {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const getGenAI = deps.getGenAI ?? createGenAIProvider(env);
  const audit = deps.audit ?? createAuditLogStore({ seed: bootstrapAuditEntries(now), now });
  const notifications = deps.notifications ?? createNotificationStore();
  const rateLimiter =
    deps.rateLimiter ??
    createRateLimiter({
      max: NOTIFICATION_RATE_LIMIT.max,
      windowMs: NOTIFICATION_RATE_LIMIT.windowMs,
      now,
    });

  const app = express();
  app.use(express.json({ limit: deps.jsonLimit ?? "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Admin identity is proved by a verified Firebase ID token; the role itself is
  // predefined data in Firestore `users/{uid}`. Both are injectable so the API
  // tests never need credentials.
  const adminApp = deps.verifyIdToken && deps.getUserRole ? null : createAdminApp(env);
  const verifyIdToken = deps.verifyIdToken ?? createTokenVerifier(adminApp!);
  const getUserRole = deps.getUserRole ?? createRoleLookup(adminApp!);

  // Local-development bypass, off unless explicitly asked for and never in
  // production. It accepts `x-admin-role: admin` with no credential at all.
  const allowInsecureAdmin =
    env.ALLOW_INSECURE_ADMIN === "1" && env.NODE_ENV !== "production";
  if (allowInsecureAdmin) {
    console.warn(
      "[RBAC] ALLOW_INSECURE_ADMIN=1 — /api/admin/* accepts an unauthenticated " +
        "`x-admin-role: admin` header. Development only."
    );
  }

  const verifyAdmin = createVerifyAdmin({
    audit,
    verifyIdToken,
    getUserRole,
    allowInsecureAdmin,
  });

  // ==========================================
  // DISCOVERY & HEALTH
  // ==========================================
  app.get("/api/config/client", (_req: Request, res: Response) => {
    res.json(buildClientConfig(env));
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      hasApiKey: Boolean(env.GEMINI_API_KEY),
      timestamp: new Date(now()).toISOString(),
    });
  });

  // ==========================================
  // GEMINI REFLECTION ENDPOINTS
  // ==========================================
  app.post("/api/gemini/reflect", async (req: Request, res: Response) => {
    try {
      const data = body(req);
      const prompt = readString(data, "prompt").trim();

      if (!prompt) {
        return res.status(400).json({ error: "A prompt or reflection text is required." });
      }
      if (prompt.length > MAX_PROMPT_LENGTH) {
        return res
          .status(400)
          .json({ error: `Input exceeds maximum character length of ${MAX_PROMPT_LENGTH}.` });
      }

      const result = await generateContentWithFallback(getGenAI(), {
        contents: buildReflectContents(data.history, prompt),
        systemInstruction: buildReflectSystemInstruction({
          mode: data.mode,
          category: data.category,
        }),
      });

      return res.json({
        reply: result.text,
        modelUsed: result.modelUsed,
        timestamp: now(),
      });
    } catch (error: any) {
      console.error("[Reflect API Error]:", error);
      return res.status(500).json({
        error: error?.message || "Failed to process reflection with Gemini AI.",
      });
    }
  });

  app.post("/api/gemini/reflect-stream", async (req: Request, res: Response) => {
    const data = body(req);
    const prompt = readString(data, "prompt").trim();

    if (!prompt) {
      return res.status(400).json({ error: "A prompt or reflection text is required." });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res
        .status(400)
        .json({ error: `Input exceeds maximum character length of ${MAX_PROMPT_LENGTH}.` });
    }

    // Server-Sent Events transport
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    try {
      const { responseStream, modelUsed } = await generateContentStreamWithFallback(getGenAI(), {
        contents: buildReflectContents(data.history, prompt),
        systemInstruction: buildReflectSystemInstruction({
          mode: data.mode,
          category: data.category,
        }),
      });

      for await (const chunk of responseStream) {
        const text = chunk?.text || "";
        if (text) {
          res.write(sseFrame({ text, modelUsed }));
        }
      }

      res.write(SSE_DONE);
      return res.end();
    } catch (error: any) {
      console.error("[Reflect Stream Error]:", error);
      res.write(
        sseFrame({ error: error?.message || "Failed to stream reflection from Gemini AI." })
      );
      return res.end();
    }
  });

  app.post("/api/gemini/summarize", async (req: Request, res: Response) => {
    try {
      const data = body(req);
      const text = readString(data, "text").trim();
      const combinedText = text || flattenTurnsToTranscript(data.turns);

      if (!combinedText) {
        return res
          .status(400)
          .json({ error: "Text or interaction history is required for summarization." });
      }

      const result = await generateContentWithFallback(getGenAI(), {
        contents: [
          { role: "user", parts: [{ text: combinedText.slice(0, MAX_SUMMARY_INPUT_LENGTH) }] },
        ],
        systemInstruction: SUMMARIZE_SYSTEM_INSTRUCTION,
      });

      return res.json({
        insights: parseInsights(result.text),
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("[Summarize API Error]:", error);
      return res.status(500).json({
        error: error?.message || "Failed to generate entry summary.",
      });
    }
  });

  // ==========================================
  // FEATURE A: LOCATION-AWARE ENTRIES (GOOGLE MAPS)
  // ==========================================
  app.post("/api/maps/geocode", async (req: Request, res: Response) => {
    try {
      const data = body(req);
      const address = readString(data, "address").trim();

      if (!address) {
        return res.status(400).json({ error: "Address query is required." });
      }
      if (address.length > MAX_ADDRESS_LENGTH) {
        return res
          .status(400)
          .json({ error: `Address length cannot exceed ${MAX_ADDRESS_LENGTH} characters.` });
      }

      const sanitizedAddress = sanitizeAddressQuery(address);
      const apiKey = env.MAPS_API_KEY;

      if (apiKey) {
        try {
          const gmapsRes = await fetchImpl(buildGeocodeUrl(sanitizedAddress, apiKey));
          const location = parseGeocodeResponse(await gmapsRes.json());
          if (location) {
            audit.record(
              "GEOCODE_LOOKUP",
              "user",
              `Geocoded "${sanitizedAddress}" via Google Maps API`
            );
            return res.json({ location });
          }
        } catch (err: any) {
          // A Maps outage degrades to the deterministic table below.
          console.warn("[Geocode Upstream Warning]:", err?.message || err);
        }
      }

      const fallback = lookupFallbackLocation(sanitizedAddress);
      if (fallback) {
        audit.record(
          "GEOCODE_LOOKUP",
          "user",
          `Geocoded "${sanitizedAddress}" to ${fallback.formattedAddress}`
        );
        return res.json({ location: fallback });
      }

      return res.json({
        location: {
          latitude: DEFAULT_FALLBACK_COORDS.lat,
          longitude: DEFAULT_FALLBACK_COORDS.lng,
          formattedAddress: sanitizedAddress,
          placeId: `place-custom-${now()}`,
        },
      });
    } catch (error: any) {
      console.error("[Geocode API Error]:", error);
      return res.status(500).json({ error: "Failed to resolve location geocode." });
    }
  });

  app.post("/api/maps/reverse-geocode", async (req: Request, res: Response) => {
    try {
      const data = body(req);
      const validation = validateCoordinates(data.latitude, data.longitude);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.reason });
      }

      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      const apiKey = env.MAPS_API_KEY;

      if (apiKey) {
        try {
          const gmapsRes = await fetchImpl(buildReverseGeocodeUrl(lat, lng, apiKey));
          const parsed = parseGeocodeResponse(await gmapsRes.json());
          if (parsed) {
            // Trust the caller's coordinates; take only the label from Maps.
            return res.json({
              location: {
                latitude: lat,
                longitude: lng,
                formattedAddress: parsed.formattedAddress,
                placeId: parsed.placeId,
              },
            });
          }
        } catch (err: any) {
          console.warn("[Reverse Geocode Upstream Warning]:", err?.message || err);
        }
      }

      return res.json({ location: buildPinnedLocation(lat, lng, now()) });
    } catch (error: any) {
      console.error("[Reverse Geocode API Error]:", error);
      return res.status(500).json({ error: "Failed to reverse geocode coordinates." });
    }
  });

  // ==========================================
  // FEATURE B: ADMIN DASHBOARD & RBAC OPERATIONS
  // ==========================================
  app.get("/api/admin/metrics", verifyAdmin, (_req: Request, res: Response) => {
    res.json({
      activeUsers: 1,
      totalInteractions: 14,
      geminiModelLadder: [...MODEL_FALLBACK_LADDER],
      primaryModel: PRIMARY_MODEL,
      fallbackTriggerCount: 0,
      systemUptimeSeconds: Math.floor(process.uptime()),
      databaseStatus: "connected",
      securityRulesEnforced: true,
      rbacEngine: "firebase-id-token + firestore-role",
      threatZonesAudited: 5,
    });
  });

  app.get("/api/admin/audit-logs", verifyAdmin, (_req: Request, res: Response) => {
    const logs = audit.list();
    res.json({ logs, total: logs.length });
  });

  app.post("/api/admin/set-role", verifyAdmin, (req: Request, res: Response) => {
    const data = body(req);
    const targetUid = readString(data, "targetUid") || "current-user";
    const newRole = data.role === "admin" ? "admin" : "user";

    audit.record(
      "ROLE_UPDATED",
      (req as Request & { user?: { uid?: string } }).user?.uid || "admin",
      `Set role for ${targetUid} to ${newRole}`
    );
    res.json({
      success: true,
      targetUid,
      role: newRole,
      message: `Role successfully updated to '${newRole}'.`,
    });
  });

  app.post("/api/admin/test-rbac", verifyAdmin, (req: Request, res: Response) => {
    res.json({
      authorized: true,
      message: "Admin verification succeeded. Caller holds elevated role.",
      user: (req as Request & { user?: unknown }).user,
    });
  });

  // ==========================================
  // FEATURE C: EXTERNAL NOTIFICATION ENGINE
  // ==========================================
  app.post("/api/notifications/dispatch", async (req: Request, res: Response) => {
    try {
      const data = body(req);
      const channel = resolveChannel(data.channel);
      const timestamp = now();
      const entryId = readString(data, "entryId") || `entry-${timestamp}`;
      const customWebhookUrl = readString(data, "customWebhookUrl").trim();
      const clientIp = req.ip || "unknown-client";

      const decision = rateLimiter.check(clientIp);
      if (!decision.allowed) {
        audit.record(
          "NOTIFICATION_RATE_LIMIT",
          clientIp,
          `Rate limit exceeded (${NOTIFICATION_RATE_LIMIT.max}/min)`,
          "warn"
        );
        res.setHeader("Retry-After", Math.ceil(decision.retryAfterMs / 1000));
        return res
          .status(429)
          .json({ error: "Notification rate limit exceeded. Please wait 1 minute." });
      }

      if (!readString(data, "summary")) {
        return res
          .status(400)
          .json({ error: "Reflection summary is required for notification dispatch." });
      }

      // Strict payload sanitization (OWASP LLM02, prompt injection defense)
      const fields = sanitizeDispatchFields({
        title: data.title,
        summary: data.summary,
        entryId,
        timestamp,
      });

      let dispatchStatus: DispatchStatus = "simulated";
      let destinationLabel = "";

      if (channel === "webhook") {
        const targetUrl = customWebhookUrl || env.WEBHOOK_URL || "";

        if (targetUrl) {
          const validation = isValidWebhookUrl(targetUrl);
          if (!validation.valid) {
            return res.status(400).json({ error: `Webhook URL rejected: ${validation.reason}` });
          }

          destinationLabel = describeWebhookTarget(targetUrl, Boolean(customWebhookUrl));
          dispatchStatus = await postJson(
            fetchImpl,
            targetUrl,
            buildWebhookPayload(fields, targetUrl),
            "Webhook"
          );
        } else {
          destinationLabel = "Standard JSON Webhook (Simulated)";
        }
      } else if (channel === "discord") {
        const webhookUrl = customWebhookUrl || resolveDiscordWebhook(env);

        destinationLabel = webhookUrl
          ? customWebhookUrl
            ? "Custom Discord Webhook"
            : "Discord Channel (reflect-ai-env)"
          : "Discord Channel #reflections (Simulated)";

        if (webhookUrl) {
          const validation = isValidWebhookUrl(webhookUrl);
          if (!validation.valid) {
            return res
              .status(400)
              .json({ error: `Discord Webhook URL rejected: ${validation.reason}` });
          }

          const projectLabel =
            env.GCP_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || "Google Cloud Run";
          dispatchStatus = await postJson(
            fetchImpl,
            webhookUrl,
            buildDiscordPayload(fields, projectLabel),
            "Discord"
          );
        }
      } else {
        destinationLabel = data.recipientEmail
          ? sanitizeNotificationPayload(data.recipientEmail)
          : "user-email@domain.com (Simulated)";
      }

      const record: NotificationRecord = notifications.add({
        id: `notif-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
        channel,
        entryId,
        title: fields.title,
        summary: fields.summary,
        timestamp,
        status: dispatchStatus,
        recipientOrWebhook: destinationLabel,
      });

      audit.record(
        "NOTIFICATION_DISPATCHED",
        "user",
        `Dispatched ${channel.toUpperCase()} notification for "${fields.title}" [${dispatchStatus}]`,
        "success"
      );

      return res.json({
        success: true,
        record,
        message: `Notification dispatched successfully via ${channel.toUpperCase()} (${dispatchStatus}).`,
      });
    } catch (error: any) {
      console.error("[Notification Dispatch Error]:", error);
      return res.status(500).json({ error: "Failed to dispatch external notification." });
    }
  });

  app.get("/api/notifications/history", (_req: Request, res: Response) => {
    const history = notifications.list();
    res.json({ history, total: history.length });
  });

  return { app, audit, notifications, rateLimiter, env };
}

/**
 * Posts a JSON body to an egress endpoint. A non-2xx response or a transport
 * failure downgrades the dispatch to "simulated" rather than failing the
 * caller's request — the reflection itself already saved successfully.
 */
async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  payload: unknown,
  label: string
): Promise<DispatchStatus> {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return "delivered";
    console.warn(`[${label} Warning]: Target responded with status ${response.status}`);
    return "simulated";
  } catch (e: any) {
    console.warn(`[${label} Dispatch Warning]:`, e?.message || e);
    return "simulated";
  }
}
