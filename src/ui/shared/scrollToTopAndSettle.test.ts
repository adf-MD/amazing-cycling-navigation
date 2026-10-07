import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToAndSettle, scrollToTopAndSettle } from "./scrollToTopAndSettle.ts";

// The reassertion loop's drift, settle and safety-cap behaviour is covered
// through its top-request caller in screenScrollMemory.test.ts, whose cases
// were ported from useResetScrollForNewRideContent.test.ts (backlog item
// 125). These tests pin the contract a caller relies on, and the targeted
// form scroll restoration uses.

afterEach(() => {
  vi.restoreAllMocks();
  const root = document.documentElement as unknown as Record<string, unknown>;
  delete root.scrollHeight;
  delete root.clientHeight;
});

function installFrameQueue() {
  let nextId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    callbacks.delete(id);
  });
  return {
    pendingCount: () => callbacks.size,
    flushFrame: (timestamp: number) => {
      const entries = [...callbacks.values()];
      callbacks.clear();
      for (const callback of entries) callback(timestamp);
    },
  };
}

/** A document `height` tall in an 800px viewport, with scrollTo clamping
 * window.scrollY as a browser would. */
function installScroller(height: number) {
  window.scrollY = 0;
  const root = document.documentElement;
  Object.defineProperty(root, "scrollHeight", { configurable: true, value: height });
  Object.defineProperty(root, "clientHeight", { configurable: true, value: 800 });
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [options] = args;
    const top = (options as ScrollToOptions).top ?? 0;
    window.scrollY = Math.min(top, Math.max(0, height - 800));
  });
}

describe("scrollToTopAndSettle", () => {
  it("scrolls to the top immediately and instantly, before any frame", () => {
    installFrameQueue();
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    scrollToTopAndSettle();

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, left: 0, behavior: "auto" });
  });

  it("returns a stop function that cancels the pending frame, for an effect's cleanup", () => {
    const frames = installFrameQueue();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const stop = scrollToTopAndSettle();
    expect(frames.pendingCount()).toBe(1);

    stop();

    expect(frames.pendingCount()).toBe(0);
  });

  it("abandons the loop as soon as genuine user input arrives", () => {
    const frames = installFrameQueue();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    scrollToTopAndSettle();
    window.dispatchEvent(new Event("touchstart"));

    expect(frames.pendingCount()).toBe(0);
  });
});

describe("scrollToAndSettle (backlog item 125)", () => {
  it("scrolls to the target at once, unclamped, then settles where the page can reach it", () => {
    const frames = installFrameQueue();
    const scrollSpy = installScroller(2000);

    scrollToAndSettle(3000);

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ top: 3000, left: 0, behavior: "auto" });
    expect(window.scrollY).toBe(1200);
    for (let frame = 0; frame < 3; frame += 1) frames.flushFrame(frame * 16);
    expect(frames.pendingCount()).toBe(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it("re-applies the clamped target when something else moves the page during the loop", () => {
    const frames = installFrameQueue();
    const scrollSpy = installScroller(5000);

    scrollToAndSettle(1500);
    window.scrollY = 0; // e.g. a smooth scroll from the previous screen landing late
    frames.flushFrame(0);

    expect(scrollSpy).toHaveBeenLastCalledWith({ top: 1500, left: 0, behavior: "auto" });
    expect(window.scrollY).toBe(1500);
  });

  it("ends without another scroll as soon as shouldStop says so", () => {
    const frames = installFrameQueue();
    const scrollSpy = installScroller(5000);
    let movedOn = false;

    scrollToAndSettle(1500, { shouldStop: () => movedOn });
    movedOn = true;
    window.scrollY = 1700;
    frames.flushFrame(0);

    expect(frames.pendingCount()).toBe(0);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(window.scrollY).toBe(1700);
  });

  it("calls onEnd exactly once however it ends", () => {
    const frames = installFrameQueue();
    installScroller(5000);

    const settled = vi.fn();
    scrollToAndSettle(1500, { onEnd: settled });
    for (let frame = 0; frame < 3; frame += 1) frames.flushFrame(frame * 16);
    expect(settled).toHaveBeenCalledTimes(1);

    const stopped = vi.fn();
    const stop = scrollToAndSettle(1500, { onEnd: stopped });
    stop();
    stop();
    window.dispatchEvent(new Event("wheel"));
    expect(stopped).toHaveBeenCalledTimes(1);

    const interrupted = vi.fn();
    scrollToAndSettle(1500, { onEnd: interrupted });
    window.dispatchEvent(new Event("pointerdown"));
    expect(interrupted).toHaveBeenCalledTimes(1);
  });
});
