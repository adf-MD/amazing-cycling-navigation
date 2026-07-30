import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ManoeuvreIcon } from "./ManoeuvreIcon.tsx";
import type { ManoeuvreType } from "../../domain/types.ts";

const ALL_CANONICAL_TYPES: ManoeuvreType[] = [
  "start",
  "continue",
  "slight-left",
  "left",
  "sharp-left",
  "slight-right",
  "right",
  "sharp-right",
  "u-turn",
  "roundabout",
  "waypoint",
  "finish",
  "unknown",
];

describe("ManoeuvreIcon", () => {
  it.each(ALL_CANONICAL_TYPES)("renders without throwing for type %s", (type) => {
    const { container } = render(<ManoeuvreIcon type={type} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders a generic fallback glyph for a legacy non-canonical runtime value without throwing", () => {
    // Simulates a route saved before the canonical vocabulary existed,
    // whose Manoeuvre.type is still a raw provider code string at runtime.
    const legacyType = "10" as unknown as ManoeuvreType;
    const { container } = render(<ManoeuvreIcon type={legacyType} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("is aria-hidden, since the caller always renders adjacent accessible text", () => {
    const { container } = render(<ManoeuvreIcon type="left" />);
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("rotates the shared forward-arrow glyph differently for left and right", () => {
    const { container: leftContainer } = render(<ManoeuvreIcon type="left" />);
    const { container: rightContainer } = render(<ManoeuvreIcon type="right" />);
    const leftTransform = leftContainer.querySelector("path")?.getAttribute("transform");
    const rightTransform = rightContainer
      .querySelector("path")
      ?.getAttribute("transform");
    expect(leftTransform).not.toBe(rightTransform);
  });

  it("uses a visually distinct glyph structure for roundabout, u-turn, waypoint and finish", () => {
    const { container: roundabout } = render(<ManoeuvreIcon type="roundabout" />);
    const { container: uTurn } = render(<ManoeuvreIcon type="u-turn" />);
    const { container: waypoint } = render(<ManoeuvreIcon type="waypoint" />);
    const { container: finish } = render(<ManoeuvreIcon type="finish" />);

    expect(roundabout.querySelector("circle")).not.toBeNull();
    expect(uTurn.querySelector("path")).not.toBeNull();
    expect(waypoint.querySelector("circle")).not.toBeNull();
    expect(finish.querySelector("line")).not.toBeNull();
  });

  it("respects a custom sizePx", () => {
    const { container } = render(<ManoeuvreIcon type="continue" sizePx={40} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("40");
    expect(svg?.getAttribute("height")).toBe("40");
  });
});
