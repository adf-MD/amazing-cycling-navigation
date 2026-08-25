import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClimbCategoriesDisclosure } from "./ClimbCategoriesDisclosure.tsx";
import type { ClimbCategory } from "../../navigation/routeFeatures.ts";
import { ROUTE_FEATURE_COLOURS } from "../../navigation/routeFeaturePalette.ts";

function categories(...values: ClimbCategory[]): ReadonlySet<ClimbCategory> {
  return new Set(values);
}

describe("ClimbCategoriesDisclosure", () => {
  it("renders nothing for an empty category set", () => {
    const { container } = render(
      <ClimbCategoriesDisclosure presentCategories={categories()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is collapsed by default (no open attribute)", () => {
    const { container } = render(
      <ClimbCategoriesDisclosure presentCategories={categories("category-3")} />,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("has a visible 'Climb categories' summary control", () => {
    render(<ClimbCategoriesDisclosure presentCategories={categories("hc")} />);
    expect(screen.getByText("Climb categories")).toBeInTheDocument();
  });

  it("expands via a genuine user interaction on the summary", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ClimbCategoriesDisclosure presentCategories={categories("category-2")} />,
    );
    const details = container.querySelector("details");
    expect(details?.hasAttribute("open")).toBe(false);

    await user.click(screen.getByText("Climb categories"));

    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("list", { name: "Climb categories" })).toBeInTheDocument();
  });

  it("renders one entry per present category, in a fixed least-to-most-severe order", () => {
    render(
      <ClimbCategoriesDisclosure
        presentCategories={categories("hc", "category-3", "uncategorised")}
      />,
    );
    const list = screen.getByRole("list", { name: "Climb categories" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // uncategorised, then category-3, then hc — the fixed severity order,
    // not the order categories were passed in.
    expect(items[0]?.textContent).toContain("Uncategorised");
    expect(items[1]?.textContent).toContain("Category 3");
    expect(items[2]?.textContent).toContain("HC");
  });

  it("shows Uncategorised and Category 4 as two separate rows despite sharing a colour", () => {
    render(
      <ClimbCategoriesDisclosure
        presentCategories={categories("uncategorised", "category-4")}
      />,
    );
    const list = screen.getByRole("list", { name: "Climb categories" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("Uncategorised");
    expect(items[1]?.textContent).toContain("Category 4");
    expect(ROUTE_FEATURE_COLOURS.uncategorised).toBe(ROUTE_FEATURE_COLOURS["category-4"]);
  });

  it("omits categories that are not present", () => {
    render(<ClimbCategoriesDisclosure presentCategories={categories("category-1")} />);
    expect(screen.queryByText("Uncategorised")).toBeNull();
    expect(screen.queryByText("HC")).toBeNull();
  });

  it("has no live-region role", () => {
    const { container } = render(
      <ClimbCategoriesDisclosure presentCategories={categories("category-2")} />,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("has no focusable descendants beyond the native summary", () => {
    render(
      <ClimbCategoriesDisclosure
        presentCategories={categories("uncategorised", "category-2", "hc")}
      />,
    );
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });

  it("colours each row's swatch with the authoritative route-feature palette", () => {
    render(<ClimbCategoriesDisclosure presentCategories={categories("category-3")} />);
    const swatch = document.querySelector(".gradient-colour-swatch");
    expect(swatch).not.toBeNull();
    expect(swatch).toHaveStyle({ backgroundColor: ROUTE_FEATURE_COLOURS["category-3"] });
    expect(swatch).toHaveStyle({ width: "32px", height: "8px" });
  });

  it("never includes an ordinary-route row, descent text or overview prose", () => {
    render(
      <ClimbCategoriesDisclosure
        presentCategories={categories("uncategorised", "category-1", "hc")}
      />,
    );
    const list = screen.getByRole("list", { name: "Climb categories" });
    expect(list.textContent).not.toContain("Ordinary route");
    expect(list.textContent).not.toContain("descent");
    expect(list.textContent).not.toContain("Descent");
    expect(screen.queryByText(/Overall climb colours depend on/)).toBeNull();
    expect(screen.queryByText(/Detailed colours show local gradient/)).toBeNull();
  });
});
