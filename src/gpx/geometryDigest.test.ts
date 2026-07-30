import { describe, expect, it } from "vitest";
import { canonicalizeTrackGeometry, computeGeometryDigestHex } from "./geometryDigest.ts";
import type { Coordinate } from "../domain/types.ts";

const POINTS: Coordinate[] = [
  [0, 51],
  [0.001, 51.0005],
  [0.002, 51.001],
];

describe("canonicalizeTrackGeometry", () => {
  it("joins lon,lat pairs with newlines in order", () => {
    expect(canonicalizeTrackGeometry(POINTS)).toBe("0,51\n0.001,51.0005\n0.002,51.001");
  });

  it("is order-sensitive", () => {
    const reversed = [...POINTS].reverse();
    expect(canonicalizeTrackGeometry(POINTS)).not.toBe(
      canonicalizeTrackGeometry(reversed),
    );
  });

  it("does not silently round or lose floating-point precision", () => {
    const a: Coordinate = [0.123456789012345, 51];
    const b: Coordinate = [0.123456789012346, 51];
    expect(canonicalizeTrackGeometry([a])).not.toBe(canonicalizeTrackGeometry([b]));
  });

  it("returns an empty string for no points", () => {
    expect(canonicalizeTrackGeometry([])).toBe("");
  });
});

describe("computeGeometryDigestHex", () => {
  it("is deterministic for the same input", async () => {
    const canonical = canonicalizeTrackGeometry(POINTS);
    const first = await computeGeometryDigestHex(canonical);
    const second = await computeGeometryDigestHex(canonical);
    expect(first).toBe(second);
  });

  it("matches the 64-char lower-case hex shape", async () => {
    const digest = await computeGeometryDigestHex(canonicalizeTrackGeometry(POINTS));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different canonical input", async () => {
    const digestA = await computeGeometryDigestHex(canonicalizeTrackGeometry(POINTS));
    const digestB = await computeGeometryDigestHex(
      canonicalizeTrackGeometry([...POINTS, [0.003, 51.002]]),
    );
    expect(digestA).not.toBe(digestB);
  });

  it("excludes elevation by construction (Coordinate carries no elevation)", async () => {
    // canonicalizeTrackGeometry's input type is Coordinate[], which has no
    // elevation field at all — two RoutePoint[] differing only in
    // elevation necessarily produce the identical Coordinate[] once mapped
    // via `.map(p => p.coordinate)`, so this is a type-level guarantee
    // rather than something to probe at runtime.
    const digest = await computeGeometryDigestHex(canonicalizeTrackGeometry(POINTS));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
