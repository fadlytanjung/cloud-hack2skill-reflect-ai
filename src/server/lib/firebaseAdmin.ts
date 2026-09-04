/**
 * Firebase Admin adapters: ID token verification and role lookup.
 *
 * This is the only module that talks to Firebase from the server, and it is
 * deliberately thin — the authorization decision itself lives in `rbac.ts` as a
 * pure function, so it can be tested without credentials.
 *
 * On Cloud Run the Admin SDK uses Application Default Credentials from the
 * runtime service account, so no key file is needed or wanted. The service
 * account requires `roles/datastore.user` to read `users/{uid}`.
 */

import type { RoleLookup, TokenVerifier, VerifiedToken } from "./rbac";
import type { EnvMap } from "./clientConfig";

/** Firestore collection holding the predefined role for each user. */
export const USERS_COLLECTION = "users";
export const DEFAULT_FIRESTORE_DATABASE_ID = "reflect-ai-app";

export function resolveProjectId(env: EnvMap): string {
  return (
    env.GCP_PROJECT_ID ||
    env.VITE_FIREBASE_PROJECT_ID ||
    env.FIREBASE_PROJECT_ID ||
    env.GOOGLE_CLOUD_PROJECT ||
    ""
  );
}

export function resolveDatabaseId(env: EnvMap): string {
  return (
    env.VITE_FIREBASE_DATABASE_ID || env.FIREBASE_DATABASE_ID || DEFAULT_FIRESTORE_DATABASE_ID
  );
}

/** Narrow view of the Admin SDK surface used here, so tests can substitute it. */
export interface AdminApp {
  verifyIdToken(idToken: string): Promise<VerifiedToken>;
  getRole(uid: string): Promise<string | null>;
}

/** Token verifier backed by the Admin SDK. Returns null for any invalid token. */
export function createTokenVerifier(getAdminApp: () => Promise<AdminApp>): TokenVerifier {
  return async (idToken: string) => {
    const app = await getAdminApp();
    try {
      return await app.verifyIdToken(idToken);
    } catch (err: any) {
      // Expired, malformed, wrong audience, revoked — all simply "not verified".
      console.warn("[Firebase Admin] ID token rejected:", err?.code || err?.message || err);
      return null;
    }
  };
}

/** Role lookup backed by Firestore `users/{uid}.role`. */
export function createRoleLookup(getAdminApp: () => Promise<AdminApp>): RoleLookup {
  return async (uid: string) => {
    const app = await getAdminApp();
    return app.getRole(uid);
  };
}
