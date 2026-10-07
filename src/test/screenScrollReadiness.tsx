import type { ReactNode } from "react";
import { vi } from "vitest";
import {
  ScreenScrollContext,
  type ScreenScrollMemory,
} from "../ui/shared/screenScrollMemory.ts";
import type { Screen } from "../ui/shared/screenTypes.ts";

/**
 * Backlog item 125's screen readiness, recorded for component tests: wraps
 * a screen in a scroll-memory context whose `arrive` only records what the
 * screen reported, so a test can assert when a screen says its content has
 * loaded without App or any scrolling. Every other method is a no-op spy.
 */
export function createReadinessRecorder(view: Screen) {
  const reports: boolean[] = [];
  const memory: ScreenScrollMemory = {
    noteRendered: vi.fn(),
    leave: vi.fn(),
    arrive: vi.fn((reportedView: Screen, ready: boolean) => {
      if (reportedView === view) reports.push(ready);
    }),
    markTop: vi.fn(),
    takeTop: vi.fn(() => false),
    invalidate: vi.fn(),
    savedPosition: vi.fn(() => undefined),
    dispose: vi.fn(),
  };
  const value = { memory, view };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ScreenScrollContext.Provider value={value}>{children}</ScreenScrollContext.Provider>
  );
  return {
    wrapper,
    /** Every readiness the screen has reported, in order. */
    reports,
    /** The latest report, or undefined before the first. */
    latest: () => reports.at(-1),
  };
}
