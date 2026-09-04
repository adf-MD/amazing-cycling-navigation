import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { installLocalMapStyle } from "./support/localMapStyle.ts";
import { readActiveRideStateRow } from "./support/rideStateDb.ts";

// Backlog item 104 follow-up. ridingOutAndBackTurnaround.spec.ts already
// covers a long coincident out-and-back walked in 100 m steps, and passes
// on the deployed 0.4.8. This spec covers what that one structurally
// cannot: a SHORT eight-point route walked across its turnaround in ~3 m
// steps — each step smaller than PROGRESS_EPSILON_METRES, which is the
// cadence at which 0.4.8 failed its first physical acceptance (committed
// progress ran backwards while the card still read "On route", and the
// trusted finish cue climbed from 150 m to 180 m over a minute).
//
// The route carries valid ACN navigation metadata, so the rendered trusted
// cue — the value the field report actually showed regressing — is
// asserted here rather than inferred.
//
// The two specs are complementary; neither replaces the other.

const ROUTE_LAT = 51.5;
const ROUTE_START_LON = -0.12;
// Metres per degree of longitude at latitude 51.5 — the same conversion
// factor ridingOutAndBackTurnaround.spec.ts and ridingFinishAndEnd.spec.ts
// already use, reused rather than re-derived.
const METRES_PER_DEGREE_LON = 1000 / 0.0144303623099218;
const METRES_PER_DEGREE_LAT = 111_132;

function lonAtMetres(eastMetres: number): number {
  return ROUTE_START_LON + eastMetres / METRES_PER_DEGREE_LON;
}
function latAtMetres(northMetres: number): number {
  return ROUTE_LAT + northMetres / METRES_PER_DEGREE_LAT;
}

/** The mirrored leg's shared endpoint, used TWICE by value below so the
 * outbound and return legs are a byte-for-byte exact retrace rather than
 * two nearly identical ones — the property that makes both occurrences
 * genuinely tie. Deliberately reached from a diagonal approach segment so
 * the approach is not collinear with the mirrored leg. */
const MIRROR_END: readonly [number, number] = [lonAtMetres(30.7), latAtMetres(83.7)];

/**
 * Eight points, under 400 m in total: an east-then-north approach, a ~1 m
 * diagonal into the mirrored leg, 110 m due east to the turnaround, the
 * identical 110 m back, then a distinct northward finish exit. Under
 * 400 m the projection window always spans the whole route, so nothing
 * here can be a clipped-window whole-route reacquire in disguise.
 */
const ROUTE_POINTS: readonly (readonly [number, number])[] = [
  [lonAtMetres(0), latAtMetres(0)],
  [lonAtMetres(30), latAtMetres(0)],
  [lonAtMetres(30), latAtMetres(8)],
  [lonAtMetres(30), latAtMetres(83)],
  MIRROR_END,
  [lonAtMetres(140.7), latAtMetres(83.7)],
  MIRROR_END,
  [lonAtMetres(30.7), latAtMetres(122.7)],
];

const EARTH_RADIUS_METRES = 6_371_008.8;

/** Mirrors src/navigation/distance.ts's haversine. A deliberate local
 * copy, not a shared import: e2e specs never import application source
 * (see rideStateDb.ts's own note on the same boundary), and this is only
 * used to place fixes and to label manoeuvre distances — the app always
 * recomputes its own canonical distances from the parsed geometry. */
