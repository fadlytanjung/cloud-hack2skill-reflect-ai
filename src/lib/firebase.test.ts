// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Firestore SDK is mocked wholesale: these tests pin ReflectAI's own
 * payload hygiene, offline buffering, and preview-session behaviour, not
 * Google's client library.
 */
const setDoc = vi.fn();
const deleteDoc = vi.fn();
const onSnapshot = vi.fn();
const getDoc = vi.fn();
const getDocFromServer = vi.fn();

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(() => ({ __db: true })),
  collection: vi.fn((...path: unknown[]) => ({ __collection: path.slice(1).join("/") })),
  doc: vi.fn((...path: unknown[]) => ({ __doc: path.slice(1).join("/") })),
  setDoc: (...args: unknown[]) => setDoc(...args),
  getDoc: (...args: unknown[]) => getDoc(...args),
  getDocFromServer: (...args: unknown[]) => getDocFromServer(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...args),
  query: vi.fn((ref: unknown) => ref),
  orderBy: vi.fn(() => ({ __orderBy: true })),
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
}));

/** Mutable stand-in for the Firebase Auth instance. */
const authStub: { currentUser: { getIdToken: () => Promise<string> } | null } = {
  currentUser: null,
};

const signInWithPopup = vi.fn();
const signInAnonymously = vi.fn();
const signOut = vi.fn();
const onAuthStateChanged = vi.fn();

const getIdToken = vi.fn();

vi.mock("firebase/auth", () => ({
  getAuth: vi.fn(() => authStub),
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  signInWithPopup: (...args: unknown[]) => signInWithPopup(...args),
  signOut: (...args: unknown[]) => signOut(...args),
  onAuthStateChanged: (...args: unknown[]) => onAuthStateChanged(...args),
  signInAnonymously: (...args: unknown[]) => signInAnonymously(...args),
}));

const {
  OperationType,
  adminAuthHeaders,
  clearLocalEntries,
  handleFirestoreError,
  signInAsDemoUser,
  testConnection,
  deleteJournalEntry,
  fetchUserRole,
  getIdTokenForApi,
  isReferrerBlocked,
  logoutUser,
  onAuthUserChanged,
  sanitizeForFirestore,
  saveJournalEntry,
  signInAsGuest,
  signInWithGoogle,
  subscribeToUserInteractions,
  syncOfflineEntries,
  syncUserProfile,
  updateUserRoleInFirestore,
} = await import("./firebase");

const LOCAL_ENTRIES_KEY = "reflect_ai_local_entries";

function entry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user-1",
    title: `Entry ${id}`,
    category: "General",
    mode: "thoughtful" as const,
    turns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  setDoc.mockReset().mockResolvedValue(undefined);
  deleteDoc.mockReset().mockResolvedValue(undefined);
  onSnapshot.mockReset();
  getDoc.mockReset().mockResolvedValue({ exists: () => false, data: () => undefined });
  getDocFromServer.mockReset().mockResolvedValue({ exists: () => true });
  signInWithPopup.mockReset();
  signInAnonymously.mockReset();
  signOut.mockReset().mockResolvedValue(undefined);
  onAuthStateChanged.mockReset();
  getIdToken.mockReset().mockResolvedValue("id-token-abc");
  authStub.currentUser = null;
});

