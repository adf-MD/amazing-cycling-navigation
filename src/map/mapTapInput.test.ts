import { describe, expect, it } from "vitest";
import { mapTapInputFromPointerType, trackMapTapInput } from "./mapTapInput.ts";

// Backlog item 123. Each sequence below is the order a browser delivers to
// MapLibre's canvas container, as measured on Playwright's Chromium and
// WebKit against the unchanged 0.4.45 build: a touch tap is pointerdown
// (touch), touchstart, pointerup, touchend, then compatibility mousedown,
// mouseup and click; a mouse click is pointerdown (mouse), mousedown,
// pointerup, mouseup, click.

function pointerDown(target: EventTarget, pointerType: string): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { pointerType, bubbles: true }));
}

function touchStart(target: EventTarget): void {
  target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true }));
}

/** A compatibility mouse event — a MouseEvent, never a PointerEvent. */
function compatibilityMouse(target: EventTarget, type: string): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true }));
}

/** A click as Chromium sends it: a PointerEvent carrying its own type. */
function pointerClick(pointerType: string): Event {
  return new PointerEvent("click", { pointerType, bubbles: true });
}

function touchTapSequence(target: EventTarget): void {
  pointerDown(target, "touch");
  touchStart(target);
  compatibilityMouse(target, "mousedown");
  compatibilityMouse(target, "mouseup");
}

function mouseSequence(target: EventTarget): void {
  pointerDown(target, "mouse");
  compatibilityMouse(target, "mousedown");
  compatibilityMouse(target, "mouseup");
}

describe("mapTapInputFromPointerType", () => {
  it("maps the three pointer types and treats anything else as unknown", () => {
    expect(mapTapInputFromPointerType("mouse")).toBe("mouse");
    expect(mapTapInputFromPointerType("touch")).toBe("touch");
    expect(mapTapInputFromPointerType("pen")).toBe("pen");
    expect(mapTapInputFromPointerType("")).toBe("unknown");
    expect(mapTapInputFromPointerType(undefined)).toBe("unknown");
  });
});

describe("trackMapTapInput", () => {
  it("classifies a mouse click as mouse", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    mouseSequence(container);

    expect(tracker.classify(pointerClick("mouse"))).toBe("mouse");
  });

  it("classifies a touch tap as touch even when its click reports itself as a mouse click", () => {
    // Measured on Playwright's WebKit: the click after a genuine touch tap
    // carries pointerType "mouse".
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    touchTapSequence(container);

    expect(tracker.classify(pointerClick("mouse"))).toBe("touch");
  });

  it("classifies a touch tap as touch when its click is a plain MouseEvent", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    touchTapSequence(container);

    expect(tracker.classify(new MouseEvent("click"))).toBe("touch");
  });

  it("classifies a mouse click made immediately after a touch tap as mouse", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    touchTapSequence(container);
    expect(tracker.classify(pointerClick("touch"))).toBe("touch");
    mouseSequence(container);

    expect(tracker.classify(pointerClick("mouse"))).toBe("mouse");
  });

  it("lets a touchstart mark its own sequence as touch when that sequence's pointerdown was mislabelled", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    pointerDown(container, "mouse");
    touchStart(container);

    expect(tracker.classify(pointerClick("mouse"))).toBe("touch");
  });

  it("keeps a pen as pen, including when it arrives through touch events", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    pointerDown(container, "pen");
    expect(tracker.classify(pointerClick("pen"))).toBe("pen");

    pointerDown(container, "pen");
    touchStart(container);
    expect(tracker.classify(new MouseEvent("click"))).toBe("pen");
  });

  it("lets the click's own type withhold placement but never grant it", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    mouseSequence(container);
    expect(tracker.classify(pointerClick("touch"))).toBe("touch");

    // No sequence at all: a click claiming to be a mouse is still unknown.
    expect(tracker.classify(pointerClick("mouse"))).toBe("unknown");
  });

  it("reports a click with no new pointer sequence since the last classified click as unknown", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    expect(tracker.classify(new MouseEvent("click"))).toBe("unknown");

    mouseSequence(container);
    expect(tracker.classify(pointerClick("mouse"))).toBe("mouse");
    // A programmatic or assistive-technology click, with no pointerdown.
    expect(tracker.classify(new MouseEvent("click"))).toBe("unknown");
  });

  it("gives every caller the same answer for the same click", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);

    mouseSequence(container);
    const click = pointerClick("mouse");

    expect(tracker.classify(click)).toBe("mouse");
    expect(tracker.classify(click)).toBe("mouse");
  });

  it("sees a sequence that starts on a descendant, such as the canvas inside the container", () => {
    const container = document.createElement("div");
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);
    const tracker = trackMapTapInput(container);

    touchTapSequence(canvas);

    expect(tracker.classify(pointerClick("mouse"))).toBe("touch");
  });

  it("stops listening once disposed", () => {
    const container = document.createElement("div");
    const tracker = trackMapTapInput(container);
    tracker.dispose();

    mouseSequence(container);

    expect(tracker.classify(pointerClick("mouse"))).toBe("unknown");
  });
});
