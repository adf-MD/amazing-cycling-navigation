import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createScreenScrollMemory,
  disableBrowserScrollRestoration,
  ScreenScrollContext,
  useScreenScrollRestoration,
  useScreenTopRequests,
  type ScreenScrollMemory,
} from "./screenScrollMemory.ts";
import type { Screen } from "./screenTypes.ts";

// Backlog item 125. jsdom has no layout, so the document's scrollable
// height is stubbed (scrollHeight/clientHeight) and window.scrollTo moves
// window.scrollY by hand, clamped as a browser would clamp it.

const VIEWPORT = 800;
let documentHeight = 5000;

function maxScroll(): number {
  return Math.max(0, documentHeight - VIEWPORT);
}

function installScroller() {
  window.scrollY = 0;
  const root = document.documentElement;
  Object.defineProperty(root, "scrollHeight", {
    configurable: true,
    get: () => documentHeight,
  });
  Object.defineProperty(root, "clientHeight", {
    configurable: true,
    get: () => VIEWPORT,
  });
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [a] = args;
    if (typeof a === "object" && a !== null && "top" in a) {
      const top = (a as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = Math.min(top, maxScroll());
    }
  });
}

/** A controllable requestAnimationFrame queue, as in the settle loop's own
 * tests: flushFrame(timestamp) runs whatever is pending at that time. */
function installFrameQueue() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const rafSpy = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
  const cafSpy = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((id: number) => {
      callbacks.delete(id);
    });
  return {
    rafSpy,
    cafSpy,
    pendingCount: () => callbacks.size,
    flushFrame: (timestamp: number) => {
      const entries = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of entries) callback(timestamp);
    },
  };
}

function settle(frames: ReturnType<typeof installFrameQueue>) {
  for (let frame = 0; frame < 6 && frames.pendingCount() > 0; frame += 1) {
    frames.flushFrame(frame * 16);
  }
}

/** Leaves `from` at `scrollY` for `to`, as App does before a screen change. */
function moveTo(memory: ScreenScrollMemory, from: Screen, to: Screen, scrollY: number) {
  window.scrollY = scrollY;
  memory.noteRendered(from);
  memory.leave(to);
  memory.noteRendered(to);
}

beforeEach(() => {
  documentHeight = 5000;
});

afterEach(() => {
  vi.restoreAllMocks();
  const root = document.documentElement as unknown as Record<string, unknown>;
  delete root.scrollHeight;
  delete root.clientHeight;
  document.body.innerHTML = "";
});

describe("createScreenScrollMemory — saving and restoring", () => {
  it("records each view's own position when leaving it, and restores it once on arrival, in both directions", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");

    moveTo(memory, "library", "planning", 1200);
    memory.arrive("planning", true); // first visit: top
    expect(memory.savedPosition("library")).toBe(1200);

    moveTo(memory, "planning", "library", 300);
    memory.arrive("library", true);
    expect(memory.savedPosition("planning")).toBe(300);
    expect(window.scrollY).toBe(1200);

    moveTo(memory, "library", "planning", 1500);
    memory.arrive("planning", true);
    expect(window.scrollY).toBe(300);
    expect(
      scrollSpy.mock.calls.map(([options]) => (options as ScrollToOptions).top),
    ).toEqual([0, 1200, 300]);
  });

  it("keeps Settings and Status apart", () => {
    installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("settings");

    moveTo(memory, "settings", "diagnostics", 900);
    memory.arrive("diagnostics", true);
    moveTo(memory, "diagnostics", "settings", 2100);
    memory.arrive("settings", true);
    expect(window.scrollY).toBe(900);
    moveTo(memory, "settings", "diagnostics", 900);
    memory.arrive("diagnostics", true);
    expect(window.scrollY).toBe(2100);
  });

  it("ignores a leave to the view already shown: nothing is recorded and no arrival is armed", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");
    memory.arrive("library", true);

    window.scrollY = 700;
    memory.leave("library");
    memory.arrive("library", true);

    expect(memory.savedPosition("library")).toBeUndefined();
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("starts a first visit at the top, and makes no call at all when it is already there", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");

    memory.arrive("library", false); // the initial view, already at 0
    expect(scrollSpy).not.toHaveBeenCalled();

    moveTo(memory, "library", "riding", 600);
    memory.arrive("riding", false); // first visit: top even before it is ready
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("waits for the arriving screen to be ready, never restores against its placeholder, and applies it only once", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 1800);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);
    scrollSpy.mockClear();

    memory.arrive("library", false);
    expect(scrollSpy).not.toHaveBeenCalled();

    memory.arrive("library", true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(window.scrollY).toBe(1800);

    memory.arrive("library", false);
    memory.arrive("library", true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a view's saved position when the rider leaves before it was ready", () => {
    installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 1800);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);
    memory.arrive("library", false); // still "Loading routes…"

    moveTo(memory, "library", "planning", 0); // the placeholder's offset
    expect(memory.savedPosition("library")).toBe(1800);
  });

  it("clamps a position the page can no longer reach, and makes no call when already at the clamped bottom", () => {
    const scrollSpy = installScroller();
    const frames = installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 4000);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);
    scrollSpy.mockClear();

    documentHeight = 2000; // shorter on return: bottom at 1200
    memory.arrive("library", true);
    settle(frames);
    expect(window.scrollY).toBe(1200);
    expect(frames.pendingCount()).toBe(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 4000, left: 0, behavior: "auto" });

    // Already at that bottom: a second round trip makes no call.
    moveTo(memory, "library", "planning", 1200);
    memory.arrive("planning", true);
    scrollSpy.mockClear();
    moveTo(memory, "planning", "library", 1200);
    memory.arrive("library", true);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("follows the page as it grows during the settle loop", () => {
    installScroller();
    const frames = installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 3000);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);

    documentHeight = 2000;
    memory.arrive("library", true);
    expect(window.scrollY).toBe(1200);
    documentHeight = 5000; // content still arriving
    act(() => {
      frames.flushFrame(0);
    });
    expect(window.scrollY).toBe(3000);
  });
});

