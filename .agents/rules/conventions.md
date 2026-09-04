---
description: Code conventions and project layout for ReflectAI. Applies when writing or editing source files.
trigger: always_on
---

# Conventions

## Layout

- `server.ts` is a **thin entrypoint** — dotenv, `createApp`, static/Vite,
  `listen`. No routes, no logic.
- Route wiring lives in `src/server/app.ts`; the logic each route calls lives in
  `src/server/lib/`.
- Nothing under `src/server/lib/` reads `process.env`, calls `Date.now()`, or
  calls `fetch` directly. Those arrive as arguments so tests can control them.
- Client code is under `src/`; shared types in `src/types.ts`.

## Style

- TypeScript strict mode is on, including `noUnusedLocals`. Do not leave an
  unused import behind.
- Prefer a named export over a default; `firebaseConfig.ts` keeps its default
  export for backwards compatibility only.
- Comments explain **why**, not what. A comment on a guard should say what
  attack or failure it prevents.
- Match the surrounding file's comment density and naming. Do not reformat code
  you are not otherwise changing.
- Validate at the HTTP boundary and return a specific, actionable error message.
  Every request handler treats `req.body` as possibly not an object.
- Degrade rather than fail where the user's work is at stake: a webhook that
  cannot be reached records `simulated`; a Firestore write that fails keeps a
  local copy and surfaces the error. Never fail silently.

## Adding an endpoint

1. Pure logic + unit test in `src/server/lib/`.
2. Wire the route in `src/server/app.ts`.
3. Integration test in `test/api/`, using `createTestApp`.
4. `npm run lint && npm test`.
