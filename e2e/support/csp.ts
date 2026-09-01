import type { Page } from "@playwright/test";

/**
 * Parses a Content-Security-Policy header/meta value into a directive name
 * -> source-token array map. A pure function of the string alone, with no
 * Page dependency, so it can be exercised directly without a browser — see
 * csp.spec.ts.
 *
 * Directive names are lower-cased (CSP directive names are case-insensitive
 * per CSP3); source tokens are kept exactly as written, in an array rather
 * than a Set, so a genuinely duplicated token within one directive (an
 * authoring bug) survives for a caller's own comparison to catch, instead
 * of being silently absorbed by Set deduplication.
 *
 * Throws if the same directive name appears twice in one policy string —
 * CSP's own "first occurrence wins" semantics would otherwise hide a real
 * authoring mistake rather than surface it.
 */
export function parseCspDirectives(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  const segments = policy
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    const [rawName, ...sources] = segment.split(/\s+/);
    const name = rawName.toLowerCase();
    if (directives.has(name)) {
      throw new Error(`CSP policy string repeats the "${name}" directive`);
    }
    directives.set(name, sources);
  }

  return directives;
}

export interface CspMetaTag {
  readonly httpEquiv: string;
  readonly content: string;
}

/**
 * Reads every <meta> element on the current page whose http-equiv
 * (compared case-insensitively) is "content-security-policy". A healthy
 * page has exactly one; zero means the policy is missing, more than one
 * means it was accidentally duplicated — callers should assert the count
 * explicitly before parsing any one tag's content.
 */
export async function readCspMetaTags(page: Page): Promise<CspMetaTag[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("meta"))
      .filter((meta) => meta.httpEquiv.toLowerCase() === "content-security-policy")
      .map((meta) => ({ httpEquiv: meta.httpEquiv, content: meta.content })),
  );
}

export interface CspViolationRecord {
  readonly effectiveDirective: string;
  readonly violatedDirective: string;
  readonly blockedURI: string;
  readonly disposition: string;
  readonly documentURI: string;
}

export interface CspViolationHandle {
  /** Every securitypolicyviolation event observed on this page since
   * installCspViolationListener was called, across every navigation and
   * reload for the page's whole lifetime. Backed by a Node-side array
   * (via page.exposeBinding, not a window-global) specifically so it
   * survives page.reload() — a window-global would be silently reset by
   * addInitScript re-running on each reload, which would hide a
   * violation produced by, e.g., androidOfflineAppShell.spec.ts's two
   * reloads. Never shared across pages/tests, so this stays safe under
   * Playwright's fullyParallel. */
  readonly violations: readonly CspViolationRecord[];
}

declare global {
  interface Window {
    /** Installed by installCspViolationListener's page.exposeBinding
     * call; not present outside a page that has called it. */
    __acnReportCspViolation?: (record: CspViolationRecord) => void;
    /** Set by attemptInlineScriptProbe's own injected script, only if
     * script-src permits it to run; not present otherwise. */
    __acnCspProbeExecuted?: boolean;
  }
}

/**
 * Registers a securitypolicyviolation collector before any page script
 * runs. Must be called before page.goto() — page.addInitScript only
 * affects navigations that start after it's registered.
 *
 * The exposeBinding round-trip from the browser back to Node is an async
 * IPC hop, not guaranteed complete the instant a page.evaluate() call
 * that triggered a violation resolves. Callers must never read
 * `violations` immediately after provoking one — poll first:
 *
 *   await expect.poll(() => handle.violations.length, { timeout: 5_000 })
 *     .toBeGreaterThan(0);
 *
 * then assert the exact recorded shape. This proves both that the
 * expected violation arrived and that no unexplained extra violation
 * came with it.
 */
export async function installCspViolationListener(
  page: Page,
): Promise<CspViolationHandle> {
  const violations: CspViolationRecord[] = [];

  await page.exposeBinding(
    "__acnReportCspViolation",
    (_source, record: CspViolationRecord) => {
      violations.push(record);
    },
  );

  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__acnReportCspViolation?.({
        effectiveDirective: event.effectiveDirective,
        violatedDirective: event.violatedDirective,
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        documentURI: event.documentURI,
      });
    });
  });

  return { violations };
}

/**
 * Attempts to run a forbidden inline script: creates a <script> element
 * with textContent (never src) setting a page-local sentinel, appends it
 * to document.head, and reports whether the sentinel actually ran.
 * Insertion into the DOM always succeeds — CSP's script-src blocks
 * execution, not element insertion — so this never throws; a blocked
 * policy simply leaves `executed` false.
 *
 * Deliberately reports only the sentinel outcome, never the violation
 * itself — pair this with installCspViolationListener's own handle,
 * polled per its documented contract, to prove both that the probe was
 * blocked and that the browser reported exactly why.
 */
export async function attemptInlineScriptProbe(
  page: Page,
): Promise<{ executed: boolean }> {
  const executed = await page.evaluate(async () => {
    // Deliberately not pre-initialised to `false` here: an explicit
    // literal assignment right before the read below would make TS's
    // control-flow narrowing track the property as always `false`
    // (unaware the appended script, a separate execution, may since
    // have mutated it), flagging the comparison as always-false. Relying
    // on the property's genuinely unset (`undefined`) starting state —
    // true for every fresh page this probe runs against — sidesteps
    // that false narrowing entirely.
    const script = document.createElement("script");
    script.textContent = "window.__acnCspProbeExecuted = true;";
    document.head.appendChild(script);
    // A microtask tick is enough for the sentinel write itself (a
    // same-realm synchronous script execution or a synchronous CSP
    // block) — this is unrelated to, and does not wait for, the
    // separate securitypolicyviolation event's own async delivery to
    // Node, which callers must poll for independently.
    await Promise.resolve();
    return window.__acnCspProbeExecuted === true;
  });
  return { executed };
}

export interface ServiceWorkerRegistrationResult {
  readonly scriptURL: string;
  readonly scope: string;
}

/**
 * Waits for navigator.serviceWorker.ready, bounded by timeoutMs, so a
 * future CSP regression that blocks worker-src fails fast and legibly
 * instead of hanging until Playwright's own much longer global timeout.
 * Resolves null on timeout rather than rejecting.
 */
export async function waitForServiceWorkerRegistration(
  page: Page,
  options: { timeoutMs?: number } = {},
): Promise<ServiceWorkerRegistrationResult | null> {
  const { timeoutMs = 10_000 } = options;
  return page.evaluate(async (timeout) => {
    const readyResult = navigator.serviceWorker.ready.then(
      (registration) =>
        ({
          scriptURL: registration.active?.scriptURL ?? "",
          scope: registration.scope,
        }) satisfies { scriptURL: string; scope: string },
    );
    const timeoutResult = new Promise<null>((resolve) => {
      setTimeout(() => {
        resolve(null);
      }, timeout);
    });
    return Promise.race([readyResult, timeoutResult]);
  }, timeoutMs);
}
