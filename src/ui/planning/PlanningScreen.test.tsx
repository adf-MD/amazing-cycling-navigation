import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import { db } from "../../storage/db.ts";
import { getDraft, saveDraft } from "../../storage/planningDraftRepository.ts";
import { listRoutes } from "../../storage/routesRepository.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";

interface MockMapHandle {
  factory: MapFactory;
  triggerLoad: () => void;
  triggerCameraSettled: (coordinate: Coordinate) => void;
  triggerMapTap: (coordinate: Coordinate) => void;
  /** Configures what the next (and subsequent) queryTopWarningFeatureAt
   * calls report as hit — null (the default) means every tap misses every
   * warning feature and falls through to placement, exactly like today. */
  setWarningHit: (warningIndex: number | null) => void;
  setCameraSpy: ReturnType<typeof vi.fn>;
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
  let warningHitIndex: number | null = null;
  const setCameraSpy = vi.fn();
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
      fitBounds: fitBoundsSpy,
      getCenter: () => [0, 51],
      getZoom: () => 14,
      onUserCameraInteraction: () => undefined,
      onCameraSettled: (listener) => {
        cameraSettledListener = listener;
      },
      setCamera: setCameraSpy,
      resize: () => undefined,
      onMapTap: (listener) => {
        mapTapListener = listener;
      },
      queryTopWarningFeatureAt: () =>
        warningHitIndex === null ? null : { warningIndex: warningHitIndex },
      remove: () => undefined,
    };
    return map;
  };

  return {
    factory,
    setCameraSpy,
    fitBoundsSpy,
    addLineLayerSpy,
    sources,
    setWarningHit: (warningIndex) => {
      warningHitIndex = warningIndex;
    },
    triggerLoad: () => {
      act(() => {
        // Real MapLibre always fires "style.load" strictly before "load".
        styleLoadedListener?.();
        loadListener?.();
      });
    },
    triggerCameraSettled: (coordinate) => {
      act(() => {
        cameraSettledListener?.({
          coordinate,
          zoom: 14,
          bearingDegrees: 0,
          pitchDegrees: 0,
        });
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

function buildResolvedAdapter(route: PlannedRoute): RoutingProvider {
  return {
    calculateRoute: () => Promise.resolve(route),
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
  await db.routes.clear();
});

describe("PlanningScreen", () => {
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
    expect(screen.getByText("No waypoints placed yet.")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /save route/i }));

    await waitFor(() => {
      expect(onRouteSaved).toHaveBeenCalledTimes(1);
    });
    const saved = onRouteSaved.mock.calls[0]?.[0] as PlannedRoute;
    expect(saved.name).toBe("Planned route");

    const routes = await listRoutes();
    expect(routes).toHaveLength(1);

    const draft = await getDraft();
    expect(draft).toBeUndefined();
    expect(screen.getByText("No waypoints placed yet.")).toBeInTheDocument();
  });

  it("centres a fresh session on an approximate location, at a regional zoom", async () => {
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
      expect(map.setCameraSpy).toHaveBeenCalledWith([-1.5, 53.8], 6, 0, 0, {
        animate: false,
        followOffset: false,
      });
    });
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
    expect(map.setCameraSpy).not.toHaveBeenCalled();
  });

  it("never requests a location for a session restored from an existing draft", async () => {
    await saveDraft({
      waypoints: [
        { id: "a", coordinate: [0, 51] },
        { id: "b", coordinate: [0.01, 51] },
      ],
      routeName: "Planned route",
      avoidFerries: true,
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
    expect(screen.getByLabelText("Avoid ferries")).toBeChecked();
  });

  it("route name and avoid-ferries preference persist into the draft and survive a reload", async () => {
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
    fireEvent.click(screen.getByLabelText("Avoid ferries"));

    await waitFor(
      async () => {
        const draft = await getDraft();
        expect(draft?.routeName).toBe("Coastal loop");
        expect(draft?.avoidFerries).toBe(false);
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
    expect(screen.getByLabelText("Avoid ferries")).not.toBeChecked();
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
      });
      const map = createMockMapFactory();
      const route = buildRoute(10);
      const { unmount } = render(
        <PlanningScreen
          onNavigateToSettings={vi.fn()}
          mapFactory={map.factory}
          routingProvider={buildResolvedAdapter(route)}
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
      expect(screen.getByLabelText("Avoid ferries")).not.toBeChecked();

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
});
