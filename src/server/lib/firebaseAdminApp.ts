/**
 * Firebase Admin SDK bootstrap.
 *
 * Isolated in its own module, like `devServer.ts`, because it is pure external
 * wiring: it cannot run without real Application Default Credentials, so there
 * is nothing here a unit test could meaningfully assert. Every function it
 * returns is covered in `firebaseAdmin.test.ts` through the `AdminApp` stub.
 *
 * On Cloud Run the credentials come from the runtime service account, which
 * needs Firestore read access (`roles/datastore.user`, or anything that
 * includes it). No key file is used or wanted.
 */

import type { EnvMap } from "./clientConfig";
import {
  resolveDatabaseId,
  resolveProjectId,
  USERS_COLLECTION,
  type AdminApp,
} from "./firebaseAdmin";

/** Lazily initializes the Admin SDK, memoizing the resulting adapter. */
export function createAdminApp(env: EnvMap = process.env): () => Promise<AdminApp> {
  let ready: Promise<AdminApp> | null = null;

  return function getAdminApp() {
    if (!ready) {
      ready = (async () => {
        // Dynamic so neither the test suite nor a Vite client build pulls
        // firebase-admin into scope.
        const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
        const { getAuth } = await import("firebase-admin/auth");
        const { getFirestore } = await import("firebase-admin/firestore");

        const projectId = resolveProjectId(env);
        const databaseId = resolveDatabaseId(env);

        const app =
          getApps().length > 0
            ? getApps()[0]!
            : initializeApp({ credential: applicationDefault(), projectId });

        const auth = getAuth(app);
        const firestore = getFirestore(app, databaseId);

        console.log(
          `[Firebase Admin] Initialized for project '${projectId}' (database '${databaseId}')`
        );

        return {
          async verifyIdToken(idToken: string) {
            return (await auth.verifyIdToken(idToken)) as unknown as Awaited<
              ReturnType<AdminApp["verifyIdToken"]>
            >;
          },
          async getRole(uid: string) {
            const snapshot = await firestore.collection(USERS_COLLECTION).doc(uid).get();
            if (!snapshot.exists) return null;
            const role = snapshot.data()?.role;
            return typeof role === "string" ? role : null;
          },
        };
      })();
    }
    return ready;
  };
}
