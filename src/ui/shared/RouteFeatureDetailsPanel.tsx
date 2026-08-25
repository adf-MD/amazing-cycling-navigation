import type { ReactNode } from "react";
import type {
  ClimbGradientBand,
  DescentLocalKey,
  RouteFeature,
} from "../../navigation/routeFeatures.ts";
import {
  CLIMB_CATEGORY_NAMES,
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABELS,
} from "../../navigation/routeFeaturePalette.ts";
import { ClimbLocalGradientDisclosure } from "./ClimbLocalGradientDisclosure.tsx";
import { DescentLocalGradientDisclosure } from "./DescentLocalGradientDisclosure.tsx";
import { GradientColourSwatch } from "./GradientColourSwatch.tsx";
import {
  formatDistanceKm,
  formatDistanceKmValue,
  formatGradientPercent,
  formatMetres,
} from "./routeSummary.ts";

const EMPTY_CLIMB_LOCAL_BANDS: ReadonlySet<ClimbGradientBand> = new Set();
const EMPTY_DESCENT_LOCAL_KEYS: ReadonlySet<DescentLocalKey> = new Set();

export interface RouteFeatureDetailsPanelProps {
  /** The selected-or-active feature to show detail for, or null to render
   * nothing — a controlled/dumb component, same convention as
   * ElevationChart: no internal selection state of its own. */
  feature: RouteFeature | null;
  /** The climb's 1-based position among the route's recognised climbs
   * (see listClimbsInRouteOrder), shown only by the pre-ride climb
   * selector's own call site — e.g. "Climb 2 · Category 3" instead of
   * the plain "Category 3 climb" heading used everywhere else. Omitted
   * (or a descent feature) preserves the existing heading exactly. */
  climbNumber?: number;
  /** An optional detailed chart for the shown feature, rendered directly
   * below the heading and above the fact list. Currently only supplied by
   * Riding's pre-ride climb preview (see RidingScreen.tsx); omitted by
   * Planning and by Riding's own active-climb view (which shows its own
   * chart separately, above this panel, via RidingClimbProgressPanel),
   * leaving every other caller's layout unchanged. */
  detailChart?: ReactNode;
  /** Which local-gradient climb bands are actually painted for the shown
   * climb, driving a collapsed "Gradient colours on this climb" disclosure
   * rendered directly below detailChart (backlog item 78). Omitted/empty
   * renders nothing extra — Riding's pre-ride selected-climb view is
   * currently the only supplier; every other caller is unaffected. */
  presentClimbLocalBands?: ReadonlySet<ClimbGradientBand>;
  /** The descent counterpart of presentClimbLocalBands, driving a
   * collapsed "Gradient colours on this descent" disclosure in the same
   * position (backlog item 78). */
  presentDescentLocalKeys?: ReadonlySet<DescentLocalKey>;
  /** Shown as a "How is this calculated?" action beside the climb score
   * when supplied and the feature is a climb — omitted everywhere else
   * (descents have no climb score, and other callers such as Planning and
   * Riding's active-climb view don't yet offer this navigation). Kept
   * presentational: this component only invokes the callback, it never
   * imports application navigation itself (backlog item 78). */
  onClimbScoreHelp?: () => void;
  /** Omit to render no clear control (e.g. Riding might prefer the
   * feature to simply update as the rider progresses, with no explicit
   * "clear" action while merely active-not-selected). */
  onClear?: () => void;
}

/**
 * Shared inline details panel for a selected or currently-active
 * recognised climb/descent, reused by both Riding and Planning rather
 * than each maintaining its own — the exact field set the spec requires:
 * category/"Recognised descent" heading, route position, length,
 * elevation gain/loss, average gradient, maximum/steepest local gradient
 * and climb score (climbs only). presentClimbLocalBands/
 * presentDescentLocalKeys/onClimbScoreHelp are additive, Riding-pre-ride-
 * only extensions (backlog item 78) — every other caller omits them and
 * renders exactly as before.
 */
export function RouteFeatureDetailsPanel({
  feature,
  climbNumber,
  detailChart,
  presentClimbLocalBands = EMPTY_CLIMB_LOCAL_BANDS,
  presentDescentLocalKeys = EMPTY_DESCENT_LOCAL_KEYS,
  onClimbScoreHelp,
  onClear,
}: RouteFeatureDetailsPanelProps) {
  if (feature === null) {
    return null;
  }

  const visualKey = feature.kind === "climb" ? feature.category : feature.band;
  const heading =
    feature.kind === "climb" && climbNumber !== undefined
      ? `Climb ${String(climbNumber)} · ${CLIMB_CATEGORY_NAMES[feature.category]}`
      : feature.kind === "climb"
        ? ROUTE_FEATURE_LABELS[feature.category]
        : "Recognised descent";

  return (
    <section aria-label="Route feature details" className="route-feature-details">
      <h3>
        <GradientColourSwatch colour={ROUTE_FEATURE_COLOURS[visualKey]} /> {heading}
      </h3>
      {detailChart}
      {feature.kind === "climb" ? (
        <ClimbLocalGradientDisclosure presentClimbBands={presentClimbLocalBands} />
      ) : (
        <DescentLocalGradientDisclosure
          presentDescentLocalKeys={presentDescentLocalKeys}
        />
      )}
      <p>
        Route position: {formatDistanceKmValue(feature.startDistanceMetres)}–
        {formatDistanceKmValue(feature.endDistanceMetres)} km
      </p>
      <p>Length: {formatDistanceKm(feature.lengthMetres)}</p>
      {feature.kind === "climb" ? (
        <p>Elevation gain: {formatMetres(feature.elevationGainMetres)}</p>
      ) : (
        <p>Elevation loss: {formatMetres(feature.elevationLossMetres)}</p>
      )}
      <p>Average gradient: {formatGradientPercent(feature.averageGradientPercent)}</p>
      <p>
        {feature.kind === "climb" ? "Maximum" : "Steepest"} local gradient:{" "}
        {formatGradientPercent(feature.maxGradientPercent)}
      </p>
      {feature.kind === "climb" && <p>Climb score: {Math.round(feature.climbScore)}</p>}
      {feature.kind === "climb" && onClimbScoreHelp && (
        <button type="button" className="btn-secondary" onClick={onClimbScoreHelp}>
          How is this calculated?
        </button>
      )}
      {feature.kind === "descent" && (
        <p>
          Blue intensity reflects gradient steepness only, not surface, bends, traffic or
          other conditions.
        </p>
      )}
      {onClear && (
        <button type="button" onClick={onClear}>
          Clear selection
        </button>
      )}
    </section>
  );
}
