/**
 * ReflectAI server entrypoint.
 *
 * Deliberately thin: it loads secrets, builds the API surface via `createApp`,
 * attaches the Vite dev middleware (or the built static bundle), and listens.
 * All request handling and business logic lives in `src/server/`, where it is
 * unit- and integration-tested without a live socket.
 */

import express, { type Request, type Response } from "express";
import path from "path";
import dotenv from "dotenv";
import { createViteServer } from "./src/server/devServer";
import { createApp } from "./src/server/app";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  const { app } = createApp({ env: process.env });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer();
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ReflectAI server listening on http://0.0.0.0:${PORT}`);
  });
}

start();
