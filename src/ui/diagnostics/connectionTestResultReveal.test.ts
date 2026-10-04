import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  armConnectionTestWaitGuard,
  revealConnectionTestResult,
} from "./connectionTestResultReveal.ts";

// Backlog item 124, slice 11 (P-15). jsdom has no layout and no
// visualViewport, and its window.innerHeight is 768, so with sticky rows
// ending at 120px and no safe-area inset the usable band is 128..760: 8px
// below the switcher, and 8px above the bottom. Real-browser geometry is
// proved in e2e/statusConnectionResultReveal.smoke.spec.ts.
const HEADER_BOTTOM = 120;
const BAND_TOP = 128;
const BAND_BOTTOM = 760;

function lineAt(top: number, bottom: number): HTMLElement {
  const line = document.createElement("p");
  line.getBoundingClientRect = () => ({
    top,
    bottom,
    left: 16,
    right: 374,
    width: 358,
    height: bottom - top,
    x: 16,
    y: top,
    toJSON: () => "",
  });
  return line;
}

describe("revealConnectionTestResult", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalMatchMedia = window.matchMedia;
  let scrolls: ScrollToOptions[];

  beforeEach(() => {
    scrolls = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") scrolls.push(options);
    };
  });

  afterEach(() => {
    window.scrollBy = originalScrollBy;
    window.matchMedia = originalMatchMedia;
    document.documentElement.style.removeProperty("--safe-area-inset-bottom");
  });

  it("does not move a result line that is already inside the band", () => {
    expect(revealConnectionTestResult(lineAt(500, 556), HEADER_BOTTOM)).toBe(0);
    expect(scrolls).toEqual([]);
  });

  it("brings a line wholly below the screen up to the band's bottom, no further", () => {
    // The state measured on 4 October 2026: the button low on the screen,
    // its result appearing entirely below it.
    expect(revealConnectionTestResult(lineAt(800, 856), HEADER_BOTTOM)).toBe(
      856 - BAND_BOTTOM,
    );
    expect(scrolls).toEqual([{ top: 96, left: 0, behavior: "smooth" }]);
  });

  it("moves a line that is on screen but inside the bottom cushion by the minimum", () => {
    expect(revealConnectionTestResult(lineAt(710, 766), HEADER_BOTTOM)).toBe(
      766 - BAND_BOTTOM,
    );
  });

  it("aligns the beginning of a line taller than the band below the sticky rows", () => {
    // 700px tall against a 632px band: its top lands 8px below the
    // switcher rather than its bottom at the band's bottom.
    expect(revealConnectionTestResult(lineAt(800, 1500), HEADER_BOTTOM)).toBe(
      800 - BAND_TOP,
    );
  });

  it("leaves an oversized line alone once its beginning is already aligned", () => {
    expect(
      revealConnectionTestResult(lineAt(BAND_TOP, BAND_TOP + 700), HEADER_BOTTOM),
    ).toBe(0);
    expect(scrolls).toEqual([]);
  });

  it("moves down only as far as shows a line whose top is under the sticky rows", () => {
    expect(revealConnectionTestResult(lineAt(100, 156), HEADER_BOTTOM)).toBe(
      100 - BAND_TOP,
    );
  });

  it("treats sub-pixel misalignment as already in place", () => {
    expect(
      revealConnectionTestResult(lineAt(700, BAND_BOTTOM + 0.6), HEADER_BOTTOM),
    ).toBe(0);
  });

  it("keeps the line clear of the bottom safe-area inset as well as the gap", () => {
    // The same inline seam index.css documents and the e2e specs use.
    document.documentElement.style.setProperty("--safe-area-inset-bottom", "34px");
    expect(revealConnectionTestResult(lineAt(800, 856), HEADER_BOTTOM)).toBe(
      856 - (BAND_BOTTOM - 34),
    );
  });

  it("uses the viewport's top when there are no sticky rows", () => {
    expect(revealConnectionTestResult(lineAt(-50, 6), 0)).toBe(-50 - 8);
  });

  it("does nothing for a line with no laid-out box", () => {
    expect(revealConnectionTestResult(lineAt(0, 0), HEADER_BOTTOM)).toBe(0);
    expect(scrolls).toEqual([]);
  });

  it("moves at once when reduced motion is set", () => {
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;
    revealConnectionTestResult(lineAt(800, 856), HEADER_BOTTOM);
    expect(scrolls).toEqual([{ top: 96, left: 0, behavior: "auto" }]);
  });
});

describe("armConnectionTestWaitGuard", () => {
  const button = document.createElement("button");
  const elsewhere = document.createElement("button");
  document.body.append(button, elsewhere);

  let visibility: DocumentVisibilityState = "visible";
  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setVisibility(next: DocumentVisibilityState) {
    visibility = next;
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("starts armed", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    expect(guard.armed).toBe(true);
    guard.detach();
  });

  it("stays armed while focus only leaves the disabled button", () => {
    // A disabled button losing focus fires blur and focusout, never focusin.
    const guard = armConnectionTestWaitGuard(() => button);
    button.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    button.dispatchEvent(new FocusEvent("blur"));
    expect(guard.armed).toBe(true);
    guard.detach();
  });

  it("stays armed for focusin on the button itself, and disarms for focusin elsewhere", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(guard.armed).toBe(true);
    elsewhere.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("disarms on a real focus move to another control", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    elsewhere.focus();
    expect(guard.armed).toBe(false);
    elsewhere.blur();
    guard.detach();
  });

  it("disarms when the document becomes hidden, and stays disarmed on return", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    setVisibility("hidden");
    expect(guard.armed).toBe(false);
    setVisibility("visible");
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("ignores a visibilitychange that leaves the document visible", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    setVisibility("visible");
    expect(guard.armed).toBe(true);
    guard.detach();
  });

  it("keeps the shared guard's signals: a pointerdown inside stays armed, a wheel disarms", () => {
    const guard = armConnectionTestWaitGuard(() => button);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(guard.armed).toBe(true);
    window.dispatchEvent(new Event("wheel"));
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("disarms for a pointerdown elsewhere and for any key", () => {
    const tap = armConnectionTestWaitGuard(() => button);
    elsewhere.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(tap.armed).toBe(false);
    tap.detach();

    const key = armConnectionTestWaitGuard(() => button);
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    expect(key.armed).toBe(false);
    key.detach();
  });

  it("reads as disarmed once detached, and removes every listener", () => {
    const added: string[] = [];
    const removed: string[] = [];
    const record =
      (into: string[]) =>
      (type: string): void => {
        into.push(type);
      };
    vi.spyOn(window, "addEventListener").mockImplementation(record(added));
    vi.spyOn(document, "addEventListener").mockImplementation(record(added));
    vi.spyOn(window, "removeEventListener").mockImplementation(record(removed));
    vi.spyOn(document, "removeEventListener").mockImplementation(record(removed));

    const guard = armConnectionTestWaitGuard(() => button);
    guard.detach();
    expect(guard.armed).toBe(false);
    expect([...removed].sort()).toEqual([...added].sort());
    expect(added).toEqual(
      expect.arrayContaining(["focusin", "visibilitychange", "pointerdown", "wheel"]),
    );
    guard.detach();
    expect(removed).toHaveLength(added.length);
  });
});
