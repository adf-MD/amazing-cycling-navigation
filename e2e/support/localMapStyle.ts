import type { Page } from "@playwright/test";
import type { StyleSpecification } from "maplibre-gl";

/**
 * Broad glob covering every path on the OpenFreeMap tile host — the
 * single page.route() registration both installLocalMapStyle and
 * forceMapStyleFailure use, so no request to this host (style, tile,
 * sprite, glyph, or anything else) can ever reach the real network from
 * a test that installs either. Kept here as the one place this host is
 * named, rather than duplicated per spec file (see tileSource.ts's
 * DEFAULT_TILE_SOURCE for the production style URL this mirrors).
 */
export const OPENFREEMAP_HOST_GLOB = "https://tiles.openfreemap.org/**";

/** The exact style path this suite recognises and fulfils locally —
 * matched on pathname only (see isRecognisedLibertyStyleRequest), so a
 * trailing slash or query string still counts as the same request. */
const LIBERTY_STYLE_PATH = "/styles/liberty";

/**
 * Minimal, fully local style: no sprite, no glyphs, no external source
 * — deliberately similar in shape to MapView.tsx's own FALLBACK_STYLE
 * (same "version 8, empty sources, one background layer" structure,
 * already proven safe there), but a separate literal owned by this
 * test module rather than an import from src/, with its own layer id
 * and colour so it's distinguishable from the app's fallback in a
 * bundle grep.
 */
const LOCAL_LIBERTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "acn-e2e-local-style-background",
      type: "background",
      paint: { "background-color": "#dedede" },
    },
  ],
};

/**
 * True when `requestUrl` is recognised as *the* Liberty style document
 * this suite serves locally — tolerant of a trailing slash or an
 * arbitrary query string, matched on scheme, host and pathname only.
 * False for every other request on the same host (a tile, sprite,
 * glyph, a different style, or anything unrecognised), which callers
 * must treat as unexpected rather than silently fulfilling.
 *
 * A pure function of the URL string alone, with no Page/Route
 * dependency, so it can be exercised directly without a browser — see
 * localMapStyle.spec.ts.
 */
export function isRecognisedLibertyStyleRequest(requestUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "tiles.openfreemap.org") {
    return false;
  }
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return pathname === LIBERTY_STYLE_PATH;
}

export interface LocalMapStyleHandle {
  /** Every request URL seen on the OpenFreeMap host that was NOT the
   * recognised Liberty style path — always empty for a healthy run.
   * Backed by a page-local mutable array that this call's own route
   * handler pushes into; never shared across pages or tests, so this
   * is safe under Playwright's fullyParallel. */
  readonly unexpectedOpenFreeMapRequests: readonly string[];
}

export interface InstallLocalMapStyleOptions {
  /** Delays fulfilling the recognised style request by this many
   * milliseconds — deliberately still deterministic (a real delay, not a
   * hung/unresolved promise), just late. Lets a test independently
   * control whether "Start riding" (or any other action that mounts a
   * map) happens before or after the map style becomes structurally
   * ready, which is otherwise impossible to control since geolocation is
   * always primed before `page.goto` and style fulfilment is otherwise
   * as fast as Playwright's interception machinery allows (see backlog
   * item 66's own investigation). Omitted or 0 preserves the original
   * immediate-fulfil behaviour for every existing caller. */
  styleDelayMs?: number;
}

/**
 * Registers page.route() interception for the OpenFreeMap tile host
 * before any map exists. Call this before `page.goto`, since map
 * construction always happens after in-app navigation — a route
 * registered here persists for the page's whole lifetime, so one call
 * covers every map the test later constructs on this page.
 *
 * The recognised Liberty style request is fulfilled with a minimal,
 * fully local style, reaching MapLibre's normal successful
 * `style.load` path rather than the app's own fallback path. Any other
 * request to the same host is recorded into the returned handle and
 * aborted — never left to reach the real network, and never silently
 * dropped either, so a test can assert on it with a real URL in the
 * failure message.
 *
 * Does not touch OpenRouteService (`https://api.heigit.org/**`) — each
 * test continues to mock that separately.
 *
 * Requests handled by the app's own service worker never reach
 * page.route()'s interception (a documented Playwright limitation), so
 * callers must also add `test.use({ serviceWorkers: "block" })`.
 */
export async function installLocalMapStyle(
  page: Page,
  options: InstallLocalMapStyleOptions = {},
): Promise<LocalMapStyleHandle> {
  const { styleDelayMs = 0 } = options;
  const unexpectedOpenFreeMapRequests: string[] = [];

  await page.route(OPENFREEMAP_HOST_GLOB, async (route) => {
    const requestUrl = route.request().url();
    if (isRecognisedLibertyStyleRequest(requestUrl)) {
      if (styleDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, styleDelayMs));
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(LOCAL_LIBERTY_STYLE),
      });
      return;
    }
    unexpectedOpenFreeMapRequests.push(requestUrl);
    await route.abort("failed");
  });

  return { unexpectedOpenFreeMapRequests };
}

