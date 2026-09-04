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
| Dev server (Vite middleware, port 3000) | `bun run dev` |
| Type check — must be clean | `bun run lint` |
| Full test suite | `bun run test` |
| Watch mode while developing | `bun run test:watch` |
| Security-critical tests only | `bun run test:security` |
| Coverage report + thresholds | `bun run test:coverage` |
| Production build (client + `dist/server.cjs`) | `bun run build` |
| Run the built server | `bun start` |
| Install the pre-push hook | `bun run hooks:install` |
| Deploy to Cloud Run | `bun run deploy:cloud-run` |

**Bun is the package manager, script runner, and runtime** — `bun install`, not
`npm install`. There is exactly one lockfile, `bun.lock`, and it is committed. A
`package-lock.json` in this repo is a mistake: delete it. Both the container
build and CI install with `--frozen-lockfile`, so `bun.lock` must be regenerated
and committed in the same change as any `package.json` edit.

`bun run lint` and `bun run test` must both pass before any commit. The pre-push
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

## Dependencies and the container

`dependencies` holds **only what `dist/server.cjs` requires at runtime**:
`@google/genai`, `dotenv`, `express`. Everything else — React, the Firebase SDK,
Tailwind, lucide, react-markdown, the test toolchain — is a `devDependency`,
because Vite compiles the client into `dist/assets` at build time. The
`Dockerfile`'s production stage installs `dependencies` only, so a client library
misfiled under `dependencies` silently bloats every deployed image.

Adding a server-side runtime import means adding it to `dependencies`. Confirm
what the bundle actually needs rather than guessing:

```bash
bun run build && grep -oE 'require\("[^"./][^"]*"\)' dist/server.cjs | sort -u
```

`Dockerfile` is three stages: `builder` (full install + `bun run build`), `deps`
(production install only), `runner` (copies both, runs as the non-root `bun`
user). `scripts/deploy-cloud-run.sh` gates on `lint` + `test:security` before
submitting to Cloud Build.

## Authorization

Administrator status is **predefined data**, not code: the document
`users/{uid}` in Firestore carries `role: "admin"`. Everyone who signs in is a
standard user until that document says otherwise.

```bash
bun run role:list                                  # who is an admin
bash scripts/set-user-role.sh <email> admin        # grant
bash scripts/set-user-role.sh <email> user         # revoke
```

Two invariants make this trustworthy, and both have tests:

1. **Identity comes from a verified Firebase ID token**, never from a header.
   `src/server/lib/firebaseAdmin.ts` verifies it with the Admin SDK; the role is
   then looked up by the **uid inside that token**, so a caller cannot ask about
   someone else's privileges.
2. **Clients cannot write `users/{uid}.role`.** `firestore.rules` denies it on
   both create and update. Without that, any account could grant itself the role
   the `isAdmin()` rule reads.

`decideAdminAccess` in `src/server/lib/rbac.ts` is the whole decision as a pure
function. Add an admin route by mounting it behind `verifyAdmin`; never re-derive
privilege anywhere else.

**Never reintroduce any of these** — each was a working escalation path on a
public service, and `test/api/admin.test.ts` asserts they stay closed:

- trusting `x-admin-role`, `x-admin-email`, or `x-user-email`
- a shared static bearer token
- reading claims from an **unverified** JWT
- privileging a hardcoded email address (it also ships in the public bundle)

The client's `role` is a UI hint only. It decides which controls to render and
grants nothing; every privileged call is re-checked server-side.

`ALLOW_INSECURE_ADMIN=1` accepts `x-admin-role: admin` with no credential, for
local development. It is ignored when `NODE_ENV=production` and logs a warning
when active.
