# ------------------------------------------------------------------------------
# ReflectAI - Production Multi-Stage Container
# ------------------------------------------------------------------------------

# Stage 1: Build application assets
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
COPY package*.json ./
RUN npm ci

# Copy source files
COPY . .

# Run production build (Vite client + esbuild server bundle)
RUN npm run build

# Stage 2: Minimal production runtime
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist

# Expose standard container port
EXPOSE 3000

# Start compiled server
CMD ["node", "dist/server.cjs"]
