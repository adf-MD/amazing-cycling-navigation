import { describe, expect, it } from "vitest";
import { mergeAbortSignals } from "./abortSignals.ts";

describe("mergeAbortSignals", () => {
  it("returns the internal signal unchanged when there is no external signal", () => {
    const internal = new AbortController();
    expect(mergeAbortSignals(undefined, internal.signal)).toBe(internal.signal);
  });

  it("is not aborted when neither signal has fired", () => {
    const external = new AbortController();
    const internal = new AbortController();
    expect(mergeAbortSignals(external.signal, internal.signal).aborted).toBe(false);
  });

  it("aborts immediately if the external signal is already aborted", () => {
    const external = new AbortController();
    external.abort();
    const internal = new AbortController();
    expect(mergeAbortSignals(external.signal, internal.signal).aborted).toBe(true);
  });

  it("aborts immediately if the internal signal is already aborted", () => {
    const external = new AbortController();
    const internal = new AbortController();
    internal.abort();
    expect(mergeAbortSignals(external.signal, internal.signal).aborted).toBe(true);
  });

  it("aborts when the external signal fires later", () => {
    const external = new AbortController();
    const internal = new AbortController();
    const merged = mergeAbortSignals(external.signal, internal.signal);

    expect(merged.aborted).toBe(false);
    external.abort();
    expect(merged.aborted).toBe(true);
  });

  it("aborts when the internal signal fires later", () => {
    const external = new AbortController();
    const internal = new AbortController();
    const merged = mergeAbortSignals(external.signal, internal.signal);

    expect(merged.aborted).toBe(false);
    internal.abort();
    expect(merged.aborted).toBe(true);
  });

  it("only registers one abort listener per source signal (no leak across repeated aborts)", () => {
    const external = new AbortController();
    const internal = new AbortController();
    const merged = mergeAbortSignals(external.signal, internal.signal);

    let fireCount = 0;
    merged.addEventListener("abort", () => {
      fireCount += 1;
    });
    external.abort();
    internal.abort();

    expect(fireCount).toBe(1);
  });
});
