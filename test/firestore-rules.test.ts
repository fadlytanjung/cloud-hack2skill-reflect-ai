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

/**
 * The text of the `/users/{userId}` block alone. `match /users/{userId}` is a
 * prefix of `match /users/{userId}/interactions/...`, so a naive indexOf would
 * pick up the wrong block; the trailing " {" and the slice to the next `match`
 * keep them apart.
 */
function userDocumentBlock(): string {
  const start = normalized.indexOf("match /users/{userId} {");
  expect(start, "user document block not found").toBeGreaterThan(-1);
  const rest = normalized.slice(start + "match /users/{userId} {".length);
  const end = rest.indexOf("match ");
  return end === -1 ? rest : rest.slice(0, end);
}

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
      // `if false` denies everyone, which is stricter than any auth check.
      if (/:\s*if\s+false\s*;/.test(statement)) continue;
      expect(statement, statement).toMatch(/request\.auth|isAdmin\(\)/);
    }
  });

  it("requires authentication on every allow statement that grants anything", () => {
    for (const statement of normalized.match(/allow[^;]*;/g) ?? []) {
      if (/:\s*if\s+false\s*;/.test(statement)) continue;
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

  it("restricts profile writes to the owning user, not to admins", () => {
    const userBlock = userDocumentBlock();
    for (const rule of userBlock.match(/allow (create|update):[^;]*;/g) ?? []) {
      expect(rule, rule).toMatch(/request\.auth\.uid\s*==\s*userId/);
      // An admin may read a profile but must not silently overwrite one.
      expect(rule, rule).not.toContain("isAdmin()");
    }
  });

  it("forbids a user from assigning themselves a role on create", () => {
    // Without this, anyone could sign up with role:'admin' and isAdmin() -- which
    // reads exactly that field -- would believe them.
    const createRule = userDocumentBlock().match(/allow create:[^;]*;/)?.[0] ?? "";
    expect(createRule).toMatch(/!\s*request\.resource\.data\.keys\(\)\.hasAny\(\['role'\]\)/);
  });

  it("forbids a user from changing the role field on update", () => {
    const updateRule = userDocumentBlock().match(/allow update:[^;]*;/)?.[0] ?? "";
    // Either inline, or via the roleUnchanged() helper.
    const guardsRole =
      /roleUnchanged\(\)/.test(updateRule) ||
      /affectedKeys\(\)\.hasAny\(\['role'\]\)/.test(updateRule);
    expect(guardsRole, updateRule).toBe(true);
  });

  it("defines roleUnchanged() as a diff against the stored role", () => {
    expect(normalized).toMatch(/function roleUnchanged\(\)/);
    expect(normalized).toMatch(
      /!\s*request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['role'\]\)/
    );
  });

  it("never grants a blanket write on the user document", () => {
    // `allow write` would cover create and update at once, reopening the hole.
    expect(userDocumentBlock()).not.toMatch(/allow write:/);
  });

  it("forbids client-side deletion of a profile", () => {
    expect(userDocumentBlock()).toMatch(/allow delete:\s*if false\s*;/);
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
