import { NavIcon } from "./NavIcon.tsx";

export type Screen = "library" | "riding" | "diagnostics" | "planning" | "settings";

/**
 * "sticky" pins MainNavigation to the top of the viewport while
 * scrolling (both down and up, never auto-hiding); "static" keeps it in
 * normal document flow so it scrolls away with the page. This component
 * has no opinion about *when* each mode applies — that policy lives in
 * navPositionMode.ts's `deriveNavPositionMode`, driven by App.tsx's own
 * screen and ride-tracking state.
 */
export type NavPositionMode = "sticky" | "static";

interface NavItem {
  screen: Screen;
  label: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { screen: "library", label: "Routes" },
  { screen: "riding", label: "Ride" },
  { screen: "planning", label: "Plan" },
  { screen: "diagnostics", label: "Diagnostics" },
  { screen: "settings", label: "Settings" },
];

export interface MainNavigationProps {
  screen: Screen;
  onNavigate: (screen: Screen) => void;
  positionMode: NavPositionMode;
}

/**
 * Compact, equal-width main navigation — five icon-and-label
 * destinations. Sticky by default (pinned to the top of the viewport
 * while scrolling); the caller-controlled `positionMode` returns it to
 * normal document flow only while a ride is genuinely being GPS-tracked,
 * to maximise dashboard space — see navPositionMode.ts for that policy.
 * The active destination is never colour alone: it also gets a soft
 * accent surface plus an inset ring (see `.main-nav-button` in
 * index.css), and `aria-current="page"` is the single source of truth
 * both for assistive technology and for that visual cue.
 */
export function MainNavigation({
  screen,
  onNavigate,
  positionMode,
}: MainNavigationProps) {
  return (
    <nav
      aria-label="Main"
      className={`main-nav${positionMode === "sticky" ? " main-nav--sticky" : ""}`}
    >
      {NAV_ITEMS.map((item) => (
        <button
          key={item.screen}
          type="button"
          className="main-nav-button"
          aria-current={screen === item.screen ? "page" : undefined}
          onClick={() => {
            onNavigate(item.screen);
          }}
        >
          <NavIcon screen={item.screen} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
