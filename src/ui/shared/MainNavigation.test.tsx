import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainNavigation } from "./MainNavigation.tsx";

describe("MainNavigation", () => {
  it("renders all five destinations with visible labels", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    for (const label of ["Routes", "Ride", "Plan", "Status", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  // Backlog item 112 renamed the rider-facing label only. The internal screen
  // key stays "diagnostics" (screenTypes.ts, App.tsx's render switch and
  // NavIcon's glyph lookup all key off it), so these two assertions together
  // are what prove the rename is presentation-deep and nothing more.
  it("shows Status rather than Diagnostics, while still navigating by the internal diagnostics key", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<MainNavigation screen="library" onNavigate={onNavigate} />);

    expect(screen.queryByRole("button", { name: "Diagnostics" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Status" }));

    expect(onNavigate).toHaveBeenCalledWith("diagnostics");
  });

  it("keeps the five destinations in their established order", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Routes",
      "Ride",
      "Plan",
      "Status",
      "Settings",
    ]);
  });

  it("marks exactly one destination as the current page, matching the screen prop", () => {
    render(<MainNavigation screen="planning" onNavigate={vi.fn()} />);

    const current = screen.getAllByRole("button", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Plan");
  });

  it("calls onNavigate with the corresponding screen when a destination is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<MainNavigation screen="library" onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("hides its icons from assistive technology", () => {
    const { container } = render(
      <MainNavigation screen="library" onNavigate={vi.fn()} />,
    );

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(5);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });
});
