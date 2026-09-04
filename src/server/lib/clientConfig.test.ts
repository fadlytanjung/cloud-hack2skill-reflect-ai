import { describe, expect, it } from "vitest";
import { buildClientConfig, resolveDiscordWebhook } from "./clientConfig";

describe("resolveDiscordWebhook", () => {
  it("prefers an explicit DISCORD_WEBHOOK_URL", () => {
    expect(
      resolveDiscordWebhook({
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/a",
        WEBHOOK_URL: "https://hooks.example.com/x",
      })
    ).toBe("https://discord.com/api/webhooks/1/a");
  });

  it("adopts a generic WEBHOOK_URL only when it points at Discord", () => {
    expect(resolveDiscordWebhook({ WEBHOOK_URL: "https://discord.com/api/webhooks/1/a" })).toBe(
      "https://discord.com/api/webhooks/1/a"
    );
    expect(resolveDiscordWebhook({ WEBHOOK_URL: "https://hooks.example.com/x" })).toBe("");
  });

  it("returns an empty string when neither is configured", () => {
    expect(resolveDiscordWebhook({})).toBe("");
  });
});

describe("buildClientConfig", () => {
  it("derives storage bucket, auth domain and hosting site from the project id", () => {
    const config = buildClientConfig({ VITE_FIREBASE_PROJECT_ID: "my-proj" });
    expect(config).toMatchObject({
      projectId: "my-proj",
      storageBucket: "my-proj.firebasestorage.app",
      authDomain: "my-proj.firebaseapp.com",
      hostingSite: "my-proj-reflect-ai",
    });
  });

  it("prefers explicit overrides over the derived defaults", () => {
    const config = buildClientConfig({
      VITE_FIREBASE_PROJECT_ID: "my-proj",
      VITE_FIREBASE_STORAGE_BUCKET: "custom-bucket",
      VITE_FIREBASE_AUTH_DOMAIN: "auth.example.com",
      FIREBASE_HOSTING_SITE: "my-site",
    });
    expect(config).toMatchObject({
      storageBucket: "custom-bucket",
      authDomain: "auth.example.com",
      hostingSite: "my-site",
    });
  });

  it("falls back through the project id aliases in order", () => {
    expect(buildClientConfig({ FIREBASE_PROJECT_ID: "b", GCP_PROJECT_ID: "c" }).projectId).toBe("b");
    expect(buildClientConfig({ GCP_PROJECT_ID: "c" }).projectId).toBe("c");
    expect(
      buildClientConfig({ VITE_FIREBASE_PROJECT_ID: "a", FIREBASE_PROJECT_ID: "b" }).projectId
    ).toBe("a");
  });

  it("applies the documented defaults when the environment is empty", () => {
    expect(buildClientConfig({})).toEqual({
      projectId: "",
      appId: "",
      storageBucket: "",
      authDomain: "",
      messagingSenderId: "",
      firestoreDatabaseId: "reflect-ai-app",
      firebaseKeyName: "reflect-ai-app",
      oauthClientId: "reflect-ai-app",
      hostingSite: "reflect-ai-app",
      secretManagerSecret: "reflect-ai-env",
      discordConfigured: false,
      mapsConfigured: false,
    });
  });

  it("reports service wiring as booleans without exposing the values", () => {
    const config = buildClientConfig({
      MAPS_API_KEY: "AIza-super-secret",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/secret-token",
    });
    expect(config.mapsConfigured).toBe(true);
    expect(config.discordConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain("AIza-super-secret");
    expect(JSON.stringify(config)).not.toContain("secret-token");
  });

  it("never leaks a server-side secret into the client payload", () => {
    const config = buildClientConfig({
      GEMINI_API_KEY: "gemini-secret",
      MAPS_API_KEY: "maps-secret",
      WEBHOOK_URL: "https://hooks.example.com/webhook-secret",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/discord-secret",
      VITE_FIREBASE_PROJECT_ID: "my-proj",
    });
    const serialized = JSON.stringify(config);
    for (const secret of ["gemini-secret", "maps-secret", "webhook-secret", "discord-secret"]) {
      expect(serialized, secret).not.toContain(secret);
    }
  });

  it("does not read process.env when handed an explicit environment", () => {
    process.env.VITE_FIREBASE_PROJECT_ID = "leaked-from-process";
    try {
      expect(buildClientConfig({}).projectId).toBe("");
    } finally {
      delete process.env.VITE_FIREBASE_PROJECT_ID;
    }
  });
});
