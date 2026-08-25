import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClimbLocalGradientDisclosure } from "./ClimbLocalGradientDisclosure.tsx";
import type { ClimbGradientBand } from "../../navigation/routeFeatures.ts";

function bands(...values: ClimbGradientBand[]): ReadonlySet<ClimbGradientBand> {
  return new Set(values);
}

describe("ClimbLocalGradientDisclosure", () => {
  it("renders nothing for an empty band set", () => {
    const { container } = render(
      <ClimbLocalGradientDisclosure presentClimbBands={bands()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default (no open attribute)", () => {
    const { container } = render(
      <ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("has a visible 'Local gradient colours on this climb' summary control", () => {
    render(<ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />);
    expect(screen.getByText("Local gradient colours on this climb")).toBeInTheDocument();
  });

  it("expands via a genuine user interaction on the summary, revealing the compact band legend", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ClimbLocalGradientDisclosure presentClimbBands={bands("moderate-climb")} />,
    );
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Local gradient colours on this climb"));

    expect(details?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByRole("list", { name: "Detailed climb gradient legend" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3% to just below 6%")).toBeInTheDocument();
  });

  it("lists only the bands actually present, as swatch plus range only — no band name or colour name (backlog item 79)", async () => {
    const user = userEvent.setup();
    render(<ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />);
    await user.click(screen.getByText("Local gradient colours on this climb"));
    expect(screen.getByText("6% to just below 9%")).toBeInTheDocument();
    expect(screen.queryByText(/Extremely steep climb/)).toBeNull();
    expect(screen.queryByText(/Hard climb/)).toBeNull();
    expect(screen.queryByText(/orange/)).toBeNull();
  });

  it("no longer shows the explanatory paragraph — the full explanation now lives only in Settings (backlog item 79)", async () => {
    const user = userEvent.setup();
    render(<ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />);
    await user.click(screen.getByText("Local gradient colours on this climb"));
    expect(screen.queryByText(/Detailed colours show local gradient/)).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants beyond the native summary", () => {
    render(<ClimbLocalGradientDisclosure presentClimbBands={bands("hard-climb")} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
