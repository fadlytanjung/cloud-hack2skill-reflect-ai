import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guard on `firestore.rules`.
 *
 * A full behavioural test needs the Firestore emulator; these assertions catch
 * the failure mode that matters most in review — an owner-bound rule quietly
 * relaxed into a public one. They run in CI and in the pre-push hook.
 */
const rules = readFileSync(join(process.cwd(), "firestore.rules"), "utf-8");

/** Rules text with comments and collapsed whitespace removed. */
const normalized = rules
  .replace(/\/\/.*$/gm, "")
  .replace(/\s+/g, " ")
  .trim();

describe("firestore.rules", () => {
  it("uses rules_version 2", () => {
    expect(rules).toMatch(/rules_version\s*=\s*['"]2['"]/);
  });

  it("never grants an unconditional allow", () => {
    // `allow read, write: if true;` and bare `allow read;` are both open doors.
    expect(normalized).not.toMatch(/allow[^;]*:\s*if\s+true\s*;/);
    expect(normalized).not.toMatch(/allow\s+(read|write|get|list|create|update|delete)[^:;]*;/);
  });

  it("attaches a condition to every allow statement", () => {
    const allows = normalized.match(/allow[^;]*;/g) ?? [];
    expect(allows.length).toBeGreaterThan(0);
    for (const statement of allows) {
      expect(statement, statement).toMatch(/:\s*if\s+/);
      expect(statement, statement).toMatch(/request\.auth|isAdmin\(\)/);
    }
  });

  it("requires authentication on every allow statement", () => {
    for (const statement of normalized.match(/allow[^;]*;/g) ?? []) {
      // Either an explicit non-null auth check, or the isAdmin() helper, which
      // performs one itself.
      expect(statement, statement).toMatch(/request\.auth\s*!=\s*null|isAdmin\(\)/);
    }
  });

  it("binds journal interactions to their owning user", () => {
    expect(normalized).toContain("match /users/{userId}/interactions/{interactionId}");
    const interactions = normalized.slice(
      normalized.indexOf("match /users/{userId}/interactions/{interactionId}")
    );
    expect(interactions).toMatch(/request\.auth\.uid\s*==\s*userId/);
  });

  it("restricts writes on a user document to that user alone, not to admins", () => {
    const userBlock = normalized.slice(normalized.indexOf("match /users/{userId} {"));
    const writeRule = userBlock.match(/allow write:[^;]*;/)?.[0] ?? "";
    expect(writeRule).toMatch(/request\.auth\.uid\s*==\s*userId/);
    // An admin may read a profile but must not silently overwrite one.
    expect(writeRule).not.toContain("isAdmin()");
  });

  it("gates the admin collection behind the isAdmin helper", () => {
    expect(normalized).toContain("match /admin/{document=**}");
    const adminBlock = normalized.slice(normalized.indexOf("match /admin/{document=**}"));
    expect(adminBlock).toMatch(/allow read, write:\s*if isAdmin\(\)/);
  });

  it("defines isAdmin using a custom claim or a stored admin role", () => {
    expect(normalized).toMatch(/function isAdmin\(\)/);
    expect(normalized).toMatch(/request\.auth\.token\.admin\s*==\s*true/);
    expect(normalized).toMatch(/data\.role\s*==\s*'admin'/);
  });
});
