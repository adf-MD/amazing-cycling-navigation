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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Stale")).toBeInTheDocument();
  });

  it("renders the wake-lock control inside the main region, beside the text column, not inside it", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
        wakeLock={{
          desired: false,
          onToggleDesired: vi.fn(),
          wakeLockSource: fake.source,
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "Screen on" });
    expect(button.closest(".ride-status-card-main")).not.toBeNull();
    expect(button.closest(".ride-status-card-text")).toBeNull();
  });

  it("renders no wake-lock slot at all when the wakeLock prop is undefined", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.queryByLabelText("Screen on")).toBeNull();
  });

  it("groups the status label, remaining metrics and GPS line inside the same text column", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    const textColumn = screen.getByText("On route").closest(".ride-status-card-text");
    expect(textColumn).not.toBeNull();
    expect(
      screen.getByText("1.2 km · 993 m ascent").closest(".ride-status-card-text"),
    ).toBe(textColumn);
    expect(screen.getByText("GPS ±7 m · Live").closest(".ride-status-card-text")).toBe(
      textColumn,
    );
  });

  it("keeps the error row outside the main region, as a direct child of the card", () => {
    const { container } = render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "on-route" })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={false}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(container.querySelector(".ride-status-card-main")).not.toBeNull();
    const errorRow = screen.getByRole("alert");
    expect(errorRow.closest(".ride-status-card-main")).toBeNull();
    expect(errorRow.parentElement).toHaveClass("ride-status-card");
  });

  // Backlog item 83: unlike the old full-width .ride-status-card-offline
  // row, the compact connectivity indicator lives inside the main region's
  // text column, beside the status label — never a new full-width row.
  it("places the connectivity indicator inside the main region's text column, not as a new full-width row", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "on-route" })}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={false}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    const offline = screen.getByText("Offline");
    expect(offline.closest(".ride-status-card-text")).not.toBeNull();
    expect(offline.closest(".ride-status-card-main")).not.toBeNull();
  });

  it("shows a waiting-for-fix label with no remaining/GPS rows when there is no fix and no error", () => {
    render(
      <RidingStatusCard
        liveStatus={null}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("On route")).toBeInTheDocument();
    expect(screen.getByText("1.2 km · 993 m ascent")).toBeInTheDocument();
    expect(screen.getByText("GPS ±7 m · Stale (30s ago)")).toBeInTheDocument();
    const errorRows = screen.getAllByText("Getting your location timed out.");
    expect(errorRows).toHaveLength(1);
  });

  it("shows a compact connectivity indicator with an accessible Online/Offline name, alongside otherwise-healthy GPS status", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={false}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    const offline = screen.getByText("Offline");
    expect(offline).toHaveAttribute("role", "status");
    expect(offline.querySelector("svg")).not.toBeNull();
  });

  it("shows the Online connectivity indicator, not Offline, when online is true", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("shows both the connectivity indicator and the geolocation-error row together without duplicating either", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 30_000 })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={false}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your location is currently unavailable.",
    );
  });

  it("renders no imagery-recovery row when imageryRecoveryStatus is null", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.queryByText("Retry map imagery")).toBeNull();
  });

  it("shows the tile-error imagery row with role=status and the expected non-technical message", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={{ kind: "tile-error" }}
        onRetryImagery={noop}
      />,
    );
    const row = screen.getByTestId("tiles-unavailable-banner");
    expect(row).toHaveAttribute("role", "status");
    expect(row).toHaveTextContent(
      "Map imagery unavailable. The route and your position are still shown.",
    );
    expect(row).not.toHaveClass("ride-status-card-imagery-row--alert");
  });

  it("shows the fallback imagery row with role=status and the expected message", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={{ kind: "fallback" }}
        onRetryImagery={noop}
      />,
    );
    const row = screen.getByTestId("map-fallback-banner");
    expect(row).toHaveAttribute("role", "status");
    expect(row).toHaveTextContent(
      "Map imagery unavailable — showing your route on a plain background.",
    );
  });

  it("shows the terminal load-error imagery row with role=alert and the danger styling class", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={{ kind: "load-error" }}
        onRetryImagery={noop}
      />,
    );
    const row = screen.getByTestId("map-load-error");
    expect(row).toHaveAttribute("role", "alert");
    expect(row).toHaveClass("ride-status-card-imagery-row--alert");
    expect(row).toHaveTextContent(
      "Map failed to load. Check your connection and try again.",
    );
  });

  it("calls onRetryImagery exactly once when the imagery row's Retry button is pressed", () => {
    const onRetryImagery = vi.fn();
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={{ kind: "tile-error" }}
        onRetryImagery={onRetryImagery}
      />,
    );
    screen.getByRole("button", { name: "Retry map imagery" }).click();
    expect(onRetryImagery).toHaveBeenCalledTimes(1);
  });

  it("shows the connectivity indicator, the geolocation-error row and the imagery-recovery row together without duplicating any of them", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ isStale: true, fixAgeMs: 30_000 })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={false}
        imageryRecoveryStatus={{ kind: "tile-error" }}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getAllByText("Your location is currently unavailable.")).toHaveLength(
      1,
    );
    expect(screen.getAllByTestId("tiles-unavailable-banner")).toHaveLength(1);
  });

  it("shows two coexisting role=alert elements when off-route and a geolocation error both apply", () => {
    render(
      <RidingStatusCard
        liveStatus={buildLiveStatus({ offRouteLevel: "off-route" })}
        geolocationErrorMessage="Your location is currently unavailable."
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
