import request from "supertest";
import { describe, expect, it } from "vitest";
import { FIXED_NOW, createTestApp } from "../helpers/createTestApp";

describe("GET /api/health", () => {
  it("reports ok and whether a Gemini key is configured", async () => {
    const { app } = createTestApp({ env: { GEMINI_API_KEY: "k" } });
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body).toEqual({
      status: "ok",
      hasApiKey: true,
      timestamp: new Date(FIXED_NOW).toISOString(),
    });
  });

  it("reports hasApiKey false when no key is present", async () => {
    const { app } = createTestApp({ env: {} });
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.hasApiKey).toBe(false);
  });

  it("needs no authentication", async () => {
    const { app } = createTestApp();
    await request(app).get("/api/health").expect(200);
  });
});

describe("GET /api/config/client", () => {
  it("serves the public bootstrap payload", async () => {
    const { app } = createTestApp({
      env: { VITE_FIREBASE_PROJECT_ID: "my-proj", VITE_FIREBASE_API_KEY: "browser-key" },
    });
    const res = await request(app).get("/api/config/client").expect(200);
    expect(res.body).toMatchObject({
      projectId: "my-proj",
      authDomain: "my-proj.firebaseapp.com",
      firestoreDatabaseId: "reflect-ai-app",
    });
  });

  it("never serves a server-side secret to the browser", async () => {
    const { app } = createTestApp({
      env: {
        GEMINI_API_KEY: "gemini-secret-value",
        MAPS_API_KEY: "maps-secret-value",
        WEBHOOK_URL: "https://hooks.example.com/webhook-secret-value",
        DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/discord-secret-value",
      },
    });
    const res = await request(app).get("/api/config/client").expect(200);
    const serialized = JSON.stringify(res.body);
    for (const secret of [
      "gemini-secret-value",
      "maps-secret-value",
      "webhook-secret-value",
      "discord-secret-value",
    ]) {
      expect(serialized, secret).not.toContain(secret);
    }
    // Only the boolean wiring flags are exposed.
    expect(res.body.mapsConfigured).toBe(true);
    expect(res.body.discordConfigured).toBe(true);
  });
});
