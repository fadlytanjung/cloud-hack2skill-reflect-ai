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

const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID as string) || "";

export const firebaseConfig: FirebaseClientConfig = {
  projectId,
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string) || "",
  storageBucket:
    (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string) ||
    (projectId ? `${projectId}.firebasestorage.app` : ""),
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string) || "",
  authDomain:
    (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string) ||
    (projectId ? `${projectId}.firebaseapp.com` : ""),
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || "",
  measurementId: (import.meta.env.VITE_FIREBASE_MEASUREMENT_ID as string) || "",
  firestoreDatabaseId:
    (import.meta.env.VITE_FIREBASE_DATABASE_ID as string) || "reflect-ai-app",
};

export default firebaseConfig;
