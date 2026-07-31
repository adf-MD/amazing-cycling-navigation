import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import * as errorLog from "../../platform/errorLog.ts";
import { useScreenWakeLock } from "./useScreenWakeLock.ts";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
}

function fireVisibilityChange() {
  document.dispatchEvent(new Event("visibilitychange"));
}

const fixedClock = { now: () => 1_000 };

afterEach(() => {
  setVisibility("visible");
  vi.restoreAllMocks();
});

describe("useScreenWakeLock", () => {
  it("desired=false never calls request()", () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: false,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );

    expect(fake.requestSpy).not.toHaveBeenCalled();
    expect(result.current.status).toBe("inactive");
  });

  it("desired=true issues exactly one request(); a successful resolution reaches active", async () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );

    expect(fake.requestSpy).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("acquiring");

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("active");
  });

  it("desired flipping to false releases the held sentinel exactly once and returns to inactive", async () => {
    const fake = buildFakeWakeLockSource();
    const { result, rerender } = renderHook(
      ({ desired }: { desired: boolean }) =>
        useScreenWakeLock({ desired, wakeLockSource: fake.source, clock: fixedClock }),
      { initialProps: { desired: true } },
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");

    act(() => {
      rerender({ desired: false });
    });

    expect(result.current.status).toBe("inactive");
    expect(fake.instances[0]?.releaseCallCount).toBe(1);
  });

  it("unmount while active releases the held sentinel exactly once", async () => {
    const fake = buildFakeWakeLockSource();
    const { result, unmount } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");

    unmount();

    expect(fake.instances[0]?.releaseCallCount).toBe(1);
  });

  it("leaving the screen (unmount) before a route was ever active starts an unrelated new ride disabled", () => {
    // A fresh mount with desired=false — mirrors what a genuinely new
    // ride looks like (see useRideNavigation's per-route wakeLockDesired
    // reset). No request is ever issued.
    const fake = buildFakeWakeLockSource();
    const { unmount } = renderHook(() =>
      useScreenWakeLock({
        desired: false,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    unmount();
    expect(fake.requestSpy).not.toHaveBeenCalled();
  });

  it("document hidden releases the sentinel and retains desired; visible again requests exactly one fresh sentinel", async () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");

    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
    });
    expect(result.current.status).toBe("inactive");
    expect(fake.instances[0]?.releaseCallCount).toBe(1);
    expect(fake.requestSpy).toHaveBeenCalledOnce();

    act(() => {
      setVisibility("visible");
      fireVisibilityChange();
    });
    expect(fake.requestSpy).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("acquiring");

    await act(async () => {
      fake.instances[1]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");
  });

  it("two visibilitychange events in quick succession never produce two requests", async () => {
    const fake = buildFakeWakeLockSource();
    renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
      setVisibility("visible");
      fireVisibilityChange();
      fireVisibilityChange();
    });

    expect(fake.requestSpy).toHaveBeenCalledTimes(2);
  });

  it("mounting with desired already true requests a lock once visible", () => {
    const fake = buildFakeWakeLockSource();
    setVisibility("visible");
    renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    expect(fake.requestSpy).toHaveBeenCalledOnce();
  });

  it("does not request while the document is hidden at mount", () => {
    const fake = buildFakeWakeLockSource();
    setVisibility("hidden");
    renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    expect(fake.requestSpy).not.toHaveBeenCalled();
  });

  it("a rejected request() surfaces unavailable without throwing, logs a redacted entry, and retry() can succeed", async () => {
    const logErrorSpy = vi.spyOn(errorLog, "logError");
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );

    await act(async () => {
      fake.instances[0]?.rejectRequest(new Error("nope"));
      await Promise.resolve();
    });
    expect(result.current.status).toBe("unavailable");
    expect(logErrorSpy).toHaveBeenCalledWith(
      "riding-wake-lock",
      expect.anything(),
      fixedClock,
    );

    act(() => {
      result.current.retry();
    });
    expect(fake.requestSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      fake.instances[1]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");
  });

  it("retry() while already acquiring or active is a no-op", () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    act(() => {
      result.current.retry();
    });
    expect(fake.requestSpy).toHaveBeenCalledOnce();
  });

  it("retry() while desired is false is a no-op", () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: false,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    act(() => {
      result.current.retry();
    });
    expect(fake.requestSpy).not.toHaveBeenCalled();
  });

  it("a sentinel firing release while visible reaches unavailable without re-requesting", async () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    act(() => {
      fake.instances[0]?.simulateUnsolicitedRelease();
    });

    expect(result.current.status).toBe("unavailable");
    expect(fake.requestSpy).toHaveBeenCalledOnce();
  });

  it("a hide/show cycle after an unexpected release does not auto-retry", async () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });
    act(() => {
      fake.instances[0]?.simulateUnsolicitedRelease();
    });
    expect(result.current.status).toBe("unavailable");

    act(() => {
      setVisibility("hidden");
      fireVisibilityChange();
      setVisibility("visible");
      fireVisibilityChange();
    });

    expect(result.current.status).toBe("unavailable");
    expect(fake.requestSpy).toHaveBeenCalledOnce();
  });

  it("disabling before request() resolves releases the late-arriving sentinel and never reaches active", async () => {
    const fake = buildFakeWakeLockSource();
    const { result, rerender } = renderHook(
      ({ desired }: { desired: boolean }) =>
        useScreenWakeLock({ desired, wakeLockSource: fake.source, clock: fixedClock }),
      { initialProps: { desired: true } },
    );
    act(() => {
      rerender({ desired: false });
    });

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("inactive");
    expect(fake.instances[0]?.releaseCallCount).toBe(1);
  });

  it("unmounting before request() resolves releases the late-arriving sentinel and never becomes active", async () => {
    const fake = buildFakeWakeLockSource();
    const { unmount } = renderHook(() =>
      useScreenWakeLock({
        desired: true,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    unmount();

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    expect(fake.instances[0]?.releaseCallCount).toBe(1);
  });

  it("a stale resolution after a newer desired=true cycle is released, never attached", async () => {
    const fake = buildFakeWakeLockSource();
    const { result, rerender } = renderHook(
      ({ desired }: { desired: boolean }) =>
        useScreenWakeLock({ desired, wakeLockSource: fake.source, clock: fixedClock }),
      { initialProps: { desired: true } },
    );

    act(() => {
      rerender({ desired: false });
    });
    act(() => {
      rerender({ desired: true });
    });

    expect(fake.requestSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    expect(fake.instances[0]?.releaseCallCount).toBe(1);
    expect(result.current.status).toBe("acquiring");

    await act(async () => {
      fake.instances[1]?.resolveRequest();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("active");
  });

  it("removes the visibilitychange listener on unmount", () => {
    const fake = buildFakeWakeLockSource();
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() =>
      useScreenWakeLock({
        desired: false,
        wakeLockSource: fake.source,
        clock: fixedClock,
      }),
    );
    unmount();

    const addCalls = addSpy.mock.calls.filter(([type]) => type === "visibilitychange");
    const removeCalls = removeSpy.mock.calls.filter(
      ([type]) => type === "visibilitychange",
    );
    expect(addCalls.length).toBeGreaterThan(0);
    expect(removeCalls.length).toBe(addCalls.length);
  });

  it("StrictMode double-invoked effects still issue exactly one real request and reach active", async () => {
    const fake = buildFakeWakeLockSource();
    const { result } = renderHook(
      () =>
        useScreenWakeLock({
          desired: true,
          wakeLockSource: fake.source,
          clock: fixedClock,
        }),
      { wrapper: StrictMode },
    );

    expect(fake.requestSpy).toHaveBeenCalledOnce();

    await act(async () => {
      fake.instances[0]?.resolveRequest();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("active");
  });
});
