import { describe, expect, it } from "vitest";
import {
  buildUnroutedPreviewFeatureCollection,
  buildWaypointMarkerSpecs,
  deriveMarkerZoomBand,
  deriveWaypointRoles,
  type PlanningOverlayWaypoint,
} from "./planningLayer.ts";
import type { Coordinate } from "../domain/types.ts";
import { haversineDistanceMetres } from "../navigation/distance.ts";
import { ROUTE_WIDTH_CLOSE_ZOOM, ROUTE_WIDTH_REGIONAL_ZOOM } from "./routeWidthPolicy.ts";

const waypoints: PlanningOverlayWaypoint[] = [
  { id: "a", coordinate: [0, 51] },
  { id: "b", coordinate: [0.001, 51] },
  { id: "c", coordinate: [0.002, 51] },
];

describe("buildWaypointMarkerSpecs", () => {
  it("returns no markers for no waypoints", () => {
    expect(buildWaypointMarkerSpecs([], null)).toEqual([]);
  });

  it("labels a single waypoint as start, ordinal 1", () => {
    const specs = buildWaypointMarkerSpecs([{ id: "a", coordinate: [0, 51] }], null);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({
      id: "a",
      label: "1",
      role: "start",
      selected: false,
      ariaLabel: "Start waypoint 1",
    });
  });

  it("labels first/last as start/finish and the rest ordinary, in list order", () => {
    const specs = buildWaypointMarkerSpecs(waypoints, null);
    expect(specs).toHaveLength(3);
    expect(specs[0]).toMatchObject({ id: "a", label: "1", role: "start" });
    expect(specs[1]).toMatchObject({ id: "b", label: "2", role: "ordinary" });
    expect(specs[2]).toMatchObject({ id: "c", label: "3", role: "finish" });
  });

  it("marks exactly the waypoint at selectedIndex as selected", () => {
    const specs = buildWaypointMarkerSpecs(waypoints, 1);
    expect(specs.map((spec) => spec.selected)).toEqual([false, true, false]);
  });

  it("treats an out-of-range selectedIndex as none selected", () => {
    const specs = buildWaypointMarkerSpecs(waypoints, 99);
    expect(specs.every((spec) => !spec.selected)).toBe(true);
  });

  it("does not merge intermediate waypoints that happen to share a coordinate", () => {
    const withDuplicateMiddle: PlanningOverlayWaypoint[] = [
      { id: "a", coordinate: [0, 51] },
      { id: "b", coordinate: [0.001, 51] },
      { id: "c", coordinate: [0.001, 51] },
      { id: "d", coordinate: [0.002, 51] },
    ];
    const specs = buildWaypointMarkerSpecs(withDuplicateMiddle, null);
    expect(specs.map((spec) => spec.id)).toEqual(["a", "b", "c", "d"]);
    expect(specs.map((spec) => spec.role)).toEqual([
      "start",
      "ordinary",
      "ordinary",
      "finish",
    ]);
  });

  describe("closed loop (first/last within the coincidence threshold)", () => {
    const loopWaypoints: PlanningOverlayWaypoint[] = [
      { id: "a", coordinate: [0, 51] },
      { id: "b", coordinate: [0.001, 51] },
      { id: "c", coordinate: [0.002, 51] },
      // ~1m east of "a" — well within the coincidence threshold, but not
      // byte-identical, matching a manually-dragged near-coincidence.
      { id: "d", coordinate: [0.00001, 51] },
    ];

    it("renders one combined start-finish marker instead of two", () => {
      const specs = buildWaypointMarkerSpecs(loopWaypoints, null);
      expect(specs).toHaveLength(3);
      expect(specs.map((spec) => spec.id)).toEqual(["a", "b", "c"]);
      expect(specs[0]).toMatchObject({
        id: "a",
        label: "1/4",
        role: "start-finish",
        ariaLabel: "Start and finish waypoints 1 and 4",
      });
      expect(specs[1]).toMatchObject({ id: "b", label: "2", role: "ordinary" });
      expect(specs[2]).toMatchObject({ id: "c", label: "3", role: "ordinary" });
    });

    it("selects the combined marker when either the first or final waypoint is selected", () => {
      expect(buildWaypointMarkerSpecs(loopWaypoints, 0)[0]?.selected).toBe(true);
      expect(buildWaypointMarkerSpecs(loopWaypoints, 3)[0]?.selected).toBe(true);
      expect(buildWaypointMarkerSpecs(loopWaypoints, 1)[0]?.selected).toBe(false);
    });

    it("does not merge when first/last are farther apart than the threshold", () => {
      const notQuiteALoop: PlanningOverlayWaypoint[] = [
        { id: "a", coordinate: [0, 51] },
        { id: "b", coordinate: [0.001, 51] },
        // ~50m east of "a" — outside the coincidence threshold.
        { id: "c", coordinate: [0.0007, 51] },
      ];
      const specs = buildWaypointMarkerSpecs(notQuiteALoop, null);
      expect(specs.map((spec) => spec.id)).toEqual(["a", "b", "c"]);
      expect(specs.map((spec) => spec.role)).toEqual(["start", "ordinary", "finish"]);
    });
  });
});

