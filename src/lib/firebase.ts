import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  signInAnonymously,
  User,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";
import { JournalEntry, UserProfile } from "../types";

// Initialize Firebase App instance safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase Authentication
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// Initialize Cloud Firestore using custom provisioned database ID
export const db = getFirestore(
  app,
  firebaseConfig.firestoreDatabaseId || "(default)"
);

/**
 * Validate Connection to Cloud Firestore on Boot (Mandated by Firebase Skill)
 */
export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, "test", "connection"));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.warn("Please check your Firebase configuration or network status.");
    }
    return false;
  }
}

// Fire initial connection test silently
testConnection().catch(() => {});

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map((provider) => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Strict Undefined-Stripping (Zero-Crash Payload Hygiene)
 * Eliminates all undefined values from payload objects before sending to Firestore SDK.
 */
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return null as any;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForFirestore(item)) as any;
  }
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

const LOCAL_ENTRIES_KEY = "reflect_ai_local_entries";
export const PREVIEW_USER_KEY = "reflect_ai_preview_user";

// Event bus so preview-session subscribers re-render on a local save.
const entryListeners: Set<(entries: JournalEntry[]) => void> = new Set();
export const authListeners: Set<(user: UserProfile | null) => void> = new Set();

function getLocalEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(LOCAL_ENTRIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalEntries(entries: JournalEntry[]): void {
  try {
    localStorage.setItem(LOCAL_ENTRIES_KEY, JSON.stringify(entries));
    entryListeners.forEach((listener) => listener(entries));
  } catch (err) {
    console.warn("Failed to persist local entries:", err);
  }
}

/**
 * Clear local entries buffer (e.g. on logout or account switch)
 */
export function clearLocalEntries(): void {
  try {
    localStorage.removeItem(LOCAL_ENTRIES_KEY);
    entryListeners.forEach((listener) => listener([]));
  } catch (err) {
    console.warn("Failed to clear local entries:", err);
  }
}

export function isReferrerBlocked(error: any): boolean {
  if (!error) return false;
  const msg = (error?.message || error?.code || "").toLowerCase();
  return (
    msg.includes("requests-from-referer") ||
    msg.includes("blocked") ||
    msg.includes("unauthorized-domain") ||
    msg.includes("operation-not-allowed") ||
    msg.includes("popup-blocked")
  );
}

/**
 * Sign in with Google Popup (Real Firebase Authentication)
 * Generates a fresh provider instance with prompt: "select_account"
 * to ensure the account chooser is always displayed so users can switch accounts easily.
 */
export async function signInWithGoogle(): Promise<User> {
  try {
    // Clean up any preview session state before initiating real Google Auth
    localStorage.removeItem(PREVIEW_USER_KEY);
    
    // Always instantiate a fresh GoogleAuthProvider with prompt: "select_account"
    // so Google doesn't silently reuse a previous session when switching accounts.
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
    });

    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    // User voluntarily closed or cancelled the popup window (not a fatal system crash)
    if (error?.code === "auth/cancelled-popup-request" || error?.code === "auth/popup-closed-by-user") {
      console.info("Google sign-in popup was dismissed by the user.");
      const cancelError = new Error("Sign-in cancelled. Please select an account in the popup window.");
      (cancelError as any).code = error?.code;
      (cancelError as any).isCancelled = true;
      throw cancelError;
    }

    console.error("Google popup sign-in error:", error);
    if (error?.code === "auth/unauthorized-domain") {
      const hostname = typeof window !== "undefined" ? window.location.hostname : "preview domain";
      const domainError = new Error(
        `Domain '${hostname}' is not authorized in Firebase Auth. Add '${hostname}' in Firebase Console -> Authentication -> Settings -> Authorized Domains.`
      );
      (domainError as any).code = "auth/unauthorized-domain";
      (domainError as any).unauthorizedDomain = hostname;
      throw domainError;
    }
    if (error?.code === "auth/popup-blocked") {
      const popupError = new Error(
        "Sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab."
      );
      (popupError as any).code = "auth/popup-blocked";
      throw popupError;
    }
    if (isReferrerBlocked(error)) {
      const authDomain = firebaseConfig.authDomain || "your-firebase-project.firebaseapp.com";
      throw new Error(
        `API Key HTTP Referrer blocked requests from '${window.location.origin}'. Ensure '${window.location.origin}/*' and 'https://${authDomain}/*' are in Allowed Referrers in Google Cloud Console.`
      );
    }
    throw error;
  }
}

