import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsScreen } from "./DiagnosticsScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import {
  clearRoutingDiagnostics,
  recordRoutingAttempt,
  type RoutingAttemptDiagnostic,
} from "../../routing/routingDiagnostics.ts";
import { clearMapDiagnostics, recordMapAttempt } from "../../map/mapDiagnostics.ts";
import type { Clock } from "../../platform/clock.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { PlannedRoute } from "../../domain/types.ts";

function fakeRoutingProvider(behaviour: () => Promise<PlannedRoute>): RoutingProvider {
  return { calculateRoute: () => behaviour() };
}

function buildFakeRoute(): PlannedRoute {
  return {
    id: "route-1",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function buildAttempt(
  overrides: Partial<RoutingAttemptDiagnostic> &
    Pick<RoutingAttemptDiagnostic, "timestampIso" | "responseReceived" | "category">,
): RoutingAttemptDiagnostic {
  return {
    attemptId: overrides.timestampIso,
    providerId: "openrouteservice",
    endpointHost: "api.heigit.org",
    endpointPath: "/directions/cycling-road/geojson",
    httpMethod: "POST",
    wasOnline: true,
    isSecureContext: true,
    isServiceWorkerControlled: false,
    isStandalone: false,
    waypointCount: 2,
    elapsedMs: 0,
    headersConstructed: true,
    requestConstructed: true,
    fetchInvoked: true,
    fetchReturnedPromise: true,
    ...overrides,
  };
}

function getDetailValue(termText: string): HTMLElement {
  const term = screen.getByText(termText);
  const value = term.nextElementSibling;
  if (!value) throw new Error(`no <dd> found after <dt>${termText}</dt>`);
  return value as HTMLElement;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
  clearRoutingDiagnostics();
  clearMapDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiagnosticsScreen", () => {
  it("renders every field with a value or an explicit placeholder, never blank", async () => {
    render(<DiagnosticsScreen />);

    expect(getDetailValue("App version")).toHaveTextContent(__APP_VERSION__);
    expect(getDetailValue("Network")).toHaveTextContent(/online|offline/i);
    expect(getDetailValue("Service worker")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Map rendering support")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Geolocation permission")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Last known fix accuracy")).toHaveTextContent(
      "Not applicable yet",
    );
    expect(getDetailValue("Last known fix age")).toHaveTextContent("Not applicable yet");
    expect(getDetailValue("Active route")).toHaveTextContent("None");
    expect(screen.getByText(/no errors recorded this session/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(getDetailValue("Storage")).toHaveTextContent(/OK \(schema version 2\)/);
    });
  });

  it("reflects a granted geolocation permission from the Permissions API", async () => {
    vi.stubGlobal("navigator", {
      onLine: true,
      permissions: {
        query: () =>
          Promise.resolve({
            state: "granted",
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }),
      },
      geolocation: {},
    });

    render(<DiagnosticsScreen />);

    await waitFor(() => {
      expect(getDetailValue("Geolocation permission")).toHaveTextContent("Granted");
    });
  });

  it("shows the last known fix accuracy/age and active route id from a persisted ride state", async () => {
    const fixedClock: Clock = { now: () => 60_000 };
    await setActiveRideState({
      id: "active",
      routeId: "route-42",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastFix: { coordinate: [-1.5, 53.8], accuracyMetres: 9.2, timestampMs: 30_000 },
      lastMatchedPointIndex: 3,
      matchedDistanceFromStartMetres: 150,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      elevationWindowMetres: 5000,
    });

    render(<DiagnosticsScreen clock={fixedClock} />);

    await waitFor(() => {
      expect(getDetailValue("Last known fix accuracy")).toHaveTextContent("±9 m");
    });
    expect(getDetailValue("Last known fix age")).toHaveTextContent("30s ago");
    expect(getDetailValue("Active route")).toHaveTextContent("route-42");
  });

  it("shows no routing attempts recorded this session by default", () => {
    render(<DiagnosticsScreen />);

    expect(
      screen.getByText(/no routing attempts recorded this session/i),
    ).toBeInTheDocument();
  });

  it("distinguishes a received HTTP response, offline, timeout and an unexposed fetch failure, and explains the CORS/502 ambiguity", () => {
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:00:00.000Z",
        elapsedMs: 200,
        responseReceived: true,
        httpStatus: 502,
        category: "provider-unavailable",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:01:00.000Z",
        wasOnline: false,
        responseReceived: false,
        category: "offline",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:02:00.000Z",
        elapsedMs: 15_000,
        responseReceived: false,
        category: "timeout",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:03:00.000Z",
        elapsedMs: 50,
        responseReceived: false,
        category: "transport-failure",
      }),
    );

    render(<DiagnosticsScreen />);

    expect(
      screen.getByText("HTTP response received: 502 (provider-unavailable)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Device reported offline")).toBeInTheDocument();
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(
      screen.getByText("Fetch promise rejected before an HTTP response was exposed"),
    ).toBeInTheDocument();
    expect(screen.getByText(/missing CORS headers/i)).toBeInTheDocument();
  });

  it("shows no map imagery attempts recorded this session by default", () => {
    render(<DiagnosticsScreen />);

    expect(
      screen.getByText(/no map imagery attempts recorded this session/i),
    ).toBeInTheDocument();
  });

  it("shows recorded map imagery attempts in plain language", () => {
    recordMapAttempt({
      timestampIso: "2026-01-01T00:00:00.000Z",
      tileProviderId: "openfreemap-liberty",
      category: "fallback-activated",
      wasOnline: true,
      justResumed: false,
    });
    recordMapAttempt({
      timestampIso: "2026-01-01T00:01:00.000Z",
      tileProviderId: "openfreemap-liberty",
      category: "auto-retry",
      wasOnline: true,
      justResumed: true,
    });

    render(<DiagnosticsScreen />);

    expect(screen.getByText(/switched to the plain background/i)).toBeInTheDocument();
    expect(screen.getByText(/automatically/i)).toBeInTheDocument();
  });

  describe("Test routing connection", () => {
    it("states the one-request cost up front and disables the button with no key configured", () => {
      render(<DiagnosticsScreen />);

      expect(screen.getByText(/uses one API request/i)).toBeInTheDocument();
      expect(screen.getByText(/no openrouteservice key configured/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Test routing connection" }),
      ).toBeDisabled();
    });

    it("never runs automatically on mount", () => {
      const calculateRoute = vi.fn(() => Promise.resolve(buildFakeRoute()));

      render(<DiagnosticsScreen routingProvider={{ calculateRoute }} />);

      expect(calculateRoute).not.toHaveBeenCalled();
    });

    it("runs one request on click and shows a success result, never the coordinates", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const calculateRoute = vi.fn(() => Promise.resolve(buildFakeRoute()));

      render(<DiagnosticsScreen routingProvider={{ calculateRoute }} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      expect(calculateRoute).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/8\.681495/)).not.toBeInTheDocument();
    });

    it("shows the hedged, non-CORS-confirming explanation on a transport failure", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.reject(
          new RoutingError({
            reason: "transport-failure",
            message: "The routing request failed.",
            transportErrorName: "TypeError",
            transportErrorMessage: "Failed to fetch",
            transportFailureReasonCode: "generic-fetch-rejection",
            dispatchMarkers: {
              headersConstructed: true,
              requestConstructed: true,
              fetchInvoked: true,
              fetchReturnedPromise: true,
              responseReceived: false,
            },
          }),
        ),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Failed/);
      });
      expect(
        screen.getByText(/browser or network may have blocked the request/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/transport-response-unavailable/)).toBeInTheDocument();
      expect(screen.getByText("TypeError: Failed to fetch")).toBeInTheDocument();
      expect(screen.getByText("generic-fetch-rejection")).toBeInTheDocument();
    });

    it("shows every dispatch marker in the visible result, not just the copied report", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      expect(screen.getByText("Headers constructed")).toBeInTheDocument();
      expect(screen.getByText("Request constructed")).toBeInTheDocument();
      expect(screen.getByText("Fetch invoked")).toBeInTheDocument();
      expect(screen.getByText("Fetch returned a promise")).toBeInTheDocument();
      expect(screen.getByText("HTTP response received")).toBeInTheDocument();
    });

    it("copies a report that never contains the coordinates or a key", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        onLine: true,
        clipboard: { writeText },
      });

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      await user.click(screen.getByRole("button", { name: "Copy diagnostic report" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      const [report] = writeText.mock.calls[0] as [string];
      expect(report).not.toContain("8.681495");
      expect(report).not.toContain("dummy-test-key");
      expect(report).toContain("App version:");
    });
  });
});
