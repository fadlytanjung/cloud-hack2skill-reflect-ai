/**
 * Gemini client wiring and the resilient model fallback ladder.
 *
 * The generation helpers take the client as an argument, so tests can drive the
 * ladder with a stub that fails on demand instead of calling the real API.
 */

import { GoogleGenAI } from "@google/genai";
import type { GeminiContent } from "./prompts";

/** Tried in order; the first model that responds wins. */
export const MODEL_FALLBACK_LADDER = [
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
  "gemini-3.7-flash",
] as const;

export const PRIMARY_MODEL = MODEL_FALLBACK_LADDER[0];
export const GENERATION_TEMPERATURE = 0.7;

export const MISSING_API_KEY_MESSAGE =
  "GEMINI_API_KEY environment variable is not configured. Please ensure your API key from Google Cloud Secret Manager / .env is set in your environment.";

export interface GenerateParams {
  contents: GeminiContent[];
  systemInstruction?: string;
}

/** The slice of the GenAI SDK this server actually depends on. */
export interface GenAIClientLike {
  models: {
    generateContent(args: unknown): Promise<{ text?: string }>;
    generateContentStream(args: unknown): Promise<AsyncIterable<{ text?: string }>>;
  };
}

/** Lazily constructs (and memoizes) a real GenAI client from the environment. */
export function createGenAIProvider(env: Record<string, string | undefined> = process.env) {
  let client: GoogleGenAI | null = null;
  return function getGenAI(): GenAIClientLike {
    if (!client) {
      const apiKey = env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error(MISSING_API_KEY_MESSAGE);
      }
      console.log(
        "[Gemini Engine] Initialized Google GenAI SDK successfully from environment credentials"
      );
      client = new GoogleGenAI({ apiKey });
    }
    return client as unknown as GenAIClientLike;
  };
}

export type GetGenAI = () => GenAIClientLike;

export interface GenerateResult {
  text: string;
  modelUsed: string;
}

export interface StreamResult {
  responseStream: AsyncIterable<{ text?: string }>;
  modelUsed: string;
}

const LADDER_EXHAUSTED = "All models in the resilient fallback ladder failed.";

/** Walks the ladder, returning the first successful completion. */
export async function generateContentWithFallback(
  client: GenAIClientLike,
  params: GenerateParams,
  ladder: readonly string[] = MODEL_FALLBACK_LADDER
): Promise<GenerateResult> {
  let lastError: unknown = null;

  for (const model of ladder) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: GENERATION_TEMPERATURE,
        },
      });
      return { text: response.text || "", modelUsed: model };
    } catch (err: any) {
      console.warn(`[Gemini Fallback] Model ${model} encountered error:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(LADDER_EXHAUSTED);
}

/** Ladder equivalent for streaming completions. */
export async function generateContentStreamWithFallback(
  client: GenAIClientLike,
  params: GenerateParams,
  ladder: readonly string[] = MODEL_FALLBACK_LADDER
): Promise<StreamResult> {
  let lastError: unknown = null;

  for (const model of ladder) {
    try {
      const responseStream = await client.models.generateContentStream({
        model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          temperature: GENERATION_TEMPERATURE,
        },
      });
      return { responseStream, modelUsed: model };
    } catch (err: any) {
      console.warn(
        `[Gemini Stream Fallback] Model ${model} encountered error:`,
        err?.message || err
      );
      lastError = err;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("All models in the resilient stream fallback ladder failed.");
}

/** Formats one Server-Sent Events frame. */
export function sseFrame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const SSE_DONE = "data: [DONE]\n\n";
