import { expect, test, type Locator, type Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import {
  readActiveRideStateRow,
  readSavedRouteId,
  writeActiveRideStateRow,
} from "./support/rideStateDb.ts";

// Proves CLAUDE.md backlog item 119 in both engines (this file runs under
// the "chromium" and "webkit-smoke" projects): every confirmation is a
// named, described, non-modal dialog whose name and description are its
// own, even with two open at once — the page-level ride-switch prompt a
// rider takes with them when they leave Routes, beside Settings' Delete key
// confirmation — and a pending switch prompt gives way to a newer ride
// choice instead of lingering over the ride the rider has resumed.
//
// Measured on the unchanged 0.4.46 build in both engines: both
// confirmations carried role "alertdialog", aria-modal "true" and
// aria-labelledby="confirm-dialog-title", the id existed twice, and both
// computed their name as the switch prompt's title. After the launcher's
// Resume ride the switch prompt stayed above the immersive riding shell,
// and its End and switch cleared the resumed ride's stored row and stuck
// in "Ending…" with both actions disabled.
//
// No test in this file contacts a live map or routing provider.

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

const SWITCH_TITLE = 'Switch to "Route B"?';
const SWITCH_DESCRIPTION =
  "You have an unfinished ride on another route. It must be ended before this can open — the saved route will remain in your library, but ride progress will be cleared.";
const INLINE_SWITCH_DESCRIPTION =
  '"Route A" is paused. Return to it, or end it and switch to "Route B". Ending it will clear ride progress; the saved route will remain in Routes.';
const DELETE_KEY_TITLE = "Delete OpenRouteService key";
const DELETE_KEY_DESCRIPTION =
  "This removes your saved key from this device. Route planning will be unavailable until you enter a key again. Any routes you have already saved remain fully usable without it.";

const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;

/** A short straight GPX track, independent of any routing provider —
 * duplicated per this repo's no-shared-e2e-helpers-across-specs convention. */
function buildRouteGpx(): string {
  const points = Array.from({ length: 11 }, (_, index) => {
    const lon = -0.1 + (100 * index) / METRES_PER_DEGREE_LON;
    return `      <trkpt lat="51.5" lon="${String(lon)}"><ele>10.0</ele></trkpt>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Confirmation dialogs test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

async function importRoute(page: Page, name: string): Promise<void> {
  await page.getByLabel("Import GPX file").setInputFiles({
    name: `${name}.gpx`,
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildRouteGpx()),
  });
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

function navButton(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Main" })
    .getByRole("button", { name, exact: true });
}

function confirmation(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name, exact: true });
}

async function saveKey(page: Page): Promise<void> {
  await navButton(page, "Settings").click();
  await page.getByLabel("OpenRouteService API key").fill("dummy-e2e-key");
  await page.getByRole("button", { name: "Save on this device" }).click();
  await expect(
    page.getByText(/key saved on this device, not yet verified/i),
  ).toBeVisible();
  await navButton(page, "Routes").click();
}

/** Imports Routes A and B, leaves a paused ride on A in storage, and taps
 * B's card so its switch prompt opens inside that card. */
async function armSwitchToB(
  page: Page,
): Promise<{ routeARow: unknown; routeBId: string }> {
  await importRoute(page, "Route A");
  await importRoute(page, "Route B");
  const routeAId = await readSavedRouteId(page, "Route A");
  const routeBId = await readSavedRouteId(page, "Route B");
  if (!routeAId || !routeBId) throw new Error("expected saved ids for Routes A and B");
  await writeActiveRideStateRow(page, {
    id: "active",
    routeId: routeAId,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  });
  const routeARow = await readActiveRideStateRow(page);
  await page.getByRole("button", { name: "Route B", exact: true }).click();
  await expect(
    page
      .locator(`[data-route-id="${routeBId}"]`)
      .getByRole("dialog", { name: SWITCH_TITLE }),
  ).toBeVisible();
  return { routeARow, routeBId };
}

/** Every id in the document is unique, and every confirmation's
 * aria-labelledby/aria-describedby reference resolves to exactly one
 * element inside that confirmation. */
async function expectIdReferencesIntact(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) {
      found.push(`duplicate id ${id}`);
    }
    for (const dialog of document.querySelectorAll(
      '[role="dialog"],[role="alertdialog"]',
    )) {
      for (const attribute of ["aria-labelledby", "aria-describedby"]) {
        const references = (dialog.getAttribute(attribute) ?? "")
          .split(" ")
          .filter(Boolean);
        if (references.length === 0) found.push(`missing ${attribute}`);
        for (const id of references) {
          const targets = document.querySelectorAll(`[id="${id}"]`);
          if (targets.length !== 1)
            found.push(`${attribute} ${id} has ${String(targets.length)} targets`);
          else if (!dialog.contains(targets.item(0)))
            found.push(`${attribute} ${id} points outside`);
        }
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
}

async function expectNonModalDialog(dialog: Locator): Promise<void> {
  await expect(dialog).toHaveAttribute("role", "dialog");
  await expect(dialog).not.toHaveAttribute("aria-modal");
}

test.describe("Confirmation dialogs (item 119)", () => {
  test("with the switch prompt's fallback and Delete key open together, each is its own named, described, non-modal dialog", async ({
    page,
  }) => {
    await installLocalMapStyle(page);
    await page.goto("/");
    await saveKey(page);
    await armSwitchToB(page);

    const inline = confirmation(page, SWITCH_TITLE);
    await expectNonModalDialog(inline);
    await expect(inline).toHaveAccessibleDescription(INLINE_SWITCH_DESCRIPTION);

    await navButton(page, "Settings").click();
    await page.getByRole("button", { name: "Delete key" }).click();

    await expect(page.locator('[role="dialog"],[role="alertdialog"]')).toHaveCount(2);
    const switchPrompt = confirmation(page, SWITCH_TITLE);
    const deleteKey = confirmation(page, DELETE_KEY_TITLE);
    await expect(switchPrompt).toHaveAccessibleName(SWITCH_TITLE);
    await expect(deleteKey).toHaveAccessibleName(DELETE_KEY_TITLE);
    await expect(switchPrompt).toHaveAccessibleDescription(SWITCH_DESCRIPTION);
    await expect(deleteKey).toHaveAccessibleDescription(DELETE_KEY_DESCRIPTION);
    await expectNonModalDialog(switchPrompt);
    await expectNonModalDialog(deleteKey);
    await expectIdReferencesIntact(page);
    await expect(deleteKey.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  test("Escape closes only the confirmation holding focus, the navigation stays live, the prompt returns inside its card, and End and switch from the fallback opens the new route", async ({
    page,
  }) => {
    await installLocalMapStyle(page);
    await page.goto("/");
    await saveKey(page);
    const { routeBId } = await armSwitchToB(page);
    await navButton(page, "Settings").click();
    const deleteKeyButton = page.getByRole("button", { name: "Delete key" });

    // Escape in Delete key closes it alone and returns focus to Delete key.
    await deleteKeyButton.click();
    await page.keyboard.press("Escape");
    await expect(confirmation(page, DELETE_KEY_TITLE)).toHaveCount(0);
    await expect(confirmation(page, SWITCH_TITLE)).toBeVisible();
    await expect(deleteKeyButton).toBeFocused();

    // Cancel in Delete key does the same.
    await deleteKeyButton.click();
    await confirmation(page, DELETE_KEY_TITLE)
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(confirmation(page, DELETE_KEY_TITLE)).toHaveCount(0);
    await expect(confirmation(page, SWITCH_TITLE)).toBeVisible();
    await expect(deleteKeyButton).toBeFocused();

    // With both open, the navigation still works: Settings' own confirmation
    // leaves with the screen, and the switch returns inside B's card.
    await deleteKeyButton.click();
    await navButton(page, "Routes").click();
    const cardPrompt = page
      .locator(`[data-route-id="${routeBId}"]`)
      .getByRole("dialog", { name: SWITCH_TITLE });
    await expect(cardPrompt).toBeVisible();
    await expect(page.locator('[role="dialog"],[role="alertdialog"]')).toHaveCount(1);

    // Escape in the switch prompt closes it alone.
    await navButton(page, "Settings").click();
    await deleteKeyButton.click();
    await confirmation(page, SWITCH_TITLE)
      .getByRole("button", { name: "Cancel" })
      .focus();
    await page.keyboard.press("Escape");
    await expect(confirmation(page, SWITCH_TITLE)).toHaveCount(0);
    await expect(confirmation(page, DELETE_KEY_TITLE)).toBeVisible();

    // Re-arm, leave Routes, and confirm from the page-level fallback.
    await confirmation(page, DELETE_KEY_TITLE)
      .getByRole("button", { name: "Cancel" })
      .click();
    await navButton(page, "Routes").click();
    await page.getByRole("button", { name: "Route B", exact: true }).click();
    await expect(cardPrompt).toBeVisible();
    await navButton(page, "Settings").click();
    await confirmation(page, SWITCH_TITLE)
      .getByRole("button", { name: "End and switch" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Route B" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start riding" })).toBeVisible();
    await expect.poll(() => readActiveRideStateRow(page)).toBeNull();
    await expect(page.locator('[role="dialog"],[role="alertdialog"]')).toHaveCount(0);
  });

  test("a route card's delete confirmation is a named, described, non-modal dialog that takes focus and gives it back", async ({
    page,
  }) => {
    await installLocalMapStyle(page);
    await page.goto("/");
    await importRoute(page, "Route A");
    const routeAId = await readSavedRouteId(page, "Route A");
    const card = page.locator(`[data-route-id="${String(routeAId)}"]`);
    const deleteButton = card.getByRole("button", { name: "Delete", exact: true });

    await deleteButton.click();
    const dialog = confirmation(page, "Delete “Route A”?");
    await expectNonModalDialog(dialog);
    await expect(dialog).toHaveAccessibleDescription(
      "This route will be permanently deleted from this device. This cannot be undone.",
    );
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expectIdReferencesIntact(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deleteButton).toBeFocused();
  });

  test("resuming the paused ride from the launcher leaves no switch prompt behind and keeps the paused ride", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 51.5, longitude: -0.1 });
    await installLocalMapStyle(page);
    await page.goto("/");
    const { routeARow } = await armSwitchToB(page);

    await navButton(page, "Ride").click();
    await expect(confirmation(page, SWITCH_TITLE)).toBeVisible();
    await page.getByRole("button", { name: "Resume ride" }).first().click();

    await expect(page.getByRole("heading", { level: 1, name: "Route A" })).toBeVisible();
    await expect(page.locator('[role="dialog"],[role="alertdialog"]')).toHaveCount(0);
    const row = await readActiveRideStateRow(page);
    expect(row).toMatchObject({
      routeId: (routeARow as { routeId: string }).routeId,
      startedAt: "2026-01-01T08:00:00.000Z",
    });
  });
});
