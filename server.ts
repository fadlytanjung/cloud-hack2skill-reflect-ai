/**
 * ReflectAI server entrypoint.
 *
 * Deliberately thin: it loads secrets, builds the API surface via `createApp`,
 * attaches the Vite dev middleware (or the built static bundle), and listens.
 * All request handling and business logic lives in `src/server/`, where it is
 * unit- and integration-tested without a live socket.
 */

import express, { type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { createViteServer } from "./src/server/devServer";
import { createApp } from "./src/server/app";
import { buildFirebaseClientConfig } from "./src/server/lib/clientConfig";

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  const { app } = createApp({ env: process.env });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer();
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const indexPath = path.join(distPath, "index.html");

    let appletFallback: Record<string, string> = {};
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        appletFallback = JSON.parse(fs.readFileSync(configPath, "utf8"));
      }
    } catch {
      // Best-effort fallback load
    }

    const clientConfig = buildFirebaseClientConfig(process.env, appletFallback);
    const configScript = `<script id="firebase-runtime-config">window.__FIREBASE_CONFIG__=Object.freeze(${JSON.stringify(clientConfig)});</script>`;

    app.use(express.static(distPath, { index: false }));
    app.get("*", (_req: Request, res: Response) => {
      try {
        const raw = fs.readFileSync(indexPath, "utf8");
        const html = raw.includes("</head>")
          ? raw.replace("</head>", `${configScript}</head>`)
          : `${configScript}${raw}`;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(html);
      } catch {
        res.sendFile(indexPath);
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ReflectAI server listening on http://0.0.0.0:${PORT}`);
  });
}

start();
