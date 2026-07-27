/** Removes only leading/trailing whitespace (which includes a trailing
 * LF/CRLF — the most common clipboard artefact) — never touches internal
 * characters. */
export function normaliseApiKey(raw: string): string {
  return raw.trim();
}

/** HTTP header values may not contain NUL, or any other C0 control
 * character, or DEL — matching what a real `Headers`/`Request`
 * construction rejects. Does not attempt to judge whether the key is
 * authentic, only whether it is syntactically usable in a header. */
export function isValidHttpHeaderValue(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- intentional: exactly the bytes an HTTP header value must never contain.
  return value.length > 0 && !/[\x00-\x1F\x7F]/.test(value);
}