describe("createScreenScrollMemory — never against the rider", () => {
  it.each([
    ["pointerdown", () => new Event("pointerdown")],
    ["keydown", () => new KeyboardEvent("keydown", { key: "Tab" })],
    ["wheel", () => new Event("wheel")],
    ["touchmove", () => new Event("touchmove")],
  ])(
    "abandons a pending restore after a %s since leaving, and never reapplies it",
    (_, event) => {
      const scrollSpy = installScroller();
      installFrameQueue();
      const memory = createScreenScrollMemory("library");
      moveTo(memory, "library", "planning", 1800);
      memory.arrive("planning", true);
      moveTo(memory, "planning", "library", 0);
      memory.arrive("library", false);
      scrollSpy.mockClear();

      window.dispatchEvent(event());
      memory.arrive("library", true);

      expect(scrollSpy).not.toHaveBeenCalled();
    },
  );

  it("yields to a newly focused element — a carried-over confirmation's autoFocus — but not to the element that kept focus across the switch", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const switcher = document.createElement("button");
    const cancel = document.createElement("button");
    document.body.append(switcher, cancel);
    const memory = createScreenScrollMemory("settings");
    moveTo(memory, "settings", "diagnostics", 900);
    memory.arrive("diagnostics", true);

    switcher.focus();
    moveTo(memory, "diagnostics", "settings", 400);
    memory.arrive("settings", true); // the switcher kept focus
    expect(window.scrollY).toBe(900);

    moveTo(memory, "settings", "diagnostics", 900);
    cancel.focus(); // e.g. a dialog's autoFocus in the arrival commit
    scrollSpy.mockClear();
    memory.arrive("diagnostics", true);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("stops a running settle loop on input, on leaving and on a top request", () => {
    installScroller();
    const frames = installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 1800);
    memory.arrive("planning", true);

    const restoreLibrary = () => {
      moveTo(memory, "planning", "library", 0);
      memory.arrive("library", true);
      expect(frames.pendingCount()).toBe(1);
    };

    restoreLibrary();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    window.scrollY = 1900; // the keyboard scroll the loop must not fight
    act(() => {
      frames.flushFrame(0);
    });
    expect(frames.pendingCount()).toBe(0);
    expect(window.scrollY).toBe(1900);

    moveTo(memory, "library", "planning", 1800);
    memory.arrive("planning", true);
    settle(frames);
    restoreLibrary();
    memory.leave("planning");
    expect(frames.pendingCount()).toBe(0);
    memory.noteRendered("planning");
    memory.arrive("planning", true);
    settle(frames);

    restoreLibrary();
    memory.markTop("library");
    expect(frames.pendingCount()).toBe(0);
  });

  it("detaches its interaction guard once a restore is decided, so input later on goes unobserved", () => {
    installScroller();
    installFrameQueue();
    const remove = vi.spyOn(window, "removeEventListener");
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 0);
    memory.arrive("planning", true); // first visit, already at the top

    expect(remove.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining(["pointerdown", "keydown", "wheel", "touchmove"]),
    );
  });
});

