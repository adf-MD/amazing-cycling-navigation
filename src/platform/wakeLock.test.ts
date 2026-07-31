import { afterEach, describe, expect, it, vi } from "vitest";
import { browserWakeLockSource, isWakeLockSupported } from "./wakeLock.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWakeLockSupported", () => {
  it("is false when navigator.wakeLock is absent", () => {
    vi.stubGlobal("navigator", {});
    expect(isWakeLockSupported()).toBe(false);
  });

  it("is false when navigator.wakeLock is present but request is not a function", () => {
    vi.stubGlobal("navigator", { wakeLock: {} });
    expect(isWakeLockSupported()).toBe(false);
  });

  it("is true when navigator.wakeLock.request is a function", () => {
    vi.stubGlobal("navigator", { wakeLock: { request: vi.fn() } });
    expect(isWakeLockSupported()).toBe(true);
  });
});

interface StubNativeSentinel {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function buildStubNativeSentinel(): StubNativeSentinel {
  const listeners = new Set<() => void>();
  const sentinel: StubNativeSentinel = {
    released: false,
    release: vi.fn((): Promise<void> => {
      sentinel.released = true;
      return Promise.resolve();
    }),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "release") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === "release") listeners.delete(listener);
    }),
  };
  return Object.assign(sentinel, {
    // Test-only helper to fire the native "release" event.
    fireRelease: () => {
      for (const listener of listeners) listener();
    },
  });
}

describe("browserWakeLockSource", () => {
  it("requests a screen wake lock via navigator.wakeLock.request", async () => {
    const nativeSentinel = buildStubNativeSentinel();
    const request = vi.fn(() => Promise.resolve(nativeSentinel));
    vi.stubGlobal("navigator", { wakeLock: { request } });

    await browserWakeLockSource.request();

    expect(request).toHaveBeenCalledWith("screen");
  });

  it("release() calls the native sentinel's release and is idempotent", async () => {
    const nativeSentinel = buildStubNativeSentinel();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(() => Promise.resolve(nativeSentinel)) },
    });

    const handle = await browserWakeLockSource.request();
    await handle.release();
    await handle.release();

    expect(nativeSentinel.release).toHaveBeenCalledOnce();
    expect(handle.released).toBe(true);
  });

  it("onRelease fires when the native sentinel's release event fires", async () => {
    const nativeSentinel = buildStubNativeSentinel();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(() => Promise.resolve(nativeSentinel)) },
    });

    const handle = await browserWakeLockSource.request();
    const listener = vi.fn();
    handle.onRelease(listener);

    (nativeSentinel as unknown as { fireRelease: () => void }).fireRelease();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("onRelease's unsubscribe stops further delivery", async () => {
    const nativeSentinel = buildStubNativeSentinel();
    vi.stubGlobal("navigator", {
      wakeLock: { request: vi.fn(() => Promise.resolve(nativeSentinel)) },
    });

    const handle = await browserWakeLockSource.request();
    const listener = vi.fn();
    const unsubscribe = handle.onRelease(listener);
    unsubscribe();

    (nativeSentinel as unknown as { fireRelease: () => void }).fireRelease();

    expect(listener).not.toHaveBeenCalled();
  });
});
