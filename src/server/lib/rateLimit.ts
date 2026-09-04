/**
 * Fixed-window in-memory rate limiter.
 *
 * The clock is injectable so window-rollover behaviour is testable without
 * sleeping, and so a single process can host independent limiters.
 */

export interface RateLimiterOptions {
  /** Requests allowed per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Injectable clock; defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests already counted in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Counts one hit for `key` and reports whether it is permitted. */
  check(key: string): RateLimitDecision;
  /** Forgets a single key, or all keys when omitted. */
  reset(key?: string): void;
}

export const NOTIFICATION_RATE_LIMIT = { max: 10, windowMs: 60_000 } as const;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { max, windowMs } = options;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string): RateLimitDecision {
      const timestamp = now();
      const bucketKey = key || "unknown-client";
      const entry = windows.get(bucketKey);

      if (!entry || timestamp >= entry.resetAt) {
        const resetAt = timestamp + windowMs;
        windows.set(bucketKey, { count: 1, resetAt });
        return { allowed: true, count: 1, retryAfterMs: windowMs };
      }

      if (entry.count >= max) {
        return {
          allowed: false,
          count: entry.count,
          retryAfterMs: Math.max(0, entry.resetAt - timestamp),
        };
      }

      entry.count += 1;
      return {
        allowed: true,
        count: entry.count,
        retryAfterMs: Math.max(0, entry.resetAt - timestamp),
      };
    },

    reset(key?: string) {
      if (key === undefined) {
        windows.clear();
      } else {
        windows.delete(key);
      }
    },
  };
}
