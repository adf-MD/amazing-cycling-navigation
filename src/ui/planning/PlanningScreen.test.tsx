import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningScreen } from "./PlanningScreen.tsx";
import type { Coordinate, PlannedRoute } from "../../domain/types.ts";
import type { MapFactory, MapLibreLike } from "../../map/mapAdapter.ts";
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
  setCameraSpy: ReturnType<typeof vi.fn>;
}

function createMockMapFactory(): MockMapHandle {
  let loadListener: (() => void) | undefined;
  let cameraSettledListener:
    | ((camera: {
        coordinate: Coordinate;
        zoom: number;
        bearingDegrees: number;
        pitchDegrees: number;
      }) => void)
    | undefined;
  let mapTapListener: ((coordinate: Coordinate) => void) | undefined;
  const setCameraSpy = vi.fn();

  const factory: MapFactory = () => {
    const map: MapLibreLike = {
      onLoad: (listener) => {
        loadListener = listener;
      },
      onError: () => undefined,
      onSourceData: () => undefined,
      addGeoJsonSource: () => undefined,
      setGeoJsonSourceData: () => undefined,
      hasSource: () => false,
      addLineLayer: () => undefined,
      addCircleLayer: () => undefined,
      hasLayer: () => false,
      fitBounds: () => undefined,
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
      remove: () => undefined,
    };
    return map;
  };

  return {
    factory,
    setCameraSpy,
    triggerLoad: () => {
      act(() => {
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

function buildResolvedAdapter(route: PlannedRoute): RoutingProvider {
  return {
    calculateRoute: () => Promise.resolve(route),
  };
}

async function addWaypointViaCrosshair(
  map: MockMapHandle,
  user: ReturnType<typeof userEvent.setup>,
  coordinate: Coordinate,
): Promise<void> {
  map.triggerCameraSettled(coordinate);
  await user.click(
    screen.getByRole("button", { name: /add waypoint here|move selected/i }),
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
    await saveDraft([
      { id: "a", coordinate: [0, 51] },
      { id: "b", coordinate: [0.01, 51] },
    ]);
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
});
