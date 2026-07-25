import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiagnosticsScreen } from "./DiagnosticsScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import {
  clearRoutingDiagnostics,
  recordRoutingAttempt,
} from "../../routing/routingDiagnostics.ts";
import type { Clock } from "../../platform/clock.ts";

function getDetailValue(termText: string): HTMLElement {
  const term = screen.getByText(termText);
  const value = term.nextElementSibling;
  if (!value) throw new Error(`no <dd> found after <dt>${termText}</dt>`);
  return value as HTMLElement;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  clearRoutingDiagnostics();
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
    recordRoutingAttempt({
      timestampIso: "2026-01-01T00:00:00.000Z",
      providerId: "openrouteservice",
      endpointHost: "api.heigit.org",
      endpointPath: "/directions/cycling-road/geojson",
      wasOnline: true,
      elapsedMs: 200,
      responseReceived: true,
      httpStatus: 502,
      category: "provider-unavailable",
    });
    recordRoutingAttempt({
      timestampIso: "2026-01-01T00:01:00.000Z",
      providerId: "openrouteservice",
      endpointHost: "api.heigit.org",
      endpointPath: "/directions/cycling-road/geojson",
      wasOnline: false,
      elapsedMs: 0,
      responseReceived: false,
      category: "offline",
    });
    recordRoutingAttempt({
      timestampIso: "2026-01-01T00:02:00.000Z",
      providerId: "openrouteservice",
      endpointHost: "api.heigit.org",
      endpointPath: "/directions/cycling-road/geojson",
      wasOnline: true,
      elapsedMs: 15_000,
      responseReceived: false,
      category: "timeout",
    });
    recordRoutingAttempt({
      timestampIso: "2026-01-01T00:03:00.000Z",
      providerId: "openrouteservice",
      endpointHost: "api.heigit.org",
      endpointPath: "/directions/cycling-road/geojson",
      wasOnline: true,
      elapsedMs: 50,
      responseReceived: false,
      category: "transport-failure",
    });

    render(<DiagnosticsScreen />);

    expect(
      screen.getByText("HTTP response received: 502 (provider-unavailable)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Device reported offline")).toBeInTheDocument();
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(
      screen.getByText("Fetch failed before an HTTP response was exposed to the browser"),
    ).toBeInTheDocument();
    expect(screen.getByText(/missing CORS headers/i)).toBeInTheDocument();
  });
});
