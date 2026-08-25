import type { RoutePoint } from "../domain/types.ts";
import type { ClassifiedSegment } from "./gradient.ts";
import { findClassifiedSegmentAtDistance } from "./gradient.ts";
import type { ClimbFeature, RouteFeature } from "./routeFeatures.ts";
import type { MicroDetailVisualKey } from "./routeFeaturePalette.ts";
import type { ElevationViewMode } from "./types.ts";
import { interpolateRoutePointAt } from "./upcomingElevation.ts";

/**
 * The elevation view actually shown: the rider's own standard preference
 * (Full or a rolling 2/5/10 km window, unchanged from `ElevationViewMode`),
 * the transient "Climb" presentation for whichever recognised climb the
 * rider is currently riding through, or a read-only "climb-preview" of a
 * recognised climb that has not yet begun (backlog item 71). `featureId`
 * is carried for self-documentation only — it always equals the
 * `activeClimb`/`upcomingClimb` a caller already has in hand, never an
 * independent source of truth. Neither "climb" nor "climb-preview" is ever
 * itself persisted as a standing preference; see
 * `selectEffectiveElevationView`.
 */
export type EffectiveElevationView =
  | ElevationViewMode
  | { kind: "climb"; featureId: string }
  | { kind: "climb-preview"; featureId: string };

/**
 * Pure derivation of the elevation view to display — deliberately holds no
 * "has this climb already been auto-shown" state of its own. Auto-open,
 * "no repeated reset while still in the same climb", "manual dismissal
 * suppresses reopening for the rest of that climb", and "leaving all
 * climbs returns to the standard view" all fall out for free from
 * comparing `dismissedClimbFeatureId` against the currently active climb's
 * own stable id on every call:
 *
 * - No active climb: always the standard view.
 * - An active climb whose id was NOT the one most recently dismissed:
 *   Climb view (this covers first entry to a climb, repeated fixes within
 *   it, and entering a genuinely different climb after an earlier one was
 *   dismissed — the old dismissal simply no longer matches).
 * - An active climb whose id IS the one most recently dismissed: the
 *   standard view, for as long as the rider stays in that same climb.
 *
 * `dismissedClimbFeatureId` is set by the caller when the rider manually
 * picks a standard view while inside a climb, and cleared (`null`) when
 * the rider manually re-selects Climb — both are simple, unconditionally
 * safe writes since a dismissal only ever matters when it matches the
 * currently active climb.
 *
 * A fourth, transient state is possible whenever there is genuinely no
 * active climb (backlog item 71): `upcomingClimb` non-null and manually
 * selected via `previewSelectedClimbId` (the id the rider tapped `Climb`
 * for) produces a `"climb-preview"` view. Active always wins over preview
 * — the `activeClimb !== null` branch returns unconditionally before
 * `upcomingClimb`/`previewSelectedClimbId` are even examined, so the
 * moment a previewed climb actually begins, this function naturally
 * switches to the real `"climb"` presentation on the very next call, with
 * no special-casing required. Unlike `dismissedClimbFeatureId`,
 * `previewSelectedClimbId` is caller-owned, transient UI state, not part
 * of persisted ride state — this function still performs the id
 * comparison itself (mirroring how it already compares
 * `dismissedClimbFeatureId` against `activeClimb.id`) rather than
 * requiring the caller to pre-resolve a boolean, so every boundary case
 * stays testable in one place.
 */
export function selectEffectiveElevationView(
  standardMode: ElevationViewMode,
  activeClimb: ClimbFeature | null,
  dismissedClimbFeatureId: string | null,
  upcomingClimb: ClimbFeature | null,
  previewSelectedClimbId: string | null,
): EffectiveElevationView {
  if (activeClimb !== null) {
    if (dismissedClimbFeatureId === activeClimb.id) {
      return standardMode;
    }
    return { kind: "climb", featureId: activeClimb.id };
  }
  if (upcomingClimb !== null && previewSelectedClimbId === upcomingClimb.id) {
    return { kind: "climb-preview", featureId: upcomingClimb.id };
  }
  return standardMode;
}

export interface FeatureElevationWindow {
  points: RoutePoint[];
  startDistanceMetres: number;
  endDistanceMetres: number;
}

/**
 * The slice of route points spanning exactly [startDistanceMetres,
 * endDistanceMetres] — a recognised climb or descent's own bounds — with
 * both boundaries interpolated via `interpolateRoutePointAt` so the
 * window's first/last point sit at the exact feature start/finish even
 * when those fall mid-segment. Mirrors `selectUpcomingElevationWindow`'s
 * own interior-points + interpolated-seam construction, but parameterised
 * by an explicit end distance rather than a forward window: a recognised
 * feature's bounds are always within the route's own bounds
 * (detectRouteFeatures only ever derives a feature from within one
 * analysed run), so there is no clamp-to-route-end case to handle here.
 * Takes only raw points and distances — no feature-kind dependency at all,
 * so it is shared unchanged by both climb and descent chart building
 * (backlog item 79).
 */
