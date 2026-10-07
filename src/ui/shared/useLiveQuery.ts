import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { logError } from "../../platform/errorLog.ts";

export interface LiveQueryState<T> {
  /** The latest value, exactly as useLiveQuery returns it: undefined until
   * the first emission, and kept — not reset — while a new querier's
   * subscription has yet to emit. */
  value: T | undefined;
  /** Whether the CURRENT querier has answered: emitted once, or failed.
   * False from the very render in which the querier changes, before any
   * effect runs, so nothing can mistake the previous query's answer for
   * this one's. It stays true through ordinary live updates. */
  settled: boolean;
}

/**
 * useLiveQuery plus whether the current query has answered (backlog item
 * 125). `value` alone cannot say so: a key that is absent, a query that
 * fails and a query still loading all read as undefined. Screens use
 * `settled` to tell scroll restoration that their content has loaded.
 * `querier` must be a stable reference, as for useLiveQuery.
 */
export function useLiveQueryState<T>(querier: () => Promise<T> | T): LiveQueryState<T> {
  const [value, setValue] = useState<T | undefined>(undefined);
  // The querier whose subscription has answered. Compared by identity in
  // render, so a querier change reads as unsettled immediately.
  const [answeredQuerier, setAnsweredQuerier] = useState<(() => Promise<T> | T) | null>(
    null,
  );

  useEffect(() => {
    // Set false by cleanup: an obsolete subscription's late answer is
    // ignored rather than reported against the querier now current.
    let current = true;
    const subscription = liveQuery(querier).subscribe({
      next: (next) => {
        if (!current) return;
        setValue(next);
        setAnsweredQuerier(() => querier);
      },
      error: (error: unknown) => {
        logError("live-query", error);
        if (!current) return;
        setAnsweredQuerier(() => querier);
      },
    });
    return () => {
      current = false;
      subscription.unsubscribe();
    };
  }, [querier]);

  return { value, settled: answeredQuerier === querier };
}

/**
 * Small project-owned reactive wrapper around Dexie's liveQuery, in place
 * of the official dexie-react-hooks package for this one trivial use.
 * `querier` must be a stable reference (wrap it in useCallback) — a new
 * function identity on every render resubscribes on every render.
 */
export function useLiveQuery<T>(querier: () => Promise<T> | T): T | undefined {
  return useLiveQueryState(querier).value;
}
