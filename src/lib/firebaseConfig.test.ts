import { describe, expect, it } from "vitest";
import { firebaseConfig } from "./firebaseConfig";

/**
 * `firebaseConfig` reads `import.meta.env` at module load, so these assertions
 * run against the values pinned in `vitest.config.ts`.
 */
describe("firebaseConfig", () => {
  it("reads the project id straight from the Vite environment", () => {
    expect(firebaseConfig.projectId).toBe("reflect-ai-test");
    expect(firebaseConfig.apiKey).toBe("test-api-key");
  });

  it("derives authDomain and storageBucket from the project id", () => {
    expect(firebaseConfig.authDomain).toBe("reflect-ai-test.firebaseapp.com");
    expect(firebaseConfig.storageBucket).toBe("reflect-ai-test.firebasestorage.app");
  });

  it("targets the provisioned named database, not (default)", () => {
    // ReflectAI runs on a named Firestore database; falling back to "(default)"
    // would silently read and write the wrong store.
    expect(firebaseConfig.firestoreDatabaseId).toBe("reflect-ai-app");
  });

  it("declares every field the Firebase SDK requires as a string", () => {
    for (const key of [
      "projectId",
      "appId",
      "storageBucket",
      "apiKey",
      "authDomain",
      "messagingSenderId",
    ] as const) {
      expect(typeof firebaseConfig[key], key).toBe("string");
    }
  });

  it("carries only public client identifiers, never a server-side secret name", () => {
    const keys = Object.keys(firebaseConfig);
    for (const forbidden of ["geminiApiKey", "mapsApiKey", "webhookUrl", "discordWebhookUrl"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });
});
