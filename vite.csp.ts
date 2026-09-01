import type { Plugin } from "vite";

// Kept in its own tiny, side-effect-free module (rather than inline in
// vite.config.ts) so it can be imported directly by a unit test without
// that test needing to evaluate defineConfig() — see vite.csp.test.ts.
// Same reason vite.buildId.ts lives here rather than under src/: this
// only ever runs in Node at Vite build time, never in the shipped app
// bundle.
//
// Build-only by design (see cspPlugin's own apply: "build"), not a
// static edit to index.html: a real npm run dev experiment (backlog
// item 93's own history entry has the full record) proved the exact
// approved policy leaves the app genuinely broken under `vite dev` —
// Vite's dev-mode CSS-in-JS runtime style injection creates inline
// <style> elements that violate style-src 'self', producing real
// style-src-elem violations and an unstyled app. (The React Fast
// Refresh preamble script itself is unaffected, since Vite's default
// head-prepend placement inserts it before any CSP meta tag baked into
// source index.html, and per CSP3 a meta policy never governs content
// that precedes it — but that finding turned out not to be the
// deciding factor.) Production ships no such runtime style injection
// (CSS is a static <link rel="stylesheet">), so this plugin only ever
// runs for `vite build`, leaving `vite dev` with no CSP tag at all —
// unchanged from today's behaviour — while `vite preview` and the real
// deployment both serve the already-built, policy-bearing HTML.

/** The exact recommended-compatibility policy from backlog item 90's
 * investigation. Single line, semicolon-terminated, matching item 90's
 * own candidate byte-for-byte. */
export const CSP_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "connect-src 'self' https://tiles.openfreemap.org https://api.heigit.org; worker-src 'self'; " +
  "manifest-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none';";

const CHARSET_ANCHOR = '<meta charset="UTF-8" />';

/**
 * Inserts the CSP <meta> tag immediately after the charset declaration,
 * preserving the source file's existing 4-space head indentation. Pure
 * function of the HTML string alone — see vite.csp.test.ts.
 *
 * Throws if the anchor isn't found, rather than silently returning the
 * input unchanged: a security-critical injection step must fail loudly,
 * not no-op, if index.html's charset line is ever reformatted in a way
 * that breaks this literal match.
 */
export function injectCspMeta(html: string): string {
  if (!html.includes(CHARSET_ANCHOR)) {
    throw new Error(
      `injectCspMeta: could not find the charset anchor (${CHARSET_ANCHOR}) in the HTML to inject the Content-Security-Policy meta tag after`,
    );
  }
  const cspTag = `<meta\n      http-equiv="Content-Security-Policy"\n      content="${CSP_POLICY}"\n    />`;
  return html.replace(CHARSET_ANCHOR, `${CHARSET_ANCHOR}\n    ${cspTag}`);
}

/**
 * Injects the approved CSP meta tag into the built HTML only —
 * apply: "build" means this hook never runs under `vite dev`/`vite
 * serve`. `vite preview` and the real GitHub Pages deployment both
 * serve the already-built dist/index.html this hook produces, so both
 * inherit the policy for free with no separate handling.
 */
export function cspPlugin(): Plugin {
  return {
    name: "acn-csp-meta",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => injectCspMeta(html),
    },
  };
}
