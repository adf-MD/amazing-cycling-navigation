const MAX_SANITISED_LENGTH = 200;

/** Browsers only ever produce a small, fixed vocabulary of messages for a
 * pre-response fetch rejection. Checked case-insensitively, by exact
 * match — a prefix or substring match would let unexpected, unvetted text
 * through. */
const KNOWN_SAFE_FETCH_ERROR_MESSAGES = new Set([
  "failed to fetch",
  "load failed",
  "networkerror when attempting to fetch resource.",
  "the internet connection appears to be offline.",
  "network request failed",
]);

/** Strips substrings that must never appear in a persisted or copied
 * diagnostic: an exact match of the caller's own API key, any URL's query
 * string or fragment, and coordinate-shaped decimal numbers. Defence in
 * depth — the allowlist gate in sanitiseTransportErrorMessage means there
 * should rarely be anything left to redact by the time this runs on a
 * genuine browser error message — so this is exported and tested
 * independently to prove the redaction itself is correct. */
export function redactSensitiveSubstrings(
  text: string,
  apiKey: string | undefined,
): string {
  let result = text;
  if (apiKey) {
    result = result.split(apiKey).join("[redacted]");
  }
  result = result.replace(/https?:\/\/\S+/gi, (url) => url.split(/[?#]/)[0] ?? url);
  result = result.replace(/-?\d{1,3}\.\d{3,}/g, "[redacted]");
  return result;
}

/**
 * A pre-response fetch rejection's raw `Error.message` cannot be assumed
 * safe merely because it comes from the browser rather than the provider —
 * unlike a fixed `Error.name` class name, message text varies by browser
 * and engine version, and there is no guarantee a future or unusual
 * runtime never interpolates request details into it. Rather than trying
 * to scrub arbitrary text after the fact, this only ever returns one of a
 * small, known-fixed vocabulary of generic browser strings; anything else
 * is withheld entirely (returns undefined), so the caller can fall back to
 * showing the error's name alone.
 */
export function sanitiseTransportErrorMessage(
  rawMessage: string,
  apiKey: string | undefined,
): string | undefined {
  const trimmed = rawMessage.trim();
  if (!KNOWN_SAFE_FETCH_ERROR_MESSAGES.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return redactSensitiveSubstrings(trimmed, apiKey).slice(0, MAX_SANITISED_LENGTH);
}
