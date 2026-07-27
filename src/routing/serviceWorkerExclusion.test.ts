import { describe, expect, it } from "vitest";
import { workboxOptions } from "../../vite.pwa.workbox.ts";

const SAMPLE_ORS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson";

interface RuntimeCachingRule {
  urlPattern: string | RegExp | ((context: { url: URL }) => boolean);
}

/**
 * Proves, from the project's own build configuration (not just a snapshot
 * of today's absence of runtimeCaching), that this service worker cannot
 * intentionally intercept OpenRouteService requests. This is a
 * configuration-level guarantee only: it does not — and cannot — prove
 * that a specific already-installed device's service worker is running
 * this build (see the Diagnostics screen's "active service worker script"
 * field, and the completion report's manual-verification notes, for that).
 */
describe("service worker excludes the OpenRouteService API", () => {
  it("declares no runtimeCaching rules today", () => {
    const runtimeCaching = (workboxOptions as { runtimeCaching?: RuntimeCachingRule[] })
      .runtimeCaching;
    expect(runtimeCaching ?? []).toEqual([]);
  });

  it("would still exclude OpenRouteService even if a runtimeCaching rule were added later", () => {
    const runtimeCaching =
      (workboxOptions as { runtimeCaching?: RuntimeCachingRule[] }).runtimeCaching ?? [];
    const sampleUrl = new URL(SAMPLE_ORS_URL);

    for (const rule of runtimeCaching) {
      const { urlPattern } = rule;
      const matches =
        typeof urlPattern === "function"
          ? urlPattern({ url: sampleUrl })
          : urlPattern instanceof RegExp
            ? urlPattern.test(sampleUrl.href)
            : sampleUrl.href.includes(urlPattern);
      expect(matches).toBe(false);
    }
  });
});
