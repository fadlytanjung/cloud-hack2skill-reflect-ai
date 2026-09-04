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

// Event bus so preview-session subscribers re-render on a local save.
const entryListeners: Set<(entries: JournalEntry[]) => void> = new Set();

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
 */
export async function signInWithGoogle(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    console.error("Google popup sign-in error:", error);
    if (error?.code === "auth/unauthorized-domain") {
      throw new Error(
        `Domain '${window.location.hostname}' is not authorized in Firebase Auth. Add '${window.location.hostname}' in Firebase Console -> Authentication -> Settings -> Authorized Domains.`
      );
    }
    if (error?.code === "auth/popup-blocked") {
      throw new Error(
        "Sign-in popup was blocked by your browser. Please allow popups for this site or open in a new tab."
      );
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
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (error: any) {
    console.error("Guest sign-in error:", error);
    if (error?.code === "auth/admin-restricted-operation" || error?.code === "auth/operation-not-allowed") {
      throw new Error(
        "Anonymous sign-in is not enabled in Firebase. Enable 'Anonymous' in Firebase Console -> Authentication -> Sign-in method."
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
 * Sign out current user
 */
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

/**
 * Synchronize user profile into Cloud Firestore /users/{userId} on every authenticated session
 */
export async function syncUserProfile(profile: UserProfile): Promise<void> {
  if (!profile || !profile.uid || profile.uid.startsWith("preview-user")) return;
  try {
    const userDocRef = doc(db, "users", profile.uid);
    const payload = sanitizeForFirestore({
      uid: profile.uid,
      email: profile.email || null,
      displayName: profile.displayName || "Reflector",
      photoURL: profile.photoURL || null,
      lastLoginAt: Date.now(),
    });
    await setDoc(userDocRef, payload, { merge: true });
    console.log("[Firestore] Synchronized user record to Cloud Firestore /users/" + profile.uid);
  } catch (err: any) {
    console.warn("[Firestore] User profile sync error:", err?.code || err?.message || err);
  }
}

/**
 * Auth state listener adapter
 */
export function onAuthUserChanged(callback: (user: UserProfile | null) => void) {
  return onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      const profile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || (firebaseUser.isAnonymous ? "Guest Explorer" : "Reflector"),
        photoURL: firebaseUser.photoURL,
      };
      // Immediately write user record to Firestore so user document appears in Firebase Console
      syncUserProfile(profile);
      callback(profile);
    } else {
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
