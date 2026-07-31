/**
 * Static capability check — a free function, not a method on
 * WakeLockSource, mirroring mapSupport.ts's isMapRenderingSupported.
 * Called directly to decide whether to render/mount anything at all: an
 * unsupported browser must see no control, not a disabled one.
 */
export function isWakeLockSupported(): boolean {
  // Cast to a type where wakeLock is genuinely optional — lib.dom.d.ts
  // declares Navigator.wakeLock as always present, which would otherwise
  // make TypeScript treat the `in` check and optional chain below as
  // redundant even though real unsupported browsers lack the property.
  const nav = navigator as Partial<Navigator>;
  return "wakeLock" in nav && typeof nav.wakeLock?.request === "function";
}

/**
 * Runtime handle for one held wake lock. Never serialised — a sentinel is
 * DOM-only and runtime-only; only the rider's desired on/off preference is
 * ever persisted (see storage/mapping.ts's wakeLockDesired field).
 */
export interface WakeLockHandle {
  /** True once release() has settled or an unsolicited release has fired.
   * Never resurrected — a fresh request() is always required. */
  readonly released: boolean;
  /** Idempotent: a second call while already released is a safe no-op. */
  release(): Promise<void>;
  /** Registers a listener for an unsolicited release of this exact handle
   * (the browser auto-releasing on hidden, or a policy revoking it) — does
   * not try to suppress the release caused by this handle's own release()
   * call; de-duplicating that is the calling hook's responsibility (always
   * unsubscribe before calling release()), not this wrapper's. Returns an
   * unsubscribe function, matching this project's other DI sources rather
   * than raw addEventListener/removeEventListener pairs. */
  onRelease(listener: () => void): () => void;
}

/** Small DI wrapper around navigator.wakeLock so Riding's lock lifecycle is testable without a browser. */
export interface WakeLockSource {
  /** Requests a new "screen" wake lock. Rejects exactly as
   * navigator.wakeLock.request would (NotAllowedError while hidden,
   * AbortError, a policy rejection, etc.) — callers must catch. */
  request(): Promise<WakeLockHandle>;
}

export const browserWakeLockSource: WakeLockSource = {
  async request() {
    const sentinel = await navigator.wakeLock.request("screen");
    const listeners = new Set<() => void>();
    let released = false;

    sentinel.addEventListener("release", () => {
      for (const listener of listeners) listener();
    });

    return {
      get released() {
        return released;
      },
      release: async () => {
        if (released) return;
        released = true;
        await sentinel.release();
      },
      onRelease: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  },
};
