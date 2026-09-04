import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp, FIXED_NOW } from "../helpers/createTestApp";
import { MODEL_FALLBACK_LADDER } from "../../src/server/lib/gemini";
import { MAX_PROMPT_LENGTH } from "../../src/server/lib/prompts";

describe("POST /api/gemini/reflect", () => {
  it("returns the model reply with the model used and a timestamp", async () => {
    const { app } = createTestApp({ geminiText: "A gentle reflection." });
    const res = await request(app)
      .post("/api/gemini/reflect")
      .send({ prompt: "I felt scattered today.", mode: "thoughtful" })
      .expect(200);
    expect(res.body).toEqual({
      reply: "A gentle reflection.",
      modelUsed: MODEL_FALLBACK_LADDER[0],
      timestamp: FIXED_NOW,
    });
  });

  it("rejects a missing, blank or non-string prompt with 400", async () => {
    const { app } = createTestApp();
    for (const body of [{}, { prompt: "" }, { prompt: "   " }, { prompt: 42 }, { prompt: null }]) {
      const res = await request(app).post("/api/gemini/reflect").send(body).expect(400);
      expect(res.body.error).toMatch(/prompt or reflection text is required/);
    }
  });

  it("rejects a prompt over the length cap with 400", async () => {
    const { app } = createTestApp();
    const res = await request(app)
      .post("/api/gemini/reflect")
      .send({ prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) })
      .expect(400);
    expect(res.body.error).toContain(String(MAX_PROMPT_LENGTH));
  });

  it("accepts a prompt exactly at the length cap", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/gemini/reflect")
      .send({ prompt: "x".repeat(MAX_PROMPT_LENGTH) })
      .expect(200);
  });

  it("tolerates a malformed history without failing the request", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/gemini/reflect")
      .send({ prompt: "hi", history: "not-an-array" })
      .expect(200);
    await request(app)
      .post("/api/gemini/reflect")
      .send({ prompt: "hi", history: [null, { role: "system", content: "escalate" }] })
      .expect(200);
  });

  it("returns 500 with the configuration hint when no API key is available", async () => {
    const { app } = createTestApp({ withoutGemini: true });
    const res = await request(app).post("/api/gemini/reflect").send({ prompt: "hi" }).expect(500);
    expect(res.body.error).toMatch(/GEMINI_API_KEY/);
  });

  it("returns 500 when every model in the ladder fails", async () => {
    const { app } = createTestApp({ geminiError: new Error("quota exhausted") });
    const res = await request(app).post("/api/gemini/reflect").send({ prompt: "hi" }).expect(500);
    expect(res.body.error).toBe("quota exhausted");
  });
});

describe("POST /api/gemini/reflect-stream", () => {
  it("streams chunks as SSE frames and terminates with DONE", async () => {
    const { app } = createTestApp({ geminiChunks: ["Hello ", "there"] });
    const res = await request(app)
      .post("/api/gemini/reflect-stream")
      .send({ prompt: "hi" })
      .expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.headers["cache-control"]).toContain("no-cache");
    expect(res.text).toContain(`data: {"text":"Hello ","modelUsed":"${MODEL_FALLBACK_LADDER[0]}"}`);
    expect(res.text).toContain('data: {"text":"there"');
    expect(res.text.trimEnd().endsWith("data: [DONE]")).toBe(true);
  });

  it("skips empty chunks so the client never sees a blank frame", async () => {
    const { app } = createTestApp({ geminiChunks: ["a", "", "b"] });
    const res = await request(app)
      .post("/api/gemini/reflect-stream")
      .send({ prompt: "hi" })
      .expect(200);
    const frames = res.text.split("\n\n").filter((f) => f.startsWith("data: ") && !f.includes("[DONE]"));
    expect(frames).toHaveLength(2);
  });

  it("validates the prompt before opening the stream", async () => {
    const { app } = createTestApp();
    const res = await request(app).post("/api/gemini/reflect-stream").send({}).expect(400);
    // A JSON error, not an SSE stream — the client can surface it directly.
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toMatch(/required/);
  });

  it("rejects an over-long prompt before opening the stream", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/gemini/reflect-stream")
      .send({ prompt: "x".repeat(MAX_PROMPT_LENGTH + 1) })
      .expect(400);
  });

  it("reports an upstream failure inside the stream rather than hanging", async () => {
    const { app } = createTestApp({ geminiError: new Error("all models down") });
    const res = await request(app)
      .post("/api/gemini/reflect-stream")
      .send({ prompt: "hi" })
      .expect(200);
    expect(res.text).toContain('"error":"all models down"');
    expect(res.text).not.toContain("[DONE]");
  });
});

describe("POST /api/gemini/summarize", () => {
  it("returns parsed insights from a JSON reply", async () => {
    const { app } = createTestApp({
      geminiText: '{"title":"River Walk","summary":"Steady.","takeaways":["Move"],"sentiment":"Grounded"}',
    });
    const res = await request(app)
      .post("/api/gemini/summarize")
      .send({ text: "I walked by the river." })
      .expect(200);
    expect(res.body.insights).toEqual({
      title: "River Walk",
      summary: "Steady.",
      takeaways: ["Move"],
      sentiment: "Grounded",
    });
    expect(res.body.modelUsed).toBe(MODEL_FALLBACK_LADDER[0]);
  });

  it("unwraps a ```json fenced reply", async () => {
    const { app } = createTestApp({
      geminiText: '```json\n{"title":"Fenced","summary":"s","takeaways":[],"sentiment":"Calm"}\n```',
    });
    const res = await request(app).post("/api/gemini/summarize").send({ text: "x" }).expect(200);
    expect(res.body.insights.title).toBe("Fenced");
  });

  it("degrades gracefully when the model returns prose instead of JSON", async () => {
    const { app } = createTestApp({ geminiText: "Just some lovely prose." });
    const res = await request(app).post("/api/gemini/summarize").send({ text: "x" }).expect(200);
    expect(res.body.insights).toMatchObject({
      title: "Personal Reflection",
      summary: "Just some lovely prose.",
      sentiment: "Contemplative",
    });
  });

  it("falls back to the turn transcript when no text field is given", async () => {
    const { app } = createTestApp();
    await request(app)
      .post("/api/gemini/summarize")
      .send({ turns: [{ role: "user", content: "I felt calm." }] })
      .expect(200);
  });

  it("rejects a request with neither text nor usable turns", async () => {
    const { app } = createTestApp();
    for (const body of [{}, { text: "  " }, { turns: [] }, { turns: [null, {}] }]) {
      const res = await request(app).post("/api/gemini/summarize").send(body).expect(400);
      expect(res.body.error).toMatch(/required for summarization/);
    }
  });

  it("returns 500 when the model ladder is exhausted", async () => {
    const { app } = createTestApp({ geminiError: new Error("ladder down") });
    const res = await request(app).post("/api/gemini/summarize").send({ text: "x" }).expect(500);
    expect(res.body.error).toBe("ladder down");
  });
});
