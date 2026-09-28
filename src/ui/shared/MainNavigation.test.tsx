import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainNavigation } from "./MainNavigation.tsx";
import { navCurrentState } from "./screenTypes.ts";

describe("MainNavigation", () => {
  it("renders all four destinations with visible labels", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    for (const label of ["Routes", "Ride", "Plan", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  // Backlog item 121 moved Status out of the primary navigation: it is
  // reached through the Settings/Status switcher at the top of the Settings
  // section. Item 112's rename stands — no "Diagnostics" either.
  it("offers no Status or Diagnostics destination", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Diagnostics" })).not.toBeInTheDocument();
  });

  it("keeps the four destinations in their established order", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Routes",
      "Ride",
      "Plan",
      "Settings",
    ]);
  });

  it("marks exactly one destination as the current page, matching the screen prop", () => {
    render(<MainNavigation screen="planning" onNavigate={vi.fn()} />);

    const current = screen.getAllByRole("button", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Plan");
  });

  it("marks the Settings tab as the current page while Settings is showing", () => {
    render(<MainNavigation screen="settings" onNavigate={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  // Status belongs to the Settings section, so its tab stays current — but it
  // is the section that is current, not the page the tab opens (from Status,
  // the tab opens Settings), so the value is "true", never "page".
  it("marks the Settings tab as the current section, not the current page, while Status is showing", () => {
    render(<MainNavigation screen="diagnostics" onNavigate={vi.fn()} />);

    const settingsTab = screen.getByRole("button", { name: "Settings" });
    expect(settingsTab).toHaveAttribute("aria-current", "true");
    expect(screen.queryAllByRole("button", { current: "page" })).toHaveLength(0);
  });

  it("calls onNavigate with the destination, never a resolved screen", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<MainNavigation screen="diagnostics" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("hides its icons from assistive technology", () => {
    const { container } = render(
      <MainNavigation screen="library" onNavigate={vi.fn()} />,
    );

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(4);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});

describe("navCurrentState", () => {
  it("is page for the destination showing, and absent for the others", () => {
    expect(navCurrentState("planning", "planning")).toBe("page");
    expect(navCurrentState("library", "planning")).toBeUndefined();
    expect(navCurrentState("settings", "planning")).toBeUndefined();
  });

  it("is page for Settings on Settings, and true for Settings on Status", () => {
    expect(navCurrentState("settings", "settings")).toBe("page");
    expect(navCurrentState("settings", "diagnostics")).toBe("true");
    expect(navCurrentState("library", "diagnostics")).toBeUndefined();
  });
});
