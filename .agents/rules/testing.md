---
description: How tests are written and run in ReflectAI. Always applies when adding or changing code under src/ or server.ts.
trigger: always_on
---

# Testing rules

`bun run lint` (tsc, strict) and `bun run test` must both be clean before a commit.

## Where a test goes

- Pure logic → a `*.test.ts` beside the module in `src/server/lib/`.
- An HTTP endpoint → `test/api/<area>.test.ts`, using
  `test/helpers/createTestApp.ts`.
- A React component → `src/components/__tests__/<Name>.test.tsx`, with
  `// @vitest-environment jsdom` as line 1.
- Firestore rules → `test/firestore-rules.test.ts`.

## Rules

1. **A test must not need the network, a real API key, a wall clock, or a
   developer's `.env`.** Inject `fetchImpl`, `getGenAI`, and `now` instead. If a
   test needs something stubbed that `createApp` does not accept as a
   dependency, add the dependency rather than reaching for a module mock.
2. **Never sleep.** Advance the injected clock (`harness.advance(ms)`) or use
   `vi.useFakeTimers()`.
3. **Assert the observable contract**, not the implementation: status codes,
   response bodies, what was written, what left the process. `fetchCalls` on the
   test harness is how you prove an outbound request was — or was not — made.
4. **Test the negative case for every guard.** A validator's test is incomplete
   until it shows what gets rejected, and that nothing was dialled or stored
   when it was.
5. **Cover the boundary, not just the middle.** `90`/`91`, empty string, `null`,
   a non-string, the exact length limit and one past it.
6. **Name the behaviour, not the function.** `"rejects a webhook pointing at the
   cloud metadata endpoint"`, not `"test isValidWebhookUrl 3"`.
7. **Do not lower a coverage threshold** in `vitest.config.ts` to make a run
   pass. Ratchet them up as coverage grows.
8. **`userEvent` and `vi.useFakeTimers()` do not mix.** Use `fireEvent` plus
   `act()` when a test needs to advance timers.

## Red → green → refactor

For new behaviour, write the failing test first. It is worth it here: writing
tests first for this codebase surfaced three real bugs — coordinates coerced
from `null`/`false`, and `Object.prototype` members leaking through a mode
lookup — that a test written after the fact would have simply agreed with.
