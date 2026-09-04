import { describe, expect, it } from "vitest";
import { NOTIFICATION_RATE_LIMIT, createRateLimiter } from "./rateLimit";

/** Limiter driven by a manually advanced clock, so no test ever sleeps. */
function withClock(max = 3, windowMs = 1000) {
  let current = 1_000_000;
  const limiter = createRateLimiter({ max, windowMs, now: () => current });
  return {
    limiter,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe("createRateLimiter", () => {
  it("allows exactly `max` requests inside one window", () => {
    const { limiter } = withClock(3, 1000);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("reports the running count and time until reset", () => {
    const { limiter, advance } = withClock(3, 1000);
    expect(limiter.check("ip")).toEqual({ allowed: true, count: 1, retryAfterMs: 1000 });
    advance(400);
    expect(limiter.check("ip")).toEqual({ allowed: true, count: 2, retryAfterMs: 600 });
  });

  it("keeps rejecting for the remainder of the window", () => {
    const { limiter, advance } = withClock(2, 1000);
    limiter.check("ip");
    limiter.check("ip");
    advance(500);
    expect(limiter.check("ip").allowed).toBe(false);
    advance(499);
    expect(limiter.check("ip").allowed).toBe(false);
  });

  it("resets when the window elapses", () => {
    const { limiter, advance } = withClock(2, 1000);
    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);
    advance(1000);
    expect(limiter.check("ip")).toEqual({ allowed: true, count: 1, retryAfterMs: 1000 });
  });

  it("tracks each client independently", () => {
    const { limiter } = withClock(1, 1000);
    expect(limiter.check("client-a").allowed).toBe(true);
    expect(limiter.check("client-a").allowed).toBe(false);
    // A throttled neighbour must not consume another client's budget.
    expect(limiter.check("client-b").allowed).toBe(true);
  });

  it("buckets empty keys under a single anonymous bucket", () => {
    const { limiter } = withClock(1, 1000);
    expect(limiter.check("").allowed).toBe(true);
    expect(limiter.check("").allowed).toBe(false);
    expect(limiter.check("unknown-client").allowed).toBe(false);
  });

  it("clears a single key or the whole table on reset", () => {
    const { limiter } = withClock(1, 1000);
    limiter.check("a");
    limiter.check("b");
    limiter.reset("a");
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(false);
    limiter.reset();
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("pins the notification policy at 10 dispatches per minute", () => {
    expect(NOTIFICATION_RATE_LIMIT).toEqual({ max: 10, windowMs: 60_000 });
  });
});
