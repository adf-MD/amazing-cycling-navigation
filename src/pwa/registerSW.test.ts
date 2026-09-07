import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
const setOfflineReady = vi.fn();
const setNeedRefresh = vi.fn();

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [true, setOfflineReady],
    needRefresh: [false, setNeedRefresh],
    updateServiceWorker,
  }),
}));

beforeEach(() => {
  updateServiceWorker.mockClear();
  setOfflineReady.mockClear();
  setNeedRefresh.mockClear();
});

describe("usePwaUpdate", () => {
  it("exposes needRefresh but not the plugin's offlineReady flag", async () => {
    const { usePwaUpdate } = await import("./registerSW.ts");
    const { result } = renderHook(() => usePwaUpdate());

    expect(result.current.needRefresh).toBe(false);
    // The underlying plugin mock above still reports offlineReady as true —
    // this proves the project's own hook deliberately narrows it away,
    // rather than merely happening not to be exercised.
    expect(result.current).not.toHaveProperty("offlineReady");
  });

  it("only applies the waiting service worker on an explicit call", async () => {
    const { usePwaUpdate } = await import("./registerSW.ts");
    const { result } = renderHook(() => usePwaUpdate());

    expect(updateServiceWorker).not.toHaveBeenCalled();

    act(() => {
      result.current.updateNow();
    });

    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it("dismiss clears only needRefresh, never the plugin's offlineReady flag", async () => {
    const { usePwaUpdate } = await import("./registerSW.ts");
    const { result } = renderHook(() => usePwaUpdate());

    act(() => {
      result.current.dismiss();
    });

    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(setOfflineReady).not.toHaveBeenCalled();
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
