import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { FreeRoamStatusCard, type FreeRoamLiveStatus } from "./FreeRoamStatusCard.tsx";

function buildLiveStatus(
  overrides: Partial<FreeRoamLiveStatus> = {},
): FreeRoamLiveStatus {
  return {
    accuracyMetres: 8,
    isStale: false,
    fixAgeMs: 2000,
    ...overrides,
  };
}

const noop = () => {
  /* no-op */
};

describe("FreeRoamStatusCard", () => {
  it("shows a Location label with role=status for a live fix", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const status = screen.getByText("Location");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a distinct location label for a stale fix", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus({ isStale: true })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("Location — signal lost")).toBeInTheDocument();
  });

  it("shows the GPS accuracy/freshness detail line, matching route Riding's convention, and never repeats the top-row label text", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus({
          accuracyMetres: 8,
          isStale: false,
          fixAgeMs: 3000,
        })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const label = screen.getByText("Location");
    const detail = screen.getByText("GPS ±8 m · Live");
    expect(label.textContent).not.toEqual(detail.textContent);
  });

  it("shows no age parenthetical for a fresh fix even when fixAgeMs is non-null", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus({ isStale: false, fixAgeMs: 3000 })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("GPS ±8 m · Live")).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("shows a waiting-for-fix label with no GPS detail row when there is no fix and no error", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={null}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("Waiting for a GPS fix…")).toBeInTheDocument();
    expect(screen.queryByText(/GPS ±/)).toBeNull();
  });

  it("shows a GPS error label and a working inline retry when there is no fix yet", () => {
    const onRetry = vi.fn();
    render(
      <FreeRoamStatusCard
        liveStatus={null}
        geolocationErrorMessage="Location permission was denied."
        onRetryGeolocation={onRetry}
        online={true}
      />,
    );
    expect(screen.getByText("GPS error")).toBeInTheDocument();
    const errorRow = screen.getByRole("alert");
    expect(errorRow).toHaveTextContent("Location permission was denied.");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the retained stale fix's detail row together with the error row, without duplication", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 30_000 })}
        geolocationErrorMessage="Getting your location timed out."
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText(/GPS ±8 m · Stale/)).toBeInTheDocument();
    expect(screen.getAllByText("Getting your location timed out.")).toHaveLength(1);
  });

  it("shows a compact Offline row alongside otherwise-healthy GPS status", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={false}
      />,
    );
    const offline = screen.getByText("Offline");
    expect(offline).toHaveAttribute("role", "status");
  });

  it("shows both the offline row and the geolocation-error row together without duplicating either", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 30_000 })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={false}
      />,
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your location is currently unavailable.",
    );
  });

  it("renders the wake-lock control inside the top row when a wakeLock prop is supplied", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        wakeLock={{
          desired: false,
          onToggleDesired: vi.fn(),
          wakeLockSource: fake.source,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Screen on" })).toBeInTheDocument();
  });

  it("renders no wake-lock slot at all when the wakeLock prop is undefined", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.queryByRole("button", { name: "Screen on" })).toBeNull();
  });
});
