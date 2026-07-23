import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { logError } from "../../platform/errorLog.ts";

/**
 * Small project-owned reactive wrapper around Dexie's liveQuery, in place
 * of the official dexie-react-hooks package for this one trivial use.
 * `querier` must be a stable reference (wrap it in useCallback) — a new
 * function identity on every render resubscribes on every render.
 */
export function useLiveQuery<T>(querier: () => Promise<T> | T): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);

  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: setValue,
      error: (error: unknown) => {
        logError("live-query", error);
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [querier]);

  return value;
}
