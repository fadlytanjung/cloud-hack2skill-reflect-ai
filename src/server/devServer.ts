/**
 * Vite dev-middleware loader, isolated behind a dynamic import.
 *
 * `dist/server.cjs` is bundled with `--packages=external`, and production never
 * takes this path — keeping the import lazy means the built image does not have
 * to resolve Vite at startup.
 */

import type { RequestHandler } from "express";

export interface ViteDevServerLike {
  /** Connect middleware stack, mountable directly on an Express app. */
  middlewares: RequestHandler;
}

export async function createViteServer(): Promise<ViteDevServerLike> {
  const { createServer } = await import("vite");
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  return { middlewares: server.middlewares as unknown as RequestHandler };
}
