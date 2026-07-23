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
