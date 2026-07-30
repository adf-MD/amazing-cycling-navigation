import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingNextManoeuvrePanel } from "./RidingNextManoeuvrePanel.tsx";
import type { NextManoeuvreSelection } from "../../navigation/nextManoeuvre.ts";
import type { ManoeuvreType } from "../../domain/types.ts";

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
    remainingDistanceMetres: 420,
    ...overrides,
  };
}

describe("RidingNextManoeuvrePanel", () => {
  it("shows the instruction, icon and formatted distance for an active selection", () => {
    const { container } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection()}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Turn left onto Main Street")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByText(/m$/)).toBeInTheDocument();
  });

  it("prefers provider instruction text over a generic label when present", () => {
    render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({
          manoeuvre: {
            distanceFromStartMetres: 500,
            type: "left",
            instruction: "Turn left onto Main Street",
          },
        })}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Turn left onto Main Street")).toBeInTheDocument();
    expect(screen.queryByText("Turn left")).not.toBeInTheDocument();
  });

  it("falls back to a generic label when the provider gave no instruction text", () => {
    render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({
          manoeuvre: { distanceFromStartMetres: 500, type: "roundabout" },
        })}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Go through the roundabout")).toBeInTheDocument();
  });

  it("shows an unavailable message for a planner route with no usable manoeuvres", () => {
    render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted={false}
        selection={null}
        isFrozen={false}
      />,
    );
    expect(
      screen.getByText("Turn information is unavailable for this route."),
    ).toBeInTheDocument();
  });

  it("shows the imported-GPX message for an untrusted gpx-import route", () => {
    render(
      <RidingNextManoeuvrePanel
        sourceKind="gpx-import"
        isTrusted={false}
        selection={null}
        isFrozen={false}
      />,
    );
    expect(
      screen.getByText(
        "No trusted turn information is available for this imported GPX. Follow the route line on the map.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the active display for a trusted gpx-import route (ACN extension)", () => {
    render(
      <RidingNextManoeuvrePanel
        sourceKind="gpx-import"
        isTrusted
        selection={buildSelection()}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Turn left onto Main Street")).toBeInTheDocument();
  });

  it("renders nothing (end of route) for a trusted gpx-import route once every manoeuvre is passed", () => {
    const { container } = render(
      <RidingNextManoeuvrePanel
        sourceKind="gpx-import"
        isTrusted
        selection={null}
        isFrozen={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing once every manoeuvre has been passed (end of route)", () => {
    const { container } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={null}
        isFrozen={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("appends a stale/off-route qualifier only when frozen", () => {
    const { rerender } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection()}
        isFrozen={false}
      />,
    );
    expect(screen.queryByText(/last known position/)).not.toBeInTheDocument();

    rerender(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection()}
        isFrozen
      />,
    );
    expect(screen.getByText(/last known position/)).toBeInTheDocument();
  });

  it("increases font size and weight as remaining distance falls into nearer urgency bands", () => {
    const { container: normalContainer } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 800 })}
        isFrozen={false}
      />,
    );
    const { container: nearContainer } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 300 })}
        isFrozen={false}
      />,
    );
    const { container: imminentContainer } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 50 })}
        isFrozen={false}
      />,
    );

    const distanceParagraphs = [normalContainer, nearContainer, imminentContainer].map(
      (container) => {
        const paragraph = container.querySelectorAll("p")[1];
        if (!paragraph) throw new Error("expected a distance paragraph");
        return paragraph;
      },
    );
    const fontSizes = distanceParagraphs.map((p) => p.style.fontSize);
    const fontWeights = distanceParagraphs.map((p) => p.style.fontWeight);

    expect(new Set(fontSizes).size).toBe(3);
    expect(new Set(fontWeights).size).toBe(3);
    expect(Number.parseFloat(fontSizes[0] ?? "0")).toBeLessThan(
      Number.parseFloat(fontSizes[1] ?? "0"),
    );
    expect(Number.parseFloat(fontSizes[1] ?? "0")).toBeLessThan(
      Number.parseFloat(fontSizes[2] ?? "0"),
    );
  });

  it("keeps the status text byte-identical across renders with the same manoeuvre/urgency band but a different distance", () => {
    const { container, rerender } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 420 })}
        isFrozen={false}
      />,
    );
    const before = container.querySelector('[role="status"]')?.textContent;

    rerender(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 415 })}
        isFrozen={false}
      />,
    );
    const after = container.querySelector('[role="status"]')?.textContent;

    expect(after).toBe(before);
  });

  it("changes the status text once the urgency band actually changes", () => {
    const { container, rerender } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 420 })}
        isFrozen={false}
      />,
    );
    const before = container.querySelector('[role="status"]')?.textContent;

    rerender(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 420 })}
        isFrozen
      />,
    );
    const after = container.querySelector('[role="status"]')?.textContent;

    expect(after).not.toBe(before);
  });

  it("renders a legacy non-canonical manoeuvre type without throwing", () => {
    const legacyType = "10" as unknown as ManoeuvreType;
    render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({
          manoeuvre: { distanceFromStartMetres: 500, type: legacyType },
        })}
        isFrozen={false}
      />,
    );
    expect(screen.getByText("Continue on the route")).toBeInTheDocument();
  });

  it("never uses role=alert, even at the most urgent band", () => {
    const { container } = render(
      <RidingNextManoeuvrePanel
        sourceKind="planner"
        isTrusted
        selection={buildSelection({ remainingDistanceMetres: 10 })}
        isFrozen={false}
      />,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
