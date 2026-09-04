import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_AUDIT_ENTRIES,
  bootstrapAuditEntries,
  createAuditLogStore,
} from "./auditLog";

describe("createAuditLogStore", () => {
  it("starts empty by default", () => {
    const store = createAuditLogStore();
    expect(store.size).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it("records entries newest first", () => {
    const store = createAuditLogStore();
    store.record("FIRST", "system", "one");
    store.record("SECOND", "system", "two");
    expect(store.list().map((l) => l.action)).toEqual(["SECOND", "FIRST"]);
  });

  it("defaults the status to success and honours an explicit status", () => {
    const store = createAuditLogStore();
    expect(store.record("A", "system", "d").status).toBe("success");
    expect(store.record("B", "system", "d", "warn").status).toBe("warn");
    expect(store.record("C", "system", "d", "error").status).toBe("error");
  });

  it("stamps a deterministic id and timestamp from the injected clock", () => {
    const store = createAuditLogStore({ now: () => 1700000000000, idSuffix: () => "abcde" });
    expect(store.record("A", "actor", "details")).toEqual({
      id: "audit-1700000000000-abcde",
      timestamp: 1700000000000,
      action: "A",
      actor: "actor",
      details: "details",
      status: "success",
    });
  });

  it("trims to maxEntries, discarding the oldest", () => {
    const store = createAuditLogStore({ maxEntries: 3 });
    for (const n of [1, 2, 3, 4, 5]) store.record(`ACTION_${n}`, "system", "d");
    expect(store.size).toBe(3);
    expect(store.list().map((l) => l.action)).toEqual(["ACTION_5", "ACTION_4", "ACTION_3"]);
  });

  it("trims a seed that already exceeds the cap on the next write", () => {
    const seed = Array.from({ length: 5 }, (_, i) => ({
      id: `seed-${i}`,
      timestamp: i,
      action: `SEED_${i}`,
      actor: "system",
      details: "d",
      status: "success" as const,
    }));
    const store = createAuditLogStore({ maxEntries: 2, seed });
    store.record("NEW", "system", "d");
    expect(store.size).toBe(2);
    expect(store.list()[0].action).toBe("NEW");
  });

  it("returns copies so callers cannot tamper with the trail", () => {
    const store = createAuditLogStore();
    store.record("ORIGINAL", "system", "d");
    const listed = store.list();
    listed[0].action = "TAMPERED";
    listed.push({ ...listed[0], id: "injected" });
    expect(store.list()[0].action).toBe("ORIGINAL");
    expect(store.size).toBe(1);
  });

  it("does not mutate the caller's seed array", () => {
    const seed = [
      { id: "s", timestamp: 0, action: "SEED", actor: "system", details: "d", status: "success" as const },
    ];
    const store = createAuditLogStore({ seed });
    store.record("NEW", "system", "d");
    expect(seed).toHaveLength(1);
    expect(store.size).toBe(2);
  });

  it("clears every entry", () => {
    const store = createAuditLogStore({ seed: bootstrapAuditEntries() });
    store.clear();
    expect(store.size).toBe(0);
  });

  it("caps at 100 entries by default", () => {
    expect(DEFAULT_MAX_AUDIT_ENTRIES).toBe(100);
    const store = createAuditLogStore();
    for (let i = 0; i < 150; i++) store.record("A", "system", "d");
    expect(store.size).toBe(100);
  });
});

describe("bootstrapAuditEntries", () => {
  it("documents startup with two backdated success entries, newest first", () => {
    const entries = bootstrapAuditEntries(() => 1700000000000);
    expect(entries.map((e) => e.action)).toEqual([
      "FIREBASE_RULES_VERIFIED",
      "SYSTEM_INITIALIZED",
    ]);
    expect(entries.every((e) => e.status === "success")).toBe(true);
    expect(entries[0].timestamp).toBeGreaterThan(entries[1].timestamp);
    expect(entries[0].timestamp).toBeLessThan(1700000000000);
  });
});
