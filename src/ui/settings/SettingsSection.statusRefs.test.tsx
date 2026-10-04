import { describe, expect, it, vi } from "vitest";
import { createRef, type RefObject } from "react";
import { render, screen } from "@testing-library/react";
import { SettingsSection } from "./SettingsSection.tsx";

// Backlog item 124, slice 11 (P-15). Status reveals the routing test's
// result below both sticky rows — App's navigation and this section's
// Settings/Status switcher — so SettingsSection must hand Status both, as
// it already does for Settings. A separate file because the mock replaces
// Status for every test in it.
const received: {
  stickyHeaderRef?: RefObject<HTMLElement | null>;
  stickySubheaderRef?: RefObject<HTMLElement | null>;
}[] = [];

vi.mock("../diagnostics/DiagnosticsScreen.tsx", () => ({
  DiagnosticsScreen: (props: (typeof received)[number]) => {
    received.push(props);
    return <p>Status stand-in</p>;
  },
}));

describe("SettingsSection: the sticky rows Status measures", () => {
  it("passes App's navigation and its own switcher to Status", () => {
    const headerRef = createRef<HTMLElement>();
    render(
      <>
        <header ref={headerRef}>Navigation</header>
        <SettingsSection
          view="diagnostics"
          onSelectView={() => undefined}
          stickyHeaderRef={headerRef}
        />
      </>,
    );

    expect(screen.getByText("Status stand-in")).toBeInTheDocument();
    const props = received.at(-1);
    expect(props?.stickyHeaderRef).toBe(headerRef);
    expect(props?.stickySubheaderRef?.current).toBe(
      screen.getByRole("navigation", { name: "Settings and Status" }),
    );
  });
});
