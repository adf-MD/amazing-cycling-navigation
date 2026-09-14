import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LANGUAGE_BOOTSTRAP_TIMEOUT_MS,
  resolveInitialLanguagePreference,
} from "./bootstrap.ts";

/**
 * The bound is tested with fake timers throughout, never with wall-clock
 * browser timing. An assertion that something completes at precisely
 * 250ms is brittle under CI load and would become exactly the kind of
 * flake this repository has already spent an investigation on; the
 * browser coverage asserts outcomes instead.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveInitialLanguagePreference", () => {
  it("uses a preference that resolves inside the bound", async () => {
    const promise = resolveInitialLanguagePreference(() =>
      Promise.resolve({ language: "en" as const }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual({ preference: "en", timedOut: false });
  });

  it("uses a preference that resolves just before the bound", async () => {
    const promise = resolveInitialLanguagePreference(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ language: "de" as const });
          }, LANGUAGE_BOOTSTRAP_TIMEOUT_MS - 1);
        }),
    );
    await vi.advanceTimersByTimeAsync(LANGUAGE_BOOTSTRAP_TIMEOUT_MS - 1);
    await expect(promise).resolves.toEqual({ preference: "de", timedOut: false });
  });

  it("gives up at the bound rather than leaving the application blank", async () => {
    // A read that never settles is the case the bound exists for: a
    // blocked IndexedDB must not be able to hold the first paint forever.
    const promise = resolveInitialLanguagePreference(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(LANGUAGE_BOOTSTRAP_TIMEOUT_MS);
    await expect(promise).resolves.toEqual({ preference: "device", timedOut: true });
  });

  it("does not give up early", async () => {
    let settled = false;
    const promise = resolveInitialLanguagePreference(() => new Promise(() => undefined));
    void promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(LANGUAGE_BOOTSTRAP_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toBe(true);
  });

  it("treats a failed read as final, without waiting out the bound", async () => {
    const promise = resolveInitialLanguagePreference(() =>
      Promise.reject(new Error("storage unavailable")),
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toEqual({ preference: "device", timedOut: true });
  });

  it("clears its timer, so a resolved bootstrap leaves nothing pending", async () => {
    const clearTimeoutFn = vi.fn();
    await resolveInitialLanguagePreference(
      () => Promise.resolve({ language: "en" as const }),
      { clearTimeoutFn: clearTimeoutFn as unknown as typeof clearTimeout },
    );
    expect(clearTimeoutFn).toHaveBeenCalledTimes(1);
  });

  it("honours an injected bound", async () => {
    const promise = resolveInitialLanguagePreference(() => new Promise(() => undefined), {
      timeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toEqual({ preference: "device", timedOut: true });
  });

  it("keeps the measured bound at 250ms", () => {
    // Pinned as a literal, not compared against itself: the value is a
    // measurement-backed decision, so changing it should be a deliberate
    // edit that fails this test first.
    expect(LANGUAGE_BOOTSTRAP_TIMEOUT_MS).toBe(250);
  });
});
