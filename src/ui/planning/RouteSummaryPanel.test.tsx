import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteSummaryPanel } from "./RouteSummaryPanel.tsx";
import type { PlannedRoute, RouteWarning } from "../../domain/types.ts";
import type { GradientSegment } from "../../navigation/gradient.ts";

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
        revealToken={0}
        gradientSegments={[]}
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
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("Questionable surface for a road bike.");
    expect(buttons[0]).toHaveTextContent("200 m");
    expect(buttons[0]).toHaveTextContent("0.1 km");
    expect(buttons[0]).toHaveTextContent("0.3 km");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[0]).toHaveClass("route-warning-button");
    expect(buttons[0]).not.toHaveClass("is-selected");
    expect(buttons[0]).not.toHaveTextContent("✓");
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
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    const buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons[0]).toHaveAttribute("aria-pressed", "false");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveClass("route-warning-button", "is-selected");
    expect(buttons[1]).toHaveTextContent("✓");
    expect(buttons[0]).not.toHaveClass("is-selected");
  });

  it("moves the selected visual treatment when selectedWarningIndex changes, and clears it when the selection is cleared", () => {
    const { rerender } = render(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={0}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    let buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons[0]).toHaveClass("is-selected");
    expect(buttons[0]).toHaveTextContent("✓");
    expect(buttons[1]).not.toHaveClass("is-selected");
    expect(buttons[1]).not.toHaveTextContent("✓");

    rerender(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={1}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons[0]).not.toHaveClass("is-selected");
    expect(buttons[0]).not.toHaveTextContent("✓");
    expect(buttons[1]).toHaveClass("is-selected");
    expect(buttons[1]).toHaveTextContent("✓");

    rerender(
      <RouteSummaryPanel
        route={buildRoute()}
        waypointCount={2}
        warnings={WARNINGS}
        selectedWarningIndex={null}
        onSelectWarning={vi.fn()}
        onClearWarningSelection={vi.fn()}
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
    expect(buttons[0]).not.toHaveClass("is-selected");
    expect(buttons[0]).not.toHaveTextContent("✓");
    expect(buttons[1]).not.toHaveClass("is-selected");
    expect(buttons[1]).not.toHaveTextContent("✓");
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
        revealToken={0}
        gradientSegments={[]}
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
        revealToken={0}
        gradientSegments={[]}
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
        revealToken={0}
        gradientSegments={[]}
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
        revealToken={0}
        gradientSegments={[]}
      />,
    );

    expect(screen.queryByRole("list", { name: "Route warnings" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear warning selection" })).toBeNull();
  });

  describe("map-originated reveal", () => {
    let scrollIntoViewSpy: ReturnType<
      typeof vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>
    >;
    // Saved only to restore afterwards, never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
      scrollIntoViewSpy = vi.fn();
      // jsdom doesn't implement scrollIntoView at all.
      Element.prototype.scrollIntoView = scrollIntoViewSpy;
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      window.matchMedia = originalMatchMedia;
      vi.unstubAllGlobals();
    });

    it("scrolls the selected button into view when revealToken increments", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
      expect(scrollIntoViewSpy).toHaveBeenCalledWith(
        expect.objectContaining({ block: "nearest" }),
      );
    });

    it("does not scroll when revealToken is unchanged across a rerender", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute({ name: "Renamed route" })}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });

    it("does not scroll when selectedWarningIndex is null even if revealToken changed", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });

    it("scrolls again on a second revealToken increment even when selectedWarningIndex didn't change (repeat tap)", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );
      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={2}
          gradientSegments={[]}
        />,
      );

      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
    });

    it("uses non-animated scrolling when prefers-reduced-motion is set", () => {
      // Assigned directly (not via vi.stubGlobal, which would require
      // spreading — and losing the prototype of — the real Window
      // instance) since this test renders real DOM, unlike
      // environmentContext.test.ts's isolated unit tests.
      window.matchMedia = ((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
      })) as typeof window.matchMedia;
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      expect(scrollIntoViewSpy).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "auto" }),
      );
    });

    it("never moves keyboard focus when revealing", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      expect(document.activeElement).toBe(document.body);
    });

    it("still identifies the selected button via aria-pressed under the reveal path", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      const buttons = screen.getAllByRole("button", { name: /surface for a road bike/i });
      expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    });

    it("renders a role=status live region with the selected warning's message and distance range on a reveal", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );
      expect(screen.queryByRole("status")).toBeNull();

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={1}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={1}
          gradientSegments={[]}
        />,
      );

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Unsuitable surface for a road bike.");
      expect(status).toHaveTextContent("0.6 km");
      expect(status).toHaveTextContent("0.7 km");
    });

    it("does not render the live region for a list-originated selection (selectedWarningIndex changes without revealToken bumping)", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={0}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      expect(screen.queryByRole("status")).toBeNull();
      expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });
  });

  describe("surface detail", () => {
    function buildSurfaceDetailWarning(
      overrides: Partial<RouteWarning> = {},
    ): RouteWarning {
      return {
        kind: "questionable-surface",
        startDistanceMetres: 100,
        endDistanceMetres: 300,
        message: "Questionable surface for a road bike: compacted gravel.",
        surface: { type: "compacted-gravel", label: "Compacted gravel" },
        ...overrides,
      };
    }

    it("renders the structured kind · length summary, not the raw message, for a surface-detail warning", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[buildSurfaceDetailWarning()]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      const button = screen.getByRole("button", { name: /^Questionable surface/ });
      expect(button).toHaveTextContent("Questionable surface · 200 m");
      expect(button).not.toHaveTextContent("compacted gravel");
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-controls");
    });

    it("expands to show Surface: <label> and Route position when a surface-detail warning is selected", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[buildSurfaceDetailWarning()]}
          selectedWarningIndex={0}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      const button = screen.getByRole("button", { name: /^Questionable surface/ });
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(button).toHaveAttribute("aria-controls", "route-warning-detail-0");
      expect(screen.getByText("Surface: Compacted gravel")).toBeInTheDocument();
      expect(screen.getByText("Route position: 0.1–0.3 km")).toBeInTheDocument();
    });

    it("collapses the detail and removes aria-controls when the selection is cleared", () => {
      const { rerender } = render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[buildSurfaceDetailWarning()]}
          selectedWarningIndex={0}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );
      expect(screen.getByText("Surface: Compacted gravel")).toBeInTheDocument();

      rerender(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[buildSurfaceDetailWarning()]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      expect(screen.queryByText("Surface: Compacted gravel")).toBeNull();
      const button = screen.getByRole("button", { name: /^Questionable surface/ });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(button).not.toHaveAttribute("aria-controls");
    });

    it("renders a legacy (no surface field) surface warning exactly as before, even when selected", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={WARNINGS}
          selectedWarningIndex={0}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      const button = getFirstWarningButton();
      expect(button).toHaveTextContent("Questionable surface for a road bike.");
      expect(button).not.toHaveAttribute("aria-expanded");
      expect(button).not.toHaveAttribute("aria-controls");
      expect(screen.queryByText(/^Surface:/)).toBeNull();
    });

    it("does not fabricate a surface field or expand detail for a non-surface warning kind", () => {
      const stepsWarning: RouteWarning = {
        kind: "steps",
        startDistanceMetres: 0,
        endDistanceMetres: 50,
        message: "Route includes steps.",
      };
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[stepsWarning]}
          selectedWarningIndex={0}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      const button = screen.getByRole("button", { name: /steps/i });
      expect(button).not.toHaveAttribute("aria-expanded");
      expect(button).not.toHaveAttribute("aria-controls");
      expect(screen.queryByText(/^Surface:/)).toBeNull();
    });
  });

  describe("elevation profile and gradient legend", () => {
    function gradientSegment(
      startDistanceMetres: number,
      endDistanceMetres: number,
      classification: GradientSegment["classification"],
    ): GradientSegment {
      return {
        startDistanceMetres,
        endDistanceMetres,
        averageGradientPercent: null,
        classification,
      };
    }

    it("renders an elevation profile chart for a routed route with elevation", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[gradientSegment(0, 1000, "flat")]}
        />,
      );

      expect(
        screen.getByRole("img", { name: "Elevation profile chart" }),
      ).toBeInTheDocument();
    });

    it("keeps the existing missing-elevation messaging when the route has none", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute({
            points: [
              { coordinate: [0, 51], elevationMetres: null, distanceFromStartMetres: 0 },
              {
                coordinate: [0.01, 51],
                elevationMetres: null,
                distanceFromStartMetres: 1000,
              },
            ],
          })}
          waypointCount={2}
          warnings={[]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[gradientSegment(0, 1000, "unknown")]}
        />,
      );

      expect(
        screen.getByText("Elevation data is not available for this route."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("img")).toBeNull();
    });

    it("renders a gradient legend entry for each present class", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[
            gradientSegment(0, 500, "flat"),
            gradientSegment(500, 1000, "hard-climb"),
          ]}
        />,
      );

      const legend = screen.getByRole("list", { name: "Gradient legend" });
      expect(legend.querySelectorAll("li")).toHaveLength(2);
      expect(screen.getByText(/Hard climb/)).toBeInTheDocument();
    });

    it("renders no gradient legend when there are no gradient segments", () => {
      render(
        <RouteSummaryPanel
          route={buildRoute()}
          waypointCount={2}
          warnings={[]}
          selectedWarningIndex={null}
          onSelectWarning={vi.fn()}
          onClearWarningSelection={vi.fn()}
          revealToken={0}
          gradientSegments={[]}
        />,
      );

      expect(screen.queryByRole("list", { name: "Gradient legend" })).toBeNull();
    });
  });
});
