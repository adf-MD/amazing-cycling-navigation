import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollToTopAndSettle } from "./scrollToTopAndSettle.ts";

// The reassertion loop's drift, settle and safety-cap behaviour is covered
// through its original caller in useResetScrollForNewRideContent.test.ts,
// which was left unchanged when the loop was extracted (backlog item 121).
// These tests pin only the contract a second caller relies on.

afterEach(() => {
  vi.restoreAllMocks();
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
  return { pendingCount: () => callbacks.size };
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
