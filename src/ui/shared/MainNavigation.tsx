import { NavIcon } from "./NavIcon.tsx";

export type Screen = "library" | "riding" | "diagnostics" | "planning" | "settings";

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
}

/**
 * Compact, non-sticky, equal-width main navigation — five icon-and-label
 * destinations. The active destination is never colour alone: it also
 * gets a soft accent surface plus an inset ring (see `.main-nav-button`
 * in index.css), and `aria-current="page"` is the single source of truth
 * both for assistive technology and for that visual cue.
 */
export function MainNavigation({ screen, onNavigate }: MainNavigationProps) {
  return (
    <nav aria-label="Main" className="main-nav">
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