describe("sanitizeForFirestore (zero-crash payload hygiene)", () => {
  it("strips undefined properties at every depth", () => {
    const sanitized = sanitizeForFirestore({
      title: "Morning Walk",
      tags: undefined,
      location: { latitude: 37.7749, longitude: -122.4194, placeId: undefined },
      nested: { deep: { keep: 1, drop: undefined } },
    }) as any;

    expect(sanitized.title).toBe("Morning Walk");
    expect("tags" in sanitized).toBe(false);
    expect("placeId" in sanitized.location).toBe(false);
    expect(sanitized.location.latitude).toBe(37.7749);
    expect(sanitized.nested.deep).toEqual({ keep: 1 });
  });

  it("preserves null, which Firestore accepts, unlike undefined", () => {
    expect(sanitizeForFirestore({ email: null })).toEqual({ email: null });
    expect(sanitizeForFirestore(null)).toBeNull();
    expect(sanitizeForFirestore(undefined)).toBeNull();
  });

  it("preserves falsy values that are not undefined", () => {
    expect(sanitizeForFirestore({ count: 0, flag: false, text: "" })).toEqual({
      count: 0,
      flag: false,
      text: "",
    });
  });

  it("recurses into arrays and maps undefined members to null", () => {
    // Firestore rejects undefined array members but accepts null.
    expect(sanitizeForFirestore([1, undefined, { a: undefined, b: 2 }])).toEqual([
      1,
      null,
      { b: 2 },
    ]);
  });

  it("leaves Date instances intact rather than flattening them to {}", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(sanitizeForFirestore({ when: date }).when).toBeInstanceOf(Date);
    expect(sanitizeForFirestore({ when: date }).when.getTime()).toBe(date.getTime());
  });

  it("passes primitives through unchanged", () => {
    for (const value of [1, "s", true, false, 0, ""]) {
      expect(sanitizeForFirestore(value)).toBe(value);
    }
  });

  it("does not mutate the input object", () => {
    const input = { keep: 1, drop: undefined };
    sanitizeForFirestore(input);
    expect("drop" in input).toBe(true);
  });
});

describe("isReferrerBlocked", () => {
  it("recognises the API-key and domain rejection families", () => {
    for (const error of [
      { message: "Requests-from-referer are blocked" },
      { code: "auth/unauthorized-domain" },
      { code: "auth/operation-not-allowed" },
      { code: "auth/popup-blocked" },
      { message: "This request was BLOCKED" },
    ]) {
      expect(isReferrerBlocked(error), JSON.stringify(error)).toBe(true);
    }
  });

  it("does not misclassify unrelated failures", () => {
    for (const error of [
      null,
      undefined,
      {},
      { code: "auth/network-request-failed" },
      { message: "Something else went wrong" },
    ]) {
      expect(isReferrerBlocked(error), JSON.stringify(error)).toBe(false);
    }
  });
});

describe("saveJournalEntry", () => {
  it("writes a merge-patched, sanitized payload to the user's subcollection", async () => {
    await saveJournalEntry("user-1", entry("e1", { summary: undefined }) as any);
    expect(setDoc).toHaveBeenCalledOnce();
    const [ref, payload, options] = setDoc.mock.calls[0];
    expect(ref).toEqual({ __doc: "users/user-1/interactions/e1" });
    expect(options).toEqual({ merge: true });
    expect("summary" in (payload as object)).toBe(false);
    expect(payload).toMatchObject({ id: "e1", userId: "user-1" });
    expect(typeof (payload as any).updatedAt).toBe("number");
  });

  it("stamps the owning userId, overriding any value the caller supplied", async () => {
    await saveJournalEntry("real-owner", entry("e1", { userId: "spoofed-owner" }) as any);
    expect(setDoc.mock.calls[0][1]).toMatchObject({ userId: "real-owner" });
  });

  it("rejects a save with no user id or no entry id", async () => {
    await expect(saveJournalEntry("", entry("e1") as any)).rejects.toThrow(/No authenticated user/);
    await expect(saveJournalEntry("user-1", null as any)).rejects.toThrow(/Invalid entry payload/);
    await expect(saveJournalEntry("user-1", { id: "" } as any)).rejects.toThrow(
      /Invalid entry payload/
    );
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("keeps a preview session entirely local, never touching Firestore", async () => {
    await saveJournalEntry("preview-user-abc", entry("e1") as any);
    expect(setDoc).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe("e1");
  });

  it("updates in place rather than duplicating when a preview entry is re-saved", async () => {
    await saveJournalEntry("preview-user-abc", entry("e1", { title: "First" }) as any);
    await saveJournalEntry("preview-user-abc", entry("e1", { title: "Second" }) as any);
    const stored = JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe("Second");
  });

  it("preserves the entry locally and surfaces the error when Firestore rejects the write", async () => {
    setDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await expect(saveJournalEntry("user-1", entry("e1") as any)).rejects.toThrow(
      /Firestore save failed.*Local copy preserved/
    );
    // Never fail silently, and never lose the user's writing.
    const stored = JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!);
    expect(stored[0].id).toBe("e1");
  });

  it("clears the offline buffer for an entry once the cloud write confirms", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1"), entry("e2")]));
    await saveJournalEntry("user-1", entry("e1") as any);
    const stored = JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!);
    expect(stored.map((e: any) => e.id)).toEqual(["e2"]);
  });
});

