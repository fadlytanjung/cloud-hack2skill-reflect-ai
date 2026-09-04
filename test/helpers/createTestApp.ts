/**
 * Test harness for the Express surface.
 *
 * Builds a fully wired app with every external dependency stubbed: no Gemini
 * client, no Maps call, no webhook egress, and a clock the test controls.
 */

import { createApp, type AppDependencies, type ReflectApp } from "../../src/server/app";
import { bootstrapAuditEntries, createAuditLogStore } from "../../src/server/lib/auditLog";
import { createNotificationStore } from "../../src/server/lib/notifications";
import { createRateLimiter, NOTIFICATION_RATE_LIMIT } from "../../src/server/lib/rateLimit";
import type { EnvMap } from "../../src/server/lib/clientConfig";
import type { GenAIClientLike } from "../../src/server/lib/gemini";

export interface FetchCall {
  url: string;
  init?: RequestInit;
  /** Parsed JSON body, when the call sent one. */
  body?: unknown;
}

export interface TestHarness extends ReflectApp {
  /** Every outbound fetch the app attempted, in order. */
  fetchCalls: FetchCall[];
  /** Advances the injected clock. */
  advance(ms: number): void;
  now(): number;
}

export const FIXED_NOW = 1_700_000_000_000;

export interface TestAppOptions {
  env?: EnvMap;
  /** Text the stub Gemini client returns from generateContent. */
  geminiText?: string;
  /** Chunks the stub Gemini client streams. */
  geminiChunks?: string[];
  /** When set, the stub Gemini client rejects with this error. */
  geminiError?: Error;
  /** Omit the Gemini client entirely, as if GEMINI_API_KEY were unset. */
  withoutGemini?: boolean;
  /** Responses for outbound fetches, matched in call order. */
  fetchResponses?: Array<{ ok?: boolean; status?: number; json?: unknown } | Error>;
  rateLimit?: { max: number; windowMs: number };
  /**
   * ID tokens the stub verifier accepts, mapped to the uid they resolve to.
   * Anything else is rejected, exactly as an invalid token would be.
   */
  validTokens?: Record<string, { uid: string; email?: string }>;
  /** Predefined Firestore roles, keyed by uid. */
  userRoles?: Record<string, string>;
  /** Make the verifier throw, simulating an Admin SDK outage. */
  verifierThrows?: boolean;
  /** Make the role lookup throw, simulating Firestore being unreachable. */
  roleLookupThrows?: boolean;
}

function stubGenAI(options: TestAppOptions): GenAIClientLike {
  const defaultSummary =
    '{"title":"T","summary":"S","takeaways":["a"],"sentiment":"Calm"}';
  return {
    models: {
      async generateContent() {
        if (options.geminiError) throw options.geminiError;
        return { text: options.geminiText ?? defaultSummary };
      },
      async generateContentStream() {
        if (options.geminiError) throw options.geminiError;
        const chunks = options.geminiChunks ?? ["Hello ", "world"];
        return (async function* () {
          for (const text of chunks) yield { text };
        })();
      },
    },
  };
}

export function createTestApp(options: TestAppOptions = {}): TestHarness {
  let clock = FIXED_NOW;
  const now = () => clock;
  const fetchCalls: FetchCall[] = [];
  const queued = [...(options.fetchResponses ?? [])];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    fetchCalls.push({ url: String(input), init, body });

    const next = queued.shift();
    if (next instanceof Error) throw next;
    const spec = next ?? { ok: true, status: 200, json: {} };
    return {
      ok: spec.ok ?? (spec.status ?? 200) < 400,
      status: spec.status ?? 200,
      json: async () => spec.json ?? {},
      text: async () => JSON.stringify(spec.json ?? {}),
    } as Response;
  }) as unknown as typeof fetch;

  const audit = createAuditLogStore({ seed: bootstrapAuditEntries(now), now });
  const notifications = createNotificationStore();
  const rateLimiter = createRateLimiter({
    max: options.rateLimit?.max ?? NOTIFICATION_RATE_LIMIT.max,
    windowMs: options.rateLimit?.windowMs ?? NOTIFICATION_RATE_LIMIT.windowMs,
    now,
  });

  const deps: AppDependencies = {
    env: options.env ?? {},
    audit,
    notifications,
    rateLimiter,
    fetchImpl,
    now,
    getGenAI: options.withoutGemini
      ? () => {
          throw new Error("GEMINI_API_KEY environment variable is not configured.");
        }
      : () => stubGenAI(options),

    // Stand-ins for Firebase: no credentials, no network. A token is valid only
    // if the test declared it, and a role only if the test seeded it.
    async verifyIdToken(idToken: string) {
      if (options.verifierThrows) throw new Error("Admin SDK unavailable");
      const match = (options.validTokens ?? {})[idToken];
      return match ? { uid: match.uid, email: match.email ?? null } : null;
    },
    async getUserRole(uid: string) {
      if (options.roleLookupThrows) throw new Error("Firestore unavailable");
      return (options.userRoles ?? {})[uid] ?? null;
    },
  };

  const built = createApp(deps);

  return {
    ...built,
    fetchCalls,
    now,
    advance(ms: number) {
      clock += ms;
    },
  };
}

/** A verified-token/role pair that satisfies the admin guard. */
export const ADMIN_UID = "admin-uid";
export const ADMIN_EMAIL = "owner@example.com";
export const ADMIN_ID_TOKEN = "valid-admin-id-token";

/** Harness options granting `ADMIN_ID_TOKEN` admin rights. */
export const ADMIN_FIXTURE: Pick<TestAppOptions, "validTokens" | "userRoles"> = {
  validTokens: { [ADMIN_ID_TOKEN]: { uid: ADMIN_UID, email: ADMIN_EMAIL } },
  userRoles: { [ADMIN_UID]: "admin" },
};

/** Authorization header carrying a token the harness will verify as an admin. */
export const ADMIN_AUTH = { Authorization: `Bearer ${ADMIN_ID_TOKEN}` };

/** A verified but non-admin caller. */
export const USER_UID = "plain-uid";
export const USER_ID_TOKEN = "valid-user-id-token";
export const USER_FIXTURE: Pick<TestAppOptions, "validTokens" | "userRoles"> = {
  validTokens: { [USER_ID_TOKEN]: { uid: USER_UID, email: "user@example.com" } },
  userRoles: { [USER_UID]: "user" },
};
export const USER_AUTH = { Authorization: `Bearer ${USER_ID_TOKEN}` };
