import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { computeLocalAreaBounds } from "../../map/localAreaBounds.ts";
import {
  buildPositionFeatureCollection,
  EMPTY_FEATURE_COLLECTION,
} from "../../map/routeLayer.ts";
import { cumulativeDistancesMetres } from "../../navigation/distance.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { RoutingOptions, RoutingProvider } from "../../routing/provider.ts";
import { db } from "../../storage/db.ts";
import { getDraft, saveDraft } from "../../storage/planningDraftRepository.ts";
import { savePlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import { listRoutes } from "../../storage/routesRepository.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerCameraSettled: (
    coordinate: Coordinate,
    options?: { zoom?: number; bearingDegrees?: number; pitchDegrees?: number },
  ) => void;
  /** Simulates a genuine user gesture (drag/pinch/rotate/pitch) — never
   * fired for MapView's own programmatic camera moves. */
  triggerUserCameraInteraction: () => void;
  triggerMapTap: (coordinate: Coordinate) => void;
  /** Configures what the next (and subsequent) queryTopWarningFeatureAt
   * calls report as hit — null (the default) means every tap misses every
   * warning feature and falls through to placement, exactly like today. */
  setWarningHit: (warningIndex: number | null) => void;
  /** Configures what the next (and subsequent) queryTopRouteFeatureAt
   * calls report as hit — null (the default) means every tap misses every
   * route feature and falls through to warning hit-testing/placement. */
  setRouteFeatureHit: (routeFeatureId: string | null) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
  centreOnSpy: ReturnType<typeof vi.fn>;
  fitBoundsSpy: ReturnType<typeof vi.fn>;
  addLineLayerSpy: ReturnType<typeof vi.fn>;
  sources: Map<string, GeoJSON.FeatureCollection>;
}

function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let styleLoadedListener: (() => void) | undefined;
  let cameraSettledListener:
    | ((camera: {
        coordinate: Coordinate;
        zoom: number;
        bearingDegrees: number;
        pitchDegrees: number;
      }) => void)
    | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  let userCameraInteractionListener: (() => void) | undefined;
  let warningHitIndex: number | null = null;
  let routeFeatureHitId: string | null = null;
  const setCameraSpy = vi.fn();
  const centreOnSpy = vi.fn();
  const fitBoundsSpy = vi.fn();
  const addLineLayerSpy = vi.fn();
  const sources = new Map<string, GeoJSON.FeatureCollection>();

  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onStyleLoaded: (listener) => {
        styleLoadedListener = listener;
      },
      onError: () => undefined,
      onSourceData: () => undefined,
      addGeoJsonSource: (id, data) => {
        sources.set(id, data);
      },
      setGeoJsonSourceData: (id, data) => {
        sources.set(id, data);
      },
      hasSource: (id) => sources.has(id),
      addLineLayer: (id, sourceId, paint) => {
        addLineLayerSpy(id, sourceId, paint);
      },
      addCircleLayer: () => undefined,
      hasLayer: () => false,
      hasImage: () => false,
      addImage: () => undefined,
      addSymbolLayer: () => undefined,
      fitBounds: fitBoundsSpy,
      getCenter: () => [0, 51],
      getZoom: () => 14,
      onUserCameraInteraction: (listener) => {
        userCameraInteractionListener = listener;
      },
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
      centreOn: centreOnSpy,
      resize: () => undefined,
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: () =>
        warningHitIndex === null ? null : { warningIndex: warningHitIndex },
      queryTopRouteFeatureAt: () =>
        routeFeatureHitId === null ? null : { routeFeatureId: routeFeatureHitId },
      setMarkers: () => undefined,
      setDistanceBadges: () => undefined,
      remove: () => undefined,
    };
    return map;
  };

  return {
    factory,
    setCameraSpy,
    centreOnSpy,
    fitBoundsSpy,
    addLineLayerSpy,
    sources,
    setWarningHit: (warningIndex) => {
      warningHitIndex = warningIndex;
    },
    setRouteFeatureHit: (routeFeatureId) => {
      routeFeatureHitId = routeFeatureId;
    },
    triggerLoad: () => {
      act(() => {
        // Real MapLibre always fires "style.load" strictly before "load".
        styleLoadedListener?.();
        loadListener?.();
      });
    },
    triggerCameraSettled: (coordinate, options) => {
      act(() => {
        cameraSettledListener?.({
          coordinate,
          zoom: options?.zoom ?? 14,
          bearingDegrees: options?.bearingDegrees ?? 0,
          pitchDegrees: options?.pitchDegrees ?? 0,
        });
      });
    },
    triggerUserCameraInteraction: () => {
      act(() => {
        userCameraInteractionListener?.();
      });
    },
    triggerMapTap: (coordinate) => {
      act(() => {
        mapTapListener?.(coordinate);
      });
    },
  };
}