/**
 * Aborts every request to the OpenFreeMap host, so the app's own
 * switchToFallback() path activates deterministically — the opposite of
 * installLocalMapStyle, for tests that deliberately want the FALLBACK
 * style (see directionArrows.spec.ts). A test should call exactly one
 * of these two functions per page, never both.
 */
export async function forceMapStyleFailure(page: Page): Promise<void> {
  await page.route(OPENFREEMAP_HOST_GLOB, async (route) => {
    await route.abort("failed");
  });
}

/** The path prefix this suite recognises as a controllable test tile
 * request — matched on pathname only, like isRecognisedLibertyStyleRequest.
 * Never a real OpenFreeMap path; a fictitious one under the same host so
 * it's covered by the single OPENFREEMAP_HOST_GLOB route registration. */
const TEST_TILE_PATH_PREFIX = "/e2e-test-tiles/";

function isRecognisedTestTileRequest(requestUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "tiles.openfreemap.org") {
    return false;
  }
  return parsed.pathname.startsWith(TEST_TILE_PATH_PREFIX);
}

/**
 * A local style declaring one real, controllable raster tile source —
 * deliberately raster, not vector: MapLibre's error/sourcedata event
 * machinery (see mapAdapter.ts's onError/onSourceData) is entirely
 * source-type-agnostic, so a raster source is exactly as capable of
 * exercising a genuine source-or-tile AJAXError and the sourcedata
 * recovery signal, without needing to fabricate valid MVT protobuf tile
 * bytes for zero behavioural difference in what's being tested (backlog
 * item 67). Unlike LOCAL_LIBERTY_STYLE (sources: {}, so nothing is ever
 * requested after it loads), this style causes MapLibre to actually issue
 * tile requests the returned TileFailureController can fail/succeed.
 */
function buildLocalStyleWithTileSource(): StyleSpecification {
  return {
    version: 8,
    sources: {
      "acn-e2e-test-raster-source": {
        type: "raster",
        tiles: [`https://tiles.openfreemap.org${TEST_TILE_PATH_PREFIX}{z}/{x}/{y}.png`],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "acn-e2e-local-style-background",
        type: "background",
        paint: { "background-color": "#dedede" },
      },
      {
        id: "acn-e2e-test-raster-layer",
        type: "raster",
        source: "acn-e2e-test-raster-source",
      },
    ],
  };
}

/** A minimal, valid 1x1 transparent PNG — enough for a real browser's
 * image decoder to accept a fulfilled tile request without error; pixel
 * content is irrelevant to what this harness tests. */
const TINY_TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export interface TileFailureController {
  /** Subsequent tile requests fail with a network-level abort (a genuine
   * AJAXError, matching a real connectivity failure) until succeedTiles()
   * is called. */
  failTiles: () => void;
  /** Subsequent tile requests succeed with a minimal fixed-colour PNG. */
  succeedTiles: () => void;
  /** Total tile requests observed so far, succeeded or failed — for
   * polling "did a new request genuinely happen" rather than trusting
   * elapsed time. Equal to failedTileRequestCount() + succeededTileRequestCount()
   * at every point; kept for every existing caller that only needs "some
   * request happened" (always true while shouldFail is still false). */
  requestCount: () => number;
  /** Total style-document requests observed so far — one per genuine map
   * (re)creation, regardless of how many individual tile requests (and
   * any browser/MapLibre-internal retries of those, observed directly to
   * occur independently of this app's own retry logic — see backlog item
   * 67's own real-browser verification note) that attach then issues.
   * A far more reliable proxy for "how many times did the app actually
   * recreate the map" than requestCount, which can keep growing for a
   * single recreation for reasons entirely outside the app's control. */
  styleRequestCount: () => number;
  /** Total tile requests that were genuinely aborted (route.abort, a real
   * network-level failure), i.e. requests seen while failTiles() was in
   * effect at interception time. Backlog item 67 follow-up: proves a
   * NEW tile request actually failed, rather than assuming a triggering
   * action (a zoom press, a pan) necessarily produced one — see the two
   * matching real CI failures this counter was added to diagnose and
   * close. Never decreases; a caller wanting "did a fresh failure just
   * happen" must capture a baseline first, as requestCount()'s own
   * existing callers already do. */
  failedTileRequestCount: () => number;
  /** Total tile requests that were genuinely fulfilled (a real 200
   * response), i.e. requests seen while failTiles() was NOT in effect at
   * interception time. The complement of failedTileRequestCount() —
   * together they always sum to requestCount(). */
  succeededTileRequestCount: () => number;
}

/**
 * Registers page.route() interception for the OpenFreeMap tile host,
 * exactly like installLocalMapStyle, but serving a style with one real,
 * controllable raster tile source instead of the sourceless
 * LOCAL_LIBERTY_STYLE — so a test can deterministically fail, then
 * succeed, genuine post-load tile requests (backlog item 67's own
 * source-or-tile AJAXError/recovery scenario), which installLocalMapStyle
 * alone cannot produce since its style has nothing to ever request a tile
 * for. Call this instead of (never alongside) installLocalMapStyle/
 * forceMapStyleFailure. Also requires `test.use({ serviceWorkers: "block" })`,
 * for the same documented reason installLocalMapStyle does.
 */