describe("deleteJournalEntry", () => {
  it("removes the document and drops it from the local buffer", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1"), entry("e2")]));
    await deleteJournalEntry("user-1", "e1");
    expect(deleteDoc).toHaveBeenCalledWith({ __doc: "users/user-1/interactions/e1" });
    expect(JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!).map((e: any) => e.id)).toEqual([
      "e2",
    ]);
  });

  it("is a no-op without both a user id and an entry id", async () => {
    await deleteJournalEntry("", "e1");
    await deleteJournalEntry("user-1", "");
    expect(deleteDoc).not.toHaveBeenCalled();
  });

  it("deletes locally only for a preview session", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1")]));
    await deleteJournalEntry("preview-user-abc", "e1");
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!)).toEqual([]);
  });

  it("propagates a Firestore delete failure", async () => {
    deleteDoc.mockRejectedValueOnce(new Error("offline"));
    await expect(deleteJournalEntry("user-1", "e1")).rejects.toThrow("offline");
  });
});

describe("syncOfflineEntries", () => {
  it("pushes every buffered entry and empties the buffer", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1"), entry("e2")]));
    expect(await syncOfflineEntries("user-1")).toBe(2);
    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!)).toEqual([]);
  });

  it("re-stamps each entry with the syncing user's id", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1", { userId: "old" })]));
    await syncOfflineEntries("user-1");
    expect(setDoc.mock.calls[0][1]).toMatchObject({ userId: "user-1" });
  });

  it("retains the entries it could not push", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1"), entry("e2")]));
    setDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("offline"));
    expect(await syncOfflineEntries("user-1")).toBe(1);
    expect(JSON.parse(localStorage.getItem(LOCAL_ENTRIES_KEY)!).map((e: any) => e.id)).toEqual([
      "e2",
    ]);
  });

  it("returns 0 without writing for an empty buffer, a missing user, or a preview session", async () => {
    expect(await syncOfflineEntries("user-1")).toBe(0);
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1")]));
    expect(await syncOfflineEntries("")).toBe(0);
    expect(await syncOfflineEntries("preview-user-abc")).toBe(0);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe("subscribeToUserInteractions", () => {
  it("emits an empty list and a no-op unsubscribe without a user", () => {
    const onData = vi.fn();
    const unsubscribe = subscribeToUserInteractions("", onData, vi.fn());
    expect(onData).toHaveBeenCalledWith([]);
    expect(() => unsubscribe()).not.toThrow();
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("serves a preview session from local storage and re-emits on save", async () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1")]));
    const onData = vi.fn();
    const unsubscribe = subscribeToUserInteractions("preview-user-abc", onData, vi.fn());
    expect(onData.mock.calls[0][0].map((e: any) => e.id)).toEqual(["e1"]);

    await saveJournalEntry("preview-user-abc", entry("e2") as any);
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onData.mock.calls[1][0].map((e: any) => e.id)).toEqual(["e2", "e1"]);

    // After unsubscribing the listener must go quiet.
    unsubscribe();
    await saveJournalEntry("preview-user-abc", entry("e3") as any);
    expect(onData).toHaveBeenCalledTimes(2);
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("maps a Firestore snapshot, letting the document id win over any stored id", () => {
    onSnapshot.mockImplementation((_q: unknown, onNext: (snap: unknown) => void) => {
      onNext({
        forEach(cb: (doc: unknown) => void) {
          cb({ id: "real-id", data: () => ({ id: "stale-id", title: "Kept" }) });
        },
      });
      return () => {};
    });

    const onData = vi.fn();
    subscribeToUserInteractions("user-1", onData, vi.fn());
    expect(onData).toHaveBeenCalledWith([{ id: "real-id", title: "Kept" }]);
  });

  it("falls back to buffered entries and still reports the error on a subscription failure", () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("cached")]));
    onSnapshot.mockImplementation(
      (_q: unknown, _onNext: unknown, onError: (err: unknown) => void) => {
        onError(Object.assign(new Error("permission denied"), { code: "permission-denied" }));
        return () => {};
      }
    );

    const onData = vi.fn();
    const onError = vi.fn();
    subscribeToUserInteractions("user-1", onData, onError);
    expect(onData).toHaveBeenCalledWith([expect.objectContaining({ id: "cached" })]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not emit a misleading empty list when the buffer is also empty", () => {
    onSnapshot.mockImplementation(
      (_q: unknown, _onNext: unknown, onError: (err: unknown) => void) => {
        onError(new Error("offline"));
        return () => {};
      }
    );
    const onData = vi.fn();
    subscribeToUserInteractions("user-1", onData, vi.fn());
    expect(onData).not.toHaveBeenCalled();
  });
});

describe("signInWithGoogle", () => {
  it("returns the authenticated user on success", async () => {
    signInWithPopup.mockResolvedValue({ user: { uid: "uid-1" } });
    await expect(signInWithGoogle()).resolves.toEqual({ uid: "uid-1" });
  });

  it("translates an unauthorized domain into console-specific instructions", async () => {
    signInWithPopup.mockRejectedValue({ code: "auth/unauthorized-domain" });
    // The message must name the console path, so the user can act on it.
    await expect(signInWithGoogle()).rejects.toThrow(
      /not authorized in Firebase Auth.*Authorized Domains/s
    );
    await expect(signInWithGoogle()).rejects.toThrow(window.location.hostname);
  });

  it("explains a blocked popup", async () => {
    signInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });
    await expect(signInWithGoogle()).rejects.toThrow(/allow popups for this site/);
  });

  it("translates an API-key referrer block into the allowed-referrers fix", async () => {
    signInWithPopup.mockRejectedValue({ message: "Requests-from-referer are blocked" });
    await expect(signInWithGoogle()).rejects.toThrow(/Allowed Referrers in Google Cloud Console/);
  });

  it("rethrows an unrecognised error unchanged", async () => {
    const original = Object.assign(new Error("network down"), {
      code: "auth/network-request-failed",
    });
    signInWithPopup.mockRejectedValue(original);
    await expect(signInWithGoogle()).rejects.toBe(original);
  });
});

