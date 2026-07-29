import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GradientSegmentDetailsPanel } from "./GradientSegmentDetailsPanel.tsx";
import type { GradientSegment } from "../../navigation/gradient.ts";

const segment: GradientSegment = {
  startDistanceMetres: 12400,
  endDistanceMetres: 12700,
  averageGradientPercent: -7.3,
  classification: "steep-descent",
};

describe("GradientSegmentDetailsPanel", () => {
  it("renders nothing when segment is null", () => {
    const { container } = render(
      <GradientSegmentDetailsPanel
        segment={null}
        startElevationMetres={null}
        endElevationMetres={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the class name paired with its actual gradient, route position and elevation, matching the spec's example format", () => {
    render(
      <GradientSegmentDetailsPanel
        segment={segment}
        startElevationMetres={286}
        endElevationMetres={264}
      />,
    );
    expect(screen.getByText("Steep descent · -7.3%")).toBeInTheDocument();
    expect(screen.getByText(/Route position: 12\.4–12\.7 km/)).toBeInTheDocument();
    expect(screen.getByText(/Elevation: 286 m to 264 m/)).toBeInTheDocument();
  });

  it("omits the elevation line when either endpoint's elevation is unknown", () => {
    render(
      <GradientSegmentDetailsPanel
        segment={segment}
        startElevationMetres={null}
        endElevationMetres={264}
      />,
    );
    expect(screen.queryByText(/Elevation:/)).toBeNull();
  });

  it("omits the gradient suffix when averageGradientPercent is null", () => {
    render(
      <GradientSegmentDetailsPanel
        segment={{ ...segment, averageGradientPercent: null }}
        startElevationMetres={null}
        endElevationMetres={null}
      />,
    );
    expect(screen.getByText("Steep descent")).toBeInTheDocument();
  });

  it("renders a clear-selection control only when onClear is supplied, and calls it on click", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    const { rerender } = render(
      <GradientSegmentDetailsPanel
        segment={segment}
        startElevationMetres={286}
        endElevationMetres={264}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear selection" })).toBeNull();

    rerender(
      <GradientSegmentDetailsPanel
        segment={segment}
        startElevationMetres={286}
        endElevationMetres={264}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
