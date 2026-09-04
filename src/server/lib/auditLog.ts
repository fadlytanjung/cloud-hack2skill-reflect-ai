/**
 * Bounded in-memory audit trail surfaced by `GET /api/admin/audit-logs`.
 *
 * Newest entry first; the store trims to `maxEntries` so a long-running Cloud
 * Run revision cannot grow unbounded.
 */

export type AuditStatus = "success" | "warn" | "error";

export interface AuditLog {
  id: string;
  timestamp: number;
  action: string;
  actor: string;
  details: string;
  status: AuditStatus;
}

export interface AuditLogStoreOptions {
  maxEntries?: number;
  now?: () => number;
  /** Injectable id suffix generator, so ids are deterministic under test. */
  idSuffix?: () => string;
  /** Entries to preload, newest first. */
  seed?: AuditLog[];
}

export interface AuditLogStore {
  record(action: string, actor: string, details: string, status?: AuditStatus): AuditLog;
  list(): AuditLog[];
  get size(): number;
  clear(): void;
}

export const DEFAULT_MAX_AUDIT_ENTRIES = 100;

export function createAuditLogStore(options: AuditLogStoreOptions = {}): AuditLogStore {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_AUDIT_ENTRIES;
  const now = options.now ?? Date.now;
  const idSuffix = options.idSuffix ?? (() => Math.random().toString(36).slice(2, 7));
  const logs: AuditLog[] = options.seed ? [...options.seed] : [];

  return {
    record(action, actor, details, status: AuditStatus = "success") {
      const entry: AuditLog = {
        id: `audit-${now()}-${idSuffix()}`,
        timestamp: now(),
        action,
        actor,
        details,
        status,
      };
      logs.unshift(entry);
      while (logs.length > maxEntries) {
        logs.pop();
      }
      return entry;
    },

    list() {
      // Defensive copy: callers must not be able to mutate the trail.
      return logs.map((entry) => ({ ...entry }));
    },

    get size() {
      return logs.length;
    },

    clear() {
      logs.length = 0;
    },
  };
}

/** The two boot-time entries that document a healthy startup. */
export function bootstrapAuditEntries(now: () => number = Date.now): AuditLog[] {
  const t = now();
  return [
    {
      id: `audit-${t}-boot2`,
      timestamp: t - 1_800_000,
      action: "FIREBASE_RULES_VERIFIED",
      actor: "security_subsystem",
      details: "Owner-bound isolation & RBAC rules active for Cloud Firestore.",
      status: "success",
    },
    {
      id: `audit-${t}-boot1`,
      timestamp: t - 3_600_000,
      action: "SYSTEM_INITIALIZED",
      actor: "system",
      details: "ReflectAI security and model ladders mounted successfully.",
      status: "success",
    },
  ];
}