export async function installLocalMapStyleWithTileSource(
  page: Page,
): Promise<TileFailureController> {
  const style = buildLocalStyleWithTileSource();
  let shouldFail = false;
  let requestCount = 0;
  let styleRequestCount = 0;
  let failedTileRequestCount = 0;
  let succeededTileRequestCount = 0;

  await page.route(OPENFREEMAP_HOST_GLOB, async (route) => {
    const requestUrl = route.request().url();

    if (isRecognisedLibertyStyleRequest(requestUrl)) {
      styleRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(style),
      });
      return;
    }

    if (isRecognisedTestTileRequest(requestUrl)) {
      requestCount += 1;
      if (shouldFail) {
        failedTileRequestCount += 1;
        await route.abort("failed");
      } else {
        succeededTileRequestCount += 1;
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: Buffer.from(TINY_TRANSPARENT_PNG_BASE64, "base64"),
        });
      }
      return;
    }

    await route.abort("failed");
  });

  return {
    failTiles: () => {
      shouldFail = true;
    },
    succeedTiles: () => {
      shouldFail = false;
    },
    requestCount: () => requestCount,
    styleRequestCount: () => styleRequestCount,
    failedTileRequestCount: () => failedTileRequestCount,
    succeededTileRequestCount: () => succeededTileRequestCount,
  };
}

export interface StyleFailureController {
  /** Subsequent style-DOCUMENT requests fail with a network-level abort
   * (a genuine AJAXError, matching a real offline/unreachable style host)
   * until succeedStyle() is called. Drives MapView's own
   * onError("style-request-or-parse")/switchToFallback() path exactly as
   * a real offline-first load would. */
  failStyle: () => void;
  /** Subsequent style-document requests succeed, fulfilled with the same
   * minimal LOCAL_LIBERTY_STYLE installLocalMapStyle uses. */
  succeedStyle: () => void;
  /** Total style-document requests observed so far, succeeded or failed —
   * one per genuine map (re)creation attempt against the real style URL.
   * Mirrors TileFailureController's own styleRequestCount: a far more
   * reliable proxy for "did the app actually attempt a fresh attach" than
   * elapsed time or banner state alone. */
  styleRequestCount: () => number;
  /** Total style-document requests that were genuinely aborted, i.e. seen
   * while failStyle() was in effect at interception time. Mirrors
   * TileFailureController's failedTileRequestCount — proves a NEW attempt
   * genuinely failed, rather than assuming a triggering action did. */
  failedStyleRequestCount: () => number;
  /** Total style-document requests that were genuinely fulfilled — the
   * complement of failedStyleRequestCount(). */
  succeededStyleRequestCount: () => number;
}

/**
 * Registers page.route() interception for the OpenFreeMap tile host,
 * exactly like installLocalMapStyle, but lets a test toggle the STYLE
 * DOCUMENT itself between failing and succeeding within one test.
 * Neither installLocalMapStyle (always succeeds) nor forceMapStyleFailure
 * (fails permanently, no recovery toggle) can express the offline-first
 * sequence backlog item 94 needs to reproduce: the style fails once
 * (offline), the app's own fallback activates, then later the ORIGINAL
 * style succeeds after a retry/reconnect. installLocalMapStyleWithTileSource
 * is the nearest existing precedent but only ever toggles post-load TILE
 * requests, never the style document itself (its own style always
 * succeeds) — this controller is the style-document-level analogue.
 *
 * Call this instead of (never alongside) installLocalMapStyle/
 * forceMapStyleFailure/installLocalMapStyleWithTileSource. Also requires
 * `test.use({ serviceWorkers: "block" })`, for the same documented reason
 * installLocalMapStyle does. The served style is sourceless
 * (LOCAL_LIBERTY_STYLE), so any other request to this host is unexpected
 * and aborted, exactly like installLocalMapStyle's own policy.
 */
export async function installLocalMapStyleWithFailureControl(
  page: Page,
): Promise<StyleFailureController> {
  let shouldFail = false;
  let styleRequestCount = 0;
  let failedStyleRequestCount = 0;
  let succeededStyleRequestCount = 0;

  await page.route(OPENFREEMAP_HOST_GLOB, async (route) => {
    const requestUrl = route.request().url();

    if (isRecognisedLibertyStyleRequest(requestUrl)) {
      styleRequestCount += 1;
      if (shouldFail) {
        failedStyleRequestCount += 1;
        await route.abort("failed");
        return;
      }
      succeededStyleRequestCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify(LOCAL_LIBERTY_STYLE),
      });
      return;
    }

    await route.abort("failed");
  });

  return {
    failStyle: () => {
      shouldFail = true;
    },
    succeedStyle: () => {
      shouldFail = false;
    },
    styleRequestCount: () => styleRequestCount,
    failedStyleRequestCount: () => failedStyleRequestCount,
    succeededStyleRequestCount: () => succeededStyleRequestCount,
  };
}