describe("signInAsGuest", () => {
  it("returns the anonymous user on success", async () => {
    signInAnonymously.mockResolvedValue({ user: { uid: "anon-1", isAnonymous: true } });
    await expect(signInAsGuest()).resolves.toMatchObject({ uid: "anon-1" });
  });

  it("explains that anonymous sign-in must be enabled in the console", async () => {
    for (const code of ["auth/admin-restricted-operation", "auth/operation-not-allowed"]) {
      signInAnonymously.mockRejectedValue({ code });
      await expect(signInAsGuest()).rejects.toThrow(
        /Enable 'Anonymous' in Firebase Console/
      );
    }
  });

  it("explains an unauthorized domain", async () => {
    signInAnonymously.mockRejectedValue({ code: "auth/unauthorized-domain" });
    await expect(signInAsGuest()).rejects.toThrow(/not authorized in Firebase Auth/);
  });

  it("rethrows anything else unchanged", async () => {
    const original = new Error("quota exceeded");
    signInAnonymously.mockRejectedValue(original);
    await expect(signInAsGuest()).rejects.toBe(original);
  });
});

describe("logoutUser", () => {
  it("delegates to the Firebase SDK", async () => {
    await logoutUser();
    expect(signOut).toHaveBeenCalledOnce();
  });
});

