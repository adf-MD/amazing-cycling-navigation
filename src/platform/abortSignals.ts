/** Merges an optional caller signal with another signal (e.g. a request's
 * own timeout) into one combined signal — a small hand-rolled listener
 * merge rather than AbortSignal.any()/.timeout(), so this has no minimum
 * browser-version dependency at all. */
export function mergeAbortSignals(
  external: AbortSignal | undefined,
  internal: AbortSignal,
): AbortSignal {
  if (!external) return internal;
  const controller = new AbortController();
  if (external.aborted || internal.aborted) {
    controller.abort();
    return controller.signal;
  }
  const onAbort = () => {
    controller.abort();
  };
  external.addEventListener("abort", onAbort, { once: true });
  internal.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}
