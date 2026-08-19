import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingCompactManoeuvreCue } from "./RidingCompactManoeuvreCue.tsx";
import type { NextManoeuvreSelection } from "../../navigation/nextManoeuvre.ts";

function buildSelection(
  overrides: Partial<NextManoeuvreSelection> = {},
): NextManoeuvreSelection {
  return {
    index: 0,
    manoeuvre: {
      distanceFromStartMetres: 500,
      type: "left",
      instruction: "Turn left onto Main Street",
    },
    remainingDistanceMetres: 80,
    ...overrides,
  };
}

describe("RidingCompactManoeuvreCue", () => {
  it("shows the provider's instruction text and the formatted distance", () => {
    render(<RidingCompactManoeuvreCue selection={buildSelection()} isFrozen={false} />);

    expect(screen.getByText("Turn left onto Main Street")).toBeInTheDocument();
    expect(screen.getByText("80 m")).toBeInTheDocument();
  });

  it("falls back to the shared generic label when the provider gave no instruction text", () => {
    render(
      <RidingCompactManoeuvreCue
        selection={buildSelection({
          manoeuvre: { distanceFromStartMetres: 500, type: "right" },
        })}
        isFrozen={false}
      />,
    );

    expect(screen.getByText("Turn right")).toBeInTheDocument();
  });

  it("appends a short frozen qualifier only when isFrozen is true", () => {
    const { rerender } = render(
      <RidingCompactManoeuvreCue selection={buildSelection()} isFrozen={false} />,
    );
    expect(screen.getByText("Turn left onto Main Street")).toBeInTheDocument();

    rerender(<RidingCompactManoeuvreCue selection={buildSelection()} isFrozen={true} />);
    expect(
      screen.getByText("Turn left onto Main Street — last known position"),
    ).toBeInTheDocument();
  });

  it("only the instruction carries role=status, and it is never role=alert", () => {
    const { container } = render(
      <RidingCompactManoeuvreCue selection={buildSelection()} isFrozen={false} />,
    );
    const instruction = screen.getByRole("status");
    expect(instruction).toHaveClass("ride-compact-manoeuvre-instruction");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("renders a distinct distance element outside the status role, alongside a direction icon", () => {
    const { container } = render(
      <RidingCompactManoeuvreCue selection={buildSelection()} isFrozen={false} />,
    );
    const distance = container.querySelector(".ride-compact-manoeuvre-distance");
    expect(distance).not.toBeNull();
    expect(distance).not.toHaveAttribute("role");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders without throwing for a legacy non-canonical manoeuvre type", () => {
    render(
      <RidingCompactManoeuvreCue
        selection={buildSelection({
          manoeuvre: {
            distanceFromStartMetres: 500,
            // A raw provider code predating the canonical ManoeuvreType
            // vocabulary — genericManoeuvreLabel's own `default` branch
            // must resolve it, not throw.
            type: "7" as unknown as NextManoeuvreSelection["manoeuvre"]["type"],
          },
        })}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Continue on the route")).toBeInTheDocument();
  });
});