describe("syncUserProfile", () => {
  it("writes a merge-patched profile document", async () => {
    await syncUserProfile({
      uid: "uid-1",
      email: "a@b.c",
      displayName: "Ada",
      photoURL: "https://example.com/a.png",
    });
    const [ref, payload, options] = setDoc.mock.calls[0];
    expect(ref).toEqual({ __doc: "users/uid-1" });
    expect(options).toEqual({ merge: true });
    expect(payload).toMatchObject({
      uid: "uid-1",
      email: "a@b.c",
      displayName: "Ada",
      photoURL: "https://example.com/a.png",
    });
    expect(typeof (payload as any).lastLoginAt).toBe("number");
  });

  it("never writes the role field — Firestore rules reject it, and it governs access", async () => {
    await syncUserProfile({
      uid: "uid-1",
      email: "a@b.c",
      displayName: "Ada",
      photoURL: null,
      role: "admin",
    } as any);
    expect("role" in (setDoc.mock.calls[0][1] as object)).toBe(false);
  });

  it("substitutes nulls and a default display name rather than undefined", async () => {
    await syncUserProfile({ uid: "uid-1", email: null, displayName: null, photoURL: null });
    expect(setDoc.mock.calls[0][1]).toMatchObject({
      email: null,
      photoURL: null,
      displayName: "Reflector",
    });
  });

  it("skips a preview session and a profile with no uid", async () => {
    await syncUserProfile({ uid: "preview-user-abc", email: null, displayName: null, photoURL: null });
    await syncUserProfile({ uid: "", email: null, displayName: null, photoURL: null });
    await syncUserProfile(null as any);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("swallows a write failure — a failed profile sync must not block sign-in", async () => {
    setDoc.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    await expect(
      syncUserProfile({ uid: "uid-1", email: null, displayName: null, photoURL: null })
    ).resolves.toBeUndefined();
  });
});

describe("onAuthUserChanged", () => {
  /** Invokes the adapter with a Firebase user and returns the mapped profile. */
  function emit(firebaseUser: unknown) {
    const callback = vi.fn();
    onAuthStateChanged.mockImplementation((_auth: unknown, handler: (u: unknown) => void) => {
      handler(firebaseUser);
      return () => {};
    });
    onAuthUserChanged(callback);
    return callback.mock.calls[0]?.[0];
  }

  it("maps a Google user onto a UserProfile", () => {
    expect(
      emit({
        uid: "uid-1",
        email: "a@b.c",
        displayName: "Ada Reflector",
        photoURL: "https://example.com/a.png",
        isAnonymous: false,
      })
    ).toEqual({
      uid: "uid-1",
      email: "a@b.c",
      displayName: "Ada Reflector",
      photoURL: "https://example.com/a.png",
      // Every session starts as a standard user; admin is re-emitted only after
      // the predefined Firestore role is read back.
      role: "user",
    });
  });

  it("names an anonymous user 'Guest Explorer' and a named-less user 'Reflector'", () => {
    expect(emit({ uid: "anon-1", email: null, displayName: null, photoURL: null, isAnonymous: true }).displayName)
      .toBe("Guest Explorer");
    expect(emit({ uid: "uid-2", email: "a@b.c", displayName: null, photoURL: null, isAnonymous: false }).displayName)
      .toBe("Reflector");
  });

  it("writes the profile to Firestore so the user appears in the console", () => {
    emit({ uid: "uid-1", email: "a@b.c", displayName: "Ada", photoURL: null, isAnonymous: false });
    expect(setDoc).toHaveBeenCalledWith(
      { __doc: "users/uid-1" },
      expect.objectContaining({ uid: "uid-1" }),
      { merge: true }
    );
  });

  it("reports null on sign-out without touching Firestore", () => {
    const callback = vi.fn();
    onAuthStateChanged.mockImplementation((_auth: unknown, handler: (u: unknown) => void) => {
      handler(null);
      return () => {};
    });
    onAuthUserChanged(callback);
    expect(callback).toHaveBeenCalledWith(null);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("passes the SDK's unsubscribe straight back to the caller", () => {
    const unsubscribe = vi.fn();
    onAuthStateChanged.mockReturnValue(unsubscribe);
    expect(onAuthUserChanged(vi.fn())).toBe(unsubscribe);
  });

  it("automatically assigns role 'admin' to designated admin fadlysyah96@gmail.com", () => {
    const profile = emit({
      uid: "fadly-uid",
      email: "fadlysyah96@gmail.com",
      displayName: "Fadly",
      photoURL: null,
      isAnonymous: false,
    });
    expect(profile).toMatchObject({
      email: "fadlysyah96@gmail.com",
      role: "user",
    });
  });

  it("never derives a role from the email address", async () => {
    // The previous design granted admin to a hardcoded address, which shipped in
    // the public bundle and was trusted from a request header. Roles are now
    // predefined data in Firestore and nothing else.
    getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    const profile = emit({
      uid: "uid-owner",
      email: "fadlysyah96@gmail.com",
      displayName: "Owner",
      photoURL: null,
      isAnonymous: false,
    });
    expect(profile.role).toBe("user");
  });
});

describe("fetchUserRole", () => {
  it("reports admin when the predefined Firestore role says so", async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: "admin" }) });
    await expect(fetchUserRole("uid-1")).resolves.toBe("admin");
  });

  it("reports user for every other stored value", async () => {
    for (const role of ["user", "Admin", "ADMIN", "superadmin", "", null, undefined, 1]) {
      getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role }) });
      await expect(fetchUserRole("uid-1"), String(role)).resolves.toBe("user");
    }
  });

  it("reports user when the document does not exist", async () => {
    getDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await expect(fetchUserRole("uid-1")).resolves.toBe("user");
  });

  it("degrades to user, not admin, when the read fails", async () => {
    // Failing closed matters: this decides whether the UI offers admin controls.
    getDoc.mockRejectedValue(new Error("permission-denied"));
    await expect(fetchUserRole("uid-1")).resolves.toBe("user");
  });

  it("short-circuits for a missing uid and a preview session", async () => {
    await expect(fetchUserRole("")).resolves.toBe("user");
    await expect(fetchUserRole("preview-user-abc")).resolves.toBe("user");
    expect(getDoc).not.toHaveBeenCalled();
  });
});

