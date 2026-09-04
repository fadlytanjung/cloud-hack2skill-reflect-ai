---
name: tdd-workflow
description: Test-driven workflow for ReflectAI — write the failing test first, then the code. Use when adding an API endpoint, a validation guard, a React component, or when asked to raise coverage, fix a bug reproducibly, or set up the pre-push test hook.
---

# TDD workflow for ReflectAI

Red → green → refactor, with the project's actual seams. The architecture was
built for this: `createApp(deps)` takes every external dependency as an
argument, so a test never needs the network, an API key, or a real clock.

## Commands

```bash
bun run test:watch                  # red/green loop while you work
bun run test                            # full suite, once
bun run test src/server/lib/rbac     # one file or directory
bun run test -t "rejects a webhook"  # one test by name
bun run test:security               # the guard suites the pre-push hook runs
bun run test:coverage               # report + enforce thresholds
bun run lint                        # tsc strict, must be clean
```

## The loop

### 1. Red — write the test that fails

Name the behaviour in the sentence you would use in review.

```ts
it("rejects a webhook pointing at the cloud metadata endpoint", () => {
  const result = isValidWebhookUrl("https://169.254.169.254/computeMetadata/v1/");
  expect(result.valid).toBe(false);
  expect(result.reason).toMatch(/private network/);
});
```

Run it. **Confirm it fails for the reason you expect** — a test that passes
before you write the code is testing nothing.

### 2. Green — the simplest change that passes

### 3. Refactor — with the test holding the behaviour still

Then `bun run lint && bun run test`.

## Where the test goes

| Adding | Test file | Environment |
|---|---|---|
| Pure logic / a guard | `src/server/lib/<module>.test.ts` | node |
| An API endpoint | `test/api/<area>.test.ts` | node + supertest |
| Firestore / client lib behaviour | `src/lib/<module>.test.ts` | jsdom |
| A React component | `src/components/__tests__/<Name>.test.tsx` | jsdom |
| A `firestore.rules` change | `test/firestore-rules.test.ts` | node |

jsdom files declare it on line 1:

```ts
// @vitest-environment jsdom
```

## Adding an API endpoint

Work outside-in, but write the unit test first.

**Step 1 — the logic, with its test.** New module under `src/server/lib/`. It
takes what it needs as arguments; it does not read `process.env`, call
`Date.now()`, or call `fetch`.

**Step 2 — wire it into `createApp`** in `src/server/app.ts`. The handler
validates input, calls the module, and shapes the response. If it needs a new
external dependency, add it to `AppDependencies` — do not reach for `vi.mock`.

**Step 3 — the integration test**, using the harness:

```ts
import request from "supertest";
import { createTestApp, ADMIN_AUTH } from "../helpers/createTestApp";

it("rejects a private-network webhook without dialling it", async () => {
  const { app, fetchCalls } = createTestApp({ env: {} });
  const res = await request(app)
    .post("/api/notifications/dispatch")
    .send({ summary: "s", customWebhookUrl: "https://10.0.0.1/x" })
    .expect(400);
  expect(res.body.error).toMatch(/Webhook URL rejected/);
  expect(fetchCalls).toHaveLength(0);   // nothing left the process
});
```

`createTestApp` options: `env`, `geminiText`, `geminiChunks`, `geminiError`,
`withoutGemini`, `fetchResponses` (consumed in call order; an `Error` entry makes
that call throw), `rateLimit`. It returns `app`, `audit`, `notifications`,
`rateLimiter`, `fetchCalls`, and `advance(ms)`.

## What a good test asserts

- **The negative path.** A guard's test is incomplete until it shows what is
  rejected *and* that nothing was dialled, stored, or audited as a result.
- **Boundaries.** `90` and `91`. Empty string, `null`, `undefined`, a
  non-string, a boolean. The exact length cap and one character past it.
- **What left the process.** `fetchCalls[0].body` is the payload the outside
  world would have seen. Assert secrets are absent from it and from the response.
- **The audit trail.** A security-relevant action writes an entry; check
  `audit.list()[0]`.

## Traps in this repo

- **`userEvent` deadlocks under `vi.useFakeTimers()`.** Use `fireEvent` plus
  `act(() => vi.advanceTimersByTime(ms))` when a test must advance timers.
- **Never `await` a real delay.** Use `harness.advance(ms)` for rate-limit and
  window-rollover tests.
- **`Number()` is too permissive for validation.** It maps `null`, `""` and
  `false` to `0`, and `true` to `1`. Coordinate parsing learned this the hard way.
- **`key in obj` matches the prototype chain.** Use `Object.hasOwn` when
  validating a key against a lookup table, or `"constructor"` becomes a valid
  input.
- **Tests must not read the real `.env`.** `vitest.config.ts` points `envDir` at
  an empty fixture directory; pin any `VITE_` value a test needs in `test.env`.

## Fixing a bug

1. Write a test that reproduces it and fails. This is the deliverable — it is
   what stops the bug coming back.
2. Fix the code.
3. Leave the test named after the bug's symptom.

## Coverage

```bash
bun run test:coverage       # writes coverage/index.html
```

Thresholds are enforced in `vitest.config.ts` and are a floor, not a target.
Raise them when coverage rises; **never lower one to make a run pass.** If a
branch is genuinely unreachable, restructure the code rather than excluding it.

## Pre-push hook

```bash
bun run hooks:install
```

Installs `.githooks/pre-push`, which runs `bun run lint` and
`bun run test:security` before every push — the guard suites that must never
regress before a Cloud Run deploy. It is a git hook, so it lives outside version
control until installed; each contributor runs the command once.

Do not push with `--no-verify`. If the hook is in the way, the fix is a passing
test.