/**
 * Sign in with Anonymous mode (Real Firebase Authentication)
 */
export async function signInAsGuest(): Promise<User> {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(PREVIEW_USER_KEY);
    }
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (error: any) {
    if (
      error?.code === "auth/admin-restricted-operation" ||
      error?.code === "auth/operation-not-allowed"
    ) {
      throw new Error(
        "Anonymous sign-in is disabled. Enable 'Anonymous' in Firebase Console -> Authentication -> Sign-in method."
      );
    }
    if (error?.code === "auth/unauthorized-domain") {
      throw new Error(
        `Domain '${window.location.hostname}' is not authorized in Firebase Auth. Add '${window.location.hostname}' in Firebase Console -> Authentication -> Settings -> Authorized Domains.`
      );
    }
    throw error;
  }
}

/**
 * Instant demo sign-in for testing RBAC (standard user vs admin)
 */
export function signInAsDemoUser(role: "admin" | "user" = "user"): UserProfile {
  const demoUser: UserProfile = {
    uid: `preview-user-${role}-${Date.now().toString(36)}`,
    displayName: role === "admin" ? "Demo Admin User" : "Demo Standard User",
    email: `${role}.demo@reflectai.internal`,
    photoURL: null,
    role,
  };
  try {
    localStorage.setItem(PREVIEW_USER_KEY, JSON.stringify(demoUser));
  } catch {}
  authListeners.forEach((l) => l(demoUser));
  return demoUser;
}

/**
 * Sign out current user completely (clears Firebase session, preview session, and local entry caches)
 */
export async function logoutUser(): Promise<void> {
  try {
    localStorage.removeItem(PREVIEW_USER_KEY);
    clearLocalEntries();
    authListeners.forEach((l) => l(null));
    await signOut(auth);
  } catch (err) {
    console.warn("Sign out notice:", err);
  }
}

/**
 * Update a user's role in Cloud Firestore (/users/{userId}) and local state
 */
/**
 * Local-preview role toggle.
 *
 * A real account's role cannot be changed from the browser: Firestore rules
 * forbid writing `users/{uid}.role`. Use `scripts/set-user-role.sh` (or the
 * Admin SDK) instead. This exists only so the sandboxed preview session can
 * demonstrate the admin UI.
 */
export async function updateUserRoleInFirestore(uid: string, role: "admin" | "user"): Promise<void> {
  if (!uid) return;

  if (uid.startsWith("preview-user")) {
    const current = localStorage.getItem(PREVIEW_USER_KEY);
    if (current) {
      try {
        const parsed = JSON.parse(current);
        parsed.role = role;
        localStorage.setItem(PREVIEW_USER_KEY, JSON.stringify(parsed));
        authListeners.forEach((l) => l(parsed));
      } catch {}
    }
    return;
  }

  console.warn(
    `[RBAC] Refusing to write role '${role}' for ${uid} from the browser. ` +
      "Roles are predefined data -- run scripts/set-user-role.sh instead."
  );
}

/**
 * Synchronize the user profile into /users/{userId} on every authenticated session.
 *
 * This never writes `role`. Roles are predefined data, granted out of band with
 * scripts/set-user-role.sh, and Firestore rules reject a client write to that
 * field — otherwise an account could assign itself the role that governs it.
 */
export async function syncUserProfile(profile: UserProfile): Promise<void> {
  if (!profile || !profile.uid || profile.uid.startsWith("preview-user")) {
    return;
  }

  try {
    const userDocRef = doc(db, "users", profile.uid);
    // `role` is deliberately absent. It is predefined data, seeded with
    // scripts/set-user-role.sh, and Firestore rules reject any client write to
    // it -- otherwise an account could grant itself the role that governs it.
    const payload = sanitizeForFirestore({
      uid: profile.uid,
      email: profile.email || null,
      displayName: profile.displayName || "Reflector",
      photoURL: profile.photoURL || null,
      lastLoginAt: Date.now(),
    });
    await setDoc(userDocRef, payload, { merge: true });
  } catch (err: any) {
    console.warn("[Firestore] User profile sync error:", err?.code || err?.message || err);
  }
}

