import type { ZoomInterpolatedLineWidth } from "./mapAdapter.ts";

/**
 * Zoom-responsive route-line width policy: the single source of the
 * `line-width` zoom stops shared by every route/warning/preview layer in
 * MapView.tsx, so Planning and Riding resolve identical widths for the
 * same zoom by construction. Pure, MapLibre-free — sibling to
 * distanceBadgeLayer.ts/routeLayer.ts/planningLayer.ts. Produces
 * ZoomInterpolatedLineWidth values that addLineLayer (mapAdapter.ts) turns
 * into a native MapLibre `interpolate` expression, evaluated by MapLibre
 * itself on every render frame — no React state or effect drives route
 * width at all.
 */

// Provisional starting points, NOT yet verified against a real iPhone
// viewport — mirrors distanceBadgeLayer.ts's own documented humility for
// first-pass zoom bands. ROUTE_WIDTH_CLOSE_ZOOM deliberately equals
// DISTANCE_BADGE_STREET_ZOOM_MIN, so "close navigation zoom" means the
// same thing across both features.
export const ROUTE_WIDTH_OVERVIEW_ZOOM = 6;
export const ROUTE_WIDTH_REGIONAL_ZOOM = 11;
export const ROUTE_WIDTH_CLOSE_ZOOM = 15;

// Two independently-tuned recession curves, each expressed as a fraction
// of a layer's own close-zoom (unchanged, existing) width:
//  - RECEDING: the always-on coloured overlays (macro climb/descent,
//    micro gradient) — recede faster, so at low zoom they read as a
//    narrower stripe over the neutral casing beneath them, rather than
//    fully covering it the way they do today at every zoom (today both
//    are the same fixed width, so the coloured overlay always completely
//    hides the casing — this is the confirmed root cause of a
//    long-descent route reading as solid blue).
//  - LEGIBLE: the neutral base/casing, selection halos and warning
//    casings — recede more gently, so the underlying route shape stays
//    traceable, and a warning still visually outranks whatever climb/
//    descent overlay it overlaps, at every zoom.
// Applying one shared multiplier per family (rather than a bespoke curve
// per layer) means every within-family width relationship established at
// close zoom — e.g. a selection halo wider than what it rings — is
// preserved proportionally at every zoom, with no extra bookkeeping.
// At ROUTE_WIDTH_CLOSE_ZOOM both curves resolve to exactly 1 (today's
// unchanged width) by construction, matching the settled contract's
// requirement to preserve the current close-zoom relationship exactly.
const RECEDING_MULTIPLIERS = { overview: 0.4, regional: 0.65 } as const;
const LEGIBLE_MULTIPLIERS = { overview: 0.6, regional: 0.8 } as const;

function buildStops(
  closeWidthPx: number,
  multipliers: { overview: number; regional: number },
): ZoomInterpolatedLineWidth {
  return {
    stops: [
      { zoom: ROUTE_WIDTH_OVERVIEW_ZOOM, width: closeWidthPx * multipliers.overview },
      { zoom: ROUTE_WIDTH_REGIONAL_ZOOM, width: closeWidthPx * multipliers.regional },
      { zoom: ROUTE_WIDTH_CLOSE_ZOOM, width: closeWidthPx },
    ],
  };
}

/** Width policy for the always-on coloured climb/descent/gradient
 * overlays (ROUTE_FEATURE_LAYER_WIDTH, GRADIENT_LINE_WIDTH in
 * MapView.tsx) — recedes faster than legibleWidthStops so the overlay
 * reads as a narrower stripe over the neutral casing at low zoom, instead
 * of fully covering it. */
export function recedingWidthStops(closeWidthPx: number): ZoomInterpolatedLineWidth {
  return buildStops(closeWidthPx, RECEDING_MULTIPLIERS);
}

/** Width policy for the neutral route casing (remaining/completed line),
 * selection halos and warning casings — recedes more gently than
 * recedingWidthStops, so the route stays traceable and a warning still
 * visually outranks whatever it overlaps, at every zoom. */
export function legibleWidthStops(closeWidthPx: number): ZoomInterpolatedLineWidth {
  return buildStops(closeWidthPx, LEGIBLE_MULTIPLIERS);
}
