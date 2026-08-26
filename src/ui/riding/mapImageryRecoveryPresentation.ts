import type { MapImageryRecoveryStatus } from "../../map/MapView.tsx";

export interface MapImageryRecoveryPresentation {
  role: "alert" | "status";
  message: string;
  testId: "map-load-error" | "tiles-unavailable-banner" | "map-fallback-banner";
}

/**
 * The single source of copy/role/testid for a relocated imagery-recovery
 * row (backlog item 83), shared by RidingStatusCard and FreeRoamStatusCard
 * so wording can never drift between the two. Reuses MapView's own three
 * banner strings and testids verbatim (see MapView.tsx's in-map overlay
 * JSX) — the relocated row and the map-owned banner are mutually
 * exclusive per screen, so this minimises churn in existing tests that
 * already locate by these testids. `role="alert"` is preserved only for
 * the terminal load-error state, matching MapView's own distinction.
 */
export function describeMapImageryRecovery(
  kind: MapImageryRecoveryStatus["kind"],
): MapImageryRecoveryPresentation {
  switch (kind) {
    case "load-error":
      return {
        role: "alert",
        testId: "map-load-error",
        message: "Map failed to load. Check your connection and try again.",
      };
    case "tile-error":
      return {
        role: "status",
        testId: "tiles-unavailable-banner",
        message: "Map imagery unavailable. The route and your position are still shown.",
      };
    case "fallback":
      return {
        role: "status",
        testId: "map-fallback-banner",
        message: "Map imagery unavailable — showing your route on a plain background.",
      };
  }
}