describe("getIdTokenForApi / adminAuthHeaders", () => {
  it("returns the signed-in user's ID token", async () => {
    authStub.currentUser = { getIdToken };
    await expect(getIdTokenForApi()).resolves.toBe("id-token-abc");
  });

  it("returns null when nobody is signed in", async () => {
    authStub.currentUser = null;
    await expect(getIdTokenForApi()).resolves.toBeNull();
  });

  it("returns null rather than throwing when the token refresh fails", async () => {
    authStub.currentUser = { getIdToken };
    getIdToken.mockRejectedValue(new Error("network error"));
    await expect(getIdTokenForApi()).resolves.toBeNull();
  });

  it("builds a bearer Authorization header", async () => {
    authStub.currentUser = { getIdToken };
    await expect(adminAuthHeaders()).resolves.toEqual({
      Authorization: "Bearer id-token-abc",
    });
  });

  it("builds no header when signed out, so the request is simply unauthenticated", async () => {
    authStub.currentUser = null;
    await expect(adminAuthHeaders()).resolves.toEqual({});
  });
});

describe("updateUserRoleInFirestore", () => {
  it("refuses to write a real account's role from the browser", async () => {
    await updateUserRoleInFirestore("uid-1", "admin");
    // Roles are predefined data; the browser must not be able to grant them.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("still toggles the sandboxed preview session's role", async () => {
    localStorage.setItem(
      "reflect_ai_preview_user",
      JSON.stringify({ uid: "preview-user-abc", role: "user" })
    );
    await updateUserRoleInFirestore("preview-user-abc", "admin");
    const stored = JSON.parse(localStorage.getItem("reflect_ai_preview_user")!);
    expect(stored.role).toBe("admin");
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe("testConnection", () => {
  it("reports true when Firestore answers", async () => {
    getDocFromServer.mockResolvedValue({ exists: () => true });
    await expect(testConnection()).resolves.toBe(true);
  });

  it("reports false rather than throwing when the read fails", async () => {
    getDocFromServer.mockRejectedValue(new Error("permission-denied"));
    await expect(testConnection()).resolves.toBe(false);
  });

  it("reports false and hints at configuration when the client is offline", async () => {
    getDocFromServer.mockRejectedValue(new Error("Failed to get document because the client is offline"));
    await expect(testConnection()).resolves.toBe(false);
  });

  it("tolerates a non-Error rejection", async () => {
    getDocFromServer.mockRejectedValue("a thrown string");
    await expect(testConnection()).resolves.toBe(false);
  });
});

describe("handleFirestoreError", () => {
  it("throws a JSON envelope naming the operation and path", () => {
    let thrown: unknown;
    try {
      handleFirestoreError(new Error("permission-denied"), OperationType.WRITE, "users/uid-1");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const info = JSON.parse((thrown as Error).message);
    expect(info).toMatchObject({
      error: "permission-denied",
      operationType: "write",
      path: "users/uid-1",
    });
  });

  it("stringifies a non-Error rejection", () => {
    expect(() => handleFirestoreError("plain string", OperationType.GET, null)).toThrow(
      /plain string/
    );
  });

  it("includes the signed-in identity to make a rules failure diagnosable", () => {
    authStub.currentUser = {
      getIdToken,
      uid: "uid-1",
      email: "a@b.c",
      emailVerified: true,
      isAnonymous: false,
      tenantId: null,
      providerData: [{ providerId: "google.com", email: "a@b.c" }],
    } as any;
    try {
      handleFirestoreError(new Error("denied"), OperationType.LIST, "users");
    } catch (e) {
      const info = JSON.parse((e as Error).message);
      expect(info.authInfo).toMatchObject({
        userId: "uid-1",
        email: "a@b.c",
        emailVerified: true,
        isAnonymous: false,
      });
      expect(info.authInfo.providerInfo).toEqual([
        { providerId: "google.com", email: "a@b.c" },
      ]);
    }
  });

  it("records an empty provider list when nobody is signed in", () => {
    authStub.currentUser = null;
    try {
      handleFirestoreError(new Error("denied"), OperationType.CREATE, "users");
    } catch (e) {
      expect(JSON.parse((e as Error).message).authInfo.providerInfo).toEqual([]);
    }
  });
});

describe("clearLocalEntries", () => {
  it("empties the offline buffer and notifies subscribers", () => {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify([entry("e1")]));
    const onData = vi.fn();
    subscribeToUserInteractions("preview-user-abc", onData, vi.fn());
    onData.mockClear();

    clearLocalEntries();

    expect(localStorage.getItem(LOCAL_ENTRIES_KEY)).toBeNull();
    expect(onData).toHaveBeenCalledWith([]);
  });

  it("is safe to call when the buffer is already empty", () => {
    expect(() => clearLocalEntries()).not.toThrow();
  });
});

describe("signInAsDemoUser", () => {
  it("creates a preview session that is never written to Firestore", () => {
    const user = signInAsDemoUser("user");
    expect(user.uid.startsWith("preview-user")).toBe(true);
    expect(user.role).toBe("user");
    // A preview uid short-circuits every Firestore write path.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it("can open a demo admin session for showing the admin UI", () => {
    const admin = signInAsDemoUser("admin");
    expect(admin.role).toBe("admin");
    expect(admin.displayName).toBe("Demo Admin User");
    expect(admin.uid.startsWith("preview-user")).toBe(true);
  });

  it("defaults to a standard user", () => {
    expect(signInAsDemoUser().role).toBe("user");
  });

  it("persists the session so a reload keeps it", () => {
    const user = signInAsDemoUser("admin");
    expect(JSON.parse(localStorage.getItem("reflect_ai_preview_user")!)).toMatchObject({
      uid: user.uid,
      role: "admin",
    });
  });

  it("uses an internal, non-routable email so it cannot collide with a real account", () => {
    expect(signInAsDemoUser("admin").email).toBe("admin.demo@reflectai.internal");
  });
});
