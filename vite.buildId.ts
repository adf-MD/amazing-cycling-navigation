// Kept in its own tiny, side-effect-free module (rather than inline in
// vite.config.ts) so it can be imported directly by a unit test without
// that test needing to evaluate defineConfig() — see vite.buildId.test.ts.
// Same reason vite.pwa.workbox.ts lives here rather than under src/: this
// only ever runs in Node at Vite config-eval time, never in the shipped
// app bundle.

const FALLBACK_BUILD_ID = "dev";
const SHORT_SHA_LENGTH = 7;

// GitHub Actions' `github.sha` is always a full 40-character lowercase
// SHA-1 hex string. Anything that doesn't match that shape exactly —
// wrong length, any uppercase character, a non-hex character, or a
// missing value — falls back to "dev" rather than being coerced, so a
// malformed value is visibly "dev" instead of silently producing a
// wrong-looking short id.
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Resolves a build identifier from a raw candidate string (normally
 * process.env.APP_BUILD_SHA, read exactly once by vite.config.ts). Takes
 * the candidate as a parameter rather than reading process.env itself, so
 * this stays a pure function usable from Vitest with no Vite/Node
 * environment required, and so it can never see or leak any other
 * environment variable.
 */
export function resolveBuildId(candidate: string | undefined): string {
  if (candidate === undefined) return FALLBACK_BUILD_ID;

  const trimmed = candidate.trim();
  if (!FULL_SHA_PATTERN.test(trimmed)) return FALLBACK_BUILD_ID;

  return trimmed.slice(0, SHORT_SHA_LENGTH);
}
