import { useEffect, useId, useState } from "react";

// Backlog item 97. 10 seconds, not a shorter/tunable value — never shorten
// this for test convenience; e2e coverage waits it out for real.
const UNTRUSTED_GPX_FULL_WARNING_MS = 10_000;

const FULL_WARNING_TEXT =
  "No trusted turn information is available for this imported GPX. Follow the route line on the map.";

/**
 * The untrusted-GPX-import trust notice, shown throughout an active ride on
 * a route with no trusted manoeuvre metadata and source.kind === "gpx-import"
 * (see domain/manoeuvreTrust.ts's hasTrustedManoeuvres — the caller decides
 * trust and gpx-import-ness; this component is presentational only). Unlike
 * RidingNextManoeuvrePanel, which is Map-exclusive and remounts on every
 * Map<->Profile toggle, this notice is rendered by RidingScreen once, outside
 * the Map-only .ride-content-area toggle, specifically so it can own a
 * multi-second timed disclosure without confusing a view change for a new
 * ride-session episode. It does not duplicate itself per view the way
 * RidingCompactManoeuvreCue does — that pattern exists for stateless content
 * needing different text per view; this needs one continuous stateful
 * instance shared across both.
 *
 * No props, no externally-supplied "episode" identity: RidingScreen renders
 * this only while nav.geolocationStatus !== "idle" for an untrusted
 * gpx-import route, and that status only ever leaves "idle" on a genuine
 * fresh Start, explicit Resume, or cold resume-intent recovery — never
 * transiently on the mid-ride "error" -> "watching" Try-again retry, which
 * stays within the same mounted episode throughout. React's own mount
 * lifecycle for this component therefore already is the required episode
 * boundary; do not "fix" this by threading a counter down from RidingScreen
 * mirroring MapView's item-96 SLOW_IMAGERY_NOTICE_GRACE_MS episode ref — that
 * ref exists there because that effect can re-run while still mounted
 * (its own eligibility/retryToken dependencies can change without an
 * unmount); this component's mount-once effect below has no such dependency
 * and therefore no overlapping-timer race to guard against.
 */
export function RidingUntrustedGpxNotice() {
  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const explanationId = useId();

  // Empty deps: this can never re-run while the component stays mounted, so
  // there is at most one live pending timeout per mounted instance — the
  // cleanup below cancels it before unmount (or before React Strict Mode's
  // development-only second setup), which is sufficient on its own. Do not
  // read this as "runs exactly once per mount": Strict Mode may genuinely
  // execute setup -> cleanup -> setup for a single logical mount, and the
  // correctness property that must hold regardless is only ever-one-live-
  // timer, not exactly-once-ever.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setAutoCollapsed(true);
    }, UNTRUSTED_GPX_FULL_WARNING_MS);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  if (!autoCollapsed) {
    return (
      <p role="status" className="status-row">
        {FULL_WARNING_TEXT}
      </p>
    );
  }

  return (
    <div className="stack">
      <button
        type="button"
        className="btn-secondary"
        aria-expanded={isExpanded}
        aria-controls={isExpanded ? explanationId : undefined}
        onClick={() => {
          setIsExpanded((expanded) => !expanded);
        }}
      >
        No turn cues
      </button>
      {isExpanded ? (
        <p id={explanationId} className="status-row">
          {FULL_WARNING_TEXT}
        </p>
      ) : null}
    </div>
  );
}
