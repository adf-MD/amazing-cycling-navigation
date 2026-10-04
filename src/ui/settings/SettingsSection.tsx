import { useLayoutEffect, useRef, type RefObject } from "react";
import { DiagnosticsScreen } from "../diagnostics/DiagnosticsScreen.tsx";
import type { SettingsSectionView } from "../shared/screenTypes.ts";
import { scrollToTopAndSettle } from "../shared/scrollToTopAndSettle.ts";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { SettingsStatusSwitcher } from "./SettingsStatusSwitcher.tsx";
import { useProviderKeyDraft } from "./useProviderKeyDraft.ts";

/** Custom properties this section publishes on the root element while it is
 * mounted: the sticky header's height, which the switcher sticks beneath,
 * and the switcher's own height, which the section's scroll margin adds. */
const HEADER_BLOCK_SIZE = "--app-header-block-size";
const SWITCHER_BLOCK_SIZE = "--settings-switcher-block-size";

export interface SettingsSectionProps {
  view: SettingsSectionView;
  onSelectView: (view: SettingsSectionView) => void;
  stickyHeaderRef: RefObject<HTMLElement | null>;
}

/**
 * Backlog item 121: the Settings section — the Settings and Status views as
 * siblings beneath one sticky switcher, reached through the Settings tab.
 *
 * App renders this component in a single slot whenever either view is
 * showing, so it stays mounted across a Settings ↔ Status switch and
 * unmounts when the rider leaves for another tab. That lifetime is what
 * three things here hang on:
 *
 * - **The unfinished key edit** (useProviderKeyDraft) lives here, so typing
 *   a key, checking Status and coming back does not lose it. It is memory
 *   only, and leaving the section discards it, as before.
 * - **The switcher's DOM node** is the first child whichever view is
 *   showing, so a switch keeps focus on the button just pressed.
 * - **The interim top reset.** Whenever navigation changes the rendered view
 *   — on entry from another tab (mount), on a switch, or when the Settings
 *   tab is tapped while Status is showing — the page starts at the top.
 *   Nothing else resets it: the effect depends on `view` alone, so a
 *   disclosure, a preference change or a live-query refresh leaves the
 *   scroll position where it is, and so does tapping the Settings tab while
 *   Settings is already showing. Backlog item 125 is to replace this with a
 *   restored position for each view; this rule is deliberately interim, and
 *   no other screen's scroll behaviour changes.
 *
 * The switcher is sticky beneath the primary navigation, except while focus
 * is inside the key form (index.css), when it scrolls with the page. Stage 0
 * of the item measured why: at 375×667 with 200 % text, the sticky switcher
 * left too little room for the key field above an on-screen keyboard.
 */
export function SettingsSection({
  view,
  onSelectView,
  stickyHeaderRef,
}: SettingsSectionProps) {
  const keyDraft = useProviderKeyDraft();
  const switcherRef = useRef<HTMLElement>(null);

  // useLayoutEffect, so the reset lands before the new view is painted and
  // never flashes the previous screen's offset. `view` is the whole trigger.
  useLayoutEffect(() => scrollToTopAndSettle(), [view]);

  // Publishes both sticky heights for index.css: the switcher's `top` and the
  // section's scroll margin, which keeps a keyboard-focused control from
  // landing beneath the sticky rows. Measured before the first paint, and
  // re-measured whenever either box resizes (text size, language, width).
  useLayoutEffect(() => {
    const root = document.documentElement;
    const publish = () => {
      const header = stickyHeaderRef.current;
      const switcher = switcherRef.current;
      root.style.setProperty(
        HEADER_BLOCK_SIZE,
        `${String(header ? header.getBoundingClientRect().height : 0)}px`,
      );
      root.style.setProperty(
        SWITCHER_BLOCK_SIZE,
        `${String(switcher ? switcher.getBoundingClientRect().height : 0)}px`,
      );
    };
    publish();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(publish);
      if (stickyHeaderRef.current) observer.observe(stickyHeaderRef.current);
      if (switcherRef.current) observer.observe(switcherRef.current);
    }
    return () => {
      observer?.disconnect();
      root.style.removeProperty(HEADER_BLOCK_SIZE);
      root.style.removeProperty(SWITCHER_BLOCK_SIZE);
    };
  }, [stickyHeaderRef]);

  return (
    <div className="settings-section">
      <SettingsStatusSwitcher ref={switcherRef} view={view} onSelectView={onSelectView} />
      {view === "settings" ? (
        <SettingsScreen
          keyDraft={keyDraft}
          stickyHeaderRef={stickyHeaderRef}
          stickySubheaderRef={switcherRef}
        />
      ) : (
        <DiagnosticsScreen
          stickyHeaderRef={stickyHeaderRef}
          stickySubheaderRef={switcherRef}
        />
      )}
    </div>
  );
}
