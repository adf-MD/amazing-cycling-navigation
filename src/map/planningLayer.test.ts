import { describe, expect, it } from "vitest";
import {
  buildUnroutedPreviewFeatureCollection,
  buildWaypointFeatureCollections,
  type PlanningOverlayWaypoint,
} from "./planningLayer.ts";

const waypoints: PlanningOverlayWaypoint[] = [
  { id: "a", coordinate: [0, 51] },
  { id: "b", coordinate: [0.001, 51] },
  { id: "c", coordinate: [0.002, 51] },
];

describe("buildWaypointFeatureCollections", () => {
  it("puts every waypoint in 'others' and none in 'selected' when nothing is selected", () => {
    const { others, selected } = buildWaypointFeatureCollections(waypoints, null);
    expect(others.features).toHaveLength(3);
    expect(selected.features).toHaveLength(0);
  });

  it("moves exactly the selected waypoint into its own collection", () => {
    const { others, selected } = buildWaypointFeatureCollections(waypoints, 1);
    expect(others.features).toHaveLength(2);
    expect(selected.features).toHaveLength(1);
    expect(selected.features[0]?.properties).toEqual({ id: "b" });
    const otherIds = others.features.map(
      (feature): unknown => (feature.properties as { id: unknown } | null)?.id,
    );
    expect(otherIds).toEqual(["a", "c"]);
  });

  it("is tolerant of an out-of-range selected index (treats it as none selected)", () => {
    const { others, selected } = buildWaypointFeatureCollections(waypoints, 99);
    expect(others.features).toHaveLength(3);
    expect(selected.features).toHaveLength(0);
  });

  it("returns empty collections for no waypoints", () => {
    const { others, selected } = buildWaypointFeatureCollections([], null);
    expect(others.features).toEqual([]);
    expect(selected.features).toEqual([]);
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
