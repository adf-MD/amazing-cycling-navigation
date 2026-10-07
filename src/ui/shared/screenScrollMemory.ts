import { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";
import {
  armOperationInteractionGuard,
  type OperationInteractionGuard,
} from "./operationInteractionGuard.ts";
import type { Screen } from "./screenTypes.ts";
import { scrollToAndSettle, scrollToTopAndSettle } from "./scrollToTopAndSettle.ts";

/** Within this many CSS pixels a restore counts as already in place, and
 * no scroll call is made at all. The settle loop's own tolerance. */
const IN_PLACE_TOLERANCE_PX = 1;

type EntryPhase = "awaiting" | "pending" | "done";

/** The current arrival: the view now shown, and how far its restore has
 * got. One at a time — a newer arrival replaces it. */
interface Entry {
  view: Screen;
  phase: EntryPhase;
  /** document.activeElement when the rider left the previous view; null
   * for the initial view, which nobody navigated to. */
  activeAtLeave: Element | null;
  /** Item 124's "rider has moved on" guard, armed when the rider left the
   * previous view; null for the initial view. */
  guard: OperationInteractionGuard | null;
}

/**
 * Backlog item 125: each primary view's own scroll position, kept in
 * memory for the current app session only.
 *
 * - **Saved when leaving.** App calls `leave` synchronously before every
 *   change of screen, so `window.scrollY` still belongs to the view being
 *   left — the view App last rendered, never a possibly stale screen value
 *   captured by an async callback. A view whose restore has not yet been
 *   applied keeps its saved position: leaving before a screen has loaded
 *   never records the loading placeholder's offset.
 * - **Restored on arrival, once.** The arriving screen reports through
 *   `useScreenScrollRestoration` whether its first reads have settled. The
 *   decision is made in that screen's own layout effect, after every
 *   descendant's autoFocus or reveal from the same commit, and applied by
 *   the settle loop, clamped to the page's height.
 * - **Never against the rider.** A tap, key press, wheel or touch scroll
 *   since leaving (item 124's interaction guard), or focus moving to a new
 *   element — a carried-over confirmation's autoFocus, say — means the
 *   restore is abandoned, and it is never reapplied.
 * - **Top requests.** New ride content, a new Planning draft from Edit
 *   copy and Planning's Open Settings discard the saved position and start
 *   the view at the top (`useScreenTopRequests`).
 *
 * Nothing here is stored: a fresh App mount remembers no offsets, and
 * every view's first visit starts at the top.
 */
export interface ScreenScrollMemory {
  /** The view App rendered last. Called by App's layout effect. */
  noteRendered(view: Screen): void;
  /** Called before the rendered screen changes to `to`. */
  leave(to: Screen): void;
  /** A view's arrival decision; see useScreenScrollRestoration. */
  arrive(view: Screen, ready: boolean): void;
  /** Discards `view`'s saved position and marks a top request for it.
   * Returns nothing: App's useScreenTopRequests applies it. */
  markTop(view: Screen): void;
  /** Takes `view`'s top request, if there is one. */
  takeTop(view: Screen): boolean;
  /** Discards `view`'s saved position for a future arrival without
   * touching the screen now shown: if `view` is rendered, its next leave
   * records nothing either. */
  invalidate(view: Screen): void;
  /** The saved position, for tests and diagnostics only. */
  savedPosition(view: Screen): number | undefined;
  /** Stops the restore loop and detaches the guard. Reversible: the saved
   * positions stay, so Strict Mode's effect replay loses nothing. */
  dispose(): void;
}

function isAtTarget(target: number): boolean {
  const scroller = document.scrollingElement ?? document.documentElement;
  const reachable = Math.min(
    target,
    Math.max(0, scroller.scrollHeight - scroller.clientHeight),
  );
  return Math.abs(window.scrollY - reachable) <= IN_PLACE_TOLERANCE_PX;
}

/** Created once by App; creating it has no side effects. */
export function createScreenScrollMemory(initialView: Screen): ScreenScrollMemory {
  const saved = new Map<Screen, number>();
  const topPending = new Set<Screen>();
  const discardOnLeave = new Set<Screen>();
  let rendered: Screen = initialView;
  let entry: Entry | null = {
    view: initialView,
    phase: "awaiting",
    activeAtLeave: null,
    guard: null,
  };
  let stopLoop: (() => void) | null = null;

  const hasMovedOn = (current: Entry): boolean => {
    if (current.guard !== null && !current.guard.armed) return true;
    const active = document.activeElement;
    return (
      active !== null && active !== document.body && active !== current.activeAtLeave
    );
  };

  const finish = (current: Entry) => {
    current.phase = "done";
    current.guard?.detach();
  };

  const stopRunningLoop = () => {
    const stop = stopLoop;
    stopLoop = null;
    stop?.();
  };

  const restore = (current: Entry, target: number) => {
    current.phase = "done";
    if (isAtTarget(target)) {
      current.guard?.detach();
      return;
    }
    stopLoop = scrollToAndSettle(target, {
      shouldStop: () => hasMovedOn(current),
      onEnd: () => {
        current.guard?.detach();
        stopLoop = null;
      },
    });
  };

  return {
    noteRendered(view) {
      rendered = view;
    },
    leave(to) {
      const from = rendered;
      if (from === to) return;
      stopRunningLoop();
      // A saved position its arrival has not yet applied — the screen still
      // loading — is kept: the offset now showing is the placeholder's.
      const savedNotYetApplied =
        entry !== null &&
        entry.view === from &&
        entry.phase !== "done" &&
        saved.has(from);
      if (discardOnLeave.delete(from)) {
        saved.delete(from);
      } else if (!savedNotYetApplied) {
        saved.set(from, window.scrollY);
      }
      if (entry !== null) finish(entry);
      entry = {
        view: to,
        phase: "awaiting",
        activeAtLeave: document.activeElement,
        guard: armOperationInteractionGuard(() => null),
      };
    },
    arrive(view, ready) {
      const current = entry;
      if (current?.view !== view || current.phase === "done") return;
      if (topPending.has(view) || hasMovedOn(current)) {
        finish(current);
        return;
      }
      const target = saved.get(view);
      if (target === undefined) {
        restore(current, 0);
        return;
      }
      if (!ready) {
        current.phase = "pending";
        return;
      }
      restore(current, target);
    },
    markTop(view) {
      saved.delete(view);
      discardOnLeave.delete(view);
      topPending.add(view);
      if (entry?.view === view) {
        if (entry.phase !== "done") finish(entry);
        stopRunningLoop();
      }
    },
    takeTop(view) {
      return topPending.delete(view);
    },
    invalidate(view) {
      saved.delete(view);
      if (rendered === view) discardOnLeave.add(view);
    },
    savedPosition(view) {
      return saved.get(view);
    },
    dispose() {
      stopRunningLoop();
      if (entry !== null && entry.phase !== "done") {
        entry.guard?.detach();
        entry.guard = null;
      }
    },
  };
}

/**
 * Turns off the browser's own scroll restoration for this document, so a
 * reload or a relaunch that loads the page afresh starts every view at the
 * top, as a fresh App mount remembers nothing (backlog item 125). Called
 * once, before the first render.
 */
export function disableBrowserScrollRestoration(): void {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
}

interface ScreenScrollContextValue {
  memory: ScreenScrollMemory;
  view: Screen;
}

export const ScreenScrollContext = createContext<ScreenScrollContextValue | null>(null);

/**
 * A screen's report to scroll restoration (backlog item 125): `ready` once
 * its first reads have settled and its content is no longer a loading
 * placeholder — including when a read failed and an error now shows.
 * Call it last among the screen's hooks. Outside App's provider — a screen
 * rendered on its own in a test — it does nothing.
 */
export function useScreenScrollRestoration(ready: boolean): void {
  const context = useContext(ScreenScrollContext);
  useLayoutEffect(() => {
    context?.memory.arrive(context.view, ready);
  }, [context, ready]);
}

/**
 * Applies top requests (backlog item 125), generalising
 * useResetScrollForNewRideContent, which it replaces: `requestTop(view)`
 * discards that view's saved position and scrolls it to the top exactly
 * once — now, if it is the screen shown, or on its next arrival. A plain
 * return to a view with no new request never fires it again. The loop is
 * scrollToTopAndSettle's, stopped by this effect's cleanup, so leaving the
 * view ends it.
 */
export function useScreenTopRequests(
  screen: Screen,
  memory: ScreenScrollMemory,
): (view: Screen) => void {
  const [token, setToken] = useState(0);

  useLayoutEffect(() => {
    if (!memory.takeTop(screen)) return;
    return scrollToTopAndSettle();
  }, [memory, screen, token]);

  return useCallback(
    (view: Screen) => {
      memory.markTop(view);
      setToken((current) => current + 1);
    },
    [memory],
  );
}
