import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIRESTORE_DATABASE_ID,
  USERS_COLLECTION,
  createRoleLookup,
  createTokenVerifier,
  resolveDatabaseId,
  resolveProjectId,
  type AdminApp,
} from "./firebaseAdmin";

function stubApp(over: Partial<AdminApp> = {}): AdminApp {
  return {
    verifyIdToken: vi.fn(async () => ({ uid: "uid-1", email: "a@b.c" })),
    getRole: vi.fn(async () => "admin"),
    ...over,
  };
}

describe("resolveProjectId", () => {
  it("prefers the explicit deployment project id", () => {
    expect(
      resolveProjectId({ GCP_PROJECT_ID: "a", VITE_FIREBASE_PROJECT_ID: "b" })
    ).toBe("a");
  });

  it("falls through the aliases in order", () => {
    expect(resolveProjectId({ VITE_FIREBASE_PROJECT_ID: "b" })).toBe("b");
    expect(resolveProjectId({ FIREBASE_PROJECT_ID: "c" })).toBe("c");
    // Cloud Run injects GOOGLE_CLOUD_PROJECT automatically.
    expect(resolveProjectId({ GOOGLE_CLOUD_PROJECT: "d" })).toBe("d");
  });

  it("returns an empty string when nothing is configured", () => {
    expect(resolveProjectId({})).toBe("");
  });
});

describe("resolveDatabaseId", () => {
  it("defaults to the provisioned named database, never (default)", () => {
    // Falling back to "(default)" would silently read and write the wrong store.
    expect(resolveDatabaseId({})).toBe(DEFAULT_FIRESTORE_DATABASE_ID);
    expect(DEFAULT_FIRESTORE_DATABASE_ID).toBe("reflect-ai-app");
  });

  it("honours an override", () => {
    expect(resolveDatabaseId({ VITE_FIREBASE_DATABASE_ID: "other" })).toBe("other");
    expect(resolveDatabaseId({ FIREBASE_DATABASE_ID: "other" })).toBe("other");
  });
});

describe("createTokenVerifier", () => {
  it("returns the decoded token for a valid credential", async () => {
    const app = stubApp();
    const verify = createTokenVerifier(async () => app);
    await expect(verify("good")).resolves.toMatchObject({ uid: "uid-1" });
    expect(app.verifyIdToken).toHaveBeenCalledWith("good");
  });

  it("returns null — never throws — for any rejected token", async () => {
    // Expired, malformed, revoked, wrong audience: all are simply "not verified",
    // and the caller must not have to distinguish them.
    for (const err of [
      Object.assign(new Error("expired"), { code: "auth/id-token-expired" }),
      Object.assign(new Error("bad sig"), { code: "auth/argument-error" }),
      new Error("network"),
      "a thrown string",
    ]) {
      const verify = createTokenVerifier(async () =>
        stubApp({ verifyIdToken: vi.fn(async () => { throw err; }) })
      );
      await expect(verify("bad"), String(err)).resolves.toBeNull();
    }
  });

  it("propagates a failure to initialize the Admin SDK", async () => {
    // This is a misconfiguration, not an invalid token; rbac.ts turns it into a
    // deny rather than silently treating it as "not an admin".
    const verify = createTokenVerifier(async () => {
      throw new Error("could not load default credentials");
    });
    await expect(verify("any")).rejects.toThrow(/default credentials/);
  });
});

describe("createRoleLookup", () => {
  it("returns the stored role", async () => {
    const lookup = createRoleLookup(async () => stubApp());
    await expect(lookup("uid-1")).resolves.toBe("admin");
  });

  it("returns null when there is no role", async () => {
    const lookup = createRoleLookup(async () => stubApp({ getRole: vi.fn(async () => null) }));
    await expect(lookup("uid-1")).resolves.toBeNull();
  });

  it("propagates a Firestore failure so rbac can decide how to degrade", async () => {
    const lookup = createRoleLookup(async () =>
      stubApp({ getRole: vi.fn(async () => { throw new Error("permission-denied"); }) })
    );
    await expect(lookup("uid-1")).rejects.toThrow("permission-denied");
  });

  it("reads the role from the users collection", () => {
    expect(USERS_COLLECTION).toBe("users");
  });
});
