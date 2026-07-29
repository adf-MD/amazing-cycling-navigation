import { useEffect, useRef, useState } from "react";
import type { PlannedRoute, RouteWarning, RouteWarningKind } from "../../domain/types.ts";
import type { GradientSegment } from "../../navigation/gradient.ts";
import { prefersReducedMotion } from "../../platform/environmentContext.ts";
import { ElevationChart } from "../shared/ElevationChart.tsx";
import { GradientLegend } from "../shared/GradientLegend.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";

export interface RouteSummaryPanelProps {
  route: PlannedRoute;
  waypointCount: number;
  /** Already coalesced by the caller (see PlanningScreen), and the same
   * array MapView's warningOverlay is fed — so a list index here always
   * matches the highlighted map segment. */
  warnings: readonly RouteWarning[];
  selectedWarningIndex: number | null;
  onSelectWarning: (index: number) => void;
  onClearWarningSelection: () => void;
  /** Shared, provider-independent gradient analysis for `route.points` —
   * computed once by the caller (PlanningScreen) so it stays referentially
   * stable across unrelated re-renders and across a failed recalculation
   * (which leaves `route` itself unchanged). */
  gradientSegments: readonly GradientSegment[];
  /** Increments once per map-originated warning selection (including a
   * repeat tap on an already-selected warning) — the one-shot signal to
   * scroll the matching entry into view and announce it. Never itself a
   * selection source; PlanningScreen derives it alongside
   * selectedWarningIndex. A list-originated selection does not bump
   * this, since the entry is already where the user is interacting. */
  revealToken: number;
}

function formatMetres(metres: number): string {
  return `${String(Math.round(metres))} m`;
}

/** Just the numeric km value, no unit — for a "start–end km" range with
 * one trailing unit, unlike formatDistanceKm's own "X.X km" (used where
 * each figure stands alone). */
function formatDistanceKmValue(metres: number): string {
  return (metres / 1000).toFixed(1);
}

/** Short display name for a surface-classification warning kind — only
 * ever used for a warning that carries surface detail, so the three
 * surface kinds are the only cases that matter in practice. */
function surfaceKindLabel(kind: RouteWarningKind): string {
  switch (kind) {
    case "unknown-surface":
      return "Unknown surface";
    case "questionable-surface":
      return "Questionable surface";
    case "unsuitable-surface":
      return "Unsuitable surface";
    default:
      // Unreachable in practice — warning.surface is only ever set for
      // the three kinds above (see normalizeOpenRouteServiceRoute.ts) —
      // but kept total rather than throwing, matching this file's own
      // defensive style elsewhere.
      return "Surface";
  }
}

/**
 * Distance, ascent/descent, provider provenance, surface breakdown and
 * inspectable warnings for a calculated route — shown before save/export,
 * per CLAUDE.md. Never claims more precision than the response actually
 * carried: unknown-surface distance is shown as its own figure, not folded
 * into "paved".
 */
