# ReflectAI — agent guide

Private journaling and reflection companion. React 19 + Vite front end, Express
API in the same process, Gemini for reflection and synthesis, Firebase Auth +
Cloud Firestore for persistence, deployed to Google Cloud Run.

This file is the shared context for any coding agent working in this repo
(Antigravity, Claude Code, or otherwise). Rules that must always apply live in
`.agents/rules/`; task-specific procedures live in `.agents/skills/`.

## Commands

| Task | Command |
|---|---|
| Dev server (Vite middleware, port 3000) | `npm run dev` |
| Type check — must be clean | `npm run lint` |
| Full test suite | `npm test` |
| Watch mode while developing | `npm run test:watch` |
| Security-critical tests only | `npm run test:security` |
| Coverage report + thresholds | `npm run test:coverage` |
| Production build (client + `dist/server.cjs`) | `npm run build` |
| Run the built server | `npm start` |
| Install the pre-push hook | `npm run hooks:install` |
| Deploy to Cloud Run | `npm run deploy:cloud-run` |

`npm run lint` and `npm test` must both pass before any commit. The pre-push
hook enforces this; do not bypass it with `--no-verify`.

## Architecture

```
index.html ──▶ src/main.tsx ──▶ src/App.tsx ──▶ src/components/*
                                     │
                                     └─▶ src/lib/firebase.ts   (Auth + Firestore)
                                     └─▶ fetch("/api/...")     (same-origin API)

server.ts                 thin entrypoint: dotenv, createApp, Vite/static, listen
└── src/server/app.ts     createApp(deps) — every route, all dependencies injected
    └── src/server/lib/   pure, unit-tested logic
        ├── security.ts       SSRF guard, coordinate bounds, egress sanitizer
        ├── rbac.ts           admin identity resolution + Express middleware
        ├── rateLimit.ts      fixed-window limiter with an injectable clock
        ├── auditLog.ts       bounded audit trail
        ├── prompts.ts        persona wiring, history mapping, insight parsing
        ├── gemini.ts         model fallback ladder, SSE framing
        ├── notifications.ts  webhook / Discord payload shaping + history
        ├── maps.ts           geocode URLs, response parsing, offline fallback
        └── clientConfig.ts   public bootstrap payload
```

**The invariant that makes this testable:** `server.ts` holds no logic.
`createApp` receives `env`, `getGenAI`, `audit`, `notifications`, `rateLimiter`,
`fetchImpl`, and `now` as dependencies. Nothing under `src/server/lib/` reads
`process.env`, calls `Date.now()`, or dials the network on its own.

When you add an endpoint, put its logic in a `src/server/lib/` module with a
unit test, then wire it into `createApp` and add an integration test under
`test/api/`. Do not add logic directly to `server.ts`.

## Tests

| Location | Environment | Covers |
|---|---|---|
| `src/server/lib/*.test.ts` | node | pure logic, exhaustive edge cases |
| `test/api/*.test.ts` | node + supertest | HTTP status, bodies, headers, egress |
| `src/lib/*.test.ts` | jsdom | Firestore payload hygiene, offline buffer |
| `src/components/__tests__/*.test.tsx` | jsdom + Testing Library | rendering, interaction |
| `test/firestore-rules.test.ts` | node | static guard on `firestore.rules` |

Component and browser tests opt into jsdom with a `// @vitest-environment jsdom`
docblock on line 1; everything else runs in node.

Use `test/helpers/createTestApp.ts` for API tests — it stubs Gemini, `fetch`,
and the clock, and exposes `fetchCalls` so a test can assert exactly what would
have left the process.

`vitest.config.ts` sets `envDir` to an empty fixture directory so a
contributor's real `.env` can never change a test result.

## Non-negotiables

1. **No secrets in the repo.** `.env` is gitignored; the real values live in one
   Secret Manager secret, `reflect-ai-env`. See the `reflect-ai-secrets` skill.
2. **Never print a secret to stdout.** Tool output becomes transcript.
3. **`VITE_`-prefixed values are public** — they are inlined into the browser
   bundle. Never move a server-side key behind a `VITE_` name.
4. **Every outbound URL passes `isValidWebhookUrl`** before `fetch`. HTTPS only,
   no private or metadata hosts.
5. **Every `/api/admin/*` route sits behind `verifyAdmin`**, and every grant and
   denial is recorded in the audit log.
6. **Model output is untrusted data.** Sanitize before egress; never render it
   as raw HTML.
7. **A guard change needs a test in the same commit.** If you relax a rule in
   `firestore.rules` or `security.ts`, a test must justify it.

## Known limitation

`decodeJwtClaims` in `src/server/lib/rbac.ts` reads JWT claims **without
verifying the signature**, so a forged token could claim `admin: true`. This is
acceptable for the current demo deployment and is called out in the code. Before
exposing the admin surface to untrusted callers, swap it for the Firebase Admin
SDK's `verifyIdToken`. `src/server/lib/rbac.test.ts` is where that change gets
proven.