describe("createScreenScrollMemory — top requests, invalidation and disposal", () => {
  it("a top request discards the saved position and makes the arriving screen leave the scrolling to App", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "riding", 0);
    memory.arrive("riding", true);
    moveTo(memory, "riding", "library", 700);
    memory.arrive("library", true);
    scrollSpy.mockClear();

    memory.markTop("riding");
    moveTo(memory, "library", "riding", 1000);
    memory.arrive("riding", true);

    expect(memory.savedPosition("riding")).toBeUndefined();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(memory.takeTop("riding")).toBe(true);
    expect(memory.takeTop("riding")).toBe(false);
  });

  it("invalidating a view that is not shown discards its saved position for the next arrival", () => {
    installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("planning");
    moveTo(memory, "planning", "riding", 1400);
    memory.arrive("riding", true);

    memory.invalidate("planning");
    moveTo(memory, "riding", "planning", 0);
    memory.arrive("planning", true);

    expect(window.scrollY).toBe(0);
  });

  it("invalidating the view shown never scrolls it, and its next leave records nothing", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("riding");
    moveTo(memory, "riding", "planning", 0);
    memory.arrive("planning", true);
    window.scrollY = 650; // the rider has scrolled Planning
    scrollSpy.mockClear();

    memory.invalidate("planning");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(650);

    moveTo(memory, "planning", "library", 650);
    expect(memory.savedPosition("planning")).toBeUndefined();
  });

  it("disposal stops the loop and detaches the guard but keeps the saved positions", () => {
    installScroller();
    const frames = installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 1800);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);
    memory.arrive("library", true);
    expect(frames.pendingCount()).toBe(1);

    memory.dispose();

    expect(frames.pendingCount()).toBe(0);
    expect(memory.savedPosition("planning")).toBe(0);
  });

  it("has no side effects when created", () => {
    const add = vi.spyOn(window, "addEventListener");
    createScreenScrollMemory("library");
    expect(add).not.toHaveBeenCalled();
  });
});

