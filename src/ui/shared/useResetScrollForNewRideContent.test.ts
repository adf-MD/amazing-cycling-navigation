import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Screen } from "./MainNavigation.tsx";
import { useResetScrollForNewRideContent } from "./useResetScrollForNewRideContent.ts";

function installScrollToSpy() {
  window.scrollY = 0;
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [a, b] = args;
    if (typeof a === "object" && a !== null && "top" in a) {
      const top = (a as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = top;
    } else if (typeof b === "number") {
      window.scrollY = b;
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useResetScrollForNewRideContent", () => {
  it("never scrolls while screen is not riding, even after a bump", () => {
    const spy = installScrollToSpy();
    const { result } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      {
        initialProps: { screen: "library" },
      },
    );

    act(() => {
      result.current();
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it("scrolls to the top exactly once when a bump is followed by screen becoming riding", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("does not re-fire on a plain screen bounce back to riding without a new bump — mirrors a nav-tab return to an already-open ride", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ screen: "diagnostics" });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("fires again on a second bump — the mechanism handleRouteSaved shares with handleOpenRoute", () => {
    const spy = installScrollToSpy();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(spy).toHaveBeenCalledTimes(1);

    rerender({ screen: "library" });
    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("reassertion against a scroll landing after the reset (item 95 follow-up)", () => {
  /** A controllable requestAnimationFrame queue: flushFrame(timestamp)
   * fires whatever callback(s) are currently pending with that exact
   * timestamp, letting a test script an exact drift/settle sequence
   * rather than depending on jsdom's own frame timing. */
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
        for (const [, callback] of entries) {
          callback(timestamp);
        }
      },
    };
  }

  it("corrects a scripted late drift and terminates once scrollY holds within tolerance for consecutive frames", () => {
    const scrollSpy = installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(frames.pendingCount()).toBe(1);

    // Frame 1: already at top from the synchronous reset.
    act(() => {
      frames.flushFrame(0);
    });
    expect(frames.pendingCount()).toBe(1);

    // Something else (e.g. a still-animating switch-prompt card scroll)
    // lands a scroll after the reset — simulated directly, since jsdom
    // cannot itself animate a real scrollIntoView.
    window.scrollY = 250;
    act(() => {
      frames.flushFrame(16);
    });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(window.scrollY).toBe(0);

    // Three more consecutive in-tolerance frames settle it.
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

  it("terminates at the elapsed-time safety cap, not a frame count, when scrollY never comes within tolerance", () => {
    const scrollSpy = installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    window.scrollY = 999; // a persistent, never-settling external drift
    act(() => {
      frames.flushFrame(0);
    });
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(frames.pendingCount()).toBe(1);

    // A single subsequent tick whose timestamp already exceeds the cap
    // ends the loop immediately — proving the cap is driven by elapsed
    // time, not by how many frames have actually ticked (only two ticks
    // occur here in total).
    window.scrollY = 999;
    act(() => {
      frames.flushFrame(1500);
    });

    expect(frames.pendingCount()).toBe(0);
  });

  it("cancels the prior generation's pending frame when a newer token supersedes mid-loop", () => {
    installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(frames.pendingCount()).toBe(1);

    act(() => {
      result.current(); // a second, genuinely new bump mid-loop
    });

    expect(frames.cafSpy).toHaveBeenCalled();
    expect(frames.pendingCount()).toBe(1); // only the new generation's own tick
  });

  it("cancels the pending frame on unmount", () => {
    installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender, unmount } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(frames.pendingCount()).toBe(1);

    unmount();

    expect(frames.cafSpy).toHaveBeenCalled();
    expect(frames.pendingCount()).toBe(0);
  });

  it.each(["touchstart", "pointerdown", "wheel"] as const)(
    "stops immediately on a genuine %s event, before stability or the safety cap would otherwise end it",
    (eventName) => {
      const scrollSpy = installScrollToSpy();
      const frames = installFrameQueue();
      const { result, rerender } = renderHook(
        ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
        { initialProps: { screen: "library" } },
      );

      act(() => {
        result.current();
      });
      rerender({ screen: "riding" });
      expect(scrollSpy).toHaveBeenCalledTimes(1);

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

  it("a genuine plain tab return — away from Riding and back with no new bump — never starts the reassertion loop again", () => {
    const scrollSpy = installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // Let the loop settle naturally.
    act(() => {
      frames.flushFrame(0);
    });
    act(() => {
      frames.flushFrame(16);
    });
    act(() => {
      frames.flushFrame(32);
    });
    expect(frames.pendingCount()).toBe(0);
    const rafCallsAtSettle = frames.rafSpy.mock.calls.length;

    // A genuine plain nav-tab return: away from Riding and back, with no
    // further bump of the returned token.
    rerender({ screen: "library" });
    rerender({ screen: "riding" });

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(frames.rafSpy.mock.calls.length).toBe(rafCallsAtSettle);
  });

  it("does not resume correcting once settled, even if scrollY is later perturbed by a deliberate user scroll", () => {
    const scrollSpy = installScrollToSpy();
    const frames = installFrameQueue();
    const { result, rerender } = renderHook(
      ({ screen }: { screen: Screen }) => useResetScrollForNewRideContent(screen),
      { initialProps: { screen: "library" } },
    );

    act(() => {
      result.current();
    });
    rerender({ screen: "riding" });
    act(() => {
      frames.flushFrame(0);
    });
    act(() => {
      frames.flushFrame(16);
    });
    act(() => {
      frames.flushFrame(32);
    });
    expect(frames.pendingCount()).toBe(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // A deliberate later scroll: nothing is scheduled any more to fight it.
    window.scrollY = 400;
    expect(frames.pendingCount()).toBe(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
