import { vi } from "vitest";
import type {
  GeolocationError,
  GeolocationFix,
  GeolocationSource,
} from "../../platform/geolocation.ts";

export interface FakeWatchInstance {
  /** 0-based order this watchPosition() call was made in. */
  readonly index: number;
  emitFix: (fix: GeolocationFix) => void;
  emitError: (error: GeolocationError) => void;
  /** True once this instance's own returned cleanup has been invoked. */
  readonly disposed: boolean;
}

export type SyncEmission =
  { kind: "fix"; fix: GeolocationFix } | { kind: "error"; error: GeolocationError };

export interface FakeGeolocationSource {
  source: GeolocationSource;
  /** Every watchPosition() call ever made, in order — each entry stays
   * addressable individually, so a test can prove a late callback from an
   * earlier (superseded) watch is ignored while a later one still works. */
  watches: FakeWatchInstance[];
  watchPositionSpy: ReturnType<typeof vi.fn>;
  /** One-shot: the *next* watchPosition() call invokes onFix/onError
   * synchronously, before returning its cleanup — proves callers can't
   * assume the cleanup is already stored when the first callback fires. */
  armSyncEmissionForNextWatch: (emission: SyncEmission) => void;
}

/** A richer GeolocationSource test double than a bare vi.fn() stub: unlike
 * a stub that just captures the latest onFix/onError pair (indistinguishable
 * from "the same watch is still live"), this exposes every watchPosition()
 * call as its own addressable instance with observable disposal, so tests
 * can prove the exact regression this fixture exists for — a superseded
 * watch's stray callback must never affect state after a newer watch has
 * replaced it. */
export function buildFakeGeolocationSource(): FakeGeolocationSource {
  const watches: FakeWatchInstance[] = [];
  let armed: SyncEmission | null = null;

  const watchPositionSpy = vi.fn(
    (
      onFix: (fix: GeolocationFix) => void,
      onError: (error: GeolocationError) => void,
    ) => {
      let disposed = false;
      watches.push({
        index: watches.length,
        emitFix: onFix,
        emitError: onError,
        get disposed() {
          return disposed;
        },
      });

      const toEmit = armed;
      armed = null;
      if (toEmit?.kind === "fix") onFix(toEmit.fix);
      if (toEmit?.kind === "error") onError(toEmit.error);

      return () => {
        disposed = true;
      };
    },
  );

  return {
    source: { watchPosition: watchPositionSpy },
    watches,
    watchPositionSpy,
    armSyncEmissionForNextWatch: (emission) => {
      armed = emission;
    },
  };
}