/**
 * Reads the predefined role for a user from Cloud Firestore.
 *
 * This is a hint for the UI only. It decides which controls to show; it grants
 * nothing. Every privileged action is re-checked server-side against a verified
 * ID token, so a tampered client sees admin buttons that return 403.
 */
export async function fetchUserRole(uid: string): Promise<"admin" | "user"> {
  if (!uid || uid.startsWith("preview-user")) return "user";
  try {
    const snapshot = await getDoc(doc(db, "users", uid));
    return snapshot.exists() && snapshot.data()?.role === "admin" ? "admin" : "user";
  } catch (err: any) {
    console.warn("[Firestore] Role lookup failed:", err?.code || err?.message || err);
    return "user";
  }
}

/**
 * The current user's Firebase ID token, for the Authorization header on
 * /api/admin/* calls. The server verifies it cryptographically.
 */
export async function getIdTokenForApi(): Promise<string | null> {
  try {
    return (await auth.currentUser?.getIdToken()) ?? null;
  } catch (err: any) {
    console.warn("[Auth] Could not obtain an ID token:", err?.code || err?.message || err);
    return null;
  }
}

/** Authorization header for the admin API, or an empty object when signed out. */
export async function adminAuthHeaders(): Promise<Record<string, string>> {
  const token = await getIdTokenForApi();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Auth state listener adapter
 */
export function onAuthUserChanged(callback: (user: UserProfile | null) => void) {
  authListeners.add(callback);

  // Check if preview session active
  if (typeof localStorage !== "undefined") {
    const storedPreview = localStorage.getItem(PREVIEW_USER_KEY);
    if (storedPreview && !auth.currentUser) {
      try {
        callback(JSON.parse(storedPreview));
      } catch {}
    }
  }

  return onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(PREVIEW_USER_KEY);
      }

      // Everyone starts as a standard user. The role is predefined data in
      // Firestore; no email address is privileged, and nothing here grants
      // access -- the server re-checks every admin call against a verified token.
      const profile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || (firebaseUser.isAnonymous ? "Guest Explorer" : "Reflector"),
        photoURL: firebaseUser.photoURL,
        role: "user",
      };

      callback(profile);

      // Write the profile (never the role), then read the role back and, if the
      // user is an administrator, re-emit so the UI reveals the admin controls.
      void (async () => {
        try {
          await syncUserProfile(profile);
        } catch (e) {
          console.warn("[Auth] Profile sync notice:", e);
        }

        const claimAdmin = await firebaseUser
          .getIdTokenResult?.()
          .then((r) => r?.claims?.admin === true || r?.claims?.role === "admin")
          .catch(() => false);

        const role =
          claimAdmin || (await fetchUserRole(firebaseUser.uid)) === "admin" ? "admin" : "user";

        if (role === "admin") {
          callback({ ...profile, role });
        }
      })();
    } else {
      if (typeof localStorage !== "undefined") {
        const preview = localStorage.getItem(PREVIEW_USER_KEY);
        if (preview) {
          try {
            callback(JSON.parse(preview));
            return;
          } catch {}
        }
      }
      callback(null);
    }
  });
}

/**
 * Synchronize any locally cached entries into Cloud Firestore.
 * This runs automatically when an authenticated user connects, ensuring any entries
 * created previously or while offline are pushed to Firestore immediately.
 */
