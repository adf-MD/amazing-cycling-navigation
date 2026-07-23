import { beforeEach, describe, expect, it } from "vitest";
import { clearErrorLog, getRecentErrors, logError } from "./errorLog.ts";
import type { Clock } from "./clock.ts";

const fixedClock: Clock = { now: () => 1_000 };

beforeEach(() => {
  clearErrorLog();
});

describe("errorLog", () => {
  it("records the context, message and timestamp of a logged error", () => {
    logError("gpx-import", new Error("boom"), fixedClock);

    const [entry] = getRecentErrors();
    expect(entry).toEqual({ context: "gpx-import", message: "boom", timestampMs: 1000 });
  });

  it("stores the most recent error first", () => {
    logError("first", new Error("one"), fixedClock);
    logError("second", new Error("two"), fixedClock);

    expect(getRecentErrors().map((entry) => entry.message)).toEqual(["two", "one"]);
  });

  it("redacts coordinate-shaped numbers from the message", () => {
    logError("geolocation", new Error("fix at -1.54321, 53.80123 rejected"), fixedClock);

    expect(getRecentErrors()[0]?.message).toBe(
      "fix at [coordinate], [coordinate] rejected",
    );
  });

  it("redacts long token-shaped strings from the message", () => {
    logError(
      "routing",
      new Error("request failed with key abcdefghij1234567890"),
      fixedClock,
    );

    expect(getRecentErrors()[0]?.message).toBe("request failed with key [token]");
  });

  it("caps the log at 20 entries", () => {
    for (let i = 0; i < 25; i += 1) {
      logError("loop", new Error(`error-${String(i)}`), fixedClock);
    }

    expect(getRecentErrors()).toHaveLength(20);
    expect(getRecentErrors()[0]?.message).toBe("error-24");
  });

  it("handles non-Error values", () => {
    logError("unknown", "plain string failure", fixedClock);

    expect(getRecentErrors()[0]?.message).toBe("plain string failure");
  });
});
