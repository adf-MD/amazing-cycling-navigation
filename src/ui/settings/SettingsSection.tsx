import { useLayoutEffect, useRef, type RefObject } from "react";
import { DiagnosticsScreen } from "../diagnostics/DiagnosticsScreen.tsx";
import type { SettingsSectionView } from "../shared/screenTypes.ts";
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
 * two things here hang on:
 *
 * - **The unfinished key edit** (useProviderKeyDraft) lives here, so typing
 *   a key, checking Status and coming back does not lose it. It is memory
 *   only, and leaving the section discards it, as before.
 * - **The switcher's DOM node** is the first child whichever view is
 *   showing, so a switch keeps focus on the button just pressed — which is
 *   also why that focus never counts as a new focus that would stop the
 *   arriving view's scroll position being restored.
 *
 * Scroll position: item 121's interim rule, which started the page at the
 * top whenever navigation changed the rendered view, was replaced by
 * backlog item 125. Settings and Status are separate screens to App's
 * screen scroll memory, so each view comes back where the rider left it in
 * this app session, on a switch and on entry from another tab alike;
 * SettingsScreen and DiagnosticsScreen each report when their content has
 * loaded. A view's first visit, and Planning's Open Settings, start at the
 * top. The switcher's natural position is its stuck position — the section
 * is the first thing in `<main>` — so it stays put whatever is restored.
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