function haversineMetres(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const halfDeltaLat = toRadians(b[1] - a[1]) / 2;
  const halfDeltaLon = toRadians(b[0] - a[0]) / 2;
  const h =
    Math.sin(halfDeltaLat) ** 2 +
    Math.cos(toRadians(a[1])) * Math.cos(toRadians(b[1])) * Math.sin(halfDeltaLon) ** 2;
  return EARTH_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const CUMULATIVE_DISTANCES_METRES: number[] = [];
for (let index = 0; index < ROUTE_POINTS.length; index += 1) {
  CUMULATIVE_DISTANCES_METRES.push(
    index === 0
      ? 0
      : CUMULATIVE_DISTANCES_METRES[index - 1] +
          haversineMetres(ROUTE_POINTS[index - 1], ROUTE_POINTS[index]),
  );
}

const TURNAROUND_INDEX = 5;
const TURNAROUND_DISTANCE_METRES = CUMULATIVE_DISTANCES_METRES[TURNAROUND_INDEX];
const TOTAL_DISTANCE_METRES =
  CUMULATIVE_DISTANCES_METRES[CUMULATIVE_DISTANCES_METRES.length - 1];

/** Linear interpolation along the route, in route-distance terms. */
function coordinateAtDistance(targetMetres: number): readonly [number, number] {
  for (let i = 0; i < ROUTE_POINTS.length - 1; i += 1) {
    const a = CUMULATIVE_DISTANCES_METRES[i];
    const b = CUMULATIVE_DISTANCES_METRES[i + 1];
    const from = ROUTE_POINTS[i];
    const to = ROUTE_POINTS[i + 1];
    if (targetMetres >= a && targetMetres <= b) {
      const fraction = b === a ? 0 : (targetMetres - a) / (b - a);
      return [
        from[0] + fraction * (to[0] - from[0]),
        from[1] + fraction * (to[1] - from[1]),
      ];
    }
  }
  return ROUTE_POINTS[ROUTE_POINTS.length - 1];
}

/** Mirrors src/gpx/geometryDigest.ts's canonicalisation and digest — the
 * same deliberate local-copy boundary as haversineMetres above. The
 * `String(x)` stringification must match the trkpt attribute text exactly,
 * which is why both are produced from the same numbers below. */
function geometryDigestHex(): string {
  const canonical = ROUTE_POINTS.map(
    ([longitude, latitude]) => `${String(longitude)},${String(latitude)}`,
  ).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

const ACN_NAMESPACE =
  "https://adf-md.github.io/amazing-cycling-navigation/gpx-extensions/v1";

function buildShortTurnaroundGpx(): string {
  const trackPoints = ROUTE_POINTS.map(
    ([longitude, latitude]) =>
      `      <trkpt lat="${String(latitude)}" lon="${String(longitude)}"><ele>12</ele></trkpt>`,
  ).join("\n");

  const manoeuvre = (index: number, type: string, instruction?: string): string => {
    const distance = String(CUMULATIVE_DISTANCES_METRES[index]);
    const body =
      instruction === undefined
        ? "/>"
        : `><acn:instruction>${instruction}</acn:instruction></acn:manoeuvre>`;
    return `<acn:manoeuvre trackPointIndex="${String(index)}" distanceMetres="${distance}" type="${type}"${body}`;
  };

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:acn="${ACN_NAMESPACE}" version="1.1" creator="acn-e2e-fixtures">
  <trk>
    <name>Short turnaround walking test route</name>
    <extensions><acn:navigation version="1" pointCount="${String(ROUTE_POINTS.length)}" geometrySha256="${geometryDigestHex()}">${manoeuvre(0, "start", "Head east on the test approach")}${manoeuvre(2, "left", "Turn left onto the test approach")}${manoeuvre(TURNAROUND_INDEX, "waypoint")}${manoeuvre(ROUTE_POINTS.length - 1, "finish", "Arrive at the test finish")}</acn:navigation></extensions>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

/** Deterministic replacement for a fixed sleep: each fix's own raw
 * coordinate is persisted after every accepted fix, so polling it proves
 * the fix was genuinely applied before the next one is sent. Both
 * components are checked because this route turns through 90 degrees —
 * longitude alone cannot distinguish fixes on the northward approach. */
async function waitForPersistedFix(
  page: Page,
  coordinate: readonly [number, number],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const row = await readActiveRideStateRow(page);
        const lastFix = row?.lastFix as
          { coordinate?: [number, number] } | null | undefined;
        const persisted = lastFix?.coordinate;
        if (!persisted) return null;
        return (
          Math.abs(persisted[0] - coordinate[0]) < 1e-9 &&
          Math.abs(persisted[1] - coordinate[1]) < 1e-9
        );
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function readCommittedDistanceMetres(page: Page): Promise<number> {
  const row = await readActiveRideStateRow(page);
  const value = row?.lastReliableMatchedDistanceFromStartMetres;
  return typeof value === "number" ? value : Number.NaN;
}

test("holds and then advances committed progress across a short turnaround walked in sub-epsilon steps, with the trusted cue never regressing", async ({
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

  // Sanity-check the fixture's own decisive structural properties before
  // relying on them, rather than assuming the arithmetic above.
  expect(ROUTE_POINTS.length).toBe(8);
  expect(TOTAL_DISTANCE_METRES).toBeLessThan(400);
  expect(ROUTE_POINTS[4]).toBe(ROUTE_POINTS[6]);

  const startCoordinate = ROUTE_POINTS[0];
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: startCoordinate[1],
    longitude: startCoordinate[0],
    accuracy: 14,
  });

  const { unexpectedOpenFreeMapRequests } = await installLocalMapStyle(page);

  await page.goto("/");
  await page.getByLabel("Import GPX file").setInputFiles({
    name: "short-turnaround-walking-route.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(buildShortTurnaroundGpx()),
  });

  const routeName = "short-turnaround-walking-route";
  const routeButton = page.getByRole("button", { name: routeName, exact: true });
  await expect(routeButton).toBeVisible();
  await routeButton.click();
  await expect(page.getByRole("heading", { name: routeName })).toBeVisible();

  await page.getByRole("button", { name: "Start riding" }).click();
  await expect(page.getByTestId("map-loading")).toBeHidden({ timeout: 15_000 });

  async function sendFixAtDistance(distanceMetres: number): Promise<void> {
    const coordinate = coordinateAtDistance(distanceMetres);
    await context.setGeolocation({
      latitude: coordinate[1],
      longitude: coordinate[0],
      accuracy: 14,
    });
    await waitForPersistedFix(page, coordinate);
  }

  // Outbound, in ordinary steps, up to the turnaround.
  for (const distance of [40, 90, TURNAROUND_DISTANCE_METRES - 40]) {
    await sendFixAtDistance(distance);
  }
  await expect(page.getByText("On route")).toBeVisible();
  await sendFixAtDistance(TURNAROUND_DISTANCE_METRES);

  // The trusted finish cue at the turnaround — the same ~150 m reading the
  // field report showed immediately before progress began running
  // backwards. Rounded to the nearest 10 m by formatManoeuvreDistance.
  const cueAtTurnaroundMetres = TOTAL_DISTANCE_METRES - TURNAROUND_DISTANCE_METRES;
  const expectedCueAtTurnaround = `${String(Math.round(cueAtTurnaroundMetres / 10) * 10)} m`;
  await expect(page.getByText(expectedCueAtTurnaround, { exact: true })).toBeVisible();

  const committedAtTurnaround = await readCommittedDistanceMetres(page);
  expect(committedAtTurnaround).toBeGreaterThan(TURNAROUND_DISTANCE_METRES - 15);

  // Walk back along the exactly retraced leg in ~3 m steps — every one of
  // them smaller than PROGRESS_EPSILON_METRES. Committed progress is read
  // after EVERY fix, so a single backwards step anywhere fails the test.
  const RETURN_STEP_METRES = 3;
  let previousCommittedMetres = committedAtTurnaround;
  let advancedPastTurnaround = false;

  for (
    let beyondTurn = RETURN_STEP_METRES;
    beyondTurn <= 45;
    beyondTurn += RETURN_STEP_METRES
  ) {
    await sendFixAtDistance(TURNAROUND_DISTANCE_METRES + beyondTurn);
    const committed = await readCommittedDistanceMetres(page);
    expect(committed).toBeGreaterThanOrEqual(previousCommittedMetres - 1e-6);
    previousCommittedMetres = committed;
    if (committed > TURNAROUND_DISTANCE_METRES + 1) advancedPastTurnaround = true;
  }

  // Holding for ever at the turnaround is not sufficient: progress must
  // genuinely transfer onto the return leg and keep going.
  expect(advancedPastTurnaround).toBe(true);
  expect(previousCommittedMetres).toBeGreaterThan(TURNAROUND_DISTANCE_METRES + 30);

  // ...and the rendered trusted cue has come DOWN from its turnaround
  // value, never up as it did in the field.
  const expectedCueAfterReturn = `${String(Math.round((TOTAL_DISTANCE_METRES - previousCommittedMetres) / 10) * 10)} m`;
  await expect(page.getByText(expectedCueAfterReturn, { exact: true })).toBeVisible();
  expect(Number.parseInt(expectedCueAfterReturn, 10)).toBeLessThan(
    Number.parseInt(expectedCueAtTurnaround, 10),
  );

  await expect(page.getByText("On route")).toBeVisible();

  expect(unexpectedOpenFreeMapRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
