import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GradientColoursDisclosure } from "./GradientColoursDisclosure.tsx";
import type { GradientClass } from "../../navigation/gradient.ts";
import type { RouteFeatureVisualKey } from "../../navigation/routeFeaturePalette.ts";

function classes(...values: GradientClass[]): ReadonlySet<GradientClass> {
  return new Set(values);
}
function keys(...values: RouteFeatureVisualKey[]): ReadonlySet<RouteFeatureVisualKey> {
  return new Set(values);
}

describe("GradientColoursDisclosure", () => {
  it("renders nothing when both sections would be empty", () => {
    const { container } = render(
      <GradientColoursDisclosure presentClasses={classes()} presentVisualKeys={keys()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default (no open attribute)", () => {
    const { container } = render(
      <GradientColoursDisclosure
        presentClasses={classes("flat")}
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
        presentClasses={classes("flat")}
        presentVisualKeys={keys()}
      />,
    );
    expect(screen.getByText("Gradient colours")).toBeInTheDocument();
  });

  it("expands via a genuine user interaction on the summary, revealing both sections", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <GradientColoursDisclosure
        presentClasses={classes("hard-climb")}
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
    expect(screen.getByRole("list", { name: "Gradient legend" })).toBeInTheDocument();
  });

  it("renders only the route-features section when there is no detailed local-gradient data yet", () => {
    render(
      <GradientColoursDisclosure
        presentClasses={classes()}
        presentVisualKeys={keys("hc")}
      />,
    );
    expect(
      screen.getByRole("list", { name: "Recognised route features legend" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Gradient legend" })).toBeNull();
  });

  it("still shows the route-features section (with just its ordinary-route entry) when there are no recognised route features yet", () => {
    render(
      <GradientColoursDisclosure
        presentClasses={classes("flat")}
        presentVisualKeys={keys()}
      />,
    );
    expect(screen.getByRole("list", { name: "Gradient legend" })).toBeInTheDocument();
    const featuresList = screen.getByRole("list", {
      name: "Recognised route features legend",
    });
    expect(featuresList.querySelectorAll("li")).toHaveLength(1);
    expect(featuresList.textContent).toContain("Ordinary route");
  });

  it("includes the required explanatory sentences for both sections", () => {
    render(
      <GradientColoursDisclosure
        presentClasses={classes("flat")}
        presentVisualKeys={keys("hc")}
      />,
    );
    expect(
      screen.getByText(
        /Overall climb colours consider both length and average gradient\. Descent colours describe average gradient and are specific to this app\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Detailed colours show local gradient calculated over approximately 100 m\. They appear for the selected or currently active climb or descent\./,
      ),
    ).toBeInTheDocument();
  });
});
