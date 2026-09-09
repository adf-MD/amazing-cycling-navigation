import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without Vitest's `globals: true`, Testing Library can't auto-detect
// `afterEach` to run its own cleanup, so each component test's render
// output would otherwise accumulate in the DOM across tests.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver. Components only need the
// constructor to exist and observe()/disconnect() to be callable; no test
// currently depends on it actually firing a callback.
class NoopResizeObserver implements ResizeObserver {
  observe(): void {
    // no-op: jsdom has no layout engine to observe.
  }
  unobserve(): void {
    // no-op: jsdom has no layout engine to observe.
  }
  disconnect(): void {
    // no-op: jsdom has no layout engine to observe.
  }
}
globalThis.ResizeObserver = NoopResizeObserver;

// jsdom doesn't implement window.scrollBy either — it logs a noisy "Not
// implemented" console warning and otherwise does nothing. A no-op stub
// here (mirroring the ResizeObserver stub above) keeps that off every
// test's output; a test that specifically needs to observe scrollBy calls
// (e.g. RouteListItem.test.tsx's tag-save reveal tests) still overrides
// this itself and restores it afterward.
window.scrollBy = () => {
  // no-op: jsdom has no layout engine to scroll.
};
