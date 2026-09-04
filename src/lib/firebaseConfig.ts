/**
 * Firebase client configuration, resolved at runtime rather than baked in.
 *
 * Order of precedence:
 *   1. `window.__FIREBASE_CONFIG__` — injected into the served HTML by
 *      `server.ts` from the environment, which on Cloud Run comes from the
 *      `reflect-ai-env` secret. This is the production path.
 *   2. `import.meta.env.VITE_FIREBASE_*` — inlined by Vite from a local `.env`.
 *      This is the local development path.
 *   3. Derived defaults from the project id.
 *
 * There is deliberately no import of `firebase-applet-config.json`. That file is
 * gitignored (it is the file that leaked an API key in the pre-rewrite history),
 * so a static import of it resolves on one laptop and nowhere else: `gcloud
 * builds submit` derives its upload filter from `.gitignore`, so Cloud Build
 * never receives it and Rollup fails with "Could not resolve". The server still
 * reads that file at runtime if it happens to exist, guarded by `existsSync`.
 *
 * Runtime injection is also what makes a key rotation take effect: the built
 * assets are served with `max-age=31536000, immutable`, so anything inlined at
 * build time would be pinned in caches until the filename hash changes.
 */
export interface FirebaseClientConfig {
  projectId: string;
  appId: string;
  storageBucket: string;
  apiKey: string;
  authDomain: string;
  messagingSenderId: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
}

interface WindowWithFirebaseConfig {
  __FIREBASE_CONFIG__?: Partial<FirebaseClientConfig>;
}

export function resolveFirebaseConfig(
  customRuntime?: Partial<FirebaseClientConfig>
): FirebaseClientConfig {
  const runtimeConfig: Partial<FirebaseClientConfig> =
    customRuntime ||
    (typeof window !== "undefined" &&
      (window as unknown as WindowWithFirebaseConfig).__FIREBASE_CONFIG__ &&
      typeof (window as unknown as WindowWithFirebaseConfig).__FIREBASE_CONFIG__ === "object"
      ? (window as unknown as WindowWithFirebaseConfig).__FIREBASE_CONFIG__!
      : {});

  const projectId =
    runtimeConfig.projectId ||
    (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) ||
    "";

  return {
    projectId,
    appId:
      runtimeConfig.appId ||
      (import.meta.env.VITE_FIREBASE_APP_ID as string) ||
      "",
    storageBucket:
      runtimeConfig.storageBucket ||
      (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
      (projectId ? `${projectId}.firebasestorage.app` : "") ||
      "",
    apiKey:
      runtimeConfig.apiKey ||
      (import.meta.env.VITE_FIREBASE_API_KEY as string) ||
      "",
    authDomain:
      runtimeConfig.authDomain ||
      (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
      (projectId ? `${projectId}.firebaseapp.com` : "") ||
      "",
    messagingSenderId:
      runtimeConfig.messagingSenderId ||
      (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) ||
      "",
    measurementId:
      runtimeConfig.measurementId ||
      (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string) ||
      "",
    firestoreDatabaseId:
      runtimeConfig.firestoreDatabaseId ||
      (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) ||
      "reflect-ai-app",
  };
}

export const firebaseConfig: FirebaseClientConfig = resolveFirebaseConfig();

export default firebaseConfig;
