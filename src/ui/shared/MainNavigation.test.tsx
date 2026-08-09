import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainNavigation } from "./MainNavigation.tsx";

describe("MainNavigation", () => {
  it("renders all five destinations with visible labels", () => {
    render(<MainNavigation screen="library" onNavigate={vi.fn()} />);

    for (const label of ["Routes", "Ride", "Plan", "Diagnostics", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
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