export async function syncOfflineEntries(userId: string): Promise<number> {
  if (!userId || userId.startsWith("preview-user")) return 0;
  const local = getLocalEntries();
  if (local.length === 0) return 0;

  let syncedCount = 0;
  const remaining: JournalEntry[] = [];

  for (const entry of local) {
    try {
      const cleanPayload = sanitizeForFirestore({
        ...entry,
        userId,
        updatedAt: entry.updatedAt || Date.now(),
      });
      const entryDocRef = doc(db, "users", userId, "interactions", entry.id);
      await setDoc(entryDocRef, cleanPayload, { merge: true });
      syncedCount++;
    } catch (e: any) {
      console.warn("Could not sync local entry to Firestore yet:", entry.id, e?.message || e);
      remaining.push(entry);
    }
  }

  saveLocalEntries(remaining);
  return syncedCount;
}

/**
 * Save or update a Journal Entry
 * Persists directly to Cloud Firestore (/users/{userId}/interactions/{entryId}).
 * In case of temporary network disconnect, preserves a local copy as a safety net
 * and bubbles up the error so the UI can accurately reflect sync status.
 */
export async function saveJournalEntry(userId: string, entry: JournalEntry): Promise<void> {
  if (!userId) {
    throw new Error("Cannot save entry: No authenticated user ID provided.");
  }
  if (!entry || !entry.id) {
    throw new Error("Cannot save entry: Invalid entry payload.");
  }

  const cleanPayload = sanitizeForFirestore({
    ...entry,
    userId,
    updatedAt: Date.now(),
  });

  // If local preview user, persist locally
  if (userId.startsWith("preview-user")) {
    const current = getLocalEntries();
    const idx = current.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      current[idx] = cleanPayload;
    } else {
      current.unshift(cleanPayload);
    }
    saveLocalEntries(current);
    return;
  }

  try {
    const entryDocRef = doc(db, "users", userId, "interactions", entry.id);
    await setDoc(entryDocRef, cleanPayload, { merge: true });
    
    // Once confirmed written to Cloud Firestore, remove from local offline buffer
    const current = getLocalEntries().filter((e) => e.id !== entry.id);
    saveLocalEntries(current);
  } catch (err: any) {
    // Safety net: preserve locally so user work is never lost
    const current = getLocalEntries();
    const idx = current.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      current[idx] = cleanPayload;
    } else {
      current.unshift(cleanPayload);
    }
    saveLocalEntries(current);

    // Bubble error to UI: never fail silently!
    throw new Error(
      `Firestore save failed: ${err?.code || err?.message || "Permission or network error"}. Local copy preserved.`
    );
  }
}

/**
 * Delete a Journal Entry from Cloud Firestore or Local Store
 */
export async function deleteJournalEntry(userId: string, entryId: string): Promise<void> {
  if (!userId || !entryId) return;

  // Always remove from local cache
  const current = getLocalEntries().filter((e) => e.id !== entryId);
  saveLocalEntries(current);

  if (userId.startsWith("preview-user")) {
    return;
  }

  try {
    const entryDocRef = doc(db, "users", userId, "interactions", entryId);
    await deleteDoc(entryDocRef);
  } catch (err: any) {
    console.warn("Firestore delete failed:", err?.message || err);
    throw err;
  }
}

/**
 * Real-time subscription to user's journal entries
 */
export function subscribeToUserInteractions(
  userId: string,
  onData: (entries: JournalEntry[]) => void,
  onError: (error: Error) => void
) {
  if (!userId) {
    onData([]);
    return () => {};
  }

  // Preview user session: listen to local storage
  if (userId.startsWith("preview-user")) {
    const emit = () => onData(getLocalEntries());
    emit();
    entryListeners.add(emit);
    return () => {
      entryListeners.delete(emit);
    };
  }

  const colRef = collection(db, "users", userId, "interactions");
  const q = query(colRef, orderBy("updatedAt", "desc"));

  return onSnapshot(
    q,
    (snapshot) => {
      const entries: JournalEntry[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as JournalEntry;
        entries.push({
          ...data,
          id: docSnap.id,
        });
      });
      onData(entries);
    },
    (err) => {
      console.warn("[Firestore Subscription Notice]:", err?.code || err?.message || err);
      // Fallback to local entries if Firestore permissions/network disconnect occurs
      const fallback = getLocalEntries();
      if (fallback.length > 0) {
        onData(fallback);
      }
      onError(err);
    }
  );
}
