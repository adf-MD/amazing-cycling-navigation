import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteSummaryPanel } from "./RouteSummaryPanel.tsx";
import type { PlannedRoute, RouteWarning } from "../../domain/types.ts";

function buildRoute(overrides: Partial<PlannedRoute> = {}): PlannedRoute {
  return {
    id: "route-1",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [
      { coordinate: [0, 51], elevationMetres: 10, distanceFromStartMetres: 0 },
      { coordinate: [0.01, 51], elevationMetres: 20, distanceFromStartMetres: 1000 },
    ],
    manoeuvres: [],
    distanceMetres: 1000,
    ascentMetres: 10,
    descentMetres: 0,
    surfaceSummary: {
      pavedMetres: 700,
      questionableMetres: 200,
      unsuitableMetres: 50,
      unknownMetres: 50,
    },
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
    ...overrides,
  };
}

function getFirstWarningButton(): HTMLElement {
  const button = screen.getAllByRole("button", { name: /surface for a road bike/i })[0];
  if (!button) throw new Error("expected at least one warning button");
  return button;
}

const WARNINGS: RouteWarning[] = [
  {
    kind: "questionable-surface",
    startDistanceMetres: 100,
    endDistanceMetres: 300,
    message: "Questionable surface for a road bike.",
  },
  {
    kind: "unsuitable-surface",
    startDistanceMetres: 600,
    endDistanceMetres: 650,
    message: "Unsuitable surface for a road bike.",
  },
];

describe("RouteSummaryPanel", () => {
  it("shows distance/ascent/descent and surface totals regardless of warnings", () => {
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={null}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
      />,
    );

    expect(screen.getByText(/1\.0 km/)).toBeInTheDocument();
    expect(screen.getByText("Paved: 700 m")).toBeInTheDocument();
    expect(screen.getByText("Questionable: 200 m")).toBeInTheDocument();
    expect(screen.getByText("Unsuitable: 50 m")).toBeInTheDocument();
    expect(screen.getByText("Unknown: 50 m")).toBeInTheDocument();
    expect(screen.getByText(/not a guarantee of road quality/i)).toBeInTheDocument();
  });

  it("renders each warning as an accessible, unpressed button showing kind, length and approximate range", () => {
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={null}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("Questionable surface for a road bike.");
    expect(buttons[0]).toHaveTextContent("200 m");
    expect(buttons[0]).toHaveTextContent("0.1 km");
    expect(buttons[0]).toHaveTextContent("0.3 km");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the selected warning's button as pressed", () => {
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={1}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
  });

  it("selects a warning when its button is clicked", async () => {
    const user = userEvent.setup();
    const onSelectWarning = vi.fn();
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={null}
        onSelectWarning={onSelectWarning}
        onClearWarningSelection={vi.fn()}
      />,
    );

    await user.click(getFirstWarningButton());

    expect(onSelectWarning).toHaveBeenCalledWith(0);
  });

  it("clears the selection when the already-selected warning's button is clicked again", async () => {
    const user = userEvent.setup();
    const onClearWarningSelection = vi.fn();
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={0}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={onClearWarningSelection}
      />,
    );

    await user.click(getFirstWarningButton());

    expect(onClearWarningSelection).toHaveBeenCalledOnce();
  });

  it("shows an explicit clear-selection button only when a warning is selected", async () => {
    const user = userEvent.setup();
    const onClearWarningSelection = vi.fn();
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={0}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={onClearWarningSelection}
      />,
    );

    const clearButton = screen.getByRole("button", { name: "Clear warning selection" });
    await user.click(clearButton);
    expect(onClearWarningSelection).toHaveBeenCalledOnce();
  });

  it("shows no clear-selection button and no warnings list when nothing is selected and there are none", () => {
    render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={[]}
        selectedWarningIndex={null}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
      />,
    );

    expect(screen.queryByRole("list", { name: "Route warnings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear warning selection" })).toBeNull();
  });
});