describe("deriveWaypointRoles", () => {
  it("returns no roles for no waypoints", () => {
    expect(deriveWaypointRoles([])).toEqual([]);
  });

  it("treats a single waypoint as start, never start-finish", () => {
    expect(deriveWaypointRoles([[0, 51]])).toEqual(["start"]);
  });

  it("labels first/last as start/finish and the rest ordinary for an open route", () => {
    expect(deriveWaypointRoles(waypoints.map((waypoint) => waypoint.coordinate))).toEqual(
      ["start", "ordinary", "finish"],
    );
  });

  it("gives both endpoints start-finish for an exact closed loop, without collapsing them", () => {
    const loopCoordinates: Coordinate[] = [
      [0, 51],
      [0.001, 51],
      [0.002, 51],
      [0, 51],
    ];
    expect(deriveWaypointRoles(loopCoordinates)).toEqual([
      "start-finish",
      "ordinary",
      "ordinary",
      "start-finish",
    ]);
  });

  it("gives both endpoints start-finish for a near-exact closed loop within the threshold", () => {
    const loopCoordinates: Coordinate[] = [
      [0, 51],
      [0.001, 51],
      [0.002, 51],
      // ~1m east of the first — within the 3m coincidence threshold, but
      // not byte-identical, matching a manually-dragged near-coincidence.
      [0.00001, 51],
    ];
    expect(deriveWaypointRoles(loopCoordinates)).toEqual([
      "start-finish",
      "ordinary",
      "ordinary",
      "start-finish",
    ]);
  });

  it("does not merge when first/last are farther apart than the threshold", () => {
    const notQuiteALoop: Coordinate[] = [
      [0, 51],
      [0.001, 51],
      // ~50m east of the first — outside the coincidence threshold.
      [0.0007, 51],
    ];
    expect(deriveWaypointRoles(notQuiteALoop)).toEqual(["start", "ordinary", "finish"]);
  });

  it("merges just inside the 3m threshold and does not merge just outside it", () => {
    // Self-checked via haversineDistanceMetres rather than a guessed
    // literal degree offset, since a fixed-longitude latitude delta's
    // metre distance is exact regardless of latitude.
    const metresPerDegreeLatitude = 111_320;
    const base: Coordinate = [0, 51];
    const middle: Coordinate = [0.001, 51];
    const justUnder: Coordinate = [0, 51 + 2.9 / metresPerDegreeLatitude];
    const justOver: Coordinate = [0, 51 + 3.1 / metresPerDegreeLatitude];

    expect(haversineDistanceMetres(base, justUnder)).toBeLessThan(3);
    expect(haversineDistanceMetres(base, justOver)).toBeGreaterThan(3);

    expect(deriveWaypointRoles([base, middle, justUnder])).toEqual([
      "start-finish",
      "ordinary",
      "start-finish",
    ]);
    expect(deriveWaypointRoles([base, middle, justOver])).toEqual([
      "start",
      "ordinary",
      "finish",
    ]);
  });

  it("derives roles from current positions, not any stored waypoint identity", () => {
    const coordinateA: Coordinate = [0, 51];
    const coordinateB: Coordinate = [0.001, 51];
    const coordinateC: Coordinate = [0.002, 51];
    // ~1m east of A — within the 3m coincidence threshold.
    const coordinateAPrime: Coordinate = [0.00001, 51];

    expect(
      deriveWaypointRoles([coordinateA, coordinateB, coordinateC, coordinateAPrime]),
    ).toEqual(["start-finish", "ordinary", "ordinary", "start-finish"]);

    // Rotate so the coincident pair (A/A') sits in the middle instead of
    // at the endpoints — the same two coordinates, now no longer
    // detected as a loop, proving the result depends on current
    // position, not on which waypoint they came from.
    expect(
      deriveWaypointRoles([coordinateB, coordinateA, coordinateAPrime, coordinateC]),
    ).toEqual(["start", "ordinary", "ordinary", "finish"]);
  });

  it("agrees with buildWaypointMarkerSpecs's own role assignment for an open route", () => {
    const specs = buildWaypointMarkerSpecs(waypoints, null);
    expect(specs.map((spec) => spec.role)).toEqual(
      deriveWaypointRoles(waypoints.map((waypoint) => waypoint.coordinate)),
    );
  });
});

describe("buildUnroutedPreviewFeatureCollection", () => {
  it("builds a line through the given coordinates", () => {
    const collection = buildUnroutedPreviewFeatureCollection([
      [0, 51],
      [0.001, 51],
      [0.002, 51],
    ]);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [0, 51],
        [0.001, 51],
        [0.002, 51],
      ],
    });
  });

  it("returns no features for fewer than two coordinates", () => {
    expect(buildUnroutedPreviewFeatureCollection([]).features).toEqual([]);
    expect(buildUnroutedPreviewFeatureCollection([[0, 51]]).features).toEqual([]);
  });
});

describe("deriveMarkerZoomBand", () => {
  it("resolves to close at and above ROUTE_WIDTH_CLOSE_ZOOM", () => {
    expect(deriveMarkerZoomBand(ROUTE_WIDTH_CLOSE_ZOOM)).toBe("close");
    expect(deriveMarkerZoomBand(ROUTE_WIDTH_CLOSE_ZOOM + 3)).toBe("close");
  });

  it("resolves to regional just below ROUTE_WIDTH_CLOSE_ZOOM, down to ROUTE_WIDTH_REGIONAL_ZOOM", () => {
    expect(deriveMarkerZoomBand(ROUTE_WIDTH_CLOSE_ZOOM - 0.1)).toBe("regional");
    expect(deriveMarkerZoomBand(ROUTE_WIDTH_REGIONAL_ZOOM)).toBe("regional");
  });

  it("resolves to overview below ROUTE_WIDTH_REGIONAL_ZOOM", () => {
    expect(deriveMarkerZoomBand(ROUTE_WIDTH_REGIONAL_ZOOM - 0.1)).toBe("overview");
    expect(deriveMarkerZoomBand(0)).toBe("overview");
  });

  it("resolves a non-finite zoom (no camera settle yet) to close — today's unchanged full-size appearance", () => {
    expect(deriveMarkerZoomBand(Number.NaN)).toBe("close");
    expect(deriveMarkerZoomBand(Number.POSITIVE_INFINITY)).toBe("close");
  });
});
