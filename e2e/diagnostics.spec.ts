import { expect, test } from "@playwright/test";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Diagnostics is intentionally allowed to scroll vertically (unlike the
// short Routes screen visualFoundation.spec.ts's own isFullyWithin check
// was written for) — so only horizontal containment is checked here, per
// this slice's own "no horizontal overflow" requirement.
function isHorizontallyWithin(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x && inner.x + inner.width <= outer.x + outer.width;
}

// Narrow iPhone-width portrait viewport — the project's primary target
// device (see CLAUDE.md), matching visualFoundation.spec.ts's own
// convention. This file deliberately never runs "Test routing connection"
// for real: App.tsx gives end-to-end rendering no routingProvider
// injection point, so the no-key state alone (button visibly disabled,
// no network request possible) proves the migrated layout.
test.use({ viewport: { width: 390, height: 844 } });

test("Diagnostics renders its four sections without horizontal scrolling, with the fetch-failure explanation collapsed by default", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(
    page.getByRole("heading", { name: "Diagnostics", level: 1 }),
  ).toBeVisible();

  const hasNoHorizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(hasNoHorizontalScroll).toBe(true);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "System status",
    "Recent errors",
    "Routing diagnostics",
    "Recent map imagery attempts",
  ]);

  const routingRegion = page.getByRole("region", { name: "Routing diagnostics" });
  await expect(
    routingRegion.getByRole("heading", { name: "Recent routing attempts", level: 3 }),
  ).toBeVisible();
  await expect(
    routingRegion.getByRole("heading", { name: "Test routing connection", level: 3 }),
  ).toBeVisible();

  const explanation = routingRegion.getByText(/missing CORS headers/i);
  await expect(explanation).toBeHidden();
  await routingRegion.getByText("Why a fetch can fail before an HTTP response").click();
  await expect(explanation).toBeVisible();

  await expect(
    routingRegion.getByText("No OpenRouteService key configured."),
  ).toBeVisible();
  const testButton = routingRegion.getByRole("button", {
    name: "Test routing connection",
  });
  await expect(testButton).toBeVisible();
  await expect(testButton).toBeDisabled();

  const viewportBox: Box = { x: 0, y: 0, width: 390, height: 844 };
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (!box) throw new Error("expected a bounding box for a visible button");
    expect(isHorizontallyWithin(box, viewportBox)).toBe(true);
  }
});
