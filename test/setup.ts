/**
 * Global test setup.
 *
 * Loaded for every environment. jsdom-only helpers are guarded so the node
 * suites do not pay for them.
 */

import { afterEach, vi } from "vitest";

// Keep test output readable: the server logs warnings on every deliberately
// failed dispatch and model fallback, which are expected in these suites.
const SILENCED = ["warn", "error", "log"] as const;
for (const level of SILENCED) {
  vi.spyOn(console, level).mockImplementation(() => {});
}

if (typeof window !== "undefined") {
  // @testing-library/jest-dom matchers, only meaningful under jsdom.
  await import("@testing-library/jest-dom/vitest");

  // jsdom implements neither matchMedia nor ResizeObserver, both of which the
  // motion/framer animation layer touches on mount.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

afterEach(async () => {
  vi.clearAllTimers();
  if (typeof window !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
