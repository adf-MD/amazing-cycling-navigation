import { vi } from "vitest";
import type { WakeLockHandle, WakeLockSource } from "../../platform/wakeLock.ts";

export interface FakeWakeLockInstance {
  /** 0-based order this request() call was made in. */
  readonly index: number;
  /** Settles this call's request() promise with a fresh handle. */
  resolveRequest: () => void;
  /** Settles this call's request() promise with a rejection. */
  rejectRequest: (error: unknown) => void;
  /** Fires this handle's onRelease listeners unconditionally — including
   * after this handle's own release() was already called, deliberately
   * not self-suppressed, so a test can exercise the hook's own
   * unsubscribe-before-release ordering directly. Only meaningful once
   * resolveRequest() has been called. */
  simulateUnsolicitedRelease: () => void;
  readonly releaseCallCount: number;
  readonly released: boolean;
}

export interface FakeWakeLockSource {
  source: WakeLockSource;
  /** Every request() call ever made, in order — each entry stays
   * addressable individually, so a test can prove a late-resolving
   * request from a superseded attempt is released and never becomes the
   * active sentinel. */
  instances: FakeWakeLockInstance[];
  requestSpy: ReturnType<typeof vi.fn>;
}

/** A richer WakeLockSource test double than a bare vi.fn() stub: request()
 * timing itself (not just the resulting handle's events) must be driven
 * manually, since the race conditions this feature must survive hinge on
 * exactly when a request settles relative to other lifecycle events. */
export function buildFakeWakeLockSource(): FakeWakeLockSource {
  const instances: FakeWakeLockInstance[] = [];

  const requestSpy = vi.fn(() => {
    const index = instances.length;
    const listeners = new Set<() => void>();
    let released = false;
    let releaseCallCount = 0;

    let resolvePromise!: (handle: WakeLockHandle) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<WakeLockHandle>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const handle: WakeLockHandle = {
      get released() {
        return released;
      },
      release: () => {
        if (!released) {
          released = true;
          releaseCallCount += 1;
        }
        return Promise.resolve();
      },
      onRelease: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    instances.push({
      index,
      resolveRequest: () => {
        resolvePromise(handle);
      },
      rejectRequest: (error) => {
        rejectPromise(error);
      },
      simulateUnsolicitedRelease: () => {
        released = true;
        for (const listener of listeners) listener();
      },
      get releaseCallCount() {
        return releaseCallCount;
      },
      get released() {
        return released;
      },
    });

    return promise;
  });

  return {
    source: { request: requestSpy },
    instances,
    requestSpy,
  };
}
