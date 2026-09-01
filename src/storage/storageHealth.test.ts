import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { db } from "./db.ts";
import {
  computeUsageRatio,
  isHighStoragePressure,
  parseStorageEstimateNumbers,
  useStorageHealth,
} from "./storageHealth.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseStorageEstimateNumbers", () => {
  it("returns the parsed pair for valid finite numbers", () => {
    expect(parseStorageEstimateNumbers(50, 100)).toEqual({
      usageBytes: 50,
      quotaBytes: 100,
    });
  });

  it("rejects a missing usage", () => {
    expect(parseStorageEstimateNumbers(undefined, 100)).toBeNull();
  });

  it("rejects a missing quota", () => {
    expect(parseStorageEstimateNumbers(50, undefined)).toBeNull();
  });

  it("rejects a zero quota", () => {
    expect(parseStorageEstimateNumbers(50, 0)).toBeNull();
  });

  it("rejects a NaN usage", () => {
    expect(parseStorageEstimateNumbers(NaN, 100)).toBeNull();
  });

  it("rejects a NaN quota", () => {
    expect(parseStorageEstimateNumbers(50, NaN)).toBeNull();
  });

  it("rejects an infinite usage", () => {
    expect(parseStorageEstimateNumbers(Infinity, 100)).toBeNull();
  });

  it("rejects a negative usage", () => {
    expect(parseStorageEstimateNumbers(-1, 100)).toBeNull();
  });

  it("accepts usage greater than quota (a deliberate, conservative classification — not rejected)", () => {
    expect(parseStorageEstimateNumbers(120, 100)).toEqual({
      usageBytes: 120,
      quotaBytes: 100,
    });
  });
});

describe("computeUsageRatio", () => {
  it("returns the finite ratio for ordinary inputs", () => {
    expect(computeUsageRatio(1, 2)).toBe(0.5);
  });

  it("returns null when two individually finite inputs overflow to Infinity on division", () => {
    expect(computeUsageRatio(Number.MAX_VALUE, Number.MIN_VALUE)).toBeNull();
  });
});

describe("isHighStoragePressure", () => {
  it("classifies exactly the 90% threshold as high pressure", () => {
    expect(isHighStoragePressure(0.9)).toBe(true);
  });

  it("classifies just under the 90% threshold as not high pressure", () => {
    expect(isHighStoragePressure(0.899999)).toBe(false);
  });

  it("classifies a usage>quota ratio above 1 as high pressure", () => {
    expect(isHighStoragePressure(1.2)).toBe(true);
  });
});

describe("useStorageHealth", () => {
  it("skips the estimate call entirely when db.open() rejects", async () => {
    vi.spyOn(db, "open").mockRejectedValueOnce(new Error("boom"));
    const estimateSpy = vi.fn().mockResolvedValue({ usage: 1, quota: 100 });
    vi.stubGlobal("navigator", { storage: { estimate: estimateSpy } });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("error");
    });
    expect(result.current).toEqual({ status: "error", schemaVersion: null });
    expect(estimateSpy).not.toHaveBeenCalled();
  });

  it("reports estimate unsupported once opened, when navigator.storage is explicitly undefined", async () => {
    vi.stubGlobal("navigator", { storage: undefined });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({
      status: "ok",
      estimate: { status: "unsupported" },
    });
  });

  it("reports estimate unsupported when navigator.storage exists but has no estimate method", async () => {
    vi.stubGlobal("navigator", { storage: {} });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({
      status: "ok",
      estimate: { status: "unsupported" },
    });
  });

  it("reports estimate unavailable, without crashing, when accessing navigator.storage itself throws", async () => {
    const throwingNavigator = {};
    Object.defineProperty(throwingNavigator, "storage", {
      get() {
        throw new Error("blocked");
      },
    });
    vi.stubGlobal("navigator", throwingNavigator);

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({
      status: "ok",
      estimate: { status: "unavailable" },
    });
  });

  it("reports estimate unavailable when estimate() rejects, while the database stays ok", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.reject(new Error("quota check failed")) },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({
      status: "ok",
      estimate: { status: "unavailable" },
    });
  });

  it("reports estimate unavailable for a malformed result (missing usage)", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: undefined, quota: 100 }) },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({ estimate: { status: "unavailable" } });
  });

  it("reports estimate unavailable when individually finite usage/quota overflow to Infinity on division", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () =>
          Promise.resolve({ usage: Number.MAX_VALUE, quota: Number.MIN_VALUE }),
      },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({ estimate: { status: "unavailable" } });
  });

  it("reports a valid low-pressure estimate with exact usage/quota/ratio", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () => Promise.resolve({ usage: 1_048_576, quota: 500 * 1024 * 1024 }),
      },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({
      status: "ok",
      estimate: {
        status: "available",
        usageBytes: 1_048_576,
        quotaBytes: 500 * 1024 * 1024,
        highPressure: false,
      },
    });
    if (
      result.current.status === "ok" &&
      result.current.estimate.status === "available"
    ) {
      expect(result.current.estimate.usageRatio).toBeCloseTo(
        1_048_576 / (500 * 1024 * 1024),
        10,
      );
    }
  });

  it("classifies exactly 90% usage as high pressure", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 900_000, quota: 1_000_000 }) },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({ estimate: { highPressure: true } });
  });

  it("does not classify just-under-90% usage as high pressure", async () => {
    vi.stubGlobal("navigator", {
      storage: { estimate: () => Promise.resolve({ usage: 899_999, quota: 1_000_000 }) },
    });

    const { result } = renderHook(() => useStorageHealth());

    await waitFor(() => {
      expect(result.current.status).toBe("ok");
    });
    expect(result.current).toMatchObject({ estimate: { highPressure: false } });
  });

  it("does not update state after unmount while an estimate() promise is still pending", async () => {
    let resolveEstimate: ((value: { usage: number; quota: number }) => void) | undefined;
    vi.stubGlobal("navigator", {
      storage: {
        estimate: () =>
          new Promise<{ usage: number; quota: number }>((resolve) => {
            resolveEstimate = resolve;
          }),
      },
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { result, unmount } = renderHook(() => useStorageHealth());
    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "ok",
        estimate: { status: "checking" },
      });
    });

    unmount();
    resolveEstimate?.({ usage: 1, quota: 100 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
