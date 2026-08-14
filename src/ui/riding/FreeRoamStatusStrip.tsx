export interface FreeRoamStatusStripProps {
  accuracyMetres: number;
  isStale: boolean;
  fixAgeMs: number | null;
}

function formatFixAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.round(seconds / 60))} min ago`;
}

/**
 * Free roam's counterpart to RidingStatusStrip.tsx — deliberately not a
 * reuse of that component, since its offRouteLevel/distanceRemainingMetres
 * props are fundamentally route-shaped and meaningless without a route.
 * Shows only GPS accuracy and fresh/stale, mirroring RidingStatusStrip's
 * own exact wording, role and no-colour-alone conventions for that one
 * line.
 */
export function FreeRoamStatusStrip({
  accuracyMetres,
  isStale,
  fixAgeMs,
}: FreeRoamStatusStripProps) {
  return (
    <div className="ride-status-strip">
      <span role="status" className="ride-status-strip-detail">
        GPS accuracy: ±{Math.round(accuracyMetres)} m — {isStale ? "Stale" : "Live"}
        {fixAgeMs !== null ? ` (${formatFixAge(fixAgeMs)})` : null}
      </span>
    </div>
  );
}