export function selectFeatureElevationWindow(
  points: readonly RoutePoint[],
  startDistanceMetres: number,
  endDistanceMetres: number,
): FeatureElevationWindow {
  const startPoint = interpolateRoutePointAt(points, startDistanceMetres);
  if (startPoint === null) {
    return { points: [], startDistanceMetres, endDistanceMetres };
  }

  if (startDistanceMetres === endDistanceMetres) {
    return {
      points: [startPoint],
      startDistanceMetres: startPoint.distanceFromStartMetres,
      endDistanceMetres: startPoint.distanceFromStartMetres,
    };
  }

  const endPoint = interpolateRoutePointAt(points, endDistanceMetres);
  if (endPoint === null) {
    return { points: [], startDistanceMetres, endDistanceMetres };
  }

  const interiorPoints = points.filter(
    (point) =>
      point.distanceFromStartMetres > startPoint.distanceFromStartMetres &&
      point.distanceFromStartMetres < endPoint.distanceFromStartMetres,
  );

  return {
    points: [startPoint, ...interiorPoints, endPoint],
    startDistanceMetres: startPoint.distanceFromStartMetres,
    endDistanceMetres: endPoint.distanceFromStartMetres,
  };
}

/**
 * Which climb/descent-chart presentation to build — the two contexts that
 * reuse the same underlying rendering path (see `buildClimbChartViewModel`),
 * made explicit rather than a loose collection of booleans:
 *
 * - `"active-current-climb"`: the live Climb elevation view shown during an
 *   active ride, with the rider's own progress as a marker. Climb-only —
 *   this app does not track live descent progress (backlog item 79).
 * - `"pre-ride-selected-feature"`: a read-only preview of whichever
 *   recognised climb or descent is selected pre-ride (dropdown, map tap or
 *   chart tap) — the whole feature, no marker.
 */
export type ClimbChartMode =
  | { kind: "pre-ride-selected-feature" }
  | {
      kind: "active-current-climb";
      marker: {
        distanceFromStartMetres: number;
        elevationMetres: number | null;
        stale: boolean;
      };
    };

export interface ClimbChartViewModel {
  points: RoutePoint[];
  domain: { startDistanceMetres: number; endDistanceMetres: number };
  gradientSegments: ClassifiedSegment<MicroDetailVisualKey>[];
  marker: {
    distanceFromStartMetres: number;
    elevationMetres: number | null;
    stale: boolean;
  } | null;
  areaFill: boolean;
}

/**
 * Builds everything `ElevationChart` needs to render either chart
 * presentation from the same recognised-feature data, so every context
 * shares one rendering path rather than each constructing their own
 * points/domain. Deliberately returns plain object shapes (not
 * `ElevationChartDomain`/`ElevationChartMarkerInput` from the `ui` layer)
 * so this navigation-layer module never imports from `src/ui/` — the
 * shapes match structurally, so a caller can still spread the result
 * straight into `ElevationChart`'s props.
 *
 * For `"active-current-climb"`, `points`/`domain`/`gradientSegments` are the
 * climb's own window in route-global metres, unchanged from how the active
 * Climb view has always built them. For `"pre-ride-selected-feature"`, every
 * point and segment is rebased so the feature's own start is distance 0 —
 * `ElevationChart` renders no distance tick labels today, so this rebase is
 * pixel-equivalent to leaving the domain route-global; its value is making
 * this pure model's own output genuinely "local distance from feature
 * start", which is what a unit test (and any future on-chart label) can
 * rely on.
 *
 * Only `startDistanceMetres`/`endDistanceMetres` (both on every
 * `RouteFeature`, climb or descent) are ever read off the second parameter
 * — this function's body has always been feature-kind-agnostic. The
 * overloads below exist purely to keep that true at the type level too:
 * `"active-current-climb"` (this app's only live-progress mode) is
 * statically restricted to a `ClimbFeature`, so a descent can never reach
 * it — a compile-time guarantee, not a runtime branch — while
 * `"pre-ride-selected-feature"` accepts either (backlog item 79).
 */
