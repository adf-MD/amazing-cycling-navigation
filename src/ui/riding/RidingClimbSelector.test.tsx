import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingClimbSelector } from "./RidingClimbSelector.tsx";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";

function buildClimb(overrides: Partial<ClimbFeature>): ClimbFeature {
  return {
    id: "climb-0",
    kind: "climb",
    startDistanceMetres: 0,
    endDistanceMetres: 1000,
    lengthMetres: 1000,
    elevationGainMetres: 60,
    averageGradientPercent: 6,
    maxGradientPercent: 8,
    climbScore: 6000,
    category: "category-4",
    ...overrides,
  };
}

const climb1 = buildClimb({
  id: "climb-1",
  startDistanceMetres: 2000,
  endDistanceMetres: 3000,
  category: "category-3",
});
const climb2 = buildClimb({
  id: "climb-2",
  startDistanceMetres: 18400,
  endDistanceMetres: 21200,
  category: "category-2",
});

describe("RidingClimbSelector", () => {
  it("shows the explanatory empty state and no dropdown when there are no recognised climbs", () => {
    render(
      <RidingClimbSelector climbs={[]} selectedClimbId={null} onSelectClimb={vi.fn()} />,
    );
    expect(
      screen.getByText(
        "No recognised climbs. A recognised climb must be at least 500 m long and average at least 3%.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("lists climbs in route order, numbered from 1, with an All route option first", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId={null}
        onSelectClimb={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Recognised climbs" });
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toBe("All route");
    expect(options[1]?.textContent).toBe("Climb 1 · Category 3 · starts at 2.0 km");
    expect(options[2]?.textContent).toBe("Climb 2 · Category 2 · starts at 18.4 km");
  });

  it("shows the route-level climb count when All route is selected", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId={null}
        onSelectClimb={vi.fn()}
      />,
    );
    expect(screen.getByText("2 recognised climbs on this route")).toBeInTheDocument();
  });

  it("uses the singular form for exactly one climb", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1]}
        selectedClimbId={null}
        onSelectClimb={vi.fn()}
      />,
    );
    expect(screen.getByText("1 recognised climb on this route")).toBeInTheDocument();
  });

  it("hides the route-level count once a climb is selected", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId="climb-1"
        onSelectClimb={vi.fn()}
      />,
    );
    expect(screen.queryByText(/recognised climbs? on this route/)).toBeNull();
  });

  it("calls onSelectClimb with the climb id when a climb is chosen, and null for All route", async () => {
    const user = userEvent.setup();
    const onSelectClimb = vi.fn();
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId={null}
        onSelectClimb={onSelectClimb}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Recognised climbs" });
    await user.selectOptions(select, "Climb 2 · Category 2 · starts at 18.4 km");
    expect(onSelectClimb).toHaveBeenCalledWith("climb-2");

    await user.selectOptions(select, "All route");
    expect(onSelectClimb).toHaveBeenCalledWith(null);
  });

  it("reflects the selected climb id as the select's own value", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId="climb-2"
        onSelectClimb={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Recognised climbs" });
    expect(select).toHaveValue("climb-2");
  });
});
