import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 104: a real iPhone field defect where, on an out-and-back
// route whose outbound and return legs are EXACTLY geometrically
// coincident, canonical route progress never reliably advanced onto the
// return leg as the rider rode home — it could keep re-matching the
// outbound leg's mirror-image point, making displayed remaining distance
// "go back in time". This proves the real, integrated
// geolocation-to-projection-to-status-card path, not just the
// projection.test.ts/rideNavigationCore.test.ts unit-level proof.

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.1;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor ridingFinishAndEnd.spec.ts's own fixture uses, reused here rather
// than re-derived.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const OUTBOUND_LENGTH_METRES = 1000;
const TOTAL_ROUTE_LENGTH_METRES = OUTBOUND_LENGTH_METRES * 2;
const SEGMENT_METRES = 100;

function lonAtMetres(distanceMetres: number): number {
  return ROUTE_START_LON + distanceMetres / METRES_PER_DEGREE_LON;
}

/** An exact out-and-back GPX track: outbound trkpts from 0 to
 * OUTBOUND_LENGTH_METRES, then return trkpts retracing the identical
 * coordinates (via the same lonAtMetres formula) in reverse — a genuine
 * coordinate-for-coordinate coincidence, not merely a geographically close
 * parallel leg. */
function buildCoincidentOutAndBackGpx(): string {
  const outboundDistances = Array.from(
    { length: OUTBOUND_LENGTH_METRES / SEGMENT_METRES + 1 },
    (_, index) => SEGMENT_METRES * index,
  );
  const returnDistances = outboundDistances
    .slice(0, -1)
    .toReversed()
    .map((outboundDistanceMetres) => TOTAL_ROUTE_LENGTH_METRES - outboundDistanceMetres);
  const allDistances = [...outboundDistances, ...returnDistances];

  const points = allDistances
    .map((cumulativeDistanceMetres) => {
      const physicalDistanceMetres =
        cumulativeDistanceMetres <= OUTBOUND_LENGTH_METRES
          ? cumulativeDistanceMetres
          : TOTAL_ROUTE_LENGTH_METRES - cumulativeDistanceMetres;
      return `      <trkpt lat="${String(ROUTE_LAT)}" lon="${String(lonAtMetres(physicalDistanceMetres))}"><ele>10.0</ele></trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="acn-e2e-fixtures" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Out-and-back turnaround test route</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
}

// Deterministic replacement for a fixed sleep across the beyond-turnaround
// excursion: the status text itself doesn't change between the 1st and 2nd
// overshoot fixes (the debounced "Off route" display only appears on the
// 3rd, per CONSECUTIVE_TO_ESCALATE), so each fix's own persisted raw
// coordinate (written after every accepted fix, on-route or not — see
// useRideNavigation.ts's persistence effect) is polled instead, proving
// each fix was genuinely applied before the next is sent.
async function waitForPersistedFixLongitude(
  page: Page,
  longitude: number,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const row = await readActiveRideStateRow(page);
        const lastFix = row?.lastFix as
          { coordinate?: [number, number] } | null | undefined;
        return lastFix?.coordinate?.[0] ?? null;
      },
      { timeout: 10_000 },
    )
    .toBeCloseTo(longitude, 6);
}

test("preserves route progress through an exactly overlapping out-and-back turnaround: outbound decreases, the beyond-turn warning appears honestly, and the return leg advances without reversing", async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: lonAtMetres(0),
    accuracy: 5,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "out-and-back-turnaround-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildCoincidentOutAndBackGpx()),
  });

  const routeName = "out-and-back-turnaround-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  async function setGeolocationAndAwaitRemainingKm(
    outboundDistanceMetres: number,
    remainingKm: string,
  ): Promise<void> {
    await context.setGeolocation({
      latitude: ROUTE_LAT,
      longitude: lonAtMetres(outboundDistanceMetres),
      accuracy: 5,
    });
    await expect(page.getByText(`${remainingKm} km · 0 m ascent`)).toBeVisible();
  }

  // Outbound: remaining distance decreases steadily, several intermediate
  // steps rather than one large jump (a large jump could itself trigger a
  // legitimate reacquire that resolves correctly regardless of whether
  // this item's own fix works, silently failing to exercise it at all).
  await setGeolocationAndAwaitRemainingKm(300, "1.7");
  await expect(page.getByText("On route")).toBeVisible();
  await setGeolocationAndAwaitRemainingKm(600, "1.4");
  await setGeolocationAndAwaitRemainingKm(900, "1.1");

  // Exactly at the turnaround.
  await setGeolocationAndAwaitRemainingKm(OUTBOUND_LENGTH_METRES, "1.0");
  await expect(page.getByText("On route")).toBeVisible();

  // Continue past the turnaround in the original outbound direction — off
  // the route entirely. Three distinct fixes (each awaited via its own
  // persisted-fix postcondition, per waitForPersistedFixLongitude's own
  // comment) are required to satisfy the existing three-fix debounce
  // before "Off route" is displayed; do not expect it after only one.
  const [firstOvershootLon, secondOvershootLon, thirdOvershootLon] = [
    lonAtMetres(OUTBOUND_LENGTH_METRES + 100),
    lonAtMetres(OUTBOUND_LENGTH_METRES + 150),
    lonAtMetres(OUTBOUND_LENGTH_METRES + 200),
  ];

  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: firstOvershootLon,
    accuracy: 5,
  });
  await waitForPersistedFixLongitude(page, firstOvershootLon);
  await expect(page.getByText("On route")).toBeVisible();

  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: secondOvershootLon,
    accuracy: 5,
  });
  await waitForPersistedFixLongitude(page, secondOvershootLon);
  await expect(page.getByText("On route")).toBeVisible();

  await context.setGeolocation({
    latitude: ROUTE_LAT,
    longitude: thirdOvershootLon,
    accuracy: 5,
  });
  await waitForPersistedFixLongitude(page, thirdOvershootLon);
  await expect(page.getByText("Off route")).toBeVisible();
  // Remaining distance stayed frozen at the turnaround's own value
  // throughout the excursion (lastReliableMatch freezes on the first raw
  // off-route fix) — it must not have silently changed to something else.
  await expect(page.getByText("1.0 km · 0 m ascent")).toBeVisible();

  // Turn back for real, following the exactly coincident return leg. Two
  // consecutive on-route fixes are required to de-escalate the debounced
  // warning back to "On route" (CONSECUTIVE_TO_DEESCALATE). The first
  // return-leg fix physically coincides with the earlier outbound
  // approach fix at 900 m (100 m before the turnaround) — the decisive
  // proof that canonical progress transfers onto the LATER (return) leg
  // rather than snapping back to that earlier outbound occurrence.
  //
  // Steps of 100 m each (matching the GPX's own trkpt spacing) rather
  // than one large jump: on this sparse (100 m-spaced) route, a fix
  // landing too close to the far edge of the ±400 m window built around a
  // distant lastMatch can be — correctly, per the pre-existing,
  // route-shape-independent isClippedAtEdge safeguard this item
  // deliberately leaves unmodified (see projection.ts) — distrusted as
  // sitting at a genuinely clipped window edge, triggering a legitimate
  // whole-route reacquire. That reacquire is a different, unmodified code
  // path with its own already-documented, turf-version-sensitive
  // fresh-start tie behaviour (see item 46), not a regression in this
  // item's own windowed-branch fix; walking forward in small steps keeps
  // lastMatch's own window comfortably ahead of each next fix, the same
  // discipline this file's own straight/closed-loop tests already use for
  // an analogous reason.
  await setGeolocationAndAwaitRemainingKm(900, "0.9");
  await setGeolocationAndAwaitRemainingKm(800, "0.8");
  await expect(page.getByText("On route")).toBeVisible();

  // Sustained, continuing advance over further consecutive fixes — not
  // just one blip — proving the return leg progresses honestly rather
  // than merely flickering forward once.
  await setGeolocationAndAwaitRemainingKm(700, "0.7");
  await setGeolocationAndAwaitRemainingKm(600, "0.6");
  await setGeolocationAndAwaitRemainingKm(500, "0.5");
  await setGeolocationAndAwaitRemainingKm(400, "0.4");
  await setGeolocationAndAwaitRemainingKm(300, "0.3");

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
