import { describe, expect, it } from "vitest";
import {
  buildUnroutedPreviewFeatureCollection,
  buildWaypointMarkerSpecs,
  type PlanningOverlayWaypoint,
} from "./planningLayer.ts";

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
