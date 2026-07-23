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
  it("exposes the current offline-ready/need-refresh flags", async () => {
    const { usePwaUpdate } = await import("./registerSW.ts");
    const { result } = renderHook(() => usePwaUpdate());

    expect(result.current.offlineReady).toBe(true);
    expect(result.current.needRefresh).toBe(false);
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

  it("dismiss clears both flags without applying the update", async () => {
    const { usePwaUpdate } = await import("./registerSW.ts");
    const { result } = renderHook(() => usePwaUpdate());

    act(() => {
      result.current.dismiss();
    });

    expect(setOfflineReady).toHaveBeenCalledWith(false);
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });
});
