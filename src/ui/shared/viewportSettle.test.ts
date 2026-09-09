import { afterEach, describe, expect, it, vi } from "vitest";
import { runWhenViewportSettled } from "./viewportSettle.ts";

// Backlog item 106. Direct coverage of the settling lifecycle every tag
// reveal now waits on, kept separate from its callers' own tests so the
// frame/tolerance/cap rules are pinned in one place rather than inferred
// from a component's behaviour.
describe("runWhenViewportSettled", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRaf = window.requestAnimationFrame;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalCancelRaf = window.cancelAnimationFrame;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalAddEventListener = window.addEventListener;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRemoveEventListener = window.removeEventListener;
  const originalVisualViewport = window.visualViewport;
  const originalScrollY = window.scrollY;

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: originalScrollY,
    });
  });

  /** A manually driven animation-frame clock: nothing advances until the
   * test says so, and each frame carries an explicit timestamp, so the
   * stable-frame count and the elapsed-time cap are both deterministic. */
  function installFrameClock() {
    let nextHandle = 1;
    const pending = new Map<number, FrameRequestCallback>();
    const cancelled: number[] = [];
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (handle: number) => {
      cancelled.push(handle);
      pending.delete(handle);
    };
    return {
      cancelled,
      get pendingCount() {
        return pending.size;
      },
      /** Runs whichever single frame is currently queued, if any. */
      advance(timestamp: number) {
        const [entry] = [...pending.entries()];
        if (!entry) return false;
        const [handle, callback] = entry;
        pending.delete(handle);
        callback(timestamp);
        return true;
      },
      /** Runs up to `count` frames, 16ms apart from `from`. */
      advanceMany(count: number, from = 0) {
        for (let index = 0; index < count; index++) {
          if (!this.advance(from + index * 16)) return;
        }
      },
    };
  }

  function stubViewport(value: { offsetTop: number; height: number } | null) {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value,
    });
  }

  function stubScrollY(value: number) {
    Object.defineProperty(window, "scrollY", { configurable: true, value });
  }

  it("runs once the geometry has held still for the required consecutive frames", () => {
    const clock = installFrameClock();
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(400);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(3);
    expect(run).not.toHaveBeenCalled();

    clock.advanceMany(1, 48);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("invokes run exactly once and stops scheduling further frames", () => {
    const clock = installFrameClock();
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(0);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(10);

    expect(run).toHaveBeenCalledTimes(1);
    expect(clock.pendingCount).toBe(0);
  });

  it("resets the stable-frame count when the visual viewport changes", () => {
    const clock = installFrameClock();
    const viewport = { offsetTop: 260, height: 420 };
    stubViewport(viewport);
    stubScrollY(500);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(3);
    expect(run).not.toHaveBeenCalled();

    // The keyboard finishes dismissing: both the offset and the height
    // change, which must restart the count rather than complete it.
    viewport.offsetTop = 0;
    viewport.height = 700;
    clock.advanceMany(1, 48);
    expect(run).not.toHaveBeenCalled();

    clock.advanceMany(3, 64);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("resets the stable-frame count when window.scrollY changes independently", () => {
    const clock = installFrameClock();
    // The viewport box is completely static throughout — only scrollY
    // moves, which is exactly the case a viewport-only signature would
    // miss (an in-flight smooth scroll, or Safari's own scroll restoration
    // after a keyboard dismissal).
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(900);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(3);
    expect(run).not.toHaveBeenCalled();

    stubScrollY(840);
    clock.advanceMany(1, 48);
    expect(run).not.toHaveBeenCalled();

    clock.advanceMany(3, 64);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats sub-pixel jitter within the tolerance as unchanged", () => {
    const clock = installFrameClock();
    const viewport = { offsetTop: 0, height: 700.4 };
    stubViewport(viewport);
    stubScrollY(300);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advance(0);
    viewport.height = 700.9;
    clock.advance(16);
    viewport.height = 700.2;
    clock.advance(32);
    stubScrollY(300.6);
    clock.advance(48);

    // Every sample stayed within 1px of its predecessor, so the jitter
    // never restarted the count.
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to the layout viewport when visualViewport is unavailable", () => {
    const clock = installFrameClock();
    stubViewport(null);
    stubScrollY(120);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(4);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it("abandons at the safety cap WITHOUT running, rather than acting on unstable geometry", () => {
    const clock = installFrameClock();
    const viewport = { offsetTop: 0, height: 700 };
    stubViewport(viewport);
    stubScrollY(0);
    const run = vi.fn();

    runWhenViewportSettled(run);
    // Never settles: every frame moves the viewport, and the elapsed time
    // crosses the 1000ms cap.
    for (let index = 0; index < 80; index++) {
      viewport.offsetTop += 10;
      clock.advance(index * 20);
    }

    expect(run).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it("can be cancelled explicitly before it settles", () => {
    const clock = installFrameClock();
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(0);
    const run = vi.fn();

    const cancel = runWhenViewportSettled(run);
    clock.advanceMany(2);
    cancel();
    clock.advanceMany(6, 64);

    expect(run).not.toHaveBeenCalled();
    expect(clock.pendingCount).toBe(0);
  });

  it("abandons when genuine user input arrives mid-wait", () => {
    const clock = installFrameClock();
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(0);
    const run = vi.fn();

    runWhenViewportSettled(run);
    clock.advanceMany(2);
    window.dispatchEvent(new Event("pointerdown"));
    clock.advanceMany(6, 64);

    expect(run).not.toHaveBeenCalled();
  });

  it("removes its input listeners and cancels its pending frame on every exit path", () => {
    const added: string[] = [];
    const removed: string[] = [];
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      added.push(type);
      (originalAddEventListener as (...args: unknown[]) => void).call(
        window,
        type,
        ...rest,
      );
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      (originalRemoveEventListener as (...args: unknown[]) => void).call(
        window,
        type,
        ...rest,
      );
    }) as typeof window.removeEventListener;
    const clock = installFrameClock();
    stubViewport({ offsetTop: 0, height: 700 });
    stubScrollY(0);

    // Settled-completion path.
    runWhenViewportSettled(vi.fn());
    clock.advanceMany(4);
    expect(added).toEqual(["touchstart", "pointerdown", "wheel"]);
    expect(removed).toEqual(["touchstart", "pointerdown", "wheel"]);
    expect(clock.pendingCount).toBe(0);

    // Explicit-cancel path, with a frame genuinely outstanding.
    added.length = 0;
    removed.length = 0;
    const cancel = runWhenViewportSettled(vi.fn());
    clock.advance(0);
    expect(clock.pendingCount).toBe(1);
    cancel();
    expect(removed).toEqual(["touchstart", "pointerdown", "wheel"]);
    expect(clock.cancelled.length).toBeGreaterThan(0);
    expect(clock.pendingCount).toBe(0);
  });
});
