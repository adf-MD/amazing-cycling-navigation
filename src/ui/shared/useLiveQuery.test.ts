import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../storage/db.ts";
import { getProviderKey, saveProviderKey } from "../../storage/providerKeyRepository.ts";
import { useLiveQuery, useLiveQueryState } from "./useLiveQuery.ts";

// Backlog item 125: `settled` says whether the CURRENT query has answered,
// which `value` alone cannot — an absent row, a failed read and a read still
// loading all read as undefined.

beforeEach(async () => {
  await db.providerKeys.clear();
});

describe("useLiveQueryState", () => {
  it("is unsettled until the first answer, and settled by an answer that is undefined", async () => {
    const { result } = renderHook(() => useLiveQueryState(getProviderKey));

    expect(result.current).toEqual({ value: undefined, settled: false });
    await waitFor(() => {
      expect(result.current.settled).toBe(true);
    });
    expect(result.current.value).toBeUndefined();
  });

  it("is settled by a failure, keeping the value it had", async () => {
    const failing = () => Promise.reject(new Error("read failed"));
    const { result } = renderHook(() => useLiveQueryState(failing));

    await waitFor(() => {
      expect(result.current.settled).toBe(true);
    });
    expect(result.current.value).toBeUndefined();
  });

  it("reads as unsettled in the very render its querier changes, keeps the previous value until the new query answers, and ignores the obsolete query's late answer", async () => {
    let answerFirst: ((value: string) => void) | undefined;
    const first = () =>
      new Promise<string>((resolve) => {
        answerFirst = resolve;
      });
    const second = () => Promise.resolve("second");
    const renders: { value: string | undefined; settled: boolean }[] = [];
    const { result, rerender } = renderHook(
      ({ querier }: { querier: () => Promise<string> }) => {
        const state = useLiveQueryState(querier);
        renders.push(state);
        return state;
      },
      { initialProps: { querier: () => Promise.resolve("initial") } },
    );
    await waitFor(() => {
      expect(result.current).toEqual({ value: "initial", settled: true });
    });

    renders.length = 0;
    rerender({ querier: first });
    expect(renders[0]).toEqual({ value: "initial", settled: false });

    rerender({ querier: second });
    await waitFor(() => {
      expect(result.current).toEqual({ value: "second", settled: true });
    });

    answerFirst?.("first, too late");
    await Promise.resolve();
    expect(result.current).toEqual({ value: "second", settled: true });
  });

  it("stays settled through ordinary live updates", async () => {
    const { result } = renderHook(() => useLiveQueryState(getProviderKey));
    await waitFor(() => {
      expect(result.current.settled).toBe(true);
    });

    await saveProviderKey("test-dummy-key-not-real-0000");

    await waitFor(() => {
      expect(result.current.value?.apiKey).toBe("test-dummy-key-not-real-0000");
    });
    expect(result.current.settled).toBe(true);
  });
});

describe("useLiveQuery", () => {
  it("returns the same value as before: undefined until answered, then each live update", async () => {
    const { result } = renderHook(() => useLiveQuery(getProviderKey));
    expect(result.current).toBeUndefined();

    await saveProviderKey("test-dummy-key-not-real-0000");

    await waitFor(() => {
      expect(result.current?.apiKey).toBe("test-dummy-key-not-real-0000");
    });
  });
});
