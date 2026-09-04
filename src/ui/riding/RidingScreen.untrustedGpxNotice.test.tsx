// Backlog item 97: proves the untrusted-GPX trust notice's presentation
// episode is correctly anchored to RidingScreen's own idle<->non-idle mount
// boundary, driving the real Start/Resume/Try-again paths (never an internal
// setter). Deliberately separate from RidingScreen.test.tsx and its sibling
// split files (RidingScreen.pause.test.tsx/.mapProfileViews.test.tsx/etc.),
// mirroring this codebase's own established convention and reusing
// .mapProfileViews.test.tsx's own scaffolding shape rather than importing
// from RidingScreen.test.tsx, which exports nothing.
//
// Architecture under test: RidingUntrustedGpxNotice carries no props and no
// externally-supplied "episode" identity. It is rendered by RidingScreen only
// while nav.geolocationStatus !== "idle" for an untrusted gpx-import route,
// placed outside the Map-only .ride-content-area toggle. geolocationStatus
// only ever leaves "idle" on a genuine fresh Start, explicit Resume, or
// cold-recovery resume-intent consumption (all go through handleStart's
// idle-only branch), and the mid-ride "error" -> "watching" Try-again retry
// never passes back through "idle". React's own mount/unmount lifecycle for
// the notice therefore already implements the required episode boundary:
// a fresh mount happens only on a genuine idle -> non-idle transition, and
// the component never unmounts/remounts for GPS fixes, map-imagery
// recovery, Map<->Profile switching or a mid-ride retry. The tests below
// exercise that boundary directly rather than asserting it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingScreen } from "./RidingScreen.tsx";
import { db, type StoredRideState } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import { buildRoutePointsFromWaypoints } from "../../test/fixtures/routeGeometry.ts";
import { buildFakeGeolocationSource } from "../../test/fixtures/geolocationSource.ts";

const FULL_WARNING_TEXT =
  "No trusted turn information is available for this imported GPX. Follow the route line on the map.";

const routePoints = buildRoutePointsFromWaypoints(
  [
    [0, 51],
    [0.01, 51],
  ],
  20,
);

function pointAt(index: number): Coordinate {
  return routePoints[index]?.coordinate ?? [0, 51];
}

const untrustedGpxRoute: PlannedRoute = {
  id: "route-untrusted-gpx",
  name: "Evening loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: routePoints,
  manoeuvres: [],
  distanceMetres: routePoints.at(-1)?.distanceFromStartMetres ?? 0,
  ascentMetres: 2,
  descentMetres: 0,
  warnings: [],
  source: { kind: "gpx-import" },
};

const untrustedPlannerRoute: PlannedRoute = {
  ...untrustedGpxRoute,
  id: "route-untrusted-planner",
  source: { kind: "planner", provider: "openrouteservice", profile: "cycling-regular" },
};

const trustedPlannerRoute: PlannedRoute = {
  ...untrustedGpxRoute,
  id: "route-trusted-planner",
  manoeuvres: [{ distanceFromStartMetres: 0, type: "left", instruction: "Turn left" }],
  source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
};

/** Mirrors RidingScreen.mapProfileViews.test.tsx's own buildMockMapFactory,
 * kept as this file's own local copy per this codebase's established
 * no-shared-test-helpers-across-files convention. */
