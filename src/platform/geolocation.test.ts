import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserGeolocationSource, useGeolocationWatch } from "./geolocation.ts";
import type {
  GeolocationError,
  GeolocationFix,
  GeolocationSource,
} from "./geolocation.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browserGeolocationSource", () => {
  it("reports unsupported when navigator.geolocation is absent", () => {
    vi.stubGlobal("navigator", {});
    const onFix = vi.fn();
    const onError = vi.fn();

    browserGeolocationSource.watchPosition(onFix, onError);

    expect(onFix).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      reason: "unsupported",
      message: expect.any(String) as string,
    });
  });

  it("maps a successful position update to a GeolocationFix", () => {
    let successCallback: ((position: GeolocationPosition) => void) | undefined;
    const watchPosition = vi.fn((success: (position: GeolocationPosition) => void) => {
      successCallback = success;
      return 42;
    });
    const clearWatch = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { watchPosition, clearWatch } });

    const onFix = vi.fn();
    const clear = browserGeolocationSource.watchPosition(onFix, vi.fn());

    successCallback?.({
      coords: { longitude: -1.5, latitude: 53.8, accuracy: 8, speed: 3.2 },
      timestamp: 123456,
    } as GeolocationPosition);

    expect(onFix).toHaveBeenCalledWith({
      coordinate: [-1.5, 53.8],
      accuracyMetres: 8,
      timestampMs: 123456,
      speedMetresPerSecond: 3.2,
    } satisfies GeolocationFix);

    clear();
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  it.each([
    [1, "permission-denied"],
    [2, "position-unavailable"],
    [3, "timeout"],
  ])("maps GeolocationPositionError code %d to reason %s", (code, expectedReason) => {
    let errorCallback: ((error: GeolocationPositionError) => void) | undefined;
    const watchPosition = vi.fn(
      (
        _success: (position: GeolocationPosition) => void,
        error: (error: GeolocationPositionError) => void,
      ) => {
        errorCallback = error;
        return 1;
      },
    );
    vi.stubGlobal("navigator", {
      geolocation: { watchPosition, clearWatch: vi.fn() },
    });

    const onError = vi.fn();
    browserGeolocationSource.watchPosition(vi.fn(), onError);

    errorCallback?.({
      code,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);

    const [receivedError] = onError.mock.calls[0] as [GeolocationError];
    expect(receivedError.reason).toBe(expectedReason);
  });
});

function buildStubSource(): {
  source: GeolocationSource;
  emitFix: (fix: GeolocationFix) => void;
  emitError: (error: GeolocationError) => void;
  clearSpy: ReturnType<typeof vi.fn>;
  watchPositionSpy: ReturnType<typeof vi.fn>;
} {
  let onFixListener: ((fix: GeolocationFix) => void) | undefined;
  let onErrorListener: ((error: GeolocationError) => void) | undefined;
  const clearSpy = vi.fn();

  const watchPositionSpy = vi.fn(
    (
      onFix: (fix: GeolocationFix) => void,
      onError: (error: GeolocationError) => void,
    ) => {
      onFixListener = onFix;
      onErrorListener = onError;
      return clearSpy;
    },
  );

  return {
    source: { watchPosition: watchPositionSpy },
    emitFix: (fix) => onFixListener?.(fix),
    emitError: (error) => onErrorListener?.(error),
    clearSpy,
    watchPositionSpy,
  };
}

const SAMPLE_FIX: GeolocationFix = {
  coordinate: [-1.5, 53.8],
  accuracyMetres: 10,
  timestampMs: 1000,
  speedMetresPerSecond: null,
};

describe("useGeolocationWatch", () => {
  it("never calls watchPosition until start() is called", () => {
    const stub = buildStubSource();
    const { result } = renderHook(() => useGeolocationWatch(stub.source));

    expect(stub.watchPositionSpy).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("transitions to watching and stores each fix after start()", () => {
    const stub = buildStubSource();
    const { result } = renderHook(() => useGeolocationWatch(stub.source));

    act(() => {
      result.current.start();
    });
    expect(stub.watchPositionSpy).toHaveBeenCalledOnce();

    act(() => {
      stub.emitFix(SAMPLE_FIX);
    });

    expect(result.current.status).toBe("watching");
    expect(result.current.fix).toEqual(SAMPLE_FIX);
  });

  it("transitions to error state and clears the fix on a geolocation error", () => {
    const stub = buildStubSource();
    const { result } = renderHook(() => useGeolocationWatch(stub.source));

    act(() => {
      result.current.start();
    });
    act(() => {
      stub.emitError({ reason: "permission-denied", message: "denied" });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toEqual({
      reason: "permission-denied",
      message: "denied",
    });
  });

  it("calling start() twice does not create a second watch", () => {
    const stub = buildStubSource();
    const { result } = renderHook(() => useGeolocationWatch(stub.source));

    act(() => {
      result.current.start();
      result.current.start();
    });

    expect(stub.watchPositionSpy).toHaveBeenCalledOnce();
  });

  it("stop() clears the watch and returns to idle", () => {
    const stub = buildStubSource();
    const { result } = renderHook(() => useGeolocationWatch(stub.source));

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.stop();
    });

    expect(stub.clearSpy).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("idle");
  });

  it("clears the watch on unmount", () => {
    const stub = buildStubSource();
    const { result, unmount } = renderHook(() => useGeolocationWatch(stub.source));

    act(() => {
      result.current.start();
    });
    unmount();

    expect(stub.clearSpy).toHaveBeenCalledOnce();
  });
});
