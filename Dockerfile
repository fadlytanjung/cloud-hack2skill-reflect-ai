# ------------------------------------------------------------------------------
# ReflectAI - Production Container (Bun)
#
# Bun is the package manager, the build runner, and the runtime. The lockfile is
# installed frozen, so a build either reproduces bun.lock exactly or fails loudly
# rather than silently resolving different versions in CI than on a laptop.
# ------------------------------------------------------------------------------

# ---- Stage 1: install every dependency and build the bundles -----------------
FROM oven/bun:1.4-slim AS builder

WORKDIR /app

# Copy only the manifest and lockfile first, so the dependency layer is cached
# and reused whenever application source changes but dependencies do not.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Vite emits the client into dist/, esbuild bundles the server to dist/server.cjs
RUN bun run build

# ---- Stage 2: install production dependencies only ---------------------------
# Kept separate so the runtime image never carries Vite, React, the Firebase SDK,
# or the test toolchain. dist/server.cjs requires only @google/genai, dotenv and
# express at runtime; everything client-side is already compiled into dist/.
FROM oven/bun:1.4-slim AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- Stage 3: minimal runtime ------------------------------------------------
FROM oven/bun:1.4-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# firebase-applet-config.json is deliberately NOT copied. It is gitignored (it is
# the file that leaked an API key), so `gcloud builds submit` never uploads it and
# a `COPY firebase-applet-config.json* ./` matches nothing — Docker's builder
# fails a wildcard COPY with zero matches ("no source files were specified").
#
# The image does not need it. In production the Firebase client config comes from
# the reflect-ai-env secret mounted at /secrets/.env, which server.ts reads and
# injects into the served HTML as window.__FIREBASE_CONFIG__. The server's read of
# the applet file is a local-development convenience guarded by existsSync.

# The oven/bun images ship a non-root `bun` user; drop privileges to it.
USER bun

EXPOSE 3000

# Cloud Run mounts the reflect-ai-env secret at /app/.env, which dotenv reads
# relative to this working directory.
CMD ["bun", "dist/server.cjs"]
