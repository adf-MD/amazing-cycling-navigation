import { DEFAULT_LANGUAGE_PREFERENCE, type LanguagePreference } from "./language.ts";

/**
 * How long the application will wait for the stored language preference
 * before rendering without it.
 *
 * Backlog item 113. Measured rather than guessed, on the pinned Playwright
 * container, in Chromium and WebKit, opening the application's own
 * IndexedDB and reading one singleton row — worst of twelve repeats:
 *
 * | condition                                   | Chromium | WebKit |
 * | ------------------------------------------- | -------- | ------ |
 * | cold: create, open, get                     |   2.8ms  |   3ms  |
 * | warm: database already exists               |   0.8ms  |   1ms  |
 * | populated: 200 routes x 2000 points         |  18.1ms  |   1ms  |
 * | v4 -> v5 upgrade, 200 dense routes          |   4.7ms  |   1ms  |
 * | v4 -> v5 upgrade, 1000 dense routes         |   5.1ms  |   2ms  |
 *
 * The upgrade path was measured *before* this number was chosen, because
 * it is the one case that could plausibly have approached it. It does
 * not: adding an object store with no upgrade callback never rewrites a
 * row, so it barely moves between 200 and 1000 routes.
 *
 * 250ms is about 14x the worst measured case, comfortably under the band
 * where a delay starts to be noticed, and negligible beside a cold start
 * that is already fetching and parsing the bundle. The headroom is
 * deliberately generous: these are development-machine figures and an
 * installed iPhone was never measured, so a device several times slower
 * still clears it.
 */
export const LANGUAGE_BOOTSTRAP_TIMEOUT_MS = 250;

export interface LanguageBootstrapResult {
  preference: LanguagePreference;
  /** True when the read did not finish in time, or failed outright. */
  timedOut: boolean;
}

export interface LanguageBootstrapOptions {
  timeoutMs?: number;
  /** Injected so the bound can be tested with fake timers. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Reads the stored preference before the first render, bounded so that a
 * blocked, slow or failing IndexedDB can never leave the application
 * blank.
 *
 * Rendering first and correcting afterwards was rejected: it would paint
 * the wrong language, and — worse — declare the wrong `lang` for assistive
 * technology, for as long as the read took.
 *
 * On timeout or failure the caller renders with the device's own
 * resolution, and the owner's live query corrects the interface when the
 * read eventually lands. That residual flash exists only on the slow or
 * failing path, and is stated rather than hidden.
 */
export async function resolveInitialLanguagePreference(
  read: () => Promise<{ language: LanguagePreference }>,
  {
    timeoutMs = LANGUAGE_BOOTSTRAP_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }: LanguageBootstrapOptions = {},
): Promise<LanguageBootstrapResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<LanguageBootstrapResult>((resolve) => {
    timer = setTimeoutFn(() => {
      resolve({ preference: DEFAULT_LANGUAGE_PREFERENCE, timedOut: true });
    }, timeoutMs);
  });

  const stored = read()
    .then((preferences) => ({ preference: preferences.language, timedOut: false }))
    .catch(() => ({
      // A failed read is not a reason to wait out the whole bound: it is
      // already as final an answer as the timeout would be.
      preference: DEFAULT_LANGUAGE_PREFERENCE,
      timedOut: true,
    }));

  try {
    return await Promise.race([stored, timeout]);
  } finally {
    if (timer !== undefined) clearTimeoutFn(timer);
  }
}
