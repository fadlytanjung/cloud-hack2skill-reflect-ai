/**
 * Client bootstrap configuration.
 *
 * Derives the public (non-secret) Firebase / service-discovery payload served by
 * `GET /api/config/client` from a plain environment map. Kept free of
 * `process.env` reads so it can be exercised deterministically in tests.
 */

export interface ClientConfigPayload {
  projectId: string;
  appId: string;
  storageBucket: string;
  authDomain: string;
  messagingSenderId: string;
  firestoreDatabaseId: string;
  apiKey: string;
  firebaseKeyName: string;
  oauthClientId: string;
  hostingSite: string;
  secretManagerSecret: string;
  discordConfigured: boolean;
  mapsConfigured: boolean;
}

export interface FirebaseClientConfigPayload {
  projectId: string;
  appId: string;
  storageBucket: string;
  apiKey: string;
  authDomain: string;
  messagingSenderId: string;
  measurementId?: string;
  firestoreDatabaseId: string;
}

export type EnvMap = Record<string, string | undefined>;

/**
 * Resolves the effective Discord webhook: an explicit DISCORD_WEBHOOK_URL wins,
 * otherwise a generic WEBHOOK_URL is adopted only when it points at Discord.
 */
export function resolveDiscordWebhook(env: EnvMap): string {
  if (env.DISCORD_WEBHOOK_URL) return env.DISCORD_WEBHOOK_URL;
  if (env.WEBHOOK_URL?.includes("discord.com")) return env.WEBHOOK_URL;
  return "";
}

/**
 * Builds the public Firebase client SDK configuration from the environment.
 * Injected into the browser bundle at runtime by server.ts to ensure Cloud Run
 * containers mounted with Secret Manager work seamlessly without build-time inlining.
 */
export function buildFirebaseClientConfig(
  env: EnvMap,
  fallbackConfig: Record<string, string> = {}
): FirebaseClientConfigPayload {
  const projectId =
    env.VITE_FIREBASE_PROJECT_ID ||
    env.FIREBASE_PROJECT_ID ||
    env.GCP_PROJECT_ID ||
    fallbackConfig.projectId ||
    "";

  return {
    projectId,
    appId: env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || fallbackConfig.appId || "",
    storageBucket:
      env.VITE_FIREBASE_STORAGE_BUCKET ||
      fallbackConfig.storageBucket ||
      (projectId ? `${projectId}.firebasestorage.app` : ""),
    apiKey:
      env.VITE_FIREBASE_API_KEY ||
      env.FIREBASE_API_KEY ||
      env.FIREBASE_WEB_API_KEY ||
      fallbackConfig.apiKey ||
      "",
    authDomain:
      env.VITE_FIREBASE_AUTH_DOMAIN ||
      fallbackConfig.authDomain ||
      (projectId ? `${projectId}.firebaseapp.com` : ""),
    messagingSenderId:
      env.VITE_FIREBASE_MESSAGING_SENDER_ID || fallbackConfig.messagingSenderId || "",
    measurementId:
      env.VITE_FIREBASE_MEASUREMENT_ID || fallbackConfig.measurementId || "",
    firestoreDatabaseId:
      env.VITE_FIREBASE_DATABASE_ID ||
      env.FIREBASE_DATABASE_ID ||
      fallbackConfig.firestoreDatabaseId ||
      "reflect-ai-app",
  };
}

export function buildClientConfig(env: EnvMap): ClientConfigPayload {
  const projectId =
    env.VITE_FIREBASE_PROJECT_ID || env.FIREBASE_PROJECT_ID || env.GCP_PROJECT_ID || "";

  return {
    projectId,
    appId: env.VITE_FIREBASE_APP_ID || env.FIREBASE_APP_ID || "",
    storageBucket:
      env.VITE_FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.firebasestorage.app` : ""),
    apiKey: env.VITE_FIREBASE_API_KEY || env.FIREBASE_API_KEY || "",
    authDomain:
      env.VITE_FIREBASE_AUTH_DOMAIN || (projectId ? `${projectId}.firebaseapp.com` : ""),
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
    firestoreDatabaseId:
      env.VITE_FIREBASE_DATABASE_ID || env.FIREBASE_DATABASE_ID || "reflect-ai-app",
    // Explicit API Key & OAuth naming (replacing vague 'Browser key' labels)
    firebaseKeyName: env.FIREBASE_KEY_NAME || "reflect-ai-app",
    oauthClientId: env.OAUTH_CLIENT_ID || "reflect-ai-app",
    hostingSite:
      env.FIREBASE_HOSTING_SITE || (projectId ? `${projectId}-reflect-ai` : "reflect-ai-app"),
    secretManagerSecret: env.SECRET_NAME || "reflect-ai-env",
    discordConfigured: Boolean(resolveDiscordWebhook(env)),
    mapsConfigured: Boolean(env.MAPS_API_KEY),
  };
}
