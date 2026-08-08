import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MainNavigation } from "./MainNavigation.tsx";

describe("MainNavigation", () => {
  it("renders all five destinations with visible labels", () => {
    render(
      <MainNavigation screen="library" onNavigate={vi.fn()} positionMode="sticky" />,
    );

    for (const label of ["Routes", "Ride", "Plan", "Diagnostics", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks exactly one destination as the current page, matching the screen prop", () => {
    render(
      <MainNavigation screen="planning" onNavigate={vi.fn()} positionMode="sticky" />,
    );

    const current = screen.getAllByRole("button", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Plan");
  });

  it("calls onNavigate with the corresponding screen when a destination is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MainNavigation screen="library" onNavigate={onNavigate} positionMode="sticky" />,
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(onNavigate).toHaveBeenCalledWith("settings");
  });

  it("hides its icons from assistive technology", () => {
    const { container } = render(
      <MainNavigation screen="library" onNavigate={vi.fn()} positionMode="sticky" />,
    );

    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(5);
    for (const icon of icons) {
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("adds the sticky modifier class when positionMode is 'sticky'", () => {
    render(
      <MainNavigation screen="library" onNavigate={vi.fn()} positionMode="sticky" />,
    );

    expect(screen.getByRole("navigation", { name: "Main" })).toHaveClass(
      "main-nav",
      "main-nav--sticky",
    );
  });

  it("omits the sticky modifier class when positionMode is 'static', with every other contract unchanged", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MainNavigation screen="riding" onNavigate={onNavigate} positionMode="static" />,
    );

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toHaveClass("main-nav");
    expect(nav).not.toHaveClass("main-nav--sticky");

    for (const label of ["Routes", "Ride", "Plan", "Diagnostics", "Settings"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { current: "page" })).toHaveAccessibleName("Ride");

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});
