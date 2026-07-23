import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DiagnosticsScreen } from "./DiagnosticsScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
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
      expect(getDetailValue("Storage")).toHaveTextContent(/OK \(schema version 1\)/);
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
});
