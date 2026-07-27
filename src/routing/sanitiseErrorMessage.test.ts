import { describe, expect, it } from "vitest";
import {
  redactSensitiveSubstrings,
  sanitiseTransportErrorMessage,
} from "./sanitiseErrorMessage.ts";

describe("redactSensitiveSubstrings", () => {
  it("removes an exact match of the API key", () => {
    const result = redactSensitiveSubstrings(
      "request failed with key abc123secret in header",
      "abc123secret",
    );
    expect(result).not.toContain("abc123secret");
    expect(result).toContain("[redacted]");
  });

  it("strips a URL's query string and fragment, keeping origin and path", () => {
    const result = redactSensitiveSubstrings(
      "fetch to https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson?api_key=abc123&extra=1#frag failed",
      undefined,
    );
    expect(result).not.toContain("api_key");
    expect(result).not.toContain("frag");
    expect(result).toContain(
      "https://api.heigit.org/openrouteservice/v2/directions/cycling-road/geojson",
    );
  });

  it("redacts coordinate-shaped decimal numbers", () => {
    const result = redactSensitiveSubstrings(
      "no route between -1.54321 and 53.812345",
      undefined,
    );
    expect(result).not.toContain("-1.54321");
    expect(result).not.toContain("53.812345");
    expect(result).toContain("[redacted]");
  });

  it("leaves ordinary text unchanged when nothing sensitive is present", () => {
    expect(redactSensitiveSubstrings("Failed to fetch", undefined)).toBe(
      "Failed to fetch",
    );
  });
});

describe("sanitiseTransportErrorMessage", () => {
  it("passes through a known-safe browser message", () => {
    expect(sanitiseTransportErrorMessage("Failed to fetch", undefined)).toBe(
      "Failed to fetch",
    );
  });

  it("matches known-safe messages case-insensitively", () => {
    expect(sanitiseTransportErrorMessage("FAILED TO FETCH", undefined)).toBe(
      "FAILED TO FETCH",
    );
  });

  it("withholds an unrecognised message entirely", () => {
    expect(
      sanitiseTransportErrorMessage(
        "connection to 8.681495,49.41461 refused using key abc123secret",
        "abc123secret",
      ),
    ).toBeUndefined();
  });

  it("still redacts a known-safe message if it somehow contains the key", () => {
    const result = sanitiseTransportErrorMessage(
      "Failed to fetch abc123secret",
      "abc123secret",
    );
    expect(result).toBeUndefined();
  });

  it("withholds a message padded beyond the allowlisted text, rather than truncating it", () => {
    // The allowlist is exact-match, so padding a known-safe string takes
    // it off the allowlist entirely instead of being truncated down to
    // it — length capping is a defence-in-depth backstop, not the primary
    // safeguard.
    const padded = "Failed to fetch".padEnd(500, "x");
    expect(sanitiseTransportErrorMessage(padded, undefined)).toBeUndefined();
  });
});
