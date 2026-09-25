import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingClimbSelector } from "./RidingClimbSelector.tsx";
import type { ClimbFeature } from "../../navigation/routeFeatures.ts";
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";

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

  it("uses an h2 heading for the empty state", () => {
    render(
      <RidingClimbSelector climbs={[]} selectedClimbId={null} onSelectClimb={vi.fn()} />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Recognised climbs" }),
    ).toBeInTheDocument();
  });

  it("uses an h2 heading (not h3) while keeping the select's accessible name", () => {
    render(
      <RidingClimbSelector
        climbs={[climb1, climb2]}
        selectedClimbId={null}
        onSelectClimb={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Recognised climbs" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Recognised climbs" }),
    ).toBeInTheDocument();
  });

  it("lists climbs in route order by category and start, with an All route option first", () => {
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
    expect(options[1]?.textContent).toBe("Category 3 · at 2.0\u00a0km");
    expect(options[2]?.textContent).toBe("Category 2 · at 18.4\u00a0km");
  });

  // Item 113's 25 September 2026 follow-up. iOS shows the closed select's
  // chosen option on one line and never wraps it; the old German label
  // "Anstieg 1 · Kategorie 2 · beginnt bei 12,…" was clipped under the
  // chevrons on the installed iPhone.
  describe("short option labels", () => {
    const ALL_CATEGORIES: ClimbFeature["category"][] = [
      "uncategorised",
      "category-4",
      "category-3",
      "category-2",
      "category-1",
      "hc",
    ];

    function renderIn(language: "en" | "de", climbs: readonly ClimbFeature[]) {
      render(
        <LanguageProvider
          preference={language}
          readLanguages={() => ["en-GB"]}
          documentElement={{ lang: "" }}
        >
          <RidingClimbSelector
            climbs={climbs}
            selectedClimbId={null}
            onSelectClimb={vi.fn()}
          />
        </LanguageProvider>,
      );
      return [...screen.getByRole("combobox").querySelectorAll("option")]
        .slice(1)
        .map((option) => option.textContent);
    }

    it("abbreviates an uncategorised climb and keeps the start distance", () => {
      const uncategorised = buildClimb({
        id: "climb-u",
        startDistanceMetres: 12_300,
        category: "uncategorised",
      });
      expect(renderIn("en", [uncategorised])).toEqual(["uncat. · at 12.3\u00a0km"]);
    });

    it("reads naturally in German", () => {
      const uncategorised = buildClimb({
        id: "climb-u",
        startDistanceMetres: 12_300,
        category: "uncategorised",
      });
      expect(renderIn("de", [climb2, uncategorised])).toEqual([
        "Kategorie 2 · ab km\u00a018,4",
        "Nicht kat. · ab km\u00a012,3",
      ]);
    });

    for (const language of ["en", "de"] as const) {
      it(`stays within a font-independent budget at the worst case (${language})`, () => {
        // Every category at a three-digit start distance. 26 characters is
        // a budget, not a fit: whether it fits is a device question, and
        // the browser probe in e2e/climbSelectorFit.spec.ts measures it.
        const worst = ALL_CATEGORIES.map((category) =>
          buildClimb({ id: category, startDistanceMetres: 999_900, category }),
        );
        const segmenter = new Intl.Segmenter();
        for (const label of renderIn(language, worst)) {
          expect([...segmenter.segment(label)].length, label).toBeLessThanOrEqual(26);
        }
      });
    }
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
    // By value: user-event matches an option by its innerHTML, which
    // serialises the label's non-breaking space as `&nbsp;`.
    await user.selectOptions(select, "climb-2");
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
