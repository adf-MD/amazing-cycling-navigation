import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOnlineStatus } from "./onlineStatus.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useOnlineStatus", () => {
  it("reflects navigator.onLine at mount", () => {
    vi.stubGlobal("navigator", { onLine: false });

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it("updates when the browser fires online/offline events", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    vi.stubGlobal("navigator", { onLine: false });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current).toBe(false);
  });
});
