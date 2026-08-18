// Regression coverage for a real iPhone field defect: on a closed-loop
// route (shared start/finish coordinate), progress could snap from
// near-total back to near-zero right at the finish, because the search
// window used for GPS-fix projection was clipped only on its lower side
// there and a genuinely correct match at the route's own natural, un-
// clipped upper boundary was wrongly rejected as "clipped" too — see
// isClippedAtEdge's own doc comment in projection.ts, and
// projection.test.ts's "closed-loop start/finish coincidence" tests for
// the direct, lower-level proof. Deliberately separate from
// RidingScreen.completionArming.test.tsx (which proves the arming gate
// itself, on an open route) — kept apart per this codebase's own
// established convention of splitting test files by sub-concern. Reuses
// that file's exact scaffolding (buildFakeGeolocationSource, a trimmed
// MapLibreLike stub, act()-wrapped emitFix calls, real Dexie/fake-
// indexeddb via setActiveRideState).
import { beforeEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { CLOSED_LOOP_ROUTE_POINTS } from "../../test/fixtures/closedLoopRoute.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";

const route: PlannedRoute = {
  id: "closed-loop-route-1",
  name: "Square loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: CLOSED_LOOP_ROUTE_POINTS,
  manoeuvres: [],
  distanceMetres: CLOSED_LOOP_ROUTE_POINTS.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 0,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

const INTERIOR_INDEX = 40;
// ~16.7 m past the shared finish coordinate ([0, 51]) continuing in the
// closing segment's own direction of travel — the "rider continued a few
// metres past the finish looking for parking" field scenario, matching
// projection.test.ts's own fixture.
const PAST_FINISH_COORDINATE: Coordinate = [0, 50.99985];

function fixAt(coordinate: Coordinate, timestampMs: number): GeolocationFix {
  return {
    coordinate,
    accuracyMetres: 5,
    timestampMs,
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function createMockMapFactory(): { factory: MapFactory } {
  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: () => undefined,
      onStyleLoaded: () => undefined,
      onError: () => undefined,
      onSourceData: () => undefined,
      addGeoJsonSource: () => undefined,
      setGeoJsonSourceData: () => undefined,
      hasSource: () => false,
      addLineLayer: () => undefined,
      addCircleLayer: () => undefined,
      hasLayer: () => false,
      hasImage: () => false,
      addImage: () => undefined,
      addSymbolLayer: () => undefined,
      fitBounds: () => undefined,
      getCenter: () => [0, 51],
      getZoom: () => 14,
      onUserCameraInteraction: () => undefined,
      onCameraSettled: () => undefined,
      setCamera: () => undefined,
      centreOn: () => undefined,
      changeZoomBy: () => undefined,
      resize: () => undefined,
      onMapTap: () => undefined,
      queryTopWarningFeatureAt: () => null,
      queryTopRouteFeatureAt: () => null,
      setMarkers: () => undefined,
      setDistanceBadges: () => undefined,
      remove: () => undefined,
    };
    return map;
  };
  return { factory };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

describe("RidingScreen closed-loop route completion", () => {
  it("completes a full lap without a false reacquire snapping progress back to the start near the finish", async () => {
    const user = userEvent.setup();
    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start riding" }));

    // Arm via two consecutive interior fixes, comfortably inside the
    // 10%-80% interior-progress band and well outside the finish-area
    // departure radius.
    const interiorPoint = CLOSED_LOOP_ROUTE_POINTS[INTERIOR_INDEX];
    if (!interiorPoint) throw new Error("fixture missing expected point");
    let timestampMs = 1000;
    act(() => {
      fake.watches[0]?.emitFix(fixAt(interiorPoint.coordinate, timestampMs));
    });
    timestampMs += 1000;
    act(() => {
      fake.watches[0]?.emitFix(fixAt(interiorPoint.coordinate, timestampMs));
    });
    expect(screen.queryByText("Route complete")).toBeNull();

    // Walk forward in small route-distance strides (not one large jump —
    // a large jump would itself trigger a legitimate reacquire via the
    // unrelated lateral-distance gate and, since the loop's start/finish
    // coincide, could resolve to the start regardless of whether this fix
    // works, silently failing to exercise the bug at all).
    for (
      let index = INTERIOR_INDEX + 4;
      index < CLOSED_LOOP_ROUTE_POINTS.length;
      index += 4
    ) {
      const routePoint = CLOSED_LOOP_ROUTE_POINTS[index];
      if (!routePoint) throw new Error("fixture missing expected point");
      timestampMs += 1000;
      act(() => {
        fake.watches[0]?.emitFix(fixAt(routePoint.coordinate, timestampMs));
      });
    }
    expect(screen.queryByText("Route complete")).toBeNull();

    // The final two consecutive completion-eligible fixes: the exact
    // shared finish coordinate, then a few metres past it.
    const finishPoint = CLOSED_LOOP_ROUTE_POINTS.at(-1);
    if (!finishPoint) throw new Error("fixture missing expected point");
    timestampMs += 1000;
    act(() => {
      fake.watches[0]?.emitFix(fixAt(finishPoint.coordinate, timestampMs));
    });
    timestampMs += 1000;
    act(() => {
      fake.watches[0]?.emitFix(fixAt(PAST_FINISH_COORDINATE, timestampMs));
    });

    // The key regression proof: under the unfixed projection code this
    // sequence never satisfies the completion detector's remaining-
    // distance gate at all, since the false reacquire repeatedly pushes
    // reliable progress back towards zero.
    expect(await screen.findByText("Route complete")).toBeInTheDocument();
    expect(screen.getByText("Remaining: 0.0 km")).toBeInTheDocument();
  });

  it("resuming a session armed and matched near the finish completes on the next eligible fixes without snapping to the start", async () => {
    const user = userEvent.setup();
    const nearFinishPoint = CLOSED_LOOP_ROUTE_POINTS[79];
    if (!nearFinishPoint) throw new Error("fixture missing expected point");

    await setActiveRideState({
      id: "active",
      routeId: route.id,
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: {
        coordinate: nearFinishPoint.coordinate,
        accuracyMetres: 6,
        timestampMs: 1000,
      },
      lastMatchedPointIndex: 79,
      matchedDistanceFromStartMetres: nearFinishPoint.distanceFromStartMetres,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      lastReliableMatchedPointIndex: 79,
      lastReliableMatchedDistanceFromStartMetres: nearFinishPoint.distanceFromStartMetres,
      completionArmed: true,
    });

    const fake = buildFakeGeolocationSource();
    render(
      <RidingScreen
        route={route}
        geolocationSource={fake.source}
        mapFactory={createMockMapFactory().factory}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Resume riding" }));

    const finishPoint = CLOSED_LOOP_ROUTE_POINTS.at(-1);
    if (!finishPoint) throw new Error("fixture missing expected point");
    act(() => {
      fake.watches[0]?.emitFix(fixAt(finishPoint.coordinate, 2000));
    });
    act(() => {
      fake.watches[0]?.emitFix(fixAt(PAST_FINISH_COORDINATE, 3000));
    });

    expect(await screen.findByText("Route complete")).toBeInTheDocument();
  });
});
