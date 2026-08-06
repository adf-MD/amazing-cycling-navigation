import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Screen } from "./MainNavigation.tsx";

/**
 * Scrolls the document to the top exactly once per genuinely new Ride
 * content event (a route opened from Routes, or newly saved from
 * Planning), never on a plain nav-tab return to an already-open ride.
 * RidingScreen always fully unmounts and remounts on every screen switch
 * (App.tsx's conditional screen rendering has no `key`), so it can never
 * itself tell "genuinely new" apart from "already open" — only this hook,
 * living in App which never unmounts, can. The caller bumps the returned
 * token by calling it; useLayoutEffect (rather than useEffect) applies the
 * scroll before paint, avoiding a flash of the previous screen's offset.
 */
export function useResetScrollForNewRideContent(screen: Screen): () => void {
  const [token, setToken] = useState(0);
  const appliedTokenRef = useRef(0);

  useLayoutEffect(() => {
    if (screen !== "riding") return;
    if (appliedTokenRef.current === token) return;
    appliedTokenRef.current = token;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [screen, token]);

  return useCallback(() => {
    setToken((current) => current + 1);
  }, []);
}
