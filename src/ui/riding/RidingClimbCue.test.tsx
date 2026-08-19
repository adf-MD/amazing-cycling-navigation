import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingClimbCue } from "./RidingClimbCue.tsx";
import type { ClimbProgressMetrics } from "../../navigation/climbElevationView.ts";

function buildMetrics(
  overrides: Partial<ClimbProgressMetrics> = {},
): ClimbProgressMetrics {
  return {
    clampedPresentationDistanceMetres: 700,
    distanceCompletedMetres: 240,
    distanceRemainingMetres: 1800,
    currentElevationMetres: 392,
    finishElevationMetres: 518,
    elevationRemainingMetres: 126,
    currentGradientPercent: 7.2,
    ...overrides,
  };
}

describe("RidingClimbCue", () => {
  it("shows the constant climb-active title and the formatted distance remaining", () => {
    render(<RidingClimbCue metrics={buildMetrics()} onViewClimb={vi.fn()} />);

    expect(screen.getByText("Climb active")).toBeInTheDocument();
    expect(screen.getByText("1.8 km remaining")).toBeInTheDocument();
  });

  it("reuses the caller-supplied metrics rather than computing its own", () => {
    render(
      <RidingClimbCue
        metrics={buildMetrics({ distanceRemainingMetres: 500 })}
        onViewClimb={vi.fn()}
      />,
    );

    expect(screen.getByText("0.5 km remaining")).toBeInTheDocument();
  });

  it("only the title carries role=status, and it is never role=alert", () => {
    const { container } = render(
      <RidingClimbCue metrics={buildMetrics()} onViewClimb={vi.fn()} />,
    );
    const title = screen.getByRole("status");
    expect(title).toHaveClass("ride-climb-cue-title");
    expect(title).toHaveTextContent("Climb active");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("the distance-remaining detail carries no live-region role", () => {
    const { container } = render(
      <RidingClimbCue metrics={buildMetrics()} onViewClimb={vi.fn()} />,
    );
    const detail = container.querySelector(".ride-climb-cue-detail");
    expect(detail).not.toBeNull();
    expect(detail).not.toHaveAttribute("role");
  });

  it("the status title's text stays byte-identical across a metrics update within the same climb", () => {
    const { rerender } = render(
      <RidingClimbCue metrics={buildMetrics()} onViewClimb={vi.fn()} />,
    );
    const before = screen.getByRole("status").textContent;

    rerender(
      <RidingClimbCue
        metrics={buildMetrics({
          distanceRemainingMetres: 900,
          distanceCompletedMetres: 1140,
        })}
        onViewClimb={vi.fn()}
      />,
    );
    const after = screen.getByRole("status").textContent;

    expect(after).toBe(before);
    expect(after).toBe("Climb active");
  });

  it("calls onViewClimb exactly once when View climb is pressed", async () => {
    const user = userEvent.setup();
    const onViewClimb = vi.fn();
    render(<RidingClimbCue metrics={buildMetrics()} onViewClimb={onViewClimb} />);

    await user.click(screen.getByRole("button", { name: "View climb" }));

    expect(onViewClimb).toHaveBeenCalledTimes(1);
  });

  it("renders View climb as a real button, not a link or a non-interactive element", () => {
    render(<RidingClimbCue metrics={buildMetrics()} onViewClimb={vi.fn()} />);

    const button = screen.getByRole("button", { name: "View climb" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });
});
