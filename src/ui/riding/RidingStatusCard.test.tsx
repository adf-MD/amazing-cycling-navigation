import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildFakeWakeLockSource } from "../../test/fixtures/wakeLockSource.ts";
import { RidingStatusCard, type RidingLiveStatus } from "./RidingStatusCard.tsx";

function buildLiveStatus(overrides: Partial<RidingLiveStatus> = {}): RidingLiveStatus {
  return {
    offRouteLevel: "on-route",
    distanceRemainingMetres: 1200,
    remainingAscentMetres: 993,
    accuracyMetres: 7.4,
    isStale: false,
    fixAgeMs: 2000,
    ...overrides,
  };
}

const noop = () => {
  /* no-op */
};

describe("RidingStatusCard", () => {
  it("shows on-route status with role=status, not role=alert", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "on-route" })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const status = screen.getByText("On route");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows possibly-off-route status with role=status, not role=alert", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "possibly-off-route" })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const status = screen.getByText("Possibly off route");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows off-route status with role=alert", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "off-route" })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Off route");
  });

  it("shows the exact compact remaining distance/ascent text and its spelled-out accessible label", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({
          distanceRemainingMetres: 61_500,
          remainingAscentMetres: 993,
        })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("61.5 km · 993 m ascent")).toBeInTheDocument();
    expect(
      screen.getByLabelText("61.5 kilometres remaining, 993 metres ascent remaining"),
    ).toBeInTheDocument();
  });

  it("omits the remaining-metrics line entirely when distance is null", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ distanceRemainingMetres: null })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.queryByText(/km ·/)).toBeNull();
  });

  it("shows an honest unavailable ascent state, not a fake zero, when ascent is unknown", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({
          distanceRemainingMetres: 61_500,
          remainingAscentMetres: null,
        })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("61.5 km · ascent unavailable")).toBeInTheDocument();
    expect(
      screen.getByLabelText("61.5 kilometres remaining, ascent remaining not available"),
    ).toBeInTheDocument();
  });

  it("shows a genuinely known zero remaining ascent as 0 m ascent, not unavailable", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({
          distanceRemainingMetres: 500,
          remainingAscentMetres: 0,
        })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("0.5 km · 0 m ascent")).toBeInTheDocument();
    expect(
      screen.getByLabelText("0.5 kilometres remaining, 0 metres ascent remaining"),
    ).toBeInTheDocument();
  });

  it("shows GPS ± accuracy and Live wording for a fresh fix, without the old label or dash", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Live")).toBeInTheDocument();
    expect(screen.queryByText(/GPS accuracy:/)).toBeNull();
    expect(screen.queryByText(/—/)).toBeNull();
  });

  it("shows no age parenthetical for a fresh fix even when fixAgeMs is non-null", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Live")).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("shows Stale wording and fix age for a stale fix", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 45_000 })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Stale (45s ago)")).toBeInTheDocument();
  });

  it("formats a fix age of a minute or more in minutes", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 125_000 })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText(/2 min ago/)).toBeInTheDocument();
  });

  it("omits the fix-age parenthetical when fixAgeMs is null, even while stale", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: null })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Stale")).toBeInTheDocument();
  });

  it("renders the wake-lock control inside the top row when a wakeLock prop is supplied", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingStatusCard
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
    expect(screen.getByLabelText("Screen on")).toBeInTheDocument();
  });

  it("renders no wake-lock slot at all when the wakeLock prop is undefined", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.queryByLabelText("Screen on")).toBeNull();
  });

  it("shows a waiting-for-fix label with no remaining/GPS rows when there is no fix and no error", () => {
    render(
      <RidingStatusCard
        liveStatus={null}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const status = screen.getByText("Waiting for a GPS fix…");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByText(/km ·/)).toBeNull();
    expect(screen.queryByText(/^GPS ±/)).toBeNull();
  });

  it("shows a GPS error label and a working inline retry when there is no fix yet", () => {
    const onRetry = vi.fn();
    render(
      <RidingStatusCard
        liveStatus={null}
        geolocationErrorMessage="Location permission was denied."
        onRetryGeolocation={onRetry}
        online={true}
      />,
    );
    expect(screen.getByText("GPS error")).toBeInTheDocument();
    const errorRow = screen.getByRole("alert");
    expect(errorRow).toHaveTextContent("Location permission was denied.");
    const retryButton = screen.getByRole("button", { name: "Try again" });
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the retained stale fix's status/remaining/GPS rows together with the error row, without duplication", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 30_000 })}
        geolocationErrorMessage="Getting your location timed out."
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    expect(screen.getByText("On route")).toBeInTheDocument();
    expect(screen.getByText("1.2 km · 993 m ascent")).toBeInTheDocument();
    expect(screen.getByText("GPS ±7 m · Stale (30s ago)")).toBeInTheDocument();
    const errorRows = screen.getAllByText("Getting your location timed out.");
    expect(errorRows).toHaveLength(1);
  });

  it("shows a compact Offline row alongside otherwise-healthy GPS status", () => {
    render(
      <RidingStatusCard
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
      <RidingStatusCard
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

  it("shows two coexisting role=alert elements when off-route and a geolocation error both apply", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "off-route" })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={true}
      />,
    );
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(alerts.map((el) => el.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Off route"),
        expect.stringContaining("Your location is currently unavailable."),
      ]),
    );
  });
});