function buildMockMapFactory(): { factory: MapFactory } {
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

describe("RidingScreen — untrusted-GPX trust notice (backlog item 97)", () => {
  describe("timer boundary (fake timers)", () => {
    it("keeps the full warning at 9,999ms and collapses to 'No turn cues' at exactly 10,000ms", () => {
      vi.useFakeTimers();
      try {
        const fake = buildFakeGeolocationSource();
        render(
          <RidingScreen
            route={untrustedGpxRoute}
            geolocationSource={fake.source}
            mapFactory={buildMockMapFactory().factory}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Start riding" }));
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(9_999);
        });
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
        expect(screen.getByRole("button", { name: "No turn cues" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not restart the deadline when a GPS fix arrives during the first ten seconds", () => {
      vi.useFakeTimers();
      try {
        const fake = buildFakeGeolocationSource();
        render(
          <RidingScreen
            route={untrustedGpxRoute}
            geolocationSource={fake.source}
            mapFactory={buildMockMapFactory().factory}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Start riding" }));

        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        act(() => {
          fake.watches[0]?.emitFix({
            coordinate: pointAt(3),
            accuracyMetres: 5,
            timestampMs: 1000,
            speedMetresPerSecond: null,
            headingDegrees: null,
          });
        });
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
        expect(screen.getByRole("button", { name: "No turn cues" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not restart the deadline across a Map -> Profile switch, and an expanded explanation persists across a further switch", () => {
      vi.useFakeTimers();
      try {
        const fake = buildFakeGeolocationSource();
        render(
          <RidingScreen
            route={untrustedGpxRoute}
            geolocationSource={fake.source}
            mapFactory={buildMockMapFactory().factory}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Start riding" }));

        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        fireEvent.click(screen.getByRole("button", { name: "Profile" }));
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(5_000);
        });
        expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
        const compactButton = screen.getByRole("button", { name: "No turn cues" });
        expect(compactButton).toBeInTheDocument();

        fireEvent.click(compactButton);
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Map" }));
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "No turn cues" })).toHaveAttribute(
          "aria-expanded",
          "true",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("a mid-ride error followed by Try again does not restart the deadline", () => {
      vi.useFakeTimers();
      try {
        const fake = buildFakeGeolocationSource();
        render(
          <RidingScreen
            route={untrustedGpxRoute}
            geolocationSource={fake.source}
            mapFactory={buildMockMapFactory().factory}
          />,
        );
        fireEvent.click(screen.getByRole("button", { name: "Start riding" }));

        act(() => {
          vi.advanceTimersByTime(3_000);
        });
        act(() => {
          fake.watches[0]?.emitError({ reason: "timeout", message: "timed out" });
        });
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        // A genuine "error" -> "watching" recovery, never touching "idle" —
        // the notice must still be the same, undisturbed episode.
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        // The original 10,000ms deadline (3,000ms already elapsed before the
        // error) must still govern — not a fresh window starting from the
        // Try-again retry.
        act(() => {
          vi.advanceTimersByTime(6_999);
        });
        expect(screen.getByText(FULL_WARNING_TEXT)).toBeInTheDocument();

        act(() => {
          vi.advanceTimersByTime(1);
        });
        expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
        expect(screen.getByRole("button", { name: "No turn cues" })).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("episode boundaries (real timers)", () => {
    it("shows the full warning on an explicit Resume ride tap after a restored session", async () => {
      await setActiveRideState({
        id: "active",
        routeId: untrustedGpxRoute.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        lastReliableMatchedPointIndex: 5,
        lastReliableMatchedDistanceFromStartMetres:
          routePoints[5]?.distanceFromStartMetres ?? 0,
      });
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={untrustedGpxRoute}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
      await user.click(await screen.findByRole("button", { name: "Resume ride" }));

      expect(await screen.findByText(FULL_WARNING_TEXT)).toBeInTheDocument();
    });

    it("presents exactly one full-warning episode via the one-use cold resumeIntentToken recovery", async () => {
      await setActiveRideState({
        id: "active",
        routeId: untrustedGpxRoute.id,
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: pointAt(5), accuracyMetres: 6, timestampMs: 1000 },
        lastMatchedPointIndex: 5,
        matchedDistanceFromStartMetres: routePoints[5]?.distanceFromStartMetres ?? 0,
        offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
        elevationWindowMetres: 5000,
      } satisfies StoredRideState);
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={untrustedGpxRoute}
          resumeIntentToken={1}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );

      expect(await screen.findByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(fake.watchPositionSpy).toHaveBeenCalledOnce();
      expect(screen.getAllByText(FULL_WARNING_TEXT)).toHaveLength(1);
    });

    it("never renders the notice for a trusted route", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={trustedPlannerRoute}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));

      expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
      expect(screen.queryByRole("button", { name: "No turn cues" })).toBeNull();
    });

    it("never renders the notice for an untrusted non-GPX-import (planner) route", async () => {
      const user = userEvent.setup();
      const fake = buildFakeGeolocationSource();
      render(
        <RidingScreen
          route={untrustedPlannerRoute}
          geolocationSource={fake.source}
          mapFactory={buildMockMapFactory().factory}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Start riding" }));

      expect(screen.queryByText(FULL_WARNING_TEXT)).toBeNull();
      expect(screen.queryByRole("button", { name: "No turn cues" })).toBeNull();
      expect(
        screen.getByText("Turn information is unavailable for this route."),
      ).toBeInTheDocument();
    });
  });
});
