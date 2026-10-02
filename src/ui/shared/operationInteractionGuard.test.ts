import { afterEach, describe, expect, it, vi } from "vitest";
import { armOperationInteractionGuard } from "./operationInteractionGuard.ts";

describe("armOperationInteractionGuard", () => {
  const area = document.createElement("div");
  const inside = document.createElement("button");
  const outside = document.createElement("button");
  area.append(inside);
  document.body.append(area, outside);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts armed", () => {
    const guard = armOperationInteractionGuard(() => area);
    expect(guard.armed).toBe(true);
    guard.detach();
  });

  it("stays armed for a pointerdown inside the area, and disarms for one outside it", () => {
    const guard = armOperationInteractionGuard(() => area);
    inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(guard.armed).toBe(true);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("disarms for a pointerdown on blank space, which leaves focus on <body>", () => {
    const guard = armOperationInteractionGuard(() => area);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("stays armed only for Escape inside the area; any other key disarms it", () => {
    const escapeInside = armOperationInteractionGuard(() => area);
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escapeInside.armed).toBe(true);
    escapeInside.detach();

    const escapeOutside = armOperationInteractionGuard(() => area);
    outside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(escapeOutside.armed).toBe(false);
    escapeOutside.detach();

    const tabInside = armOperationInteractionGuard(() => area);
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(tabInside.armed).toBe(false);
    tabInside.detach();
  });

  it.each(["wheel", "touchmove"])(
    "disarms for a %s anywhere, the area included",
    (type) => {
      const guard = armOperationInteractionGuard(() => area);
      inside.dispatchEvent(new Event(type, { bubbles: true }));
      expect(guard.armed).toBe(false);
      guard.detach();
    },
  );

  it("disarms everything outside an area that is not mounted", () => {
    const guard = armOperationInteractionGuard(() => null);
    inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(guard.armed).toBe(false);
    guard.detach();
  });

  it("reads as disarmed once detached, removes exactly the listeners it added, and detaches once", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const guard = armOperationInteractionGuard(() => area);
    const added = add.mock.calls.map(([type, listener]) => [type, listener]);
    expect(added.map(([type]) => type).sort()).toEqual([
      "keydown",
      "pointerdown",
      "touchmove",
      "wheel",
    ]);

    guard.detach();
    expect(guard.armed).toBe(false);
    expect(remove.mock.calls.map(([type, listener]) => [type, listener])).toEqual(
      expect.arrayContaining(added),
    );
    expect(remove).toHaveBeenCalledTimes(4);

    guard.detach();
    expect(remove).toHaveBeenCalledTimes(4);
  });
});
