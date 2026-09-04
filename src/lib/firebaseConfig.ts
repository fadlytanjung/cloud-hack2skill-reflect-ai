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

const projectId =
  (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) ||
  fallback.projectId ||
  "";

export const firebaseConfig: FirebaseClientConfig = {
  projectId,
  appId:
    (import.meta.env.VITE_FIREBASE_APP_ID as string) ||
    fallback.appId ||
    "",
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
    (projectId ? `${projectId}.firebasestorage.app` : "") ||
    fallback.storageBucket ||
    "",
  apiKey:
    (import.meta.env.VITE_FIREBASE_API_KEY as string) ||
    fallback.apiKey ||
    "",
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
    (projectId ? `${projectId}.firebaseapp.com` : "") ||
    fallback.authDomain ||
    "",
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) ||
    fallback.messagingSenderId ||
    "",
  measurementId:
    (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string) ||
    fallback.measurementId ||
    "",
  firestoreDatabaseId:
    (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) ||
    fallback.firestoreDatabaseId ||
    "reflect-ai-app",
};

export default firebaseConfig;
