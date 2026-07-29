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
export async function installLocalMapStyle(page: Page): Promise<LocalMapStyleHandle> {
  const unexpectedOpenFreeMapRequests: string[] = [];

  await page.route(OPENFREEMAP_HOST_GLOB, async (route) => {
    const requestUrl = route.request().url();
    if (isRecognisedLibertyStyleRequest(requestUrl)) {
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