export function RouteSummaryPanel({
  route,
  waypointCount,
  warnings,
  selectedWarningIndex,
  onSelectWarning,
  onClearWarningSelection,
  revealToken,
  gradientSegments,
}: RouteSummaryPanelProps) {
  const surface = route.surfaceSummary;
  const selectedButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastRevealTokenRef = useRef(revealToken);
  // The index a map-originated tap most recently revealed, or null. Only
  // ever set inside the effect below, and only ever rendered when it
  // still matches the current selectedWarningIndex — so a stale reveal
  // (e.g. the rider later re-selects the same warning from the list)
  // never resurrects the announcement/scroll for a non-map action.
  const [justRevealedIndex, setJustRevealedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (revealToken !== lastRevealTokenRef.current) {
      // A genuine fresh map-originated selection (including a repeat tap
      // on an already-selected warning, which still bumps revealToken) —
      // scroll it into view and mark it as just revealed.
      lastRevealTokenRef.current = revealToken;
      selectedButtonRef.current?.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
      setJustRevealedIndex(selectedWarningIndex);
    } else {
      // selectedWarningIndex changed via some other path (a list click or
      // an explicit clear) — no scroll, and any previous reveal is now
      // stale.
      setJustRevealedIndex(null);
    }
  }, [revealToken, selectedWarningIndex]);

  const justRevealedWarning =
    justRevealedIndex !== null && justRevealedIndex === selectedWarningIndex
      ? warnings[justRevealedIndex]
      : undefined;

  return (
    <section aria-label="Route summary">
      <p>
        {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
        {route.descentMetres !== null
          ? ` · ${String(Math.round(route.descentMetres))} m descent`
          : ""}
      </p>
      <p>
        {waypointCount} waypoint{waypointCount === 1 ? "" : "s"}
      </p>
      <ElevationChart points={route.points} gradientSegments={gradientSegments} />
      <GradientLegend
        presentClasses={
          new Set(gradientSegments.map((segment) => segment.classification))
        }
      />
      {route.source.kind === "planner" ? (
        <p>
          Routed via {route.source.provider ?? "unknown provider"}
          {route.source.profile ? ` (${route.source.profile})` : ""}
        </p>
      ) : null}
      {surface ? (
        <>
          <ul aria-label="Surface breakdown">
            <li>Paved: {formatMetres(surface.pavedMetres)}</li>
            <li>Questionable: {formatMetres(surface.questionableMetres)}</li>
            <li>Unsuitable: {formatMetres(surface.unsuitableMetres)}</li>
            <li>Unknown: {formatMetres(surface.unknownMetres)}</li>
          </ul>
          <p>
            Based on available data only — not a guarantee of road quality, legal access
            or current conditions.
          </p>
        </>
      ) : null}
      {warnings.length > 0 ? (
        <>
          <ul aria-label="Route warnings">
            {warnings.map((warning, index) => {
              const isSelected = index === selectedWarningIndex;
              const hasSurfaceDetail = warning.surface !== undefined;
              const detailId = `route-warning-detail-${String(index)}`;
              const lengthMetres =
                warning.endDistanceMetres - warning.startDistanceMetres;
              return (
                // Warnings have no stable id of their own; the array is
                // rebuilt wholesale on every calculation, so index is safe.
                <li key={index}>
                  <button
                    ref={isSelected ? selectedButtonRef : undefined}
                    type="button"
                    className={
                      isSelected
                        ? "route-warning-button is-selected"
                        : "route-warning-button"
                    }
                    aria-pressed={isSelected}
                    aria-expanded={hasSurfaceDetail ? isSelected : undefined}
                    aria-controls={isSelected && hasSurfaceDetail ? detailId : undefined}
                    onClick={() => {
                      if (isSelected) {
                        onClearWarningSelection();
                      } else {
                        onSelectWarning(index);
                      }
                    }}
                  >
                    <span className="route-warning-selected-indicator" aria-hidden="true">
                      {isSelected ? "✓" : null}
                    </span>
                    {hasSurfaceDetail ? (
                      <>
                        {surfaceKindLabel(warning.kind)} · {formatMetres(lengthMetres)}
                      </>
                    ) : (
                      <>
                        {warning.message} — {formatMetres(lengthMetres)}
                        {" ("}
                        {formatDistanceKm(warning.startDistanceMetres)}–
                        {formatDistanceKm(warning.endDistanceMetres)}
                        {")"}
                      </>
                    )}
                  </button>
                  {isSelected && warning.surface ? (
                    <div id={detailId} className="route-warning-detail">
                      <p>Surface: {warning.surface.label}</p>
                      <p>
                        Route position:{" "}
                        {formatDistanceKmValue(warning.startDistanceMetres)}–
                        {formatDistanceKmValue(warning.endDistanceMetres)} km
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {justRevealedWarning ? (
            <p role="status">
              Selected warning: {justRevealedWarning.message} (
              {formatDistanceKm(justRevealedWarning.startDistanceMetres)}–
              {formatDistanceKm(justRevealedWarning.endDistanceMetres)}).
            </p>
          ) : null}
          {selectedWarningIndex !== null ? (
            <button type="button" onClick={onClearWarningSelection}>
              Clear warning selection
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
