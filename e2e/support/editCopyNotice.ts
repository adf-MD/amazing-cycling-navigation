import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Planning's compact Edit copy notice (item 141), as the browser specs
 * check it, in English and German:
 *
 * - the indicator, a disclosure button beside the `h1` whose accessible
 *   name is its visible label;
 * - the short qualifier kept visible for estimated and legacy reversed
 *   copies;
 * - the panel with the full explanation, rendered only while open;
 * - the announcement, a stable, visually hidden `role="status"` with
 *   `aria-atomic="true"` holding the full explanation.
 *
 * Playwright counts the 1×1 visually hidden announcement as visible, so a
 * visibility check on the full text proves nothing about what the rider
 * sees; these helpers assert the indicator and qualifier for that, and the
 * announcement's text separately. Every role query is exact: "Kopie in
 * Bearbeitung" is a substring of "Umgekehrte Kopie in Bearbeitung".
 */

export type EditCopyLanguage = "en" | "de";
export type EditCopyVariant =
  "exact" | "estimated" | "reversedExact" | "reversedEstimated";

interface EditCopyNoticeCopy {
  label: string;
  qualifier: string | null;
  full: string;
}

export const EDIT_COPY_NOTICE: Record<
  EditCopyLanguage,
  Record<EditCopyVariant, EditCopyNoticeCopy>
> = {
  en: {
    exact: {
      label: "Editing a copy",
      qualifier: null,
      full: "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
    },
    estimated: {
      label: "Editing a copy",
      qualifier: "Waypoints estimated. Recalculation may follow different roads.",
      full: "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.",
    },
    reversedExact: {
      label: "Editing a reversed copy",
      qualifier: "Recalculate before saving. One-way restrictions may change the route.",
      full: "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged.",
    },
    reversedEstimated: {
      label: "Editing a reversed copy",
      qualifier:
        "Waypoints estimated. Recalculation may follow different roads, especially around one-way restrictions.",
      full: "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.",
    },
  },
  de: {
    exact: {
      label: "Kopie in Bearbeitung",
      qualifier: null,
      full: "Du bearbeitest jetzt eine Kopie der Route, die auf den ursprünglich gesetzten Wegpunkten basiert. Die gespeicherte Route bleibt unverändert.",
    },
    estimated: {
      label: "Kopie in Bearbeitung",
      qualifier: "Wegpunkte geschätzt. Die Neuberechnung kann andere Straßen wählen.",
      full: "Anhand dieser Route wurden editierbare Wegpunkte näherungsweise ermittelt. Bei der Neuberechnung werden möglicherweise andere Straßen gewählt. Die gespeicherte Route bleibt unverändert.",
    },
    reversedExact: {
      label: "Umgekehrte Kopie in Bearbeitung",
      qualifier:
        "Vor dem Speichern neu berechnen. Einbahnregelungen können die Route ändern.",
      full: "Du bearbeitest jetzt eine Kopie der Route mit umgekehrter Fahrtrichtung. Berechne sie vor dem Speichern neu, da sie wegen Einbahnregelungen von der ursprünglichen Route abweichen kann. Die gespeicherte Route bleibt unverändert.",
    },
    reversedEstimated: {
      label: "Umgekehrte Kopie in Bearbeitung",
      qualifier:
        "Wegpunkte geschätzt. Die Neuberechnung kann andere Straßen wählen, besonders wegen Einbahnregelungen.",
      full: "Die Wegpunkte für die umgekehrte Route wurden aus dem bisherigen Routenverlauf geschätzt. Bei der Neuberechnung kann die Route anders verlaufen, insbesondere wegen Einbahnregelungen. Die gespeicherte Route bleibt unverändert.",
    },
  },
};

const LABELS: Record<EditCopyLanguage, readonly string[]> = {
  en: ["Editing a copy", "Editing a reversed copy"],
  de: ["Kopie in Bearbeitung", "Umgekehrte Kopie in Bearbeitung"],
};

export function editCopyIndicator(
  page: Page,
  variant: EditCopyVariant,
  language: EditCopyLanguage = "en",
): Locator {
  return page.getByRole("button", {
    name: EDIT_COPY_NOTICE[language][variant].label,
    exact: true,
  });
}

/** The announcement region, present on Planning whether or not the draft is
 * an edit copy. */
export function editCopyAnnouncement(page: Page): Locator {
  return page.locator(".planning-heading [role='status'][aria-atomic='true']");
}

/** Asserts the closed notice: the indicator visible and collapsed, the other
 * label absent, the qualifier visible or absent, and the full text held once
 * — by the announcement, not by a visible panel. Returns the indicator. */
export async function expectEditCopyNotice(
  page: Page,
  variant: EditCopyVariant,
  language: EditCopyLanguage = "en",
): Promise<Locator> {
  const { label, qualifier, full } = EDIT_COPY_NOTICE[language][variant];
  const indicator = editCopyIndicator(page, variant, language);
  await expect(indicator).toBeVisible();
  await expect(indicator).toHaveAttribute("aria-expanded", "false");
  await expect(indicator).not.toHaveAttribute("aria-controls");
  for (const other of LABELS[language].filter((candidate) => candidate !== label)) {
    await expect(page.getByRole("button", { name: other, exact: true })).toHaveCount(0);
  }
  const qualifierText = page.locator(".planning-copy-qualifier");
  if (qualifier === null) {
    await expect(qualifierText).toHaveCount(0);
  } else {
    await expect(qualifierText).toHaveText(qualifier);
    await expect(qualifierText).toBeVisible();
  }
  await expect(editCopyAnnouncement(page)).toHaveText(full);
  await expect(page.getByText(full, { exact: true })).toHaveCount(1);
  return indicator;
}

/** Asserts that no part of the notice is shown or announced: no indicator,
 * qualifier, panel or announcement text. The empty region may remain. */
export async function expectNoEditCopyNotice(
  page: Page,
  language: EditCopyLanguage = "en",
): Promise<void> {
  for (const label of LABELS[language]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.locator(".planning-copy-qualifier")).toHaveCount(0);
  for (const { full } of Object.values(EDIT_COPY_NOTICE[language])) {
    await expect(page.getByText(full, { exact: true })).toHaveCount(0);
  }
}
