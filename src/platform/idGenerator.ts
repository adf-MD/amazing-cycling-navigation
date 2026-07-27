/** Isolated behind a tiny helper so callers stay testable without relying
 * directly on a global browser API. */
export function generateId(): string {
  return crypto.randomUUID();
}
