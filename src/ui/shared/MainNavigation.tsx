import { NavIcon } from "./NavIcon.tsx";
import { useTranslate } from "../../i18n/useTranslate.ts";
import type { ParameterlessMessageKey } from "../../i18n/translate.ts";
import { navCurrentState, type PrimaryDestination, type Screen } from "./screenTypes.ts";

// Re-exported so existing consumers (App.tsx, immersiveRidingShell.ts and
// their tests) don't need an
// import-path change — NavIcon.tsx imports from screenTypes.ts directly,
// since importing from here would recreate the type-only cycle this
// module's own runtime import of NavIcon forms.
export type { Screen } from "./screenTypes.ts";

interface NavItem {
  destination: PrimaryDestination;
  /** Backlog item 113: a catalogue key, never the label text itself. */
  labelKey: ParameterlessMessageKey;
}

// Backlog item 121: four destinations. Status is no longer one of them — it
// is reached through the Settings/Status switcher at the top of the Settings
// section (SettingsStatusSwitcher.tsx), as a sibling view of Settings. The
// rider-facing name `Status` (item 112) and the internal screen key
// "diagnostics" are both unchanged.
const NAV_ITEMS: readonly NavItem[] = [
  { destination: "library", labelKey: "nav.routes" },
  { destination: "riding", labelKey: "nav.ride" },
  { destination: "planning", labelKey: "nav.plan" },
  { destination: "settings", labelKey: "nav.settings" },
];

export interface MainNavigationProps {
  screen: Screen;
  onNavigate: (destination: PrimaryDestination) => void;
}

/**
 * Compact, equal-width main navigation — four icon-and-label
 * destinations (backlog item 121; five before it). This component has no
 * positioning opinion of its own:
 * App.tsx renders it inside its own `<header className="app-header--sticky">`
 * whenever the app shell is not in immersive-Riding mode (see
 * immersiveRidingShell.ts) — while immersive, App.tsx renders neither this
 * component nor its wrapping `<header>` at all, replaced entirely by
 * RidingScreen's/FreeRoamScreen's own compact Pause/title/End header
 * (backlog item 55). It is that `<header>` — not this `<nav>` — that
 * carries the sticky positioning (see index.css's `.app-header--sticky`).
 * A `<nav>` whose own containing block is a `<header>` only as tall as the
 * nav itself has almost no room to stay stuck before scrolling away with
 * that too-short parent — sticky must sit on an ancestor whose containing
 * block spans the full page, which here is `<header>` itself (contained
 * by `.app-shell`, not by this nav). The active destination is never
 * colour alone: it also gets a soft accent surface plus an inset ring
 * (see `.main-nav-button` in index.css), and `aria-current` is the
 * single source of truth both for assistive technology and for that
 * visual cue.
 */
export function MainNavigation({ screen, onNavigate }: MainNavigationProps) {
  const { t } = useTranslate();
  return (
    <nav aria-label={t("nav.landmarkLabel")} className="main-nav">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.destination}
          type="button"
          className="main-nav-button"
          aria-current={navCurrentState(item.destination, screen)}
          onClick={() => {
            onNavigate(item.destination);
          }}
        >
          <NavIcon destination={item.destination} />
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </nav>
  );
}