describe("useScreenScrollRestoration", () => {
  function Screenish({ ready }: { ready: boolean }) {
    useScreenScrollRestoration(ready);
    return null;
  }

  it("does nothing without App's provider", () => {
    const scrollSpy = installScroller();
    render(<Screenish ready />);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("reports the provider's view and each change of readiness, and restores once under Strict Mode", () => {
    const scrollSpy = installScroller();
    installFrameQueue();
    const memory = createScreenScrollMemory("library");
    moveTo(memory, "library", "planning", 1600);
    memory.arrive("planning", true);
    moveTo(memory, "planning", "library", 0);
    scrollSpy.mockClear();
    const arrive = vi.spyOn(memory, "arrive");
    const value = { memory, view: "library" as Screen };

    const wrap = (ready: boolean): ReactNode => (
      <StrictMode>
        <ScreenScrollContext.Provider value={value}>
          <Screenish ready={ready} />
        </ScreenScrollContext.Provider>
      </StrictMode>
    );
    const { rerender } = render(wrap(false));
    expect(scrollSpy).not.toHaveBeenCalled();
    rerender(wrap(true));

    expect(arrive).toHaveBeenLastCalledWith("library", true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(window.scrollY).toBe(1600);
  });
});

describe("useScreenTopRequests (ported from useResetScrollForNewRideContent)", () => {
  function renderTopRequests(initialScreen: Screen) {
    const memory = createScreenScrollMemory(initialScreen);
    const hook = renderHook(
      ({ screen }: { screen: Screen }) => useScreenTopRequests(screen, memory),
      { initialProps: { screen: initialScreen } },
    );
    return { memory, ...hook };
  }

  it("never scrolls while the requested view is not shown, even after a request", () => {
    const spy = installScroller();
    const { result } = renderTopRequests("library");

    act(() => {
      result.current("riding");
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("scrolls to the top exactly once when a request is followed by its view being shown", () => {
    const spy = installScroller();
    const { result, rerender } = renderTopRequests("library");

    act(() => {
      result.current("riding");
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("applies a request at once when its view is already shown", () => {
    const spy = installScroller();
    const { result } = renderTopRequests("riding");

    act(() => {
      result.current("riding");
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire on a plain bounce back without a new request", () => {
    const spy = installScroller();
    const { result, rerender } = renderTopRequests("library");

    act(() => {
      result.current("riding");
    });
    rerender({ screen: "riding" });
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ screen: "diagnostics" });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fires again on a second request", () => {
    const spy = installScroller();
    const { result, rerender } = renderTopRequests("library");

    act(() => {
      result.current("riding");
    });
    rerender({ screen: "riding" });
    rerender({ screen: "library" });
    act(() => {
      result.current("riding");
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  describe("the reassertion loop against a scroll landing after the reset (item 95 follow-up)", () => {
    function startRidingTop() {
      const scrollSpy = installScroller();
      const frames = installFrameQueue();
      const hook = renderTopRequests("library");
      act(() => {
        hook.result.current("riding");
      });
      hook.rerender({ screen: "riding" });
      return { scrollSpy, frames, ...hook };
    }

    it("corrects a scripted late drift and terminates once scrollY holds within tolerance for consecutive frames", () => {
      const { scrollSpy, frames } = startRidingTop();
      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(frames.pendingCount()).toBe(1);

      act(() => {
        frames.flushFrame(0);
      });
      window.scrollY = 250;
      act(() => {
        frames.flushFrame(16);
      });
      expect(scrollSpy).toHaveBeenCalledTimes(2);
      expect(window.scrollY).toBe(0);

      act(() => {
        frames.flushFrame(32);
      });
      act(() => {
        frames.flushFrame(48);
      });
      act(() => {
        frames.flushFrame(64);
      });

      expect(frames.pendingCount()).toBe(0);
      expect(scrollSpy).toHaveBeenCalledTimes(2);
    });

    it("terminates at the elapsed-time safety cap when scrollY never comes within tolerance", () => {
      const { scrollSpy, frames } = startRidingTop();
      scrollSpy.mockImplementation(() => undefined); // a persistent external drift
      window.scrollY = 999;
      act(() => {
        frames.flushFrame(0);
      });
      expect(frames.pendingCount()).toBe(1);

      window.scrollY = 999;
      act(() => {
        frames.flushFrame(1500);
      });

      expect(frames.pendingCount()).toBe(0);
    });

    it("cancels the prior loop's pending frame when a newer request supersedes it mid-loop", () => {
      const { frames, result } = startRidingTop();
      expect(frames.pendingCount()).toBe(1);

      act(() => {
        result.current("riding");
      });

      expect(frames.cafSpy).toHaveBeenCalled();
      expect(frames.pendingCount()).toBe(1);
    });

    it("cancels the pending frame on unmount", () => {
      const { frames, unmount } = startRidingTop();
      expect(frames.pendingCount()).toBe(1);

      unmount();

      expect(frames.cafSpy).toHaveBeenCalled();
      expect(frames.pendingCount()).toBe(0);
    });

    it.each(["touchstart", "pointerdown", "wheel"] as const)(
      "stops immediately on a genuine %s event",
      (eventName) => {
        const { scrollSpy, frames } = startRidingTop();
        act(() => {
          frames.flushFrame(0);
        });
        expect(frames.pendingCount()).toBe(1);

        act(() => {
          window.dispatchEvent(new Event(eventName));
        });

        expect(frames.pendingCount()).toBe(0);
        expect(scrollSpy).toHaveBeenCalledTimes(1);
      },
    );

    it("a plain tab return after it has settled never starts the loop again", () => {
      const { scrollSpy, frames, rerender } = startRidingTop();
      settle(frames);
      expect(frames.pendingCount()).toBe(0);
      const rafCallsAtSettle = frames.rafSpy.mock.calls.length;

      rerender({ screen: "library" });
      rerender({ screen: "riding" });

      expect(scrollSpy).toHaveBeenCalledTimes(1);
      expect(frames.rafSpy.mock.calls.length).toBe(rafCallsAtSettle);
    });
  });
});

describe("disableBrowserScrollRestoration", () => {
  it("sets the document's scroll restoration to manual", () => {
    history.scrollRestoration = "auto";
    disableBrowserScrollRestoration();
    expect(history.scrollRestoration).toBe("manual");
  });
});
