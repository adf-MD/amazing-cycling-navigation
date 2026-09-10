/** The four MapView-owned imagery states that a rider-facing surface has
 * something to say about. Three are terminal (they never silently self-heal
 * from waiting alone) and retryable: loadState==="load-error" (fatal — even
 * the local fallback failed), tileErrorMessage!==null (a post-load tile
 * failure), and usingFallbackStyle&&ready (showing the plain local
 * fallback). The fourth, "delayed", is transient and NOT retryable: imagery
 * is still arriving, so waiting is the only useful action (backlog item
 * 108). MapView's own brief initial "Loading map…" phase is deliberately
 * not a member — it carries no rider-actionable meaning and, per item 108's
 * own state table, needs no status-card row at all. */
export type MapImageryStatusKind = "delayed" | "load-error" | "tile-error" | "fallback";

/** Which surrounding navigation content is genuinely on screen, so the copy
 * below can be truthful about it (backlog item 108). Route riding really
 * does keep drawing the route and the rider's position; free roam has no
 * route at all, so claiming one there was simply wrong. This is a
 * capability statement about the host, never a styling or layout hint. */
export type MapImageryPresentationContext = "route-riding" | "free-roam";

export interface MapImageryRecoveryPresentation {
  role: "alert" | "status";
  message: string;
  testId:
    | "map-imagery-delayed-banner"
    | "map-load-error"
    | "tiles-unavailable-banner"
    | "map-fallback-banner";
  /** False only for "delayed": imagery is still loading, so offering
   * "Retry map imagery" would invite a pointless restart of a request that
   * is already in flight. The three terminal kinds keep the retry action
   * item 83 gave them. */
  retryable: boolean;
}

/**
 * The single source of copy/role/testid/retryability for every rider-facing
 * map-imagery message, in BOTH of the surfaces that present one: MapView's
 * own in-map `.map-status-overlay` banners, and the relocated
 * `ride-status-card-imagery-row` that an active Riding/free-roam status
 * card hosts instead (backlog item 83, extended by item 108).
 *
 * It lives in `src/map/` precisely so that MapView can consume it without
 * importing upwards into `src/ui/` — the module was moved here from
 * `src/ui/riding/` by item 108 for exactly that reason. Having one table
 * serve both surfaces is what makes it structurally impossible for the
 * hosted and in-map wordings to drift apart, and it is why correcting free
 * roam's copy needed no second copy of the mapping.
 *
 * `testId`s are reused verbatim from MapView's original in-map banners, so
 * the large existing testid-based Vitest/Playwright locator surface keeps
 * working regardless of which of the two places a message is rendered in.
 * `role="alert"` is reserved for the terminal load-error state; everything
 * else is a polite `role="status"`, so a slow load is never promoted to an
 * urgent announcement.
 *
 * Deliberately says nothing about connectivity: both status cards already
 * carry their own Online/Offline indicator, and imagery trouble is not the
 * same fact as being offline (imagery can be delayed or unavailable while
 * the browser still reports Online).
 */
export function describeMapImageryRecovery(
  kind: MapImageryStatusKind,
  context: MapImageryPresentationContext,
): MapImageryRecoveryPresentation {
  const routeRiding = context === "route-riding";
  switch (kind) {
    case "delayed":
      return {
        role: "status",
        testId: "map-imagery-delayed-banner",
        retryable: false,
        message: routeRiding
          ? "Map imagery is taking longer than usual to load. Your route and position are still shown."
          : "Map imagery is taking longer than usual to load. Your position is still shown.",
      };
    case "load-error":
      return {
        role: "alert",
        testId: "map-load-error",
        retryable: true,
        message: "Map failed to load. Check your connection and try again.",
      };
    case "tile-error":
      return {
        role: "status",
        testId: "tiles-unavailable-banner",
        retryable: true,
        message: routeRiding
          ? "Map imagery unavailable. The route and your position are still shown."
          : "Map imagery unavailable. Your position is still shown.",
      };
    case "fallback":
      return {
        role: "status",
        testId: "map-fallback-banner",
        retryable: true,
        message: routeRiding
          ? "Map imagery unavailable — showing your route on a plain background."
          : "Map imagery unavailable — showing your position on a plain background.",
      };
  }
}
