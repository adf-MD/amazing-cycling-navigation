import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ElevationChart } from "./ElevationChart.tsx";
import type { RoutePoint } from "../../domain/types.ts";
import type { ClassifiedSegment } from "../../navigation/gradient.ts";
import type {
  ClimbFeature,
  DescentFeature,
  RouteFeature,
} from "../../navigation/routeFeatures.ts";
import {
  MICRO_DETAIL_COLOURS,
  ROUTE_FEATURE_COLOURS,
  type MicroDetailVisualKey,
} from "../../navigation/routeFeaturePalette.ts";

function buildPoints(entries: readonly [number, number | null][]): RoutePoint[] {
  return entries.map(([distanceFromStartMetres, elevationMetres]) => ({
    coordinate: [0, 51],
    elevationMetres,
    distanceFromStartMetres,
  }));
}

describe("ElevationChart", () => {
  it("shows an explicit empty state for no route", () => {
    render(<ElevationChart points={[]} />);
    expect(screen.getByText("No route loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows an explicit missing-elevation state when no point has elevation", () => {
    const points = buildPoints([
      [0, null],
      [100, null],
    ]);
    render(<ElevationChart points={points} />);

    expect(
      screen.getByText("Elevation data is not available for this route."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders a chart with a min/max caption when elevation is present", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    render(<ElevationChart points={points} />);

    expect(
      screen.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeInTheDocument();
    expect(screen.getByText("10–40 m")).toBeInTheDocument();
  });

  it("overrides both the figure and chart accessible names with ariaLabel when supplied", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart points={points} ariaLabel="Elevation profile for Climb 2" />,
    );

    expect(
      screen.getByRole("img", { name: "Elevation profile for Climb 2" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('figure[aria-label="Elevation profile for Climb 2"]'),
    ).not.toBeNull();
  });

  it("keeps the default generic accessible names when ariaLabel is omitted", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(<ElevationChart points={points} />);

    expect(
      screen.getByRole("img", { name: "Elevation profile chart" }),
    ).toBeInTheDocument();
    expect(
      container.querySelector('figure[aria-label="Elevation profile"]'),
    ).not.toBeNull();
  });

  it("notes that some sections have no elevation data for a partial route", () => {
    const points = buildPoints([
      [0, 10],
      [500, null],
      [1000, 25],
    ]);
    render(<ElevationChart points={points} />);

    expect(screen.getByText(/some sections have no elevation data/)).toBeInTheDocument();
  });

  it("preserves the original inferred whole-route domain when domain is omitted", () => {
    const points = buildPoints([
      [1000, 0],
      [1500, 100],
      [2000, 0],
    ]);
    const { container } = render(<ElevationChart points={points} />);
    const path = container.querySelector("path");

    // Domain defaults to [1000, 2000] (the points' own bounds), so the
    // first point maps to x = 0 and the last to x = width (320).
    expect(path?.getAttribute("d")).toMatch(/^M 0\.00 /);
    expect(path?.getAttribute("d")).toMatch(/L 320\.00 /);
  });

  it("renders a marker line and dot when a marker is given", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 40, stale: false }}
      />,
    );

    expect(container.querySelector("line.elevation-chart-marker")).not.toBeNull();
    expect(container.querySelector("circle.elevation-chart-marker-dot")).not.toBeNull();
  });

  it("positions the marker dot using the padded display range, not flush against the chart edge", () => {
    const points = buildPoints([
      [0, 0],
      [1000, 10],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        height={100}
        marker={{ distanceFromStartMetres: 1000, elevationMetres: 10, stale: false }}
      />,
    );
    const dot = container.querySelector("circle.elevation-chart-marker-dot");
    const cy = Number(dot?.getAttribute("cy"));
    // At the true maximum elevation, an unpadded scale would place the dot
    // exactly at y = 0 (the very top edge); the padded display range
    // leaves headroom above it, matching the segment lines' own scale.
    expect(cy).toBeGreaterThan(0);
  });

  it("omits the marker dot when elevation at the marker is unknown", () => {
    const points = buildPoints([
      [0, 10],
      [500, null],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: null, stale: false }}
      />,
    );

    expect(container.querySelector("line.elevation-chart-marker")).not.toBeNull();
    expect(container.querySelector("circle.elevation-chart-marker-dot")).toBeNull();
  });

  it("gives a stale marker a dashed, non-colour-only distinction from a fresh one", () => {
    const points = buildPoints([
      [0, 10],
      [1000, 25],
    ]);

    const fresh = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 20, stale: false }}
      />,
    );
    const freshLine = fresh.container.querySelector("line.elevation-chart-marker");
    expect(freshLine?.getAttribute("stroke-dasharray")).toBeNull();
    fresh.unmount();

    const stale = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 20, stale: true }}
      />,
    );
    const staleLine = stale.container.querySelector("line.elevation-chart-marker");
    expect(staleLine?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("splits the profile into a dashed completed run and a solid remaining run", () => {
    const points = buildPoints([
      [0, 10],
      [500, 40],
      [1000, 25],
    ]);
    const { container } = render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 500, elevationMetres: 40, stale: false }}
      />,
    );

    expect(container.querySelector("path.elevation-chart-completed")).not.toBeNull();
    expect(container.querySelector("path.elevation-chart-remaining")).not.toBeNull();
    expect(
      container
        .querySelector("path.elevation-chart-completed")
        ?.getAttribute("stroke-dasharray"),
    ).not.toBeNull();
    expect(
      container
        .querySelector("path.elevation-chart-remaining")
        ?.getAttribute("stroke-dasharray"),
    ).toBeNull();
  });

  it("shows accessible position text, distinguishing fresh from stale", () => {
    const points = buildPoints([
      [0, 10],
      [80000, 25],
    ]);

    render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 42300, elevationMetres: 20, stale: false }}
      />,
    );
    expect(
      screen.getByText(/Current route position: 42\.3 km of 80\.0 km\./),
    ).toBeInTheDocument();
  });

  it("labels a stale marker's accessible text as a last known position", () => {
    const points = buildPoints([
      [0, 10],
      [80000, 25],
    ]);

    render(
      <ElevationChart
        points={points}
        marker={{ distanceFromStartMetres: 42300, elevationMetres: 20, stale: true }}
      />,
    );
    expect(
      screen.getByText(/Last known position: 42\.3 km of 80\.0 km\./),
    ).toBeInTheDocument();
  });

  it("renders no marker or position text when marker is omitted", () => {
    const points = buildPoints([
      [0, 10],
      [1000, 25],
    ]);
    const { container } = render(<ElevationChart points={points} />);

    expect(container.querySelector("line.elevation-chart-marker")).toBeNull();
    expect(screen.queryByText(/route position/)).toBeNull();
  });

  describe("detailed local-gradient colouring", () => {
    function gradientSegment(
      startDistanceMetres: number,
      endDistanceMetres: number,
      visualKey: MicroDetailVisualKey,
    ): ClassifiedSegment<MicroDetailVisualKey> {
      return {
        startDistanceMetres,
        endDistanceMetres,
        averageGradientPercent: null,
        visualKey,
      };
    }

    it("colours the profile per local-gradient band instead of currentColor", () => {
      const points = buildPoints([
        [0, 0],
        [500, 20],
        [1000, 0],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          gradientSegments={[
            gradientSegment(0, 500, "hard-climb"),
            gradientSegment(500, 1000, "steep"),
          ]}
        />,
      );
      const paths = container.querySelectorAll("path");
      const strokes = Array.from(paths).map((path) => path.getAttribute("stroke"));
      expect(strokes).toContain(MICRO_DETAIL_COLOURS["hard-climb"]);
      expect(strokes).toContain(MICRO_DETAIL_COLOURS.steep);
      expect(strokes).not.toContain("currentColor");
    });

    it("combines detail colour with the Full-mode completed/remaining split", () => {
      const points = buildPoints([
        [0, 0],
        [500, 20],
        [1000, 0],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          gradientSegments={[gradientSegment(0, 1000, "moderate-climb")]}
          marker={{ distanceFromStartMetres: 500, elevationMetres: 20, stale: false }}
        />,
      );
      const completed = container.querySelector("path.elevation-chart-completed");
      const remaining = container.querySelector("path.elevation-chart-remaining");
      expect(completed).not.toBeNull();
      expect(remaining).not.toBeNull();
      expect(completed?.getAttribute("stroke")).toBe(
        MICRO_DETAIL_COLOURS["moderate-climb"],
      );
      expect(remaining?.getAttribute("stroke")).toBe(
        MICRO_DETAIL_COLOURS["moderate-climb"],
      );
      // Dash/opacity still carries ridden-status independently of colour.
      expect(completed?.getAttribute("stroke-dasharray")).not.toBeNull();
      expect(remaining?.getAttribute("stroke-dasharray")).toBeNull();
    });

    it("omitting gradientSegments reproduces the exact currentColor rendering", () => {
      const points = buildPoints([
        [0, 10],
        [500, 40],
        [1000, 25],
      ]);
      const withoutGradient = render(<ElevationChart points={points} />);
      const strokes = Array.from(withoutGradient.container.querySelectorAll("path")).map(
        (path) => path.getAttribute("stroke"),
      );
      expect(strokes.every((stroke) => stroke === "currentColor")).toBe(true);
    });

    it("renders a descent's neutral local stretch as currentColor, even as the sole (base-only) colouring", () => {
      const points = buildPoints([
        [0, 0],
        [1000, 20],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          gradientSegments={[gradientSegment(0, 1000, "neutral")]}
        />,
      );
      const path = container.querySelector("path");
      expect(path?.getAttribute("stroke")).toBe("currentColor");
    });

    it("regression: does not paint the untouched remainder outside the narrowed detail range with a placeholder colour (previously coerced to a synthetic 'unknown' grey)", () => {
      const points = buildPoints([
        [0, 0],
        [300, 20],
        [1000, 20],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          gradientSegments={[gradientSegment(0, 300, "hard-climb")]}
        />,
      );
      const strokes = Array.from(container.querySelectorAll("path")).map((path) =>
        path.getAttribute("stroke"),
      );
      expect(strokes).toContain(MICRO_DETAIL_COLOURS["hard-climb"]);
      // The 300-1000 remainder, outside the supplied detail segment, must
      // fall back to currentColor rather than any leftover placeholder hex.
      expect(strokes).toContain("currentColor");
    });
  });

  describe("macro route-feature colouring", () => {
    function climbFeature(
      startDistanceMetres: number,
      endDistanceMetres: number,
      category: ClimbFeature["category"] = "category-3",
    ): ClimbFeature {
      return {
        id: `climb-${String(startDistanceMetres)}`,
        kind: "climb",
        startDistanceMetres,
        endDistanceMetres,
        lengthMetres: endDistanceMetres - startDistanceMetres,
        elevationGainMetres: 40,
        averageGradientPercent: 6,
        maxGradientPercent: 8,
        climbScore: 20000,
        category,
      };
    }

    function descentFeature(
      startDistanceMetres: number,
      endDistanceMetres: number,
      band: DescentFeature["band"] = "steep",
    ): DescentFeature {
      return {
        id: `descent-${String(startDistanceMetres)}`,
        kind: "descent",
        startDistanceMetres,
        endDistanceMetres,
        lengthMetres: endDistanceMetres - startDistanceMetres,
        elevationLossMetres: 40,
        averageGradientPercent: -7,
        maxGradientPercent: -9,
        band,
      };
    }

    it("colours a recognised climb/descent by its macro category/severity, leaving ordinary sections currentColor", () => {
      const points = buildPoints([
        [0, 0],
        [300, 20],
        [600, 20],
        [1000, 0],
      ]);
      const features: RouteFeature[] = [
        climbFeature(0, 300, "category-2"),
        descentFeature(600, 1000, "very-steep"),
      ];
      const { container } = render(
        <ElevationChart points={points} routeFeatures={features} />,
      );
      const strokes = Array.from(container.querySelectorAll("path")).map((path) =>
        path.getAttribute("stroke"),
      );
      expect(strokes).toContain(ROUTE_FEATURE_COLOURS["category-2"]);
      expect(strokes).toContain(ROUTE_FEATURE_COLOURS["very-steep"]);
      expect(strokes).toContain("currentColor");
    });

    it("does not colour anything macro when routeFeatures is an empty array (no recognised features)", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(<ElevationChart points={points} routeFeatures={[]} />);
      const strokes = Array.from(container.querySelectorAll("path")).map((path) =>
        path.getAttribute("stroke"),
      );
      expect(strokes.every((stroke) => stroke === "currentColor")).toBe(true);
    });

    it("shows detailed local-gradient colours only inside the selected/active feature's own (caller-narrowed) range", () => {
      const points = buildPoints([
        [0, 0],
        [300, 20],
        [1000, 20],
      ]);
      const features: RouteFeature[] = [climbFeature(0, 300, "category-2")];
      const detailSegments: ClassifiedSegment<MicroDetailVisualKey>[] = [
        {
          startDistanceMetres: 0,
          endDistanceMetres: 300,
          averageGradientPercent: 6,
          visualKey: "hard-climb",
        },
      ];
      const { container } = render(
        <ElevationChart
          points={points}
          routeFeatures={features}
          gradientSegments={detailSegments}
        />,
      );
      const strokes = Array.from(container.querySelectorAll("path")).map((path) =>
        path.getAttribute("stroke"),
      );
      // Both the macro colour (base, covering 0-300) and the detail colour
      // (overlay, also covering 0-300) are present; the ordinary
      // 300-1000 stretch stays currentColor since no feature covers it.
      expect(strokes).toContain(ROUTE_FEATURE_COLOURS["category-2"]);
      expect(strokes).toContain(MICRO_DETAIL_COLOURS["hard-climb"]);
      expect(strokes).toContain("currentColor");
    });

    it("renders the detail overlay at a thicker stroke width than the macro base", () => {
      const points = buildPoints([
        [0, 0],
        [300, 20],
      ]);
      // Deliberately a macro category and detail band whose colours
      // *don't* share a tier (category-3 yellow vs the dark-red top band)
      // — a category paired with its own corresponding band (e.g.
      // category-2/hard-climb, both orange) would make the two
      // colour-keyed querySelectors below ambiguous, since they'd match
      // the identical stroke value.
      const features: RouteFeature[] = [climbFeature(0, 300, "category-3")];
      const detailSegments: ClassifiedSegment<MicroDetailVisualKey>[] = [
        {
          startDistanceMetres: 0,
          endDistanceMetres: 300,
          averageGradientPercent: 13,
          visualKey: "extremely-steep-climb",
        },
      ];
      const { container } = render(
        <ElevationChart
          points={points}
          routeFeatures={features}
          gradientSegments={detailSegments}
        />,
      );
      const macroPath = container.querySelector(
        `path[stroke="${ROUTE_FEATURE_COLOURS["category-3"]}"]`,
      );
      const detailPath = container.querySelector(
        `path[stroke="${MICRO_DETAIL_COLOURS["extremely-steep-climb"]}"]`,
      );
      const macroWidth = Number(macroPath?.getAttribute("stroke-width"));
      const detailWidth = Number(detailPath?.getAttribute("stroke-width"));
      expect(detailWidth).toBeGreaterThan(macroWidth);
    });

    it("gives a selectedRangeMetres match a further stroke-width bump, distinguishing it from its unselected sibling", () => {
      const points = buildPoints([
        [0, 20],
        [300, 20],
        [600, 20],
      ]);
      const features: RouteFeature[] = [
        climbFeature(0, 300, "category-2"),
        climbFeature(300, 600, "category-2"),
      ];
      const { container } = render(
        <ElevationChart
          points={points}
          routeFeatures={features}
          selectedRangeMetres={{ startDistanceMetres: 0, endDistanceMetres: 300 }}
        />,
      );
      const paths = Array.from(
        container.querySelectorAll(
          `path[stroke="${ROUTE_FEATURE_COLOURS["category-2"]}"]`,
        ),
      );
      const widths = paths.map((path) => Number(path.getAttribute("stroke-width")));
      expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths));
    });
  });

  describe("climb area fill", () => {
    function gradientSegment(
      startDistanceMetres: number,
      endDistanceMetres: number,
      visualKey: MicroDetailVisualKey,
    ): ClassifiedSegment<MicroDetailVisualKey> {
      return {
        startDistanceMetres,
        endDistanceMetres,
        averageGradientPercent: null,
        visualKey,
      };
    }

    const points = buildPoints([
      [0, 0],
      [500, 20],
      [1000, 40],
    ]);
    const segments = [
      gradientSegment(0, 500, "moderate-climb"),
      gradientSegment(500, 1000, "hard-climb"),
    ];
    const marker = { distanceFromStartMetres: 500, elevationMetres: 20, stale: false };

    it("renders no fill when areaFill is omitted, even with gradientSegments and a marker", () => {
      const { container } = render(
        <ElevationChart points={points} gradientSegments={segments} marker={marker} />,
      );
      expect(container.querySelector("path.elevation-chart-area-fill")).toBeNull();
      expect(container.querySelector("line.elevation-chart-baseline")).toBeNull();
    });

    it("renders no fill when areaFill is set but gradientSegments is omitted", () => {
      const { container } = render(
        <ElevationChart points={points} areaFill marker={marker} />,
      );
      expect(container.querySelector("path.elevation-chart-area-fill")).toBeNull();
    });

    it("renders one uniform-opacity fill (no completed/remaining split) when areaFill and gradientSegments are set but marker is omitted — the pre-ride whole-climb preview case", () => {
      const { container } = render(
        <ElevationChart points={points} areaFill gradientSegments={segments} />,
      );
      const fills = Array.from(
        container.querySelectorAll("path.elevation-chart-area-fill"),
      );
      expect(fills.length).toBeGreaterThan(0);
      const opacities = fills.map((path) => path.getAttribute("fill-opacity"));
      expect(new Set(opacities).size).toBe(1);
      // No rider progress means nothing is "completed" and the profile
      // stroke is not split into completed/remaining either.
      expect(container.querySelector("path.elevation-chart-completed")).toBeNull();
      expect(container.querySelector("path.elevation-chart-marker")).toBeNull();
      expect(container.querySelector("line.elevation-chart-baseline")).not.toBeNull();
    });

    it("colours each fill piece per its own local-gradient band", () => {
      const { container } = render(
        <ElevationChart
          points={points}
          areaFill
          gradientSegments={segments}
          marker={marker}
        />,
      );
      const fills = Array.from(
        container.querySelectorAll("path.elevation-chart-area-fill"),
      );
      const colours = fills.map((path) => path.getAttribute("fill"));
      expect(colours).toContain(MICRO_DETAIL_COLOURS["moderate-climb"]);
      expect(colours).toContain(MICRO_DETAIL_COLOURS["hard-climb"]);
    });

    it("gives the completed (ridden) portion a lower fill opacity than the remaining portion", () => {
      const { container } = render(
        <ElevationChart
          points={points}
          areaFill
          gradientSegments={segments}
          marker={marker}
        />,
      );
      const fills = Array.from(
        container.querySelectorAll("path.elevation-chart-area-fill"),
      );
      const opacities = fills.map((path) => Number(path.getAttribute("fill-opacity")));
      expect(Math.min(...opacities)).toBeLessThan(Math.max(...opacities));
    });

    it("paints every fill path before every profile stroke path, in DOM order", () => {
      const { container } = render(
        <ElevationChart
          points={points}
          areaFill
          gradientSegments={segments}
          marker={marker}
        />,
      );
      const fillPaths = Array.from(
        container.querySelectorAll("path.elevation-chart-area-fill"),
      );
      const strokePaths = Array.from(
        container.querySelectorAll(
          "path.elevation-chart-completed, path.elevation-chart-remaining",
        ),
      );
      expect(fillPaths.length).toBeGreaterThan(0);
      expect(strokePaths.length).toBeGreaterThan(0);
      for (const fillPath of fillPaths) {
        for (const strokePath of strokePaths) {
          // DOCUMENT_POSITION_FOLLOWING (4): strokePath comes after fillPath.
          expect(fillPath.compareDocumentPosition(strokePath) & 4).toBe(4);
        }
      }
    });

    it("renders exactly one baseline line regardless of segment count", () => {
      const gappedPoints = buildPoints([
        [0, 0],
        [400, 20],
        [500, null],
        [600, 20],
        [1000, 40],
      ]);
      const { container } = render(
        <ElevationChart
          points={gappedPoints}
          areaFill
          gradientSegments={segments}
          marker={marker}
        />,
      );
      expect(container.querySelectorAll("line.elevation-chart-baseline")).toHaveLength(1);
    });

    it("renders the current-position marker line and dot above every fill path", () => {
      const { container } = render(
        <ElevationChart
          points={points}
          areaFill
          gradientSegments={segments}
          marker={marker}
        />,
      );
      const svgChildren = Array.from(container.querySelector("svg")?.children ?? []);
      const markerGroupIndex = svgChildren.findIndex(
        (child) => child.querySelector("line.elevation-chart-marker") !== null,
      );
      const lastSegmentGroupIndex = svgChildren.reduce(
        (lastIndex, child, index) =>
          child.querySelector("path.elevation-chart-area-fill") !== null
            ? index
            : lastIndex,
        -1,
      );
      expect(markerGroupIndex).toBeGreaterThan(lastSegmentGroupIndex);
    });

    it("does not render the fill in a Full-mode-style call with gradientSegments but no areaFill (existing callers unaffected)", () => {
      const { container } = render(
        <ElevationChart points={points} gradientSegments={segments} marker={marker} />,
      );
      expect(container.querySelector("path.elevation-chart-area-fill")).toBeNull();
      // Existing stroke-based completed/remaining split is untouched.
      expect(container.querySelector("path.elevation-chart-completed")).not.toBeNull();
      expect(container.querySelector("path.elevation-chart-remaining")).not.toBeNull();
    });
  });

  describe("distance guides (backlog item 54)", () => {
    it("renders no guide elements when distanceGuides is omitted", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(<ElevationChart points={points} />);
      expect(container.querySelector("line.elevation-chart-distance-guide")).toBeNull();
    });

    it("renders no guide elements when distanceGuides is an empty array", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(
        <ElevationChart points={points} distanceGuides={[]} />,
      );
      expect(container.querySelector("line.elevation-chart-distance-guide")).toBeNull();
    });

    it("renders a guide line at the pixel position implied by its route-global distance", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          distanceGuides={[{ distanceFromStartMetres: 250, aheadMetres: 1000 }]}
        />,
      );
      const guideLine = container.querySelector("line.elevation-chart-distance-guide");
      expect(guideLine).not.toBeNull();
      // Default domain [0, 1000] over default width 320: 250 m -> x = 80.
      expect(guideLine?.getAttribute("x1")).toBe("80");
      expect(guideLine?.getAttribute("x2")).toBe("80");
    });

    it("labels each guide using the relative +N km format", () => {
      const points = buildPoints([
        [0, 10],
        [10000, 40],
      ]);
      render(
        <ElevationChart
          points={points}
          domain={{ startDistanceMetres: 0, endDistanceMetres: 10000 }}
          distanceGuides={[
            { distanceFromStartMetres: 2000, aheadMetres: 2000 },
            { distanceFromStartMetres: 4000, aheadMetres: 4000 },
            { distanceFromStartMetres: 8000, aheadMetres: 8000 },
          ]}
        />,
      );
      expect(screen.getByText("+2 km")).toBeInTheDocument();
      expect(screen.getByText("+4 km")).toBeInTheDocument();
      expect(screen.getByText("+8 km")).toBeInTheDocument();
    });

    it("gives guides a dash pattern distinct from both the stale-marker and completed-segment dash patterns", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          marker={{ distanceFromStartMetres: 500, elevationMetres: 25, stale: true }}
          distanceGuides={[{ distanceFromStartMetres: 250, aheadMetres: 1000 }]}
        />,
      );
      const guideLine = container.querySelector("line.elevation-chart-distance-guide");
      const markerLine = container.querySelector("line.elevation-chart-marker");
      const completedPath = container.querySelector("path.elevation-chart-completed");

      const guideDasharray = guideLine?.getAttribute("stroke-dasharray");
      const markerDasharray = markerLine?.getAttribute("stroke-dasharray");
      const completedDasharray = completedPath?.getAttribute("stroke-dasharray");

      expect(guideDasharray).not.toBeNull();
      expect(guideDasharray).not.toBe(markerDasharray);
      expect(guideDasharray).not.toBe(completedDasharray);
    });

    it("renders guides before every profile path, so the profile paints over them", () => {
      const points = buildPoints([
        [0, 10],
        [500, 40],
        [1000, 25],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          distanceGuides={[{ distanceFromStartMetres: 250, aheadMetres: 1000 }]}
        />,
      );
      const guideLine = container.querySelector("line.elevation-chart-distance-guide");
      const profilePaths = Array.from(container.querySelectorAll("path"));
      expect(guideLine).not.toBeNull();
      expect(profilePaths.length).toBeGreaterThan(0);
      for (const path of profilePaths) {
        // DOCUMENT_POSITION_FOLLOWING (4): path comes after the guide line.
        const position = guideLine?.compareDocumentPosition(path) ?? 0;
        expect(position & 4).toBe(4);
      }
    });

    it("keeps distance guides from intercepting the chart's tap target", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 320,
        height: 96,
        right: 320,
        bottom: 96,
        x: 0,
        y: 0,
        toJSON: () => "",
      });
      const onTapDistance = vi.fn<(distanceMetres: number) => void>();
      const { container } = render(
        <ElevationChart
          points={points}
          onTapDistance={onTapDistance}
          distanceGuides={[{ distanceFromStartMetres: 250, aheadMetres: 1000 }]}
        />,
      );
      const hitTarget = container.querySelector("rect.elevation-chart-tap-target");
      if (!hitTarget) throw new Error("expected a tap-target rect");
      // Tap exactly where the guide at 250 m is drawn (x = 80).
      fireEvent.click(hitTarget, { clientX: 80, clientY: 10 });

      expect(onTapDistance).toHaveBeenCalledTimes(1);
      expect(onTapDistance.mock.calls[0]?.[0]).toBeCloseTo(250, -1);
      vi.restoreAllMocks();
    });

    it("flips the label anchor away from the domain edges so text does not overflow", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          distanceGuides={[
            { distanceFromStartMetres: 10, aheadMetres: 1000 },
            { distanceFromStartMetres: 500, aheadMetres: 2000 },
            { distanceFromStartMetres: 990, aheadMetres: 4000 },
          ]}
        />,
      );
      const labels = Array.from(
        container.querySelectorAll("text.elevation-chart-distance-guide-label"),
      );
      expect(labels).toHaveLength(3);
      expect(labels[0]?.getAttribute("text-anchor")).toBe("start");
      expect(labels[1]?.getAttribute("text-anchor")).toBe("middle");
      expect(labels[2]?.getAttribute("text-anchor")).toBe("end");
    });

    it("renders no guide caption when distanceGuides is empty or omitted", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const omitted = render(<ElevationChart points={points} />);
      expect(
        omitted.container.querySelector(".elevation-chart-distance-guides-caption"),
      ).toBeNull();
      omitted.unmount();

      const empty = render(<ElevationChart points={points} distanceGuides={[]} />);
      expect(
        empty.container.querySelector(".elevation-chart-distance-guides-caption"),
      ).toBeNull();
    });

    it("renders a plain, non-live-region caption listing every guide's label, without disturbing the chart's own accessible name", () => {
      const points = buildPoints([
        [0, 10],
        [10000, 40],
      ]);
      const { container } = render(
        <ElevationChart
          points={points}
          domain={{ startDistanceMetres: 0, endDistanceMetres: 10000 }}
          distanceGuides={[
            { distanceFromStartMetres: 2000, aheadMetres: 2000 },
            { distanceFromStartMetres: 4000, aheadMetres: 4000 },
            { distanceFromStartMetres: 6000, aheadMetres: 6000 },
            { distanceFromStartMetres: 8000, aheadMetres: 8000 },
          ]}
        />,
      );
      const caption = container.querySelector(".elevation-chart-distance-guides-caption");
      expect(caption).not.toBeNull();
      expect(caption?.textContent).toContain("+2 km");
      expect(caption?.textContent).toContain("+4 km");
      expect(caption?.textContent).toContain("+6 km");
      expect(caption?.textContent).toContain("+8 km");
      expect(caption?.getAttribute("aria-live")).toBeNull();

      expect(
        screen.getByRole("img", { name: "Elevation profile chart" }),
      ).toBeInTheDocument();
      expect(
        container.querySelector('figure[aria-label="Elevation profile"]'),
      ).not.toBeNull();
    });
  });

  describe("chart tap interaction", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function mockBoundingClientRect(width: number, height: number): void {
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width,
        height,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => "",
      });
    }

    it("reports the tapped route distance via onTapDistance", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      mockBoundingClientRect(320, 96);
      const onTapDistance = vi.fn<(distanceMetres: number) => void>();
      const { container } = render(
        <ElevationChart points={points} onTapDistance={onTapDistance} />,
      );
      const hitTarget = container.querySelector("rect.elevation-chart-tap-target");
      expect(hitTarget).not.toBeNull();
      if (!hitTarget) throw new Error("expected a tap-target rect");
      fireEvent.click(hitTarget, { clientX: 160, clientY: 48 });

      expect(onTapDistance).toHaveBeenCalledTimes(1);
      // Tapping the horizontal midpoint of a 320-wide chart over a
      // [0,1000] domain resolves to ~500 m.
      expect(onTapDistance.mock.calls[0]?.[0]).toBeCloseTo(500, -1);
    });

    it("does not render a hit target, and never calls onTapDistance, when the prop is omitted", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      const { container } = render(<ElevationChart points={points} />);
      expect(container.querySelector("rect.elevation-chart-tap-target")).toBeNull();
    });

    it("resolves a tap anywhere on the chart, including an ordinary (non-feature) section — the caller decides what null resolution means", () => {
      const points = buildPoints([
        [0, 10],
        [1000, 40],
      ]);
      mockBoundingClientRect(320, 96);
      const onTapDistance = vi.fn<(distanceMetres: number) => void>();
      const { container } = render(
        <ElevationChart
          points={points}
          routeFeatures={[]}
          onTapDistance={onTapDistance}
        />,
      );
      const hitTarget = container.querySelector("rect.elevation-chart-tap-target");
      if (!hitTarget) throw new Error("expected a tap-target rect");
      fireEvent.click(hitTarget, { clientX: 32, clientY: 48 });

      expect(onTapDistance).toHaveBeenCalledTimes(1);
    });
  });
});
