import type { Screen } from "./MainNavigation.tsx";

/**
 * Whether the app shell should be in immersive-Riding mode (backlog item
 * 55): `MainNavigation` (and its wrapping `<header>`) genuinely absent
 * from the DOM, replaced entirely by RidingScreen's/FreeRoamScreen's own
 * compact Pause/title/End header. Supersedes item 24's old "static"
 * nav-position state, which kept the nav in normal document flow but
 * still visible — that state no longer exists; the nav is now either
 * rendered-and-sticky, or not rendered at all.
 *
 * True only while `screen === "riding"` and a ride is genuinely being
 * GPS-tracked. `isRidingActive` must always come from the app's own
 * authoritative ride-tracking state — RidingScreen's/FreeRoamScreen's own
 * `nav.geolocationStatus !== "idle"`, reported up via their shared
 * `onRidingActiveChange` prop — never inferred from button text, GPS
 * freshness, route presence or CSS. This means Riding before Start
 * riding, and Riding while awaiting an explicit Resume riding tap after a
 * restored fix, both stay non-immersive (the ordinary nav shows); a
 * transient GPS error mid-ride (`geolocationStatus === "error"`) stays
 * counted as active/immersive, matching this app's existing "Try again
 * preserves progress" philosophy — the underlying watch is never torn
 * down for it. Pre-ride and Ride-launcher/recovery states are never
 * immersive.
 */
export function isImmersiveRidingShell(screen: Screen, isRidingActive: boolean): boolean {
  return screen === "riding" && isRidingActive;
}
