import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DescentLocalGradientDisclosure } from "./DescentLocalGradientDisclosure.tsx";
import type { DescentLocalKey } from "../../navigation/routeFeatures.ts";

function keys(...values: DescentLocalKey[]): ReadonlySet<DescentLocalKey> {
  return new Set(values);
}

describe("DescentLocalGradientDisclosure", () => {
  it("renders nothing for an empty key set", () => {
    const { container } = render(
      <DescentLocalGradientDisclosure presentDescentLocalKeys={keys()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default (no open attribute)", () => {
    const { container } = render(
      <DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("has a visible 'Local gradient colours on this descent' summary control", () => {
    render(<DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />);
    expect(
      screen.getByText("Local gradient colours on this descent"),
    ).toBeInTheDocument();
  });

  it("expands via a genuine user interaction on the summary, revealing the compact local legend", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DescentLocalGradientDisclosure presentDescentLocalKeys={keys("moderate")} />,
    );
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Local gradient colours on this descent"));

    expect(details?.hasAttribute("open")).toBe(true);
    expect(
      screen.getByRole("list", { name: "Detailed descent gradient legend" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3% to just below 6%")).toBeInTheDocument();
  });

  it("lists 'neutral' only when it is genuinely present, as swatch plus range only (backlog item 79)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />,
    );
    await user.click(screen.getByText("Local gradient colours on this descent"));
    expect(screen.queryByText("Below 3%")).toBeNull();
    expect(screen.getByText("6% to just below 9%")).toBeInTheDocument();
    expect(screen.queryByText(/Steep descent/)).toBeNull();
    expect(screen.queryByText(/blue/)).toBeNull();

    rerender(
      <DescentLocalGradientDisclosure
        presentDescentLocalKeys={keys("steep", "neutral")}
      />,
    );
    expect(screen.getByText("Below 3%")).toBeInTheDocument();
    expect(screen.queryByText(/Shallower than the descent threshold/)).toBeNull();
  });

  it("no longer shows the explanatory or safety-limitation paragraph — both now live only in Settings (backlog item 79)", async () => {
    const user = userEvent.setup();
    render(<DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />);
    await user.click(screen.getByText("Local gradient colours on this descent"));
    expect(screen.queryByText(/Detailed colours show local gradient/)).toBeNull();
    expect(
      screen.queryByText(/not surface, bends, traffic or other conditions/),
    ).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants beyond the native summary", () => {
    render(<DescentLocalGradientDisclosure presentDescentLocalKeys={keys("steep")} />);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
});
