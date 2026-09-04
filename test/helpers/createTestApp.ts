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

/** Authorization header that satisfies the admin guard. */
export const ADMIN_AUTH = { Authorization: "Bearer admin-session-token" };