function buildRoute(pointCount = 10): PlannedRoute {
  return {
    id: "route-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.001, 51] as Coordinate,
      elevationMetres: 10 + i,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: (pointCount - 1) * 100,
    ascentMetres: 12,
    descentMetres: 4,
    surfaceSummary: {
      pavedMetres: (pointCount - 1) * 100,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: 0,
    },
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function buildRouteWithWarnings(): PlannedRoute {
  const pointCount = 10;
  return {
    id: "route-warnings-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.001, 51] as Coordinate,
      elevationMetres: 10 + i,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: (pointCount - 1) * 100,
    ascentMetres: 12,
    descentMetres: 4,
    surfaceSummary: {
      pavedMetres: 600,
      questionableMetres: 200,
      unsuitableMetres: 100,
      unknownMetres: 0,
    },
    warnings: [
      {
        kind: "questionable-surface",
        startDistanceMetres: 100,
        endDistanceMetres: 300,
        message: "Questionable surface for a road bike.",
      },
      {
        kind: "unsuitable-surface",
        startDistanceMetres: 600,
        endDistanceMetres: 700,
        message: "Unsuitable surface for a road bike.",
      },
    ],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function buildRouteWithStructuralWarnings(): PlannedRoute {
  const pointCount = 10;
  return {
    id: "route-structural-warnings-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.001, 51] as Coordinate,
      elevationMetres: 10 + i,
      distanceFromStartMetres: i * 100,
    })),
    manoeuvres: [],
    distanceMetres: (pointCount - 1) * 100,
    ascentMetres: 12,
    descentMetres: 4,
    surfaceSummary: {
      pavedMetres: (pointCount - 1) * 100,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: 0,
    },
    warnings: [
      {
        kind: "steps",
        startDistanceMetres: 100,
        endDistanceMetres: 200,
        message: "Route includes steps.",
      },
      {
        kind: "ford",
        startDistanceMetres: 300,
        endDistanceMetres: 400,
        message: "Route includes a ford.",
      },
      {
        kind: "ferry",
        startDistanceMetres: 500,
        endDistanceMetres: 600,
        message: "Route includes a ferry.",
      },
      {
        kind: "other",
        startDistanceMetres: 700,
        endDistanceMetres: 800,
        message: "Route includes a construction-designated way.",
      },
    ],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

// distanceFromStartMetres/distanceMetres/warning distances are derived
// from the same cumulativeDistancesMetres primitive per-leg stitching
// uses (see usePlanningRoute.ts) — the app always stitches a calculated
// route, even a single-leg one, which recomputes distances from real
// geometry. A hand-typed round number here would drift once stitched, so
// the fixture (and any exact text asserted against it) must be
// self-consistent with its own coordinates from the start.
function buildRouteWithSurfaceDetailWarning(): PlannedRoute {
  const pointCount = 10;
  const coordinates: Coordinate[] = Array.from({ length: pointCount }, (_, i) => [
    i * 0.001,
    51,
  ]);
  const distances = cumulativeDistancesMetres(coordinates);
  const warningStart = distances[1] ?? 0;
  const warningEnd = distances[4] ?? 0;
  const totalDistance = distances.at(-1) ?? 0;
  return {
    id: "route-surface-detail-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: coordinates.map((coordinate, i) => ({
      coordinate,
      elevationMetres: 10 + i,
      distanceFromStartMetres: distances[i] ?? 0,
    })),
    manoeuvres: [],
    distanceMetres: totalDistance,
    ascentMetres: 12,
    descentMetres: 4,
    surfaceSummary: {
      pavedMetres: totalDistance - (warningEnd - warningStart),
      questionableMetres: warningEnd - warningStart,
      unsuitableMetres: 0,
      unknownMetres: 0,
    },
    warnings: [
      {
        kind: "questionable-surface",
        startDistanceMetres: warningStart,
        endDistanceMetres: warningEnd,
        message: "Questionable surface for a road bike: compacted gravel.",
        surface: { type: "compacted-gravel", label: "Compacted gravel" },
      },
    ],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

// A single sustained 8% climb over its own whole length (30 points @ 50 m
// spacing = 1450 m, ~116 m gain) — comfortably above every recognised-
// climb eligibility threshold (500 m length, 3% average gradient, 1500
// climbScore), forming exactly one ClimbFeature spanning the whole route.
function buildRouteWithClimb(): PlannedRoute {
  const pointCount = 30;
  const stepMetres = 50;
  const gradePercent = 8;
  return {
    id: "route-climb-1",
    name: "Planned route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: Array.from({ length: pointCount }, (_, i) => ({
      coordinate: [i * 0.0005, 51] as Coordinate,
      elevationMetres: (i * stepMetres * gradePercent) / 100,
      distanceFromStartMetres: i * stepMetres,
    })),
    manoeuvres: [],
    distanceMetres: (pointCount - 1) * stepMetres,
    ascentMetres: 116,
    descentMetres: 0,
    surfaceSummary: {
      pavedMetres: (pointCount - 1) * stepMetres,
      questionableMetres: 0,
      unsuitableMetres: 0,
      unknownMetres: 0,
    },
    warnings: [
      {
        kind: "questionable-surface",
        startDistanceMetres: 100,
        endDistanceMetres: 200,
        message: "Questionable surface for a road bike.",
      },
    ],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function buildResolvedAdapter(route: PlannedRoute): RoutingProvider {
  return {
    calculateRoute: () => Promise.resolve(route),
  };
}

/** Like buildResolvedAdapter, but geometrically leg-aware: every call
 * returns a route whose points start/end exactly at the requested pair,
 * so a scenario with more than two waypoints (more than one leg) stitches
 * successfully instead of failing the seam-tolerance check — unlike
 * buildResolvedAdapter, which always returns the same fixed geometry
 * regardless of which leg was requested. Reuses `route`'s other fields
 * (warnings/manoeuvres/surfaceSummary/source) unchanged on every call, so
 * only use this where a test doesn't assert on that content across a
 * multi-leg calculation. */
function buildLegAwareResolvedAdapter(route: PlannedRoute): RoutingProvider {
  return {
    calculateRoute: (waypoints) => {
      const [start, end] = waypoints;
      if (!start || !end) return Promise.resolve(route);
      const distances = cumulativeDistancesMetres([start, end]);
      return Promise.resolve({
        ...route,
        points: [start, end].map((coordinate, i) => ({
          coordinate,
          elevationMetres: null,
          distanceFromStartMetres: distances[i] ?? 0,
        })),
        distanceMetres: distances.at(-1) ?? 0,
      });
    },
  };
}

interface DeferredRouteCall {
  waypoints: Coordinate[];
  options: RoutingOptions;
  resolve: (route: PlannedRoute) => void;
}

/** A minimal deferred (resolve-on-demand) adapter for tests that need to
 * observe UI state while a calculation is still in flight — unlike
 * buildResolvedAdapter/buildLegAwareResolvedAdapter, which both settle
 * immediately. */
function buildDeferredAdapter(): {
  adapter: RoutingProvider;
  calls: DeferredRouteCall[];
} {
  const calls: DeferredRouteCall[] = [];
  const adapter: RoutingProvider = {
    calculateRoute: (waypoints, options) =>
      new Promise<PlannedRoute>((resolve) => {
        calls.push({ waypoints, options, resolve });
      }),
  };
  return { adapter, calls };
}

/** A geometrically-consistent leg route matching whatever pair of
 * coordinates a given deferred call actually requested. */
function buildRouteForCall(waypoints: Coordinate[]): PlannedRoute {
  const start = waypoints[0] ?? [0, 51];
  const end = waypoints[1] ?? [0.001, 51];
  const distances = cumulativeDistancesMetres([start, end]);
  return {
    id: "leg",
    name: "Leg",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [start, end].map((coordinate, i) => ({
      coordinate,
      elevationMetres: null,
      distanceFromStartMetres: distances[i] ?? 0,
    })),
    manoeuvres: [],
    distanceMetres: distances.at(-1) ?? 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function buildFailThenSucceedAdapter(
  error: RoutingError,
  route: PlannedRoute,
): { adapter: RoutingProvider; calculateRouteSpy: ReturnType<typeof vi.fn> } {
  let callCount = 0;
  const calculateRouteSpy = vi.fn(() => {
    callCount += 1;
    return callCount === 1 ? Promise.reject(error) : Promise.resolve(route);
  });
  return { adapter: { calculateRoute: calculateRouteSpy }, calculateRouteSpy };
}

async function addWaypointViaCrosshair(
  map: MockMapHandle,
  user: ReturnType<typeof userEvent.setup>,
  coordinate: Coordinate,
): Promise<void> {
  map.triggerCameraSettled(coordinate);
  await user.click(
    screen.getByRole("button", { name: /add waypoint here|move .+ here|insert after/i }),
  );
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
  await db.planningDrafts.clear();
  await db.planningPreferences.clear();
  await db.routes.clear();
});

describe("PlanningScreen", () => {
  it("has one primary heading and the visible major section headings", () => {
    const map = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(buildRoute())}
      />,
    );
    map.triggerLoad();

    expect(
      screen.getByRole("heading", { level: 1, name: "Plan a route" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Waypoints" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Route options" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Save or export" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Route overview" }),
    ).toBeNull();
  });

  it("keeps waypoint editing usable without a key, and shows the required notice", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(buildRoute())}
      />,
    );
    map.triggerLoad();

    expect(
      screen.getByText("Road routing requires your personal OpenRouteService key."),
    ).toBeInTheDocument();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /calculate route/i })).toBeDisabled();
  });

  it("opens Settings from the no-key notice", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    const onNavigateToSettings = vi.fn();
    render(
      <PlanningScreen
        onNavigateToSettings={onNavigateToSettings}
        mapFactory={map.factory}
      />,
    );
    map.triggerLoad();

    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onNavigateToSettings).toHaveBeenCalled();
  });

  it("adds a waypoint via a direct map tap", async () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    map.triggerMapTap([0, 51]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });
  });

  it("undo removes the most recently added waypoint", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByText(
        "No waypoints yet. Tap the map or use the crosshair button below to add one.",
      ),
    ).toBeInTheDocument();
  });

  it("persists a draft to storage after an edit", async () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    map.triggerMapTap([0, 51]);

    await waitFor(
      async () => {
        const draft = await getDraft();
        expect(draft?.waypoints).toHaveLength(1);
      },
      { timeout: 3000 },
    );
  });

  it(
    "calculates a route once a key exists, shows the summary, and enables save/export " +
      "only once geometry is denser than the raw waypoints",
    async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRoute(10);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);

      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });

      expect(screen.getByRole("button", { name: /save route/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /export gpx/i })).toBeDisabled();

      await user.click(calculateButton);

      await waitFor(() => {
        expect(screen.getByRole("region", { name: "Route summary" })).toBeInTheDocument();
      });
      expect(
        within(screen.getByRole("region", { name: "Route summary" })).getByText(/km/),
      ).toBeInTheDocument();

      expect(screen.getByRole("button", { name: /save route/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /export gpx/i })).toBeEnabled();
    },
  );

  it("shows the key's verification status inline, updated after a successful calculation", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(buildRoute(10))}
      />,
    );
    map.triggerLoad();

    await waitFor(() => {
      expect(screen.getByText(/not yet verified/i)).toBeInTheDocument();
    });

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    await waitFor(() => {
      expect(screen.getByText(/key last verified/i)).toBeInTheDocument();
    });
  });

  it("does not show a key status line when no key is configured", () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    expect(
      screen.getByText("Road routing requires your personal OpenRouteService key."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not yet verified/i)).not.toBeInTheDocument();
  });

  it("saving clears the draft, resets waypoints and notifies the caller", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute(10);
    const onRouteSaved = vi.fn();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        onRouteSaved={onRouteSaved}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(route)}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save route/i })).toBeEnabled();
    });

    // Edits the route name immediately before Save, re-arming the 900ms
    // draft-autosave debounce, then clicks Save right away rather than
    // waiting it out — the exact Save-versus-autosave race regression
    // (CLAUDE.md backlog item 30): a still-pending autosave timer must not
    // resurrect the draft after clearDraft() below has cleared it.
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Renamed right before Save" },
    });
    await user.click(screen.getByRole("button", { name: /save route/i }));

    await waitFor(() => {
      expect(onRouteSaved).toHaveBeenCalledTimes(1);
    });
    const saved = onRouteSaved.mock.calls[0]?.[0] as PlannedRoute;
    expect(saved.name).toBe("Renamed right before Save");

    const routes = await listRoutes();
    expect(routes).toHaveLength(1);

    const draft = await getDraft();
    expect(draft).toBeUndefined();
    expect(
      screen.getByText(
        "No waypoints yet. Tap the map or use the crosshair button below to add one.",
      ),
    ).toBeInTheDocument();

    // Past the 900ms debounce the pre-save name edit would have armed —
    // the pending timer must have been cancelled synchronously at Save, so
    // the draft stays cleared rather than being resurrected with the
    // stale, pre-save waypoints/name.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const draftAfterDebounce = await getDraft();
    expect(draftAfterDebounce).toBeUndefined();
  });

  it("frames a fresh session in an approximately 50 × 50 km box around the rider's approximate location", async () => {
    const map = createMockMapFactory();
    const requestApproximateLocation = vi.fn().mockResolvedValue([-1.5, 53.8]);
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        requestApproximateLocation={requestApproximateLocation}
      />,
    );
    map.triggerLoad();

    const expectedBounds = computeLocalAreaBounds([-1.5, 53.8]);
    await waitFor(() => {
      expect(map.fitBoundsSpy).toHaveBeenCalledWith(expectedBounds);
    });
    expect(map.setCameraSpy).not.toHaveBeenCalled();
    expect(map.sources.get("acn-position")).toEqual(
      buildPositionFeatureCollection([-1.5, 53.8]),
    );
  });

  it("does not move the camera when the location request resolves to null", async () => {
    const map = createMockMapFactory();
    const requestApproximateLocation = vi.fn().mockResolvedValue(null);
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        requestApproximateLocation={requestApproximateLocation}
      />,
    );
    map.triggerLoad();

    await waitFor(() => {
      expect(requestApproximateLocation).toHaveBeenCalled();
    });
    expect(map.fitBoundsSpy).not.toHaveBeenCalled();
    expect(map.sources.get("acn-position")).toEqual(EMPTY_FEATURE_COLLECTION);
  });

  it("never requests a location for a session restored from an existing draft", async () => {
    await saveDraft({
      waypoints: [
        { id: "a", coordinate: [0, 51] },
        { id: "b", coordinate: [0.01, 51] },
      ],
      routeName: "Planned route",
      avoidFerries: true,
      profile: "cycling-road",
    });
    const map = createMockMapFactory();
    const requestApproximateLocation = vi.fn().mockResolvedValue([-1.5, 53.8]);
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        requestApproximateLocation={requestApproximateLocation}
      />,
    );
    map.triggerLoad();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });
    expect(requestApproximateLocation).not.toHaveBeenCalled();
  });

  describe("Locate me", () => {
    it("renders an accessible, initially enabled control", async () => {
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();

      const locateButton = await screen.findByRole("button", { name: "Locate me" });
      expect(locateButton).toBeEnabled();
      expect(locateButton).toHaveTextContent("⌖");
    });

    it("fits the same 50 × 50 km box even with existing waypoints present, unlike the automatic path", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();

      // Wait for the initial automatic location request (fired only for a
      // genuinely fresh session with zero waypoints) to have actually
      // occurred and resolved before adding a waypoint. Without this,
      // adding the waypoint could race the effect that gates on "no
      // waypoints yet", non-deterministically suppressing the automatic
      // call altogether and leaving toHaveBeenCalledTimes(1) below flaky
      // under load.
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      await addWaypointViaCrosshair(map, user, [0, 51]);

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      const expectedBounds = computeLocalAreaBounds([-1.5, 53.8]);
      await waitFor(() => {
        expect(map.fitBoundsSpy).toHaveBeenCalledWith(expectedBounds);
      });
    });

    it("shows a concise loading state and disables the control while locating", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      let resolveLocation: ((coordinate: Coordinate | null) => void) | undefined;
      const requestApproximateLocation = vi.fn(
        () =>
          new Promise<Coordinate | null>((resolve) => {
            resolveLocation = resolve;
          }),
      );
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });
      resolveLocation?.(null);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Locate me" })).toBeEnabled();
      });

      await user.click(screen.getByRole("button", { name: "Locate me" }));

      const locateButton = screen.getByRole("button", { name: "Locate me" });
      expect(locateButton).toBeDisabled();
      expect(locateButton).toHaveTextContent("Locating…");

      resolveLocation?.([-1.5, 53.8]);

      await waitFor(() => {
        expect(locateButton).toBeEnabled();
      });
      expect(locateButton).toHaveTextContent("⌖");
    });

    it("shows a failure message on a null result, with Locate me remaining as the retry path", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      await user.click(screen.getByRole("button", { name: "Locate me" }));

      expect(
        await screen.findByText("Your location could not be determined."),
      ).toBeInTheDocument();
      const locateButton = screen.getByRole("button", { name: "Locate me" });
      expect(locateButton).toBeEnabled();

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(locateButton);

      await waitFor(() => {
        expect(screen.queryByText("Your location could not be determined.")).toBeNull();
      });
      expect(map.fitBoundsSpy).toHaveBeenCalledWith(computeLocalAreaBounds([-1.5, 53.8]));
    });

    it("a rejected location request also shows the failure state", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      requestApproximateLocation.mockRejectedValueOnce(new Error("boom"));
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      expect(
        await screen.findByText("Your location could not be determined."),
      ).toBeInTheDocument();
    });

    it("two rapid taps before either resolves only issue one request", async () => {
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn(
        () =>
          new Promise<Coordinate | null>(() => {
            // Deliberately never resolves — only call counts matter here.
          }),
      );
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      const locateButton = screen.getByRole("button", { name: "Locate me" });
      fireEvent.click(locateButton);
      fireEvent.click(locateButton);

      expect(requestApproximateLocation).toHaveBeenCalledTimes(2);
    });

    it("the session's first successful tap box-fits; a second tap at the same coordinate only recentres", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      const locateButton = screen.getByRole("button", { name: "Locate me" });
      const expectedBounds = computeLocalAreaBounds([-1.5, 53.8]);

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(locateButton);
      await waitFor(() => {
        expect(map.fitBoundsSpy).toHaveBeenCalledWith(expectedBounds);
      });
      expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);
      expect(map.centreOnSpy).not.toHaveBeenCalled();

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(locateButton);
      await waitFor(() => {
        expect(map.centreOnSpy).toHaveBeenCalledWith([-1.5, 53.8], { animate: true });
      });
      // The second tap must not repeat the box-fit, now that the session's
      // initial regional framing has already happened once.
      expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);
    });

    it("shows a marker at the resolved coordinate after a successful tap", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });
      expect(map.sources.get("acn-position")).toEqual(EMPTY_FEATURE_COLLECTION);

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.sources.get("acn-position")).toEqual(
          buildPositionFeatureCollection([-1.5, 53.8]),
        );
      });
    });

    it("a failed retry after a prior success keeps showing the last resolved marker", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));
      await waitFor(() => {
        expect(map.sources.get("acn-position")).toEqual(
          buildPositionFeatureCollection([-1.5, 53.8]),
        );
      });

      requestApproximateLocation.mockResolvedValueOnce(null);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      expect(
        await screen.findByText("Your location could not be determined."),
      ).toBeInTheDocument();
      expect(map.sources.get("acn-position")).toEqual(
        buildPositionFeatureCollection([-1.5, 53.8]),
      );
    });

    it("two successive successful taps at different coordinates replace, not accumulate, the marker", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));
      await waitFor(() => {
        expect(map.sources.get("acn-position")).toEqual(
          buildPositionFeatureCollection([-1.5, 53.8]),
        );
      });

      requestApproximateLocation.mockResolvedValueOnce([-1.6, 53.9]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.sources.get("acn-position")).toEqual(
          buildPositionFeatureCollection([-1.6, 53.9]),
        );
      });
      expect(map.sources.get("acn-position")?.features).toHaveLength(1);
    });

    it("an out-of-range coordinate from the location request moves neither camera nor marker, and is treated as a failure", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      // Camera movement and the marker now share exactly one validity gate
      // (isValidCoordinate) — an out-of-range longitude like 200 fails it
      // up front, so neither a box-fit nor a recentre is ever attempted.
      requestApproximateLocation.mockResolvedValueOnce([200, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      expect(
        await screen.findByText("Your location could not be determined."),
      ).toBeInTheDocument();
      expect(map.fitBoundsSpy).not.toHaveBeenCalled();
      expect(map.centreOnSpy).not.toHaveBeenCalled();
      expect(map.sources.get("acn-position")).toEqual(EMPTY_FEATURE_COLLECTION);
    });

    it("[0, 0] is shown as a genuine fix, not treated as no-location", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      requestApproximateLocation.mockResolvedValueOnce([0, 0]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.sources.get("acn-position")).toEqual(
          buildPositionFeatureCollection([0, 0]),
        );
      });
    });

    it("a manual camera gesture before any successful geolocation makes the first successful Locate-me press recentre, not box-fit", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      map.triggerUserCameraInteraction();

      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.centreOnSpy).toHaveBeenCalledWith([-1.5, 53.8], { animate: true });
      });
      expect(map.fitBoundsSpy).not.toHaveBeenCalled();
    });

    it("once the automatic fresh-session framing itself succeeds, a following Locate-me press recentres, not box-fits", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue([-1.5, 53.8]);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(map.fitBoundsSpy).toHaveBeenCalledWith(
          computeLocalAreaBounds([-1.5, 53.8]),
        );
      });
      expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);

      requestApproximateLocation.mockResolvedValueOnce([-1.6, 53.9]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.centreOnSpy).toHaveBeenCalledWith([-1.6, 53.9], { animate: true });
      });
      expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);
    });

    it("a recentre-only Locate-me press preserves live zoom/bearing/pitch, never threading React's settled-camera state into the call", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const requestApproximateLocation = vi.fn().mockResolvedValue(null);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          requestApproximateLocation={requestApproximateLocation}
        />,
      );
      map.triggerLoad();
      await waitFor(() => {
        expect(requestApproximateLocation).toHaveBeenCalledTimes(1);
      });

      // Get past the session's first framing.
      requestApproximateLocation.mockResolvedValueOnce([-1.5, 53.8]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));
      await waitFor(() => {
        expect(map.fitBoundsSpy).toHaveBeenCalledTimes(1);
      });

      // React state has now genuinely observed non-round camera values.
      map.triggerCameraSettled([-1.5, 53.8], {
        zoom: 15.25,
        bearingDegrees: -42,
        pitchDegrees: 23,
      });

      requestApproximateLocation.mockResolvedValueOnce([-1.6, 53.9]);
      await user.click(screen.getByRole("button", { name: "Locate me" }));

      await waitFor(() => {
        expect(map.centreOnSpy).toHaveBeenCalledWith([-1.6, 53.9], { animate: true });
      });
      // Structurally incapable of carrying zoom/bearing/pitch: centreOn
      // only ever takes a coordinate and an animate flag.
      expect(map.centreOnSpy.mock.calls.at(-1)).toEqual([
        [-1.6, 53.9],
        { animate: true },
      ]);
      expect(map.setCameraSpy).not.toHaveBeenCalled();
    });
  });

  describe("north-up control", () => {
    it("is not pressed before the camera has ever settled", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    });

    it("tapping it issues an orientation-only setCamera call, preserving centre and zoom", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(map.setCameraSpy).toHaveBeenCalledWith(null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
    });

    it("becomes pressed only once the camera has actually settled north-up", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      const northUpButton = screen.getByRole("button", {
        name: "North-up, top-down view",
      });
      await user.click(northUpButton);
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");

      map.triggerCameraSettled([0, 51]);

      await waitFor(() => {
        expect(northUpButton).toHaveAttribute("aria-pressed", "true");
      });
    });

    it("counts a settled bearing within tolerance of the 0°/360° wrap as north-up", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      map.triggerCameraSettled([0, 51], { bearingDegrees: 359.7, pitchDegrees: 0 });

      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "true");
    });

    it("does not count a settled bearing outside tolerance as north-up", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      map.triggerCameraSettled([0, 51], { bearingDegrees: 358.9, pitchDegrees: 0 });

      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    });

    it("a manual rotation (nonzero bearing) unpresses the control", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      map.triggerCameraSettled([0, 51], { bearingDegrees: 45, pitchDegrees: 0 });

      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    });

    it("a manual tilt (nonzero pitch) unpresses the control", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      map.triggerCameraSettled([0, 51], { bearingDegrees: 0, pitchDegrees: 20 });

      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "false");
    });

    it("panning without changing orientation preserves the pressed state", async () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      map.triggerCameraSettled([0, 51]);
      const northUpButton = await screen.findByRole("button", {
        name: "North-up, top-down view",
      });
      expect(northUpButton).toHaveAttribute("aria-pressed", "true");

      map.triggerCameraSettled([0.02, 51.02]);

      expect(northUpButton).toHaveAttribute("aria-pressed", "true");
    });

    it("pressing Northwards a second time after an intervening manual rotation re-applies the reset", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      const northUpButton = screen.getByRole("button", {
        name: "North-up, top-down view",
      });
      await user.click(northUpButton);
      expect(map.setCameraSpy).toHaveBeenCalledTimes(1);

      // The rider manually rotates away from north between the two presses.
      map.triggerCameraSettled([0, 51], { bearingDegrees: 45, pitchDegrees: 0 });

      await user.click(northUpButton);

      expect(map.setCameraSpy).toHaveBeenCalledTimes(2);
      expect(map.setCameraSpy).toHaveBeenNthCalledWith(2, null, null, 0, 0, {
        animate: true,
        followOffset: false,
      });
    });
  });

  describe("Locate me and north-up do not interfere with other workflows", () => {
    it("using either control does not alter the waypoint list or undo history", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();
      await addWaypointViaCrosshair(map, user, [0, 51]);
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Locate me" }));
      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
      expect(
        screen.queryByText(
          "No waypoints yet. Tap the map or use the crosshair button below to add one.",
        ),
      ).toBeNull();
    });

    it("a selected warning survives either control being used", async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRouteWithWarnings();
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);

      const summaryRegion = await waitFor(() => {
        const region = screen.getByRole("region", { name: "Route summary" });
        expect(region).toBeInTheDocument();
        return region;
      });
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });
      await user.click(warningButton);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");

      await user.click(screen.getByRole("button", { name: "Locate me" }));
      await user.click(screen.getByRole("button", { name: "North-up, top-down view" }));

      expect(warningButton).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("relabels Calculate to Try again after a provider failure, and retry issues exactly one new request", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute(10);
    const { adapter, calculateRouteSpy } = buildFailThenSucceedAdapter(
      new RoutingError({
        reason: "provider-unavailable",
        message: "OpenRouteService returned a server error.",
        httpStatus: 502,
      }),
      route,
    );
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={adapter}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    const retryButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Try again" });
      expect(button).toBeInTheDocument();
      return button;
    });
    expect(calculateRouteSpy).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/OpenRouteService is temporarily unavailable \(HTTP 502\)/),
    ).toBeInTheDocument();

    await user.click(retryButton);

    await waitFor(() => {
      expect(calculateRouteSpy).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Route summary" })).toBeInTheDocument();
    });
  });

  it("retains waypoints, the draft and the unrouted preview after a provider-unavailable failure", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const adapter: RoutingProvider = {
      calculateRoute: () =>
        Promise.reject(
          new RoutingError({
            reason: "provider-unavailable",
            message: "OpenRouteService returned a server error.",
            httpStatus: 502,
          }),
        ),
    };
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={adapter}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    await waitFor(() => {
      expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    });

    // Waypoints remain, so the dashed unrouted preview (fed directly from
    // them whenever the state isn't "routed") is still available too.
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(
      screen.getByText("Calculate a complete routed result before saving or exporting."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save route/i })).toBeDisabled();

    await waitFor(async () => {
      const draft = await getDraft();
      expect(draft?.waypoints).toHaveLength(2);
    });
  });

  it("selecting a waypoint disables placement and a subsequent bare map tap changes nothing", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);

    await user.click(screen.getByRole("button", { name: "Start" }));

    const crosshairButton = screen.getByRole("button", { name: "Add waypoint here" });
    expect(crosshairButton).toBeDisabled();

    map.triggerMapTap([0.5, 51]);

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
  });

  it("tapping the selected waypoint again deselects it; tapping a different waypoint transfers selection instead", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    await addWaypointViaCrosshair(map, user, [0.02, 51]);

    const beforeDraft = await waitFor(async () => {
      const draft = await getDraft();
      expect(draft?.waypoints).toHaveLength(3);
      return draft;
    });

    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Waypoint 3" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Add waypoint here" })).toBeDisabled();

    // Tapping the already-selected waypoint again deselects it.
    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Waypoint 3" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Add waypoint here" })).toBeEnabled();
    // The relocate group (Move/Insert after) only renders for a selected row.
    expect(screen.queryByRole("button", { name: "Move" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Insert after" })).toBeNull();

    // Selecting a different waypoint transfers selection rather than
    // merely re-toggling the previous one back on.
    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));
    await user.click(screen.getByRole("button", { name: "Waypoint 3" }));
    expect(screen.getByRole("button", { name: "Waypoint 3" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // None of this selection/deselection/transfer touched a single
    // coordinate, id, or the waypoint order.
    await waitFor(async () => {
      const draft = await getDraft();
      expect(draft?.waypoints).toEqual(beforeDraft?.waypoints);
    });
  });

  it("disables placement while a genuine camera gesture is in flight, and re-enables once it settles", () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    map.triggerCameraSettled([0, 51]);
    const crosshairButton = screen.getByRole("button", { name: "Add waypoint here" });
    expect(crosshairButton).toBeEnabled();

    // A real drag/pinch/rotate (or momentum after the finger lifts) leaves
    // crosshairCoordinate holding a stale pre-gesture value until the next
    // settle — placement must not use it in the meantime.
    map.triggerUserCameraInteraction();
    expect(crosshairButton).toBeDisabled();

    map.triggerCameraSettled([0.2, 51]);
    expect(crosshairButton).toBeEnabled();
  });

  it("move is one-shot: completing it returns to selected mode, disabling further placement", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(
      screen.getByRole("button", { name: "Move the start here" }),
    ).toBeInTheDocument();

    map.triggerCameraSettled([0.5, 51]);
    await user.click(screen.getByRole("button", { name: "Move the start here" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Add waypoint here" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Add waypoint here" })).toBeDisabled();

    // A second bare tap performs no further move.
    map.triggerMapTap([0.9, 51]);
    expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
  });

  it("insert-after is one-shot: the newly inserted waypoint is left selected, not the anchor", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Insert after" }));
    expect(
      screen.getByRole("button", { name: "Insert after the start" }),
    ).toBeInTheDocument();

    map.triggerCameraSettled([0.005, 51]);
    await user.click(screen.getByRole("button", { name: "Insert after the start" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Waypoint 3" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The newly inserted waypoint (now "Waypoint 2") is selected, not the anchor.
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("tapping the waypoint again during an active relocation leaves the relocation active", async () => {
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(
      screen.getByRole("button", { name: "Move the start here" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Re-tapping the waypoint being relocated must not cancel, commit or
    // transfer the relocation — only the explicit Move toggle or a
    // placement action may end it.
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(
      screen.getByRole("button", { name: "Move the start here" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();

    // The relocation can still be completed normally afterwards.
    map.triggerCameraSettled([0.5, 51]);
    await user.click(screen.getByRole("button", { name: "Move the start here" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Add waypoint here" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("selecting then deselecting a waypoint triggers no routing request and adds no undo history entry", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute(10);
    const calculateRouteSpy = vi.fn(() => Promise.resolve(route));
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={{ calculateRoute: calculateRouteSpy }}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);
    await waitFor(() => {
      expect(calculateRouteSpy).toHaveBeenCalledTimes(1);
    });
    calculateRouteSpy.mockClear();

    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));
    await user.click(screen.getByRole("button", { name: "Waypoint 2" }));

    // Long enough to clear both the draft-save and recalculation debounces.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(calculateRouteSpy).not.toHaveBeenCalled();

    // Exactly one Undo removes the most recently *added* waypoint, proving
    // select/deselect pushed no history entry of their own.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("button", { name: "Waypoint 2" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("selection, pending move/insert-after mode and route-name edits never trigger a provider request", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute(10);
    const calculateRouteSpy = vi.fn(() => Promise.resolve(route));
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={{ calculateRoute: calculateRouteSpy }}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);
    await waitFor(() => {
      expect(calculateRouteSpy).toHaveBeenCalledTimes(1);
    });
    calculateRouteSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Custom name" },
    });

    // Long enough to clear both the draft-save and recalculation debounces.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(calculateRouteSpy).not.toHaveBeenCalled();
  });

  it("preserves the camera across an edit-triggered recalculation instead of re-fitting the whole route", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRoute();
    const legAwareAdapter = buildLegAwareResolvedAdapter(route);
    const calculateRouteSpy = vi.fn((waypoints: Coordinate[]): Promise<PlannedRoute> =>
      legAwareAdapter.calculateRoute(waypoints, { profile: "cycling-road" }),
    );
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={{ calculateRoute: calculateRouteSpy }}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Route summary" })).toBeInTheDocument();
    });

    // The first-ever calculated route for this draft fits the camera once
    // — confirming that case still works before proving the *next* one
    // (an edit-triggered recalculation) does not fit again.
    const fitBoundsCallsAfterFirstRoute = map.fitBoundsSpy.mock.calls.length;
    expect(fitBoundsCallsAfterFirstRoute).toBeGreaterThanOrEqual(1);
    calculateRouteSpy.mockClear();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    map.triggerCameraSettled([0.002, 51]);
    await user.click(screen.getByRole("button", { name: "Move the start here" }));

    // Long enough to clear both the draft-save and recalculation debounces.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Proves the recalculation genuinely happened, not merely that nothing
    // did — otherwise the fitBounds assertion below would pass vacuously.
    expect(calculateRouteSpy).toHaveBeenCalled();
    expect(map.fitBoundsSpy.mock.calls.length).toBe(fitBoundsCallsAfterFirstRoute);
  });

  it("warning selection prevents accidental waypoint placement, even in append mode", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRouteWithWarnings();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(route)}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    const summaryRegion = await waitFor(() => {
      const region = screen.getByRole("region", { name: "Route summary" });
      expect(region).toBeInTheDocument();
      return region;
    });
    const warningButton = within(summaryRegion).getByRole("button", {
      name: /questionable surface for a road bike/i,
    });
    await user.click(warningButton);

    expect(screen.getByRole("button", { name: "Add waypoint here" })).toBeDisabled();
    expect(
      screen.getByText("Clear the selected warning to place or move a waypoint."),
    ).toBeInTheDocument();

    map.triggerMapTap([0.5, 51]);

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
  });

  it("selecting a waypoint clears an active warning selection", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRouteWithWarnings();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(route)}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    const summaryRegion = await waitFor(() => {
      const region = screen.getByRole("region", { name: "Route summary" });
      expect(region).toBeInTheDocument();
      return region;
    });
    const warningButton = within(summaryRegion).getByRole("button", {
      name: /questionable surface for a road bike/i,
    });
    await user.click(warningButton);
    expect(warningButton).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Start" }));

    expect(warningButton).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting a warning cancels a pending move/insert-after and returns to selected mode", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRouteWithWarnings();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(route)}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    const summaryRegion = await waitFor(() => {
      const region = screen.getByRole("region", { name: "Route summary" });
      expect(region).toBeInTheDocument();
      return region;
    });

    await user.click(screen.getByRole("button", { name: "Start" }));
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const warningButton = within(summaryRegion).getByRole("button", {
      name: /questionable surface for a road bike/i,
    });
    await user.click(warningButton);

    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  describe("map-to-list warning selection", () => {
    // jsdom doesn't implement scrollIntoView at all, and RouteSummaryPanel
    // now calls it whenever a warning is selected via the map.
    let scrollIntoViewSpy: ReturnType<
      typeof vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>
    >;
    // Saved only to restore afterwards, never called unbound.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    beforeEach(() => {
      scrollIntoViewSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewSpy;
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    async function renderWithCalculatedWarnings(
      map: ReturnType<typeof createMockMapFactory>,
      user: ReturnType<typeof userEvent.setup>,
      route: PlannedRoute = buildRouteWithWarnings(),
    ): Promise<HTMLElement> {
      await saveProviderKey("dummy-test-key");
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);

      return waitFor(() => {
        const region = screen.getByRole("region", { name: "Route summary" });
        expect(region).toBeInTheDocument();
        return region;
      });
    }

    it("tapping a warning segment on the map selects it in the summary panel and frames/highlights it exactly like a list selection", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(map, user);
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });
      expect(warningButton).toHaveAttribute("aria-pressed", "false");

      const fitBoundsCallsBeforeSelect = map.fitBoundsSpy.mock.calls.length;
      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);

      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(warningButton).toHaveClass("is-selected");
      expect(warningButton).toHaveTextContent("✓");
      expect(map.fitBoundsSpy.mock.calls.length).toBeGreaterThan(
        fitBoundsCallsBeforeSelect,
      );
      await waitFor(() => {
        expect(map.sources.get("acn-warning-selected")?.features).toHaveLength(1);
      });
    });

    it("cancels a pending move, returning it to plain selected (matching the existing list-selection policy)", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(map, user);

      await user.click(screen.getByRole("button", { name: "Start" }));
      await user.click(screen.getByRole("button", { name: "Move" }));
      expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);

      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });
      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      // The waypoint itself stays selected — only the pending move is
      // cancelled, exactly as the existing list-selection policy already
      // behaves (see "selecting a warning cancels a pending move/insert-
      // after and returns to selected mode" above).
      expect(screen.getByRole("button", { name: "Start" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("performs no waypoint mutation when a tap hits a warning while append mode is visibly active", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      await renderWithCalculatedWarnings(map, user);
      // No waypoint is selected, so the crosshair is in "append" mode.
      expect(
        screen.getByRole("button", { name: "Add waypoint here" }),
      ).toBeInTheDocument();

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);

      expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
    });

    it("a subsequent bare map tap (no warning hit) still never places a waypoint after a map-originated selection", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      await renderWithCalculatedWarnings(map, user);

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);
      map.setWarningHit(null);
      map.triggerMapTap([0.5, 51]);

      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
    });

    it("repeated taps on the same already-selected warning stay selected, mutate nothing, and each re-reveal the list entry", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(map, user);
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

      map.triggerMapTap([0.15, 51]);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);

      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
    });

    it("the explicit Clear warning selection button clears a map-originated selection", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(map, user);
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");

      await user.click(screen.getByRole("button", { name: "Clear warning selection" }));

      expect(warningButton).toHaveAttribute("aria-pressed", "false");
    });

    it("a genuine route recalculation clears a map-originated selection", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(map, user);
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");

      // Undo dispatches directly (bypassing handlePlacementAt's own
      // warning-selection guard, unlike a crosshair tap) and drops the
      // waypoint count below 2, which invalidates the routed result
      // entirely — the summary panel (and its warning list) disappears
      // along with it, confirming no stale warning selection survives a
      // genuine recalculation.
      await user.click(screen.getByRole("button", { name: "Undo" }));

      await waitFor(() => {
        expect(screen.queryByRole("region", { name: "Route summary" })).toBeNull();
      });
    });

    it("a bare map tap with no configured hit behaves exactly as today (regression guard)", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      await renderWithCalculatedWarnings(map, user);

      map.triggerMapTap([0.5, 51]);

      expect(screen.getByRole("button", { name: "Waypoint 3" })).toBeInTheDocument();
    });

    it("tapping a structural (ferry) warning segment on the map selects it in the summary panel", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(
        map,
        user,
        buildRouteWithStructuralWarnings(),
      );
      const ferryButton = within(summaryRegion).getByRole("button", {
        name: /route includes a ferry/i,
      });
      expect(ferryButton).toHaveAttribute("aria-pressed", "false");

      // route.warnings[2] is the ferry warning in buildRouteWithStructuralWarnings.
      map.setWarningHit(2);
      map.triggerMapTap([0.55, 51]);

      expect(ferryButton).toHaveAttribute("aria-pressed", "true");
      await waitFor(() => {
        expect(map.sources.get("acn-warning-selected")?.features).toHaveLength(1);
      });
    });

    it("expands the specific surface detail from both a list click and a map-originated selection", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedWarnings(
        map,
        user,
        buildRouteWithSurfaceDetailWarning(),
      );
      const button = within(summaryRegion).getByRole("button", {
        name: /^Questionable surface/,
      });
      expect(button).toHaveTextContent("Questionable surface · 210 m");

      // List-originated selection.
      await user.click(button);
      expect(
        within(summaryRegion).getByText("Surface: Compacted gravel"),
      ).toBeInTheDocument();

      // Toggle off, then reveal the same detail via a map-originated tap.
      await user.click(button);
      expect(screen.queryByText("Surface: Compacted gravel")).toBeNull();

      map.setWarningHit(0);
      map.triggerMapTap([0.15, 51]);

      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(
        within(summaryRegion).getByText("Surface: Compacted gravel"),
      ).toBeInTheDocument();
      expect(
        within(summaryRegion).getByText("Route position: 0.1–0.3 km"),
      ).toBeInTheDocument();
    });
  });

  describe("route feature selection", () => {
    // jsdom doesn't implement scrollIntoView at all, and RouteSummaryPanel
    // calls it whenever a warning is selected via the map (part of the
    // mutual-exclusivity test below, which selects a warning first).
    let scrollIntoViewSpy: ReturnType<
      typeof vi.fn<(options?: boolean | ScrollIntoViewOptions) => void>
    >;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    beforeEach(() => {
      scrollIntoViewSpy = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewSpy;
    });

    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    async function renderWithCalculatedClimb(
      map: ReturnType<typeof createMockMapFactory>,
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<HTMLElement> {
      await saveProviderKey("dummy-test-key");
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(buildRouteWithClimb())}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);

      return waitFor(() => {
        const region = screen.getByRole("region", { name: "Route summary" });
        expect(region).toBeInTheDocument();
        return region;
      });
    }

    it("detects the recognised climb and lists it in the route-features legend", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedClimb(map, user);

      expect(
        within(summaryRegion).getByRole("list", {
          name: "Recognised route features legend",
        }),
      ).toBeInTheDocument();
      expect(within(summaryRegion).getByText(/Category 4 climb/)).toBeInTheDocument();
    });

    it("tapping the climb on the map selects it and shows the details panel", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedClimb(map, user);

      expect(
        within(summaryRegion).queryByRole("region", { name: "Route feature details" }),
      ).toBeNull();

      map.setRouteFeatureHit("climb-0");
      map.triggerMapTap([0.005, 51]);

      const detailsPanel = within(summaryRegion).getByRole("region", {
        name: "Route feature details",
      });
      expect(
        within(detailsPanel).getByRole("heading", { name: "Category 4 climb" }),
      ).toBeInTheDocument();
    });

    it("selecting a route feature clears any existing warning selection, and vice versa", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedClimb(map, user);
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });

      map.setWarningHit(0);
      map.triggerMapTap([0.001, 51]);
      expect(warningButton).toHaveAttribute("aria-pressed", "true");

      map.setWarningHit(null);
      map.setRouteFeatureHit("climb-0");
      map.triggerMapTap([0.005, 51]);

      expect(warningButton).toHaveAttribute("aria-pressed", "false");
      expect(
        within(summaryRegion).getByRole("region", { name: "Route feature details" }),
      ).toBeInTheDocument();

      // Reverse direction: selecting a warning again clears the feature.
      map.setRouteFeatureHit(null);
      map.setWarningHit(0);
      map.triggerMapTap([0.001, 51]);

      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(
        within(summaryRegion).queryByRole("region", { name: "Route feature details" }),
      ).toBeNull();
    });

    it("clearing the selection via the details panel's own control removes it and re-enables placement", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      const summaryRegion = await renderWithCalculatedClimb(map, user);

      map.setRouteFeatureHit("climb-0");
      map.triggerMapTap([0.005, 51]);
      expect(
        within(summaryRegion).getByRole("region", { name: "Route feature details" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Clear the selected route feature to place or move a waypoint."),
      ).toBeInTheDocument();

      await user.click(
        within(summaryRegion).getByRole("button", { name: "Clear selection" }),
      );

      expect(
        within(summaryRegion).queryByRole("region", { name: "Route feature details" }),
      ).toBeNull();
      expect(
        screen.queryByText(
          "Clear the selected route feature to place or move a waypoint.",
        ),
      ).toBeNull();
    });

    it("a bare map tap that misses the climb still falls through to placement (append mode appends normally)", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      await renderWithCalculatedClimb(map, user);

      expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();

      map.setRouteFeatureHit(null);
      map.triggerMapTap([0.02, 51]);

      // No route-feature hit: the tap reaches handlePlacementAt exactly
      // like today, and append mode (no waypoint selected) appends.
      expect(screen.getByRole("button", { name: "Waypoint 3" })).toBeInTheDocument();
    });
  });

  it("restores an old waypoint-only draft with routeName and avoidFerries defaulted", async () => {
    // A legacy draft row, written directly (not via saveDraft), which
    // genuinely lacks routeName/avoidFerries.
    await db.planningDrafts.put({
      id: "draft",
      waypoints: [
        { id: "a", coordinate: [0, 51] },
        { id: "b", coordinate: [0.01, 51] },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.getByLabelText("Route name")).toHaveValue("Planned route");
    // Restored draft: avoidFerries comes from mapping.ts's pre-existing
    // `?? true` legacy default, never from the Settings default.
    expect(screen.getByText(/Ferries: avoided for this plan/i)).toBeInTheDocument();
  });

  it("route name persists into the draft and survives a reload", async () => {
    const map = createMockMapFactory();
    const { unmount } = render(
      <PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />,
    );
    map.triggerLoad();

    map.triggerMapTap([0, 51]);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Route name"), {
      target: { value: "Coastal loop" },
    });

    await waitFor(
      async () => {
        const draft = await getDraft();
        expect(draft?.routeName).toBe("Coastal loop");
      },
      { timeout: 3000 },
    );

    unmount();

    const map2 = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map2.factory} />);
    map2.triggerLoad();

    await waitFor(() => {
      expect(screen.getByLabelText("Route name")).toHaveValue("Coastal loop");
    });
  });

  it("a genuinely fresh draft (no prior draft row) seeds avoidFerries from the current Settings default", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    map.triggerMapTap([0, 51]);
    map.triggerMapTap([0.01, 51]);

    await waitFor(() => {
      expect(screen.getByText(/Ferries: allowed for this plan/i)).toBeInTheDocument();
    });
  });

  it("treats an existing empty-waypoints draft row as genuinely fresh for ferry-default seeding", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });
    await db.planningDrafts.put({
      id: "draft",
      waypoints: [],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    map.triggerMapTap([0, 51]);
    map.triggerMapTap([0.01, 51]);

    await waitFor(() => {
      expect(screen.getByText(/Ferries: allowed for this plan/i)).toBeInTheDocument();
    });
  });

  it("a fresh draft keeps its seeded value even after the Settings default later changes and the app reloads", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: false });
    const map = createMockMapFactory();
    const { unmount } = render(
      <PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />,
    );
    map.triggerLoad();

    map.triggerMapTap([0, 51]);
    map.triggerMapTap([0.01, 51]);

    await waitFor(() => {
      expect(screen.getByText(/Ferries: allowed for this plan/i)).toBeInTheDocument();
    });
    await waitFor(
      async () => {
        const draft = await getDraft();
        expect(draft?.avoidFerries).toBe(false);
      },
      { timeout: 3000 },
    );
    unmount();

    await savePlanningPreferences({ avoidFerriesByDefault: true });

    const map2 = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map2.factory} />);
    map2.triggerLoad();

    await waitFor(() => {
      expect(screen.getByText(/Ferries: allowed for this plan/i)).toBeInTheDocument();
    });
  });

  it("changing the Settings ferry default afterwards leaves an already-restored draft, its policy, and routing untouched", async () => {
    await savePlanningPreferences({ avoidFerriesByDefault: true });
    await saveDraft({
      waypoints: [
        { id: "a", coordinate: [0, 51] },
        { id: "b", coordinate: [0.01, 51] },
      ],
      routeName: "Weekend loop",
      avoidFerries: true,
      profile: "cycling-road",
    });
    const calculateRouteSpy = vi.fn(() => Promise.resolve(buildRoute()));
    const map = createMockMapFactory();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={{ calculateRoute: calculateRouteSpy }}
      />,
    );
    map.triggerLoad();

    await waitFor(() => {
      expect(screen.getByText(/Ferries: avoided for this plan/i)).toBeInTheDocument();
    });
    const callCountBefore = calculateRouteSpy.mock.calls.length;

    await savePlanningPreferences({ avoidFerriesByDefault: false });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText(/Ferries: avoided for this plan/i)).toBeInTheDocument();
    const draft = await getDraft();
    expect(draft?.avoidFerries).toBe(true);
    expect(calculateRouteSpy.mock.calls.length).toBe(callCountBefore);
  });

  it("no longer exposes an editable Avoid ferries checkbox, and reports the draft's ferry policy as read-only text", async () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    await waitFor(() => {
      expect(
        screen.getByText(/Ferries: (avoided|allowed) for this plan/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Avoid ferries")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /avoid ferries/i })).toBeNull();
  });

  it("the ferry-policy readout's Change default in Settings action calls onNavigateToSettings", async () => {
    const handleNavigate = vi.fn();
    const user = userEvent.setup();
    const map = createMockMapFactory();
    render(
      <PlanningScreen onNavigateToSettings={handleNavigate} mapFactory={map.factory} />,
    );
    map.triggerLoad();

    await user.click(
      await screen.findByRole("button", { name: "Change default in Settings" }),
    );

    expect(handleNavigate).toHaveBeenCalledTimes(1);
  });

  describe("cycling profile selector", () => {
    // buildRoute(10)'s geometry is denser than the fixture's own 2
    // waypoints (required for canSaveOrExportPlan's own "denser than
    // waypoints" eligibility check) — unlike buildRouteForCall, which
    // returns exactly one point per waypoint and so would never satisfy
    // that check. Safe to ignore the requested leg endpoints here since
    // every test in this block places exactly 2 waypoints (one leg).
    function buildRouteForCallWithProfile(
      _waypoints: Coordinate[],
      profile: "cycling-road" | "cycling-regular",
    ): PlannedRoute {
      return {
        ...buildRoute(10),
        source: { kind: "planner", provider: "openrouteservice", profile },
      };
    }

    it("shows the selector with the correct accessible group label, choices and Road bike selected by default", () => {
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      const group = screen.getByRole("group", { name: "Cycling profile" });
      const roadBikeButton = within(group).getByRole("button", { name: "Road bike" });
      const generalCyclingButton = within(group).getByRole("button", {
        name: "General cycling",
      });

      expect(roadBikeButton).toHaveAttribute("aria-pressed", "true");
      expect(generalCyclingButton).toHaveAttribute("aria-pressed", "false");
      expect(roadBikeButton).toHaveClass("cycling-profile-button", "is-selected");
      expect(generalCyclingButton).toHaveClass("cycling-profile-button");
      expect(generalCyclingButton).not.toHaveClass("is-selected");
      expect(
        screen.getByText(/prefers roads suitable for a road bike/i),
      ).toBeInTheDocument();
    });

    it("switches the pressed state and explanatory text when General cycling is selected", async () => {
      const user = userEvent.setup();
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "General cycling" }));

      const roadBikeButton = screen.getByRole("button", { name: "Road bike" });
      const generalCyclingButton = screen.getByRole("button", {
        name: "General cycling",
      });
      expect(roadBikeButton).toHaveAttribute("aria-pressed", "false");
      expect(generalCyclingButton).toHaveAttribute("aria-pressed", "true");
      expect(roadBikeButton).toHaveClass("cycling-profile-button");
      expect(roadBikeButton).not.toHaveClass("is-selected");
      expect(generalCyclingButton).toHaveClass("cycling-profile-button", "is-selected");
      expect(
        screen.getByText(/may use more cycling infrastructure/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/prefers roads suitable for a road bike/i),
      ).not.toBeInTheDocument();

      await user.click(roadBikeButton);

      expect(roadBikeButton).toHaveAttribute("aria-pressed", "true");
      expect(roadBikeButton).toHaveClass("is-selected");
      expect(generalCyclingButton).toHaveAttribute("aria-pressed", "false");
      expect(generalCyclingButton).not.toHaveClass("is-selected");
    });

    it(
      "changing profile after a route exists recalculates every leg with the new profile, shows a " +
        "stale-labelled previous result meanwhile, disables Save/Export, and clears once the new " +
        "result lands",
      async () => {
        const user = userEvent.setup();
        await saveProviderKey("dummy-test-key");
        const map = createMockMapFactory();
        const { adapter, calls } = buildDeferredAdapter();
        render(
          <PlanningScreen
            onNavigateToSettings={vi.fn()}
            mapFactory={map.factory}
            routingProvider={adapter}
          />,
        );
        map.triggerLoad();

        await addWaypointViaCrosshair(map, user, [0, 51]);
        await addWaypointViaCrosshair(map, user, [0.01, 51]);
        const calculateButton = await waitFor(() => {
          const button = screen.getByRole("button", { name: /calculate route/i });
          expect(button).toBeEnabled();
          return button;
        });
        await user.click(calculateButton);
        await waitFor(() => {
          expect(calls).toHaveLength(1);
        });
        expect(calls[0]?.options.profile).toBe("cycling-road");
        calls[0]?.resolve(
          buildRouteForCallWithProfile(calls[0].waypoints, "cycling-road"),
        );

        await waitFor(() => {
          expect(
            screen.getByText(/Routed via openrouteservice · Road bike \(cycling-road\)/),
          ).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "Save route" })).toBeEnabled();

        await user.click(screen.getByRole("button", { name: "General cycling" }));

        // Stale immediately, before the debounced recalculation even starts.
        await waitFor(() => {
          expect(
            screen.getByText(
              "Recalculating for General cycling; showing the previous Road bike result below.",
            ),
          ).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "Save route" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Export GPX" })).toBeDisabled();
        // The retained result's own provenance is unchanged while stale.
        expect(
          screen.getByText(/Routed via openrouteservice · Road bike \(cycling-road\)/),
        ).toBeInTheDocument();

        await waitFor(() => {
          expect(calls).toHaveLength(2);
        });
        expect(calls[1]?.options.profile).toBe("cycling-regular");
        calls[1]?.resolve(
          buildRouteForCallWithProfile(calls[1].waypoints, "cycling-regular"),
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              /Routed via openrouteservice · General cycling \(cycling-regular\)/,
            ),
          ).toBeInTheDocument();
        });
        expect(
          screen.queryByText(/Recalculating for General cycling/),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Save route" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Export GPX" })).toBeEnabled();
      },
    );

    it(
      "never mixes profiles: General cycling always gets its own fresh request, and switching " +
        "back to an already-cached Road bike result reuses it with no new adapter call",
      async () => {
        const user = userEvent.setup();
        await saveProviderKey("dummy-test-key");
        const map = createMockMapFactory();
        const { adapter, calls } = buildDeferredAdapter();
        render(
          <PlanningScreen
            onNavigateToSettings={vi.fn()}
            mapFactory={map.factory}
            routingProvider={adapter}
          />,
        );
        map.triggerLoad();

        await addWaypointViaCrosshair(map, user, [0, 51]);
        await addWaypointViaCrosshair(map, user, [0.01, 51]);
        const calculateButton = await waitFor(() => {
          const button = screen.getByRole("button", { name: /calculate route/i });
          expect(button).toBeEnabled();
          return button;
        });
        await user.click(calculateButton);
        await waitFor(() => {
          expect(calls).toHaveLength(1);
        });
        expect(calls[0]?.options.profile).toBe("cycling-road");
        calls[0]?.resolve(
          buildRouteForCallWithProfile(calls[0].waypoints, "cycling-road"),
        );
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Save route" })).toBeEnabled();
        });

        await user.click(screen.getByRole("button", { name: "General cycling" }));
        await waitFor(() => {
          expect(calls).toHaveLength(2);
        });
        expect(calls[1]?.options.profile).toBe("cycling-regular");
        calls[1]?.resolve(
          buildRouteForCallWithProfile(calls[1].waypoints, "cycling-regular"),
        );
        await waitFor(() => {
          expect(
            screen.getByText(/Routed via openrouteservice · General cycling/),
          ).toBeInTheDocument();
        });

        // Switching back to Road bike with unchanged waypoints: the leg
        // cache already holds this exact profile/waypoint combination, so
        // it resolves with no third adapter call at all — the mechanism
        // that also guarantees a General cycling leg is never silently
        // reused as a Road bike one, or vice versa.
        await user.click(screen.getByRole("button", { name: "Road bike" }));
        await waitFor(() => {
          expect(
            screen.getByText(/Routed via openrouteservice · Road bike \(cycling-road\)/),
          ).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "Save route" })).toBeEnabled();
        expect(calls).toHaveLength(2);
      },
    );

    it("restores a persisted cycling profile from an existing draft", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Planned route",
        avoidFerries: true,
        profile: "cycling-regular",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "General cycling" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(screen.getByRole("button", { name: "Road bike" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("defaults a legacy draft with no stored profile to Road bike", async () => {
      await db.planningDrafts.put({
        id: "draft",
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Road bike" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
    });

    it("persists the selected cycling profile into the draft and survives a reload", async () => {
      const map = createMockMapFactory();
      const { unmount } = render(
        <PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />,
      );
      map.triggerLoad();

      map.triggerMapTap([0, 51]);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      });

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "General cycling" }));

      await waitFor(
        async () => {
          const draft = await getDraft();
          expect(draft?.profile).toBe("cycling-regular");
        },
        { timeout: 3000 },
      );

      unmount();

      const map2 = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map2.factory} />);
      map2.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "General cycling" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
    });
  });

  it(
    "restores a draft, edits waypoints via select/insert-after/move, undoes and redoes, " +
      "calculates via the mocked provider, and recovers the full draft after a reload, " +
      "without ever reaching the network",
    async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Weekend loop",
        avoidFerries: false,
        profile: "cycling-road",
      });
      const map = createMockMapFactory();
      const route = buildRoute(10);
      const { unmount } = render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildLegAwareResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      // 1. Restored draft, plus one more appended waypoint.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      });
      await addWaypointViaCrosshair(map, user, [0.02, 51]);
      expect(screen.getByRole("button", { name: "Waypoint 3" })).toBeInTheDocument();

      // 2. Select the middle waypoint.
      await user.click(screen.getByRole("button", { name: "Waypoint 2" }));

      // 3. Insert a new waypoint after it.
      await user.click(screen.getByRole("button", { name: "Insert after" }));
      map.triggerCameraSettled([0.015, 51]);
      await user.click(screen.getByRole("button", { name: "Insert after waypoint 2" }));
      expect(screen.getByRole("button", { name: "Waypoint 4" })).toBeInTheDocument();

      // 4. Move a (different) waypoint.
      await user.click(screen.getByRole("button", { name: "Start" }));
      await user.click(screen.getByRole("button", { name: "Move" }));
      map.triggerCameraSettled([0.5, 51]);
      await user.click(screen.getByRole("button", { name: "Move the start here" }));

      // 5. Undo and redo.
      await user.click(screen.getByRole("button", { name: "Undo" }));
      await user.click(screen.getByRole("button", { name: "Redo" }));

      // 6. Calculate through the mocked provider.
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);
      await waitFor(() => {
        expect(screen.getByRole("region", { name: "Route summary" })).toBeInTheDocument();
      });

      // 7. Reload — unmount and render a fresh instance against the same
      // fake-indexeddb-backed db, recovering waypoints/name/ferries.
      await waitFor(
        async () => {
          const draft = await getDraft();
          expect(draft?.waypoints).toHaveLength(4);
        },
        { timeout: 3000 },
      );
      unmount();

      const map2 = createMockMapFactory();
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map2.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map2.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Waypoint 4" })).toBeInTheDocument();
      });
      expect(screen.getByLabelText("Route name")).toHaveValue("Weekend loop");
      expect(screen.getByText(/Ferries: allowed for this plan/i)).toBeInTheDocument();

      // 8. No live network request was ever required.
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it(
    "calculates a route with warnings, shows surface totals, submits warning geometry " +
      "to the map, and lets selecting a warning highlight and frame it, without ever " +
      "reaching the network",
    async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRouteWithWarnings();
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);

      const summaryRegion = await waitFor(() => {
        const region = screen.getByRole("region", { name: "Route summary" });
        expect(region).toBeInTheDocument();
        return region;
      });

      // 1 & 2: a routed response was calculated and surface totals are shown.
      expect(within(summaryRegion).getByText("Paved: 600 m")).toBeInTheDocument();
      expect(within(summaryRegion).getByText("Questionable: 200 m")).toBeInTheDocument();
      expect(within(summaryRegion).getByText("Unsuitable: 100 m")).toBeInTheDocument();

      // 3: warning segments were submitted to the map's category sources.
      await waitFor(() => {
        expect(
          map.sources.get("acn-warning-questionable-surface")?.features,
        ).toHaveLength(1);
        expect(map.sources.get("acn-warning-unsuitable-surface")?.features).toHaveLength(
          1,
        );
      });

      // 4: selecting a warning highlights (aria-pressed + selected map
      // source) and frames it (a new fitBounds call beyond the initial
      // overview fit).
      const fitBoundsCallsBeforeSelect = map.fitBoundsSpy.mock.calls.length;
      const warningButton = within(summaryRegion).getByRole("button", {
        name: /questionable surface for a road bike/i,
      });
      expect(warningButton).toHaveAttribute("aria-pressed", "false");
      await user.click(warningButton);

      expect(warningButton).toHaveAttribute("aria-pressed", "true");
      expect(map.fitBoundsSpy.mock.calls.length).toBeGreaterThan(
        fitBoundsCallsBeforeSelect,
      );
      await waitFor(() => {
        expect(map.sources.get("acn-warning-selected")?.features).toHaveLength(1);
      });

      // Selecting again clears the selection.
      await user.click(warningButton);
      expect(warningButton).toHaveAttribute("aria-pressed", "false");
      await waitFor(() => {
        expect(map.sources.get("acn-warning-selected")?.features).toEqual([]);
      });

      // 5: the route remains saveable and exportable throughout.
      expect(screen.getByRole("button", { name: /save route/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /export gpx/i })).toBeEnabled();

      // 6: no live network request was ever required — the injected
      // routingProvider fully replaced the real ORS adapter.
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it(
    "renders steps/ford/ferry/other warnings, groups them into the existing obstacle/ferry/other " +
      "map categories, and lets selecting one from the list highlight and frame it",
    async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRouteWithStructuralWarnings();
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);

      const summaryRegion = await waitFor(() => {
        const region = screen.getByRole("region", { name: "Route summary" });
        expect(region).toBeInTheDocument();
        return region;
      });

      expect(
        within(summaryRegion).getByRole("button", { name: /route includes steps/i }),
      ).toBeInTheDocument();
      expect(
        within(summaryRegion).getByRole("button", { name: /route includes a ford/i }),
      ).toBeInTheDocument();
      expect(
        within(summaryRegion).getByRole("button", { name: /route includes a ferry/i }),
      ).toBeInTheDocument();
      expect(
        within(summaryRegion).getByRole("button", {
          name: /route includes a construction-designated way/i,
        }),
      ).toBeInTheDocument();

      // steps + ford share the "obstacle" map category; ferry and other
      // each have their own — the existing (unchanged) category grouping
      // in src/map/warningLayer.ts.
      await waitFor(() => {
        expect(map.sources.get("acn-warning-obstacle")?.features).toHaveLength(2);
        expect(map.sources.get("acn-warning-ferry")?.features).toHaveLength(1);
        expect(map.sources.get("acn-warning-other")?.features).toHaveLength(1);
      });

      const fitBoundsCallsBeforeSelect = map.fitBoundsSpy.mock.calls.length;
      const ferryButton = within(summaryRegion).getByRole("button", {
        name: /route includes a ferry/i,
      });
      expect(ferryButton).toHaveAttribute("aria-pressed", "false");
      await user.click(ferryButton);

      expect(ferryButton).toHaveAttribute("aria-pressed", "true");
      expect(map.fitBoundsSpy.mock.calls.length).toBeGreaterThan(
        fitBoundsCallsBeforeSelect,
      );
      await waitFor(() => {
        expect(map.sources.get("acn-warning-selected")?.features).toHaveLength(1);
      });
    },
  );

  it("selecting a structural warning still prevents accidental waypoint placement", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const route = buildRouteWithStructuralWarnings();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={buildResolvedAdapter(route)}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    const summaryRegion = await waitFor(() => {
      const region = screen.getByRole("region", { name: "Route summary" });
      expect(region).toBeInTheDocument();
      return region;
    });
    const stepsButton = within(summaryRegion).getByRole("button", {
      name: /route includes steps/i,
    });
    await user.click(stepsButton);

    expect(screen.getByRole("button", { name: "Add waypoint here" })).toBeDisabled();

    map.triggerMapTap([0.5, 51]);

    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waypoint 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Waypoint 3" })).toBeNull();
  });

  it("shows a per-section count while calculating a route needing more than one new leg", async () => {
    const user = userEvent.setup();
    await saveProviderKey("dummy-test-key");
    const map = createMockMapFactory();
    const { adapter, calls } = buildDeferredAdapter();
    render(
      <PlanningScreen
        onNavigateToSettings={vi.fn()}
        mapFactory={map.factory}
        routingProvider={adapter}
      />,
    );
    map.triggerLoad();

    await addWaypointViaCrosshair(map, user, [0, 51]);
    await addWaypointViaCrosshair(map, user, [0.01, 51]);
    await addWaypointViaCrosshair(map, user, [0.02, 51]);

    const calculateButton = await waitFor(() => {
      const button = screen.getByRole("button", { name: /calculate route/i });
      expect(button).toBeEnabled();
      return button;
    });
    await user.click(calculateButton);

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(
      screen.getByRole("button", { name: "Calculating 2 route sections…" }),
    ).toBeInTheDocument();

    calls[0]?.resolve(buildRouteForCall(calls[0].waypoints));
    calls[1]?.resolve(buildRouteForCall(calls[1].waypoints));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Route summary" })).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /calculating/i }),
    ).not.toBeInTheDocument();
  });

  it("explains that a route is calculated in per-waypoint sections", () => {
    const map = createMockMapFactory();
    render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
    map.triggerLoad();

    expect(
      screen.getByText(/calculated in sections between waypoints/i),
    ).toBeInTheDocument();
  });

  describe("edit-copy notice and planning provenance", () => {
    it("shows no edit-copy notice for an ordinary restored draft", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Planned route",
        avoidFerries: true,
        profile: "cycling-road",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      });
      expect(screen.queryByText(/editable copy/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/editable waypoints were estimated/i),
      ).not.toBeInTheDocument();
    });

    it("shows the exact-provenance notice for a draft restored with exact edit-copy waypoints", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows the derived-provenance notice for a draft restored with derived edit-copy waypoints", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "derived",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("keeps the edit-copy notice, and the underlying draft fields, after an unrelated waypoint edit (autosave regression)", async () => {
      const user = userEvent.setup();
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByText(/editable copy created/i)).toBeInTheDocument();
      });

      // An unrelated edit (adding a third waypoint) triggers the debounced
      // autosave effect. Without threading editCopyMeta through every
      // saveDraft call, this would silently drop the edit-copy fields.
      await addWaypointViaCrosshair(map, user, [0.02, 51]);

      await waitFor(
        async () => {
          const draft = await getDraft();
          expect(draft?.waypoints).toHaveLength(3);
        },
        { timeout: 3000 },
      );

      const draft = await getDraft();
      expect(draft?.editCopySourceRouteId).toBe("route-1");
      expect(draft?.editCopyWaypointsOrigin).toBe("exact");
      expect(screen.getByText(/editable copy created/i)).toBeInTheDocument();
    });

    it("clears the edit-copy notice once the copy is saved", async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
      });
      const map = createMockMapFactory();
      const route = buildRoute(10);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByText(/editable copy created/i)).toBeInTheDocument();
      });

      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /save route/i })).toBeEnabled();
      });

      // Re-arms the draft-autosave debounce immediately before Save, then
      // clicks Save right away — see the identical comment in "saving
      // clears the draft, resets waypoints and notifies the caller" above
      // for the exact race (CLAUDE.md backlog item 30) this proves closed.
      fireEvent.change(screen.getByLabelText("Route name"), {
        target: { value: "Coastal loop, renamed before Save" },
      });
      await user.click(screen.getByRole("button", { name: /save route/i }));

      await waitFor(() => {
        expect(screen.queryByText(/editable copy created/i)).not.toBeInTheDocument();
      });

      const draft = await getDraft();
      expect(draft).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const draftAfterDebounce = await getDraft();
      expect(draftAfterDebounce).toBeUndefined();
    });

    it("shows the reverse+exact notice for a draft restored with editCopyOperation reverse and exact origin", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop (reversed)",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
        editCopyOperation: "reverse",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows the reverse+derived notice for a draft restored with editCopyOperation reverse and derived origin", async () => {
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop (reversed)",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "derived",
        editCopyOperation: "reverse",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("treats a legacy draft with no editCopyOperation field at all as an ordinary forward edit copy", async () => {
      // Simulates a real draft written by the "Edit copy in Planning"
      // slice before Reverse route (and editCopyOperation) existed — no
      // editCopyOperation key at all, not merely undefined.
      await db.planningDrafts.put({
        id: "draft",
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        updatedAt: "2026-01-01T00:00:00.000Z",
        routeName: "Coastal loop",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(
          screen.getByText(
            "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
          ),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText(/reversed/i)).not.toBeInTheDocument();
    });

    it("keeps the reverse notice, and the underlying editCopyOperation, after an unrelated waypoint edit (autosave regression)", async () => {
      const user = userEvent.setup();
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Coastal loop (reversed)",
        avoidFerries: true,
        profile: "cycling-road",
        editCopySourceRouteId: "route-1",
        editCopyWaypointsOrigin: "exact",
        editCopyOperation: "reverse",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByText(/reversed editable copy created/i)).toBeInTheDocument();
      });

      await addWaypointViaCrosshair(map, user, [0.02, 51]);

      await waitFor(
        async () => {
          const draft = await getDraft();
          expect(draft?.waypoints).toHaveLength(3);
        },
        { timeout: 3000 },
      );

      const draft = await getDraft();
      expect(draft?.editCopySourceRouteId).toBe("route-1");
      expect(draft?.editCopyWaypointsOrigin).toBe("exact");
      expect(draft?.editCopyOperation).toBe("reverse");
      expect(screen.getByText(/reversed editable copy created/i)).toBeInTheDocument();
    });

    it("shows no notice for an ordinary hand-built draft, regardless of editCopyOperation's resolved default", async () => {
      // The two-field gate (editCopySourceRouteId + editCopyWaypointsOrigin)
      // is what suppresses the notice, not editCopyOperation — this draft
      // has neither field, so getDraft() resolves editCopyOperation to
      // "forward" internally, but no notice must appear.
      await saveDraft({
        waypoints: [
          { id: "a", coordinate: [0, 51] },
          { id: "b", coordinate: [0.01, 51] },
        ],
        routeName: "Planned route",
        avoidFerries: true,
        profile: "cycling-road",
      });
      const map = createMockMapFactory();
      render(<PlanningScreen onNavigateToSettings={vi.fn()} mapFactory={map.factory} />);
      map.triggerLoad();

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
      });
      expect(screen.queryByText(/editable copy/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/reversed/i)).not.toBeInTheDocument();
    });

    it("stamps planningProvenance from live waypoints, profile and avoid-ferries when saving", async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRoute(10);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await user.click(screen.getByRole("button", { name: "General cycling" }));
      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /save route/i })).toBeEnabled();
      });

      await user.click(screen.getByRole("button", { name: /save route/i }));

      await waitFor(async () => {
        const routes = await listRoutes();
        expect(routes).toHaveLength(1);
      });
      const [saved] = await listRoutes();
      expect(saved?.planningProvenance).toEqual({
        kind: "planning-session",
        waypoints: [
          [0, 51],
          [0.01, 51],
        ],
        profile: "cycling-regular",
        avoidFerries: true,
      });
    });

    it("stamps planningProvenance from live waypoints when exporting", async () => {
      const user = userEvent.setup();
      await saveProviderKey("dummy-test-key");
      const map = createMockMapFactory();
      const route = buildRoute(10);
      render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
        />,
      );
      map.triggerLoad();

      await addWaypointViaCrosshair(map, user, [0, 51]);
      await addWaypointViaCrosshair(map, user, [0.01, 51]);
      const calculateButton = await waitFor(() => {
        const button = screen.getByRole("button", { name: /calculate route/i });
        expect(button).toBeEnabled();
        return button;
      });
      await user.click(calculateButton);
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /export gpx/i })).toBeEnabled();
      });

      let capturedBlob: Blob | null = null;
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = vi.fn((blob: Blob) => {
        capturedBlob = blob;
        return "blob:mock-url";
      });
      URL.revokeObjectURL = vi.fn();

      try {
        await user.click(screen.getByRole("button", { name: /export gpx/i }));
        await waitFor(() => {
          expect(capturedBlob).not.toBeNull();
        });
        const text = await (capturedBlob as unknown as Blob).text();
        expect(text).toContain("acn:planning");
        expect(text).toContain('lon="0"');
        expect(text).toContain('profile="cycling-road"');
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }
    });
  });
});
