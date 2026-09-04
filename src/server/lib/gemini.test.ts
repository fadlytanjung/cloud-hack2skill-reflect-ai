import { describe, expect, it, vi } from "vitest";
import {
  GENERATION_TEMPERATURE,
  MISSING_API_KEY_MESSAGE,
  MODEL_FALLBACK_LADDER,
  PRIMARY_MODEL,
  SSE_DONE,
  createGenAIProvider,
  generateContentStreamWithFallback,
  generateContentWithFallback,
  sseFrame,
  type GenAIClientLike,
} from "./gemini";

/**
 * Stub client whose `failFor` set decides which models blow up, letting each
 * rung of the fallback ladder be exercised without touching the network.
 */
function stubClient(options: {
  failFor?: string[];
  text?: string;
  chunks?: string[];
  error?: Error;
}) {
  const failFor = new Set(options.failFor ?? []);
  const calls: string[] = [];

  const client: GenAIClientLike = {
    models: {
      async generateContent(args: any) {
        calls.push(args.model);
        if (failFor.has(args.model)) throw options.error ?? new Error(`${args.model} unavailable`);
        return { text: options.text ?? `reply from ${args.model}` };
      },
      async generateContentStream(args: any) {
        calls.push(args.model);
        if (failFor.has(args.model)) throw options.error ?? new Error(`${args.model} unavailable`);
        const chunks = options.chunks ?? ["hello ", "world"];
        return (async function* () {
          for (const text of chunks) yield { text };
        })();
      },
    },
  };

  return { client, calls };
}

const PARAMS = { contents: [{ role: "user" as const, parts: [{ text: "hi" }] }] };

describe("MODEL_FALLBACK_LADDER", () => {
  it("lists the models in priority order with no duplicates", () => {
    expect(MODEL_FALLBACK_LADDER.length).toBeGreaterThan(1);
    expect(new Set(MODEL_FALLBACK_LADDER).size).toBe(MODEL_FALLBACK_LADDER.length);
    expect(PRIMARY_MODEL).toBe(MODEL_FALLBACK_LADDER[0]);
  });
});

describe("generateContentWithFallback", () => {
  it("uses the primary model when it succeeds, without touching the rest", async () => {
    const { client, calls } = stubClient({});
    const result = await generateContentWithFallback(client, PARAMS);
    expect(result.modelUsed).toBe(PRIMARY_MODEL);
    expect(calls).toEqual([PRIMARY_MODEL]);
  });

  it("descends the ladder past each failing model", async () => {
    const { client, calls } = stubClient({
      failFor: [MODEL_FALLBACK_LADDER[0], MODEL_FALLBACK_LADDER[1]],
    });
    const result = await generateContentWithFallback(client, PARAMS);
    expect(result.modelUsed).toBe(MODEL_FALLBACK_LADDER[2]);
    expect(calls).toEqual(MODEL_FALLBACK_LADDER.slice(0, 3));
  });

  it("forwards the system instruction and temperature to the SDK", async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: "ok" });
    const client = { models: { generateContent, generateContentStream: vi.fn() } } as any;
    await generateContentWithFallback(client, { ...PARAMS, systemInstruction: "be kind" });
    expect(generateContent).toHaveBeenCalledWith({
      model: PRIMARY_MODEL,
      contents: PARAMS.contents,
      config: { systemInstruction: "be kind", temperature: GENERATION_TEMPERATURE },
    });
  });

  it("coerces a missing text field to an empty string", async () => {
    const client = {
      models: { generateContent: async () => ({}), generateContentStream: vi.fn() },
    } as any;
    expect((await generateContentWithFallback(client, PARAMS)).text).toBe("");
  });

  it("rethrows the last error once every model has failed", async () => {
    const boom = new Error("quota exhausted");
    const { client, calls } = stubClient({ failFor: [...MODEL_FALLBACK_LADDER], error: boom });
    await expect(generateContentWithFallback(client, PARAMS)).rejects.toThrow("quota exhausted");
    expect(calls).toEqual([...MODEL_FALLBACK_LADDER]);
  });

  it("throws a descriptive error when handed an empty ladder", async () => {
    const { client } = stubClient({});
    await expect(generateContentWithFallback(client, PARAMS, [])).rejects.toThrow(
      /All models in the resilient fallback ladder failed/
    );
  });
});

describe("generateContentStreamWithFallback", () => {
  it("returns an iterable stream from the first healthy model", async () => {
    const { client } = stubClient({ chunks: ["a", "b", "c"] });
    const { responseStream, modelUsed } = await generateContentStreamWithFallback(client, PARAMS);
    const seen: string[] = [];
    for await (const chunk of responseStream) seen.push(chunk.text ?? "");
    expect(seen).toEqual(["a", "b", "c"]);
    expect(modelUsed).toBe(PRIMARY_MODEL);
  });

  it("descends the ladder on stream setup failure", async () => {
    const { client } = stubClient({ failFor: [MODEL_FALLBACK_LADDER[0]] });
    const { modelUsed } = await generateContentStreamWithFallback(client, PARAMS);
    expect(modelUsed).toBe(MODEL_FALLBACK_LADDER[1]);
  });

  it("rethrows once the whole ladder fails", async () => {
    const { client } = stubClient({ failFor: [...MODEL_FALLBACK_LADDER] });
    await expect(generateContentStreamWithFallback(client, PARAMS)).rejects.toThrow();
  });
});

describe("createGenAIProvider", () => {
  it("throws an actionable error when GEMINI_API_KEY is absent", () => {
    const getGenAI = createGenAIProvider({});
    expect(() => getGenAI()).toThrow(MISSING_API_KEY_MESSAGE);
    expect(() => getGenAI()).toThrow(/Secret Manager/);
  });

  it("memoizes the client across calls once a key is present", () => {
    const getGenAI = createGenAIProvider({ GEMINI_API_KEY: "test-key" });
    expect(getGenAI()).toBe(getGenAI());
  });
});

describe("Server-Sent Events framing", () => {
  it("emits a single well-formed data frame", () => {
    expect(sseFrame({ text: "hi", modelUsed: "m" })).toBe(
      'data: {"text":"hi","modelUsed":"m"}\n\n'
    );
  });

  it("escapes newlines so a multi-line chunk cannot split the frame", () => {
    const frame = sseFrame({ text: "line one\nline two" });
    expect(frame.endsWith("\n\n")).toBe(true);
    // Exactly one frame terminator: the payload's own newline is escaped as \\n.
    expect(frame.split("\n\n")).toHaveLength(2);
    expect(frame).toContain("\\n");
  });

  it("terminates a stream with the DONE sentinel", () => {
    expect(SSE_DONE).toBe("data: [DONE]\n\n");
  });
});
