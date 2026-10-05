import { screen } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Planning's compact Edit copy notice (item 141), as the unit tests check
 * it, in English. Each check finds the part it describes:
 *
 * - the indicator, a disclosure button beside the `h1` whose accessible
 *   name is its visible label;
 * - the short qualifier kept visible for estimated and legacy reversed
 *   copies;
 * - the panel with the full explanation, rendered only while open;
 * - the announcement, a stable, visually hidden `role="status"` with
 *   `aria-atomic="true"` that holds the full explanation.
 *
 * A check for absence therefore names the indicator, the qualifier, the
 * panel and the announcement's text one by one, so it can never pass merely
 * because some other element went away.
 */

export const EDIT_COPY_NOTICE_TEXT = {
  exact:
    "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
  estimated:
    "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.",
  reversedExact:
    "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged.",
  reversedEstimated:
    "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.",
} as const;

export type EditCopyVariant = keyof typeof EDIT_COPY_NOTICE_TEXT;

export const EDIT_COPY_NOTICE: Record<
  EditCopyVariant,
  { label: string; qualifier: string | null; full: string }
> = {
  exact: {
    label: "Editing a copy",
    qualifier: null,
    full: EDIT_COPY_NOTICE_TEXT.exact,
  },
  estimated: {
    label: "Editing a copy",
    qualifier: "Waypoints estimated. Recalculation may follow different roads.",
    full: EDIT_COPY_NOTICE_TEXT.estimated,
  },
  reversedExact: {
    label: "Editing a reversed copy",
    qualifier: "Recalculate before saving. One-way restrictions may change the route.",
    full: EDIT_COPY_NOTICE_TEXT.reversedExact,
  },
  reversedEstimated: {
    label: "Editing a reversed copy",
    qualifier:
      "Waypoints estimated. Recalculation may follow different roads, especially around one-way restrictions.",
    full: EDIT_COPY_NOTICE_TEXT.reversedEstimated,
  },
};

/** Either indicator label, matched whole. */
export const EDIT_COPY_INDICATOR_NAME = /^Editing a (reversed )?copy$/;

/** The notice's announcement region: exactly one, atomic and visually
 * hidden, inside Planning's heading block. It exists whether or not the
 * draft is an edit copy. */
export function getEditCopyAnnouncement(): HTMLElement {
  const regions = Array.from(
    document.querySelectorAll<HTMLElement>(".planning-heading [role='status']"),
  );
  expect(regions).toHaveLength(1);
  const region = regions[0];
  if (region === undefined) throw new Error("No edit-copy announcement region.");
  expect(region).toHaveAttribute("aria-atomic", "true");
  expect(region).toHaveClass("visually-hidden");
  return region;
}

/** Asserts the closed notice for one variant: the indicator collapsed and
 * outside the heading, the qualifier or none, no panel, and the full text
 * held once — by the announcement. Returns the indicator. */
export function expectEditCopyNotice(variant: EditCopyVariant): HTMLElement {
  const { label, qualifier, full } = EDIT_COPY_NOTICE[variant];
  const indicator = screen.getByRole("button", { name: label });
  expect(screen.getAllByRole("button", { name: EDIT_COPY_INDICATOR_NAME })).toEqual([
    indicator,
  ]);
  expect(indicator).toHaveAttribute("aria-expanded", "false");
  expect(indicator).not.toHaveAttribute("aria-controls");
  expect(indicator.closest("h1")).toBeNull();
  expect(
    screen.getByRole("heading", { level: 1, name: "Plan a route" }),
  ).toBeInTheDocument();

  const qualifiers = Array.from(document.querySelectorAll(".planning-copy-qualifier"));
  expect(qualifiers.map((element) => element.textContent)).toEqual(
    qualifier === null ? [] : [qualifier],
  );

  const announcement = getEditCopyAnnouncement();
  expect(announcement.textContent).toBe(full);
  expect(screen.getAllByText(full)).toEqual([announcement]);
  return indicator;
}

/** Asserts that no part of the notice is shown or announced. The empty
 * announcement region itself may remain. */
export function expectNoEditCopyNotice(): void {
  expect(screen.queryByRole("button", { name: EDIT_COPY_INDICATOR_NAME })).toBeNull();
  expect(document.querySelector(".planning-copy-qualifier")).toBeNull();
  for (const text of Object.values(EDIT_COPY_NOTICE_TEXT)) {
    expect(screen.queryByText(text)).toBeNull();
  }
  for (const region of document.querySelectorAll(".planning-heading [role='status']")) {
    expect(region.textContent).toBe("");
  }
}