export function buildClimbChartViewModel(
  mode: {
    kind: "active-current-climb";
    marker: {
      distanceFromStartMetres: number;
      elevationMetres: number | null;
      stale: boolean;
    };
  },
  feature: ClimbFeature,
  displayPoints: readonly RoutePoint[],
  detailSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[],
): ClimbChartViewModel;
export function buildClimbChartViewModel(
  mode: { kind: "pre-ride-selected-feature" },
  feature: RouteFeature,
  displayPoints: readonly RoutePoint[],
  detailSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[],
): ClimbChartViewModel;
export function buildClimbChartViewModel(
  mode: ClimbChartMode,
  feature: RouteFeature,
  displayPoints: readonly RoutePoint[],
  detailSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[],
): ClimbChartViewModel {
  const window = selectFeatureElevationWindow(
    displayPoints,
    feature.startDistanceMetres,
    feature.endDistanceMetres,
  );

  if (mode.kind === "active-current-climb") {
    return {
      points: window.points,
      domain: {
        startDistanceMetres: window.startDistanceMetres,
        endDistanceMetres: window.endDistanceMetres,
      },
      gradientSegments: [...detailSegments],
      marker: mode.marker,
      areaFill: true,
    };
  }

  const offsetMetres = window.startDistanceMetres;
  return {
    points: window.points.map((point) => ({
      ...point,
      distanceFromStartMetres: point.distanceFromStartMetres - offsetMetres,
    })),
    domain: {
      startDistanceMetres: 0,
      endDistanceMetres: window.endDistanceMetres - offsetMetres,
    },
    gradientSegments: detailSegments.map((segment) => ({
      ...segment,
      startDistanceMetres: segment.startDistanceMetres - offsetMetres,
      endDistanceMetres: segment.endDistanceMetres - offsetMetres,
    })),
    marker: null,
    areaFill: true,
  };
}

export interface ClimbProgressMetrics {
  /** The presentation distance clamped to [climb.startDistanceMetres,
   * climb.endDistanceMetres] — used as the chart marker's own distance. */
  clampedPresentationDistanceMetres: number;
  distanceCompletedMetres: number;
  distanceRemainingMetres: number;
  /** Smoothed elevation at the clamped presentation distance, or null when
   * the shared profile has no known elevation there. */
  currentElevationMetres: number | null;
  /** Smoothed elevation at the climb's own detected finish. */
  finishElevationMetres: number | null;
  /** max(0, finishElevationMetres - currentElevationMetres) over the
   * smoothed series — a net vertical difference to the detected climb
   * finish, not a new cumulative-ascent calculation, and not the same
   * value as `elevationGainMetres` (dips within the climb are not
   * re-summed). Null whenever either elevation input is null. */
  elevationRemainingMetres: number | null;
  /** The average gradient of the classified local-gradient segment
   * (already analysed/merged/flicker-suppressed) containing the clamped
   * presentation distance — never a new two-point calculation. */
  currentGradientPercent: number | null;
}

/**
 * Climb-relative progress metrics for the active climb, derived entirely
 * from the shared smoothed elevation profile and the already-classified
 * local-gradient segments for this feature (see
 * `routeFeatureDetail.ts`'s `buildFeatureDetailSegments`) — no new
 * elevation/gradient calculation. Returns null only when there is no
 * presentation distance to measure from yet (mirrors
 * `buildFullProfileMarker`'s own `| null` convention), pushing that
 * null-check into one place rather than requiring callers to prove
 * non-nullness across two separately-derived values.
 */
export function computeClimbProgressMetrics(
  feature: ClimbFeature,
  displayPoints: readonly RoutePoint[],
  microDetailSegments: readonly ClassifiedSegment<MicroDetailVisualKey>[],
  presentationDistanceFromStartMetres: number | null,
): ClimbProgressMetrics | null {
  if (presentationDistanceFromStartMetres === null) {
    return null;
  }

  const clampedPresentationDistanceMetres = Math.min(
    Math.max(presentationDistanceFromStartMetres, feature.startDistanceMetres),
    feature.endDistanceMetres,
  );

  const currentElevationMetres =
    interpolateRoutePointAt(displayPoints, clampedPresentationDistanceMetres)
      ?.elevationMetres ?? null;
  const finishElevationMetres =
    interpolateRoutePointAt(displayPoints, feature.endDistanceMetres)?.elevationMetres ??
    null;
  const elevationRemainingMetres =
    currentElevationMetres !== null && finishElevationMetres !== null
      ? Math.max(0, finishElevationMetres - currentElevationMetres)
      : null;

  const currentGradientPercent =
    findClassifiedSegmentAtDistance(
      microDetailSegments,
      clampedPresentationDistanceMetres,
    )?.averageGradientPercent ?? null;

  return {
    clampedPresentationDistanceMetres,
    distanceCompletedMetres:
      clampedPresentationDistanceMetres - feature.startDistanceMetres,
    distanceRemainingMetres:
      feature.endDistanceMetres - clampedPresentationDistanceMetres,
    currentElevationMetres,
    finishElevationMetres,
    elevationRemainingMetres,
    currentGradientPercent,
  };
}
