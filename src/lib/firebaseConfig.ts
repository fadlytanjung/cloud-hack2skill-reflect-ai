import appletConfig from "../../firebase-applet-config.json";

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

const fallback = (appletConfig || {}) as Record<string, string>;

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
    fallback.projectId ||
    "";

  return {
    projectId,
    appId:
      runtimeConfig.appId ||
      (import.meta.env.VITE_FIREBASE_APP_ID as string) ||
      fallback.appId ||
      "",
    storageBucket:
      runtimeConfig.storageBucket ||
      (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
      (projectId ? `${projectId}.firebasestorage.app` : "") ||
      fallback.storageBucket ||
      "",
    apiKey:
      runtimeConfig.apiKey ||
      (import.meta.env.VITE_FIREBASE_API_KEY as string) ||
      fallback.apiKey ||
      "",
    authDomain:
      runtimeConfig.authDomain ||
      (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
      (projectId ? `${projectId}.firebaseapp.com` : "") ||
      fallback.authDomain ||
      "",
    messagingSenderId:
      runtimeConfig.messagingSenderId ||
      (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) ||
      fallback.messagingSenderId ||
      "",
    measurementId:
      runtimeConfig.measurementId ||
      (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string) ||
      fallback.measurementId ||
      "",
    firestoreDatabaseId:
      runtimeConfig.firestoreDatabaseId ||
      (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) ||
      fallback.firestoreDatabaseId ||
      "reflect-ai-app",
  };
}

export const firebaseConfig: FirebaseClientConfig = resolveFirebaseConfig();

export default firebaseConfig;
