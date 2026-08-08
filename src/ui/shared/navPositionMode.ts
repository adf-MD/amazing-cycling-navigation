import type { NavPositionMode, Screen } from "./MainNavigation.tsx";

/**
 * MainNavigation is sticky everywhere except while a ride is genuinely
 * being GPS-tracked (`screen === "riding" && isRidingActive`), where it
 * returns to normal document flow to maximise dashboard space.
 * `isRidingActive` must always come from the app's own authoritative
 * ride-tracking state — RidingScreen's `nav.geolocationStatus !== "idle"`,
 * reported up via its `onRidingActiveChange` prop — never inferred from
 * button text, GPS freshness, route presence or CSS. This means Riding
 * before Start riding, and Riding while awaiting an explicit Resume
 * riding tap after a restored fix, both stay sticky; a transient GPS
 * error mid-ride (`geolocationStatus === "error"`) stays counted as
 * active, matching this app's existing "Try again preserves progress"
 * philosophy — the underlying watch is never torn down for it.
 */
export function deriveNavPositionMode(
  screen: Screen,
  isRidingActive: boolean,
): NavPositionMode {
  return screen === "riding" && isRidingActive ? "static" : "sticky";
}
