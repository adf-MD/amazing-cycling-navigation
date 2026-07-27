/** Non-standard iOS Safari flag for "launched from the Home Screen icon". */
interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

/** False on plain HTTP — a genuine, if rare, explanation for a blocked
 * fetch that's otherwise easy to overlook while investigating a routing
 * failure. */
export function isSecureContext(): boolean {
  return window.isSecureContext;
}

/** Whether an active service worker currently controls this page. This
 * project's own service worker never intercepts OpenRouteService requests
 * (see vite.pwa.workbox.ts), but recording this is still a genuine,
 * independently-checkable data point when investigating a cross-origin
 * fetch failure. */
export function isServiceWorkerControlled(): boolean {
  return "serviceWorker" in navigator && navigator.serviceWorker.controller !== null;
}

/** The URL of the service worker script currently controlling this page,
 * if any — lets a diagnostic report show which build is actually active on
 * a device, distinct from the app version the current page was loaded
 * with. */
export function getActiveServiceWorkerScriptUrl(): string | undefined {
  if (!("serviceWorker" in navigator)) return undefined;
  return navigator.serviceWorker.controller?.scriptURL;
}

/** Whether the app is running as an installed PWA (standalone display)
 * rather than an ordinary browser tab. iOS Safari only ever exposes this
 * via the legacy `navigator.standalone` flag; other browsers via the
 * `display-mode` media feature. */
export function isStandaloneDisplayMode(): boolean {
  const nav = navigator as NavigatorWithStandalone;
  if (typeof nav.standalone === "boolean") {
    return nav.standalone;
  }
  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(display-mode: standalone)").matches;
  }
  return false;
}

/** Whether the user has requested reduced motion at the OS/browser level
 * — used to keep the warning-list reveal scroll (see
 * RouteSummaryPanel.tsx) restrained rather than an animated scroll, per
 * CLAUDE.md's "restrained motion" rule. Same guarded-matchMedia pattern
 * as isStandaloneDisplayMode above; false (motion allowed) when
 * matchMedia itself isn't available, matching that function's own
 * conservative fallback. */
export function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
