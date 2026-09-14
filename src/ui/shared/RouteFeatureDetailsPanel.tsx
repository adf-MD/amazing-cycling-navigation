import type { ReactNode } from "react";
import type {
  ClimbGradientBand,
  DescentLocalKey,
  RouteFeature,
} from "../../navigation/routeFeatures.ts";
import {
  CLIMB_CATEGORY_NAME_KEYS,
  ROUTE_FEATURE_COLOURS,
  ROUTE_FEATURE_LABEL_KEYS,
} from "../../navigation/routeFeaturePalette.ts";
import { useTranslate } from "../../i18n/useTranslate.ts";
import { ClearSelectionButton } from "./ClearSelectionButton.tsx";
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
   * Riding's pre-ride selected-climb and selected-descent previews (see
   * RidingScreen.tsx, backlog items 78/79); omitted by Planning and by
   * Riding's own active-climb view (which shows its own chart separately,
   * above this panel, via RidingClimbProgressPanel), leaving every other
   * caller's layout unchanged. */
  detailChart?: ReactNode;
  /** Which local-gradient climb bands are actually painted for the shown
   * climb, driving a collapsed "Local gradient colours on this climb"
   * disclosure rendered directly below detailChart (backlog item 78,
   * compacted by item 79). Omitted/empty renders nothing extra —
   * Riding's pre-ride selected-climb view is currently the only supplier;
   * every other caller is unaffected. */
  presentClimbLocalBands?: ReadonlySet<ClimbGradientBand>;
  /** The descent counterpart of presentClimbLocalBands, driving a
   * collapsed "Local gradient colours on this descent" disclosure in the
   * same position (backlog item 78, compacted by item 79). */
  presentDescentLocalKeys?: ReadonlySet<DescentLocalKey>;
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
 * presentDescentLocalKeys are additive, Riding-pre-ride-only extensions
 * (backlog item 78, compacted by item 79) — every other caller omits them
 * and renders exactly as before.
 */
export function RouteFeatureDetailsPanel({
  feature,
  climbNumber,
  detailChart,
  presentClimbLocalBands = EMPTY_CLIMB_LOCAL_BANDS,
  presentDescentLocalKeys = EMPTY_DESCENT_LOCAL_KEYS,
  onClear,
}: RouteFeatureDetailsPanelProps) {
  const translator = useTranslate();
  const { t } = translator;
  if (feature === null) {
    return null;
  }

  const visualKey = feature.kind === "climb" ? feature.category : feature.band;
  const heading =
    feature.kind === "climb" && climbNumber !== undefined
      ? t("featureDetails.heading", {
          number: climbNumber,
          category: t(CLIMB_CATEGORY_NAME_KEYS[feature.category]),
        })
      : feature.kind === "climb"
        ? t(ROUTE_FEATURE_LABEL_KEYS[feature.category])
        : t("feature.recognisedDescent");

  return (
    <section
      aria-label={t("featureDetails.landmarkLabel")}
      className="route-feature-details"
    >
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
        {t("featureDetails.routePosition", {
          start: formatDistanceKmValue(translator, feature.startDistanceMetres),
          end: formatDistanceKmValue(translator, feature.endDistanceMetres),
        })}
      </p>
      <p>
        {t("featureDetails.length", {
          distance: formatDistanceKm(translator, feature.lengthMetres),
        })}
      </p>
      {feature.kind === "climb" ? (
        <p>
          {t("featureDetails.elevationGain", {
            elevation: formatMetres(translator, feature.elevationGainMetres),
          })}
        </p>
      ) : (
        <p>
          {t("featureDetails.elevationLoss", {
            elevation: formatMetres(translator, feature.elevationLossMetres),
          })}
        </p>
      )}
      <p>
        {t("featureDetails.averageGradient", {
          gradient: formatGradientPercent(translator, feature.averageGradientPercent),
        })}
      </p>
      <p>
        {t(
          feature.kind === "climb"
            ? "featureDetails.maximumLocalGradient"
            : "featureDetails.steepestLocalGradient",
          { gradient: formatGradientPercent(translator, feature.maxGradientPercent) },
        )}
      </p>
      {feature.kind === "climb" && (
        <p>{t("featureDetails.climbScore", { score: Math.round(feature.climbScore) })}</p>
      )}
      {onClear && <ClearSelectionButton onClick={onClear} />}
    </section>
  );
}
