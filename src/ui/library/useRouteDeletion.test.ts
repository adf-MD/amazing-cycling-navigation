import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as routesRepository from "../../storage/routesRepository.ts";
import { clearErrorLog, getRecentErrors } from "../../platform/errorLog.ts";
import { useRouteDeletion } from "./useRouteDeletion.ts";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/** Controls each deleteRoute call in turn, in the order they are made. */
function controlDeletes() {
  const calls: { routeId: string; outcome: Deferred }[] = [];
  vi.spyOn(routesRepository, "deleteRoute").mockImplementation((routeId: string) => {
    const outcome = deferred();
    calls.push({ routeId, outcome });
    return outcome.promise;
  });
  return calls;
}

describe("useRouteDeletion (backlog item 124, D-02)", () => {
  beforeEach(() => {
    clearErrorLog();
  });

  afterEach(() => {
    clearErrorLog();
  });

  it("starts a deletion, admitting it with a new attempt number, and commits it", async () => {
    const calls = controlDeletes();
    const { result } = renderHook(() => useRouteDeletion());

    let attempt: number | null = null;
    act(() => {
      attempt = result.current.start("route-a");
    });

    expect(attempt).not.toBeNull();
    expect(calls.map((call) => call.routeId)).toEqual(["route-a"]);
    expect(result.current.deletion).toEqual({
      attempt,
      routeId: "route-a",
      phase: "deleting",
    });
    expect(result.current.isBusyFor("route-a")).toBe(true);
    expect(result.current.isBusyFor("route-b")).toBe(false);

    await act(async () => {
      calls[0]?.outcome.resolve();
      await calls[0]?.outcome.promise;
    });
    expect(result.current.deletion?.phase).toBe("committed");
    // Still busy until the live list reflects it.
    expect(result.current.isBusyFor("route-a")).toBe(true);

    act(() => {
      if (attempt !== null) result.current.reconcile(attempt);
    });
    expect(result.current.deletion).toBeNull();
    expect(result.current.isBusyFor("route-a")).toBe(false);
  });

  it("refuses a second deletion synchronously, even within the same batch, starting nothing", () => {
    const calls = controlDeletes();
    const { result } = renderHook(() => useRouteDeletion());

    const attempts: (number | null)[] = [];
    act(() => {
      attempts.push(result.current.start("route-a"));
      attempts.push(result.current.start("route-a"));
      attempts.push(result.current.start("route-b"));
    });

    expect(attempts[0]).not.toBeNull();
    expect(attempts.slice(1)).toEqual([null, null]);
    expect(calls).toHaveLength(1);
  });

  it("records a failure with its technical detail in the redacted log only, and leaves the record failed", async () => {
    const calls = controlDeletes();
    const { result } = renderHook(() => useRouteDeletion());
    act(() => {
      result.current.start("route-a");
    });

    await act(async () => {
      calls[0]?.outcome.reject(new Error("The operation was aborted."));
      await calls[0]?.outcome.promise.catch(() => undefined);
    });

    expect(result.current.deletion?.phase).toBe("failed");
    expect(result.current.isBusyFor("route-a")).toBe(false);
    expect(getRecentErrors()).toEqual([
      expect.objectContaining({
        context: "route-delete",
        message: "The operation was aborted.",
      }),
    ]);
  });

  it("still records and logs the outcome after its owner has unmounted", async () => {
    const calls = controlDeletes();
    const { result, unmount } = renderHook(() => useRouteDeletion());
    act(() => {
      result.current.start("route-a");
    });
    unmount();

    await act(async () => {
      calls[0]?.outcome.reject(new Error("late failure"));
      await calls[0]?.outcome.promise.catch(() => undefined);
    });

    expect(getRecentErrors()).toEqual([
      expect.objectContaining({ context: "route-delete", message: "late failure" }),
    ]);
  });

  it("lets a retry replace a failed attempt, and ignores the old attempt's late dismissal", async () => {
    const calls = controlDeletes();
    const { result } = renderHook(() => useRouteDeletion());
    let first: number | null = null;
    act(() => {
      first = result.current.start("route-a");
    });
    await act(async () => {
      calls[0]?.outcome.reject(new Error("first"));
      await calls[0]?.outcome.promise.catch(() => undefined);
    });

    let second: number | null = null;
    act(() => {
      second = result.current.start("route-a");
    });
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(result.current.deletion?.phase).toBe("deleting");

    act(() => {
      if (first !== null) {
        result.current.dismiss(first);
        result.current.reconcile(first);
      }
    });
    expect(result.current.deletion).toEqual({
      attempt: second,
      routeId: "route-a",
      phase: "deleting",
    });
  });

  it("dismisses or clears a failed attempt, and never a running or committed one", async () => {
    const calls = controlDeletes();
    const { result } = renderHook(() => useRouteDeletion());
    let attempt: number | null = null;
    act(() => {
      attempt = result.current.start("route-a");
    });

    act(() => {
      result.current.clearFailed();
      if (attempt !== null) result.current.dismiss(attempt);
    });
    expect(result.current.deletion?.phase).toBe("deleting");

    await act(async () => {
      calls[0]?.outcome.reject(new Error("failed"));
      await calls[0]?.outcome.promise.catch(() => undefined);
    });
    act(() => {
      result.current.clearFailed();
    });
    expect(result.current.deletion).toBeNull();
  });

  it("keeps a stable controller identity while nothing changes", () => {
    controlDeletes();
    const { result, rerender } = renderHook(() => useRouteDeletion());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
