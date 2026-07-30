import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GradientColoursDisclosure } from "./GradientColoursDisclosure.tsx";
import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";

function bands(...values: ClimbGradientBand[]): ReadonlySet<ClimbGradientBand> {
  return new Set(values);
}
function keys(...values: RouteFeatureVisualKey[]): ReadonlySet<RouteFeatureVisualKey> {
  return new Set(values);
}

describe("GradientColoursDisclosure", () => {
  it("renders nothing when both sections would be empty", () => {
    const { container } = render(
      <GradientColoursDisclosure
        presentClimbBands={bands()}
        presentVisualKeys={keys()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default (no open attribute)", () => {
    const { container } = render(
      <GradientColoursDisclosure
        presentClimbBands={bands("gentle-or-descending")}
        presentVisualKeys={keys("category-3")}
      />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("has a visible 'Gradient colours' summary control", () => {
    render(
      <GradientColoursDisclosure
        presentClimbBands={bands("gentle-or-descending")}
        presentVisualKeys={keys()}
      />,
    );
    expect(screen.getByText("Gradient colours")).toBeInTheDocument();
  });

  it("expands via a genuine user interaction on the summary, revealing both sections", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <GradientColoursDisclosure
        presentClimbBands={bands("hard-climb")}
        presentVisualKeys={keys("category-2")}
      />,
    );
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Gradient colours"));

    expect(details?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByRole("list", { name: "Recognised route features legend" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Detailed climb gradient legend" }),
    ).toBeInTheDocument();
  });

  it("renders only the route-features section when there is no detailed local-gradient data yet", () => {
    render(
      <GradientColoursDisclosure
        presentClimbBands={bands()}
        presentVisualKeys={keys("hc")}
      />,
    );
    expect(
      screen.getByRole("list", { name: "Recognised route features legend" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Detailed climb gradient legend" }),
    ).toBeNull();
  });

  it("still shows the route-features section (with just its ordinary-route entry) when there are no recognised route features yet", () => {
    render(
      <GradientColoursDisclosure
        presentClimbBands={bands("gentle-or-descending")}
        presentVisualKeys={keys()}
      />,
    );
    expect(
      screen.getByRole("list", { name: "Detailed climb gradient legend" }),
    ).toBeInTheDocument();
    const featuresList = screen.getByRole("list", {
      name: "Recognised route features legend",
    });
    expect(featuresList.querySelectorAll("li")).toHaveLength(1);
    expect(featuresList.textContent).toContain("Ordinary route");
  });

  it("does not duplicate descent rows in the detailed section — only climb bands appear there", () => {
    render(
      <GradientColoursDisclosure
        presentClimbBands={bands("hard-climb")}
        presentVisualKeys={keys("steep")}
      />,
    );
    const detailList = screen.getByRole("list", {
      name: "Detailed climb gradient legend",
    });
    expect(detailList.textContent).not.toContain("descent");
    expect(screen.getByText(/reuses the same three blues/)).toBeInTheDocument();
  });

  it("includes the required explanatory sentences for both sections", () => {
    render(
      <GradientColoursDisclosure
        presentClimbBands={bands("gentle-or-descending")}
        presentVisualKeys={keys("hc")}
      />,
    );
    expect(
      screen.getByText(
        /Overall climb colours depend on climb length and average gradient\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Detailed colours show local gradient over approximately 100 m within the selected or currently active climb\. Brief flat or descending sections inside a climb are green\./,
      ),
    ).toBeInTheDocument();
  });
});
