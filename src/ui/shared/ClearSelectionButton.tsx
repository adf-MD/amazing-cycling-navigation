export interface ClearSelectionButtonProps {
  onClick: () => void;
}

/**
 * The one "Clear selection" action shared by every selected-feature/segment
 * panel (RouteFeatureDetailsPanel, GradientSegmentDetailsPanel, Riding's
 * active-standard compact summary) — extracted so its own CSS (backlog item
 * 85's clipped-bottom-border fix) applies everywhere it renders by
 * construction, rather than three call sites kept in sync by hand.
 */
export function ClearSelectionButton({ onClick }: ClearSelectionButtonProps) {
  return (
    <button type="button" className="clear-selection-button" onClick={onClick}>
      Clear selection
    </button>
  );
}
