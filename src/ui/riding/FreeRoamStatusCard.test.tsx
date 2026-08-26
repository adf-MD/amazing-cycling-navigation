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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText("Location — signal lost")).toBeInTheDocument();
  });

  it("shows the GPS accuracy/freshness detail line, matching route Riding's convention, and never repeats the status label text", () => {
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
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
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.getByText(/GPS ±8 m · Stale/)).toBeInTheDocument();
    expect(screen.getAllByText("Getting your location timed out.")).toHaveLength(1);
  });

  it("shows a compact connectivity indicator with an accessible Online/Offline name, alongside otherwise-healthy GPS status", () => {
    render(
      <FreeRoamStatusCard
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
      <FreeRoamStatusCard
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

  it("places the connectivity indicator inside the main region's text column, not as a new full-width row", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
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

  it("renders no imagery-recovery row when imageryRecoveryStatus is null", () => {
    render(
      <FreeRoamStatusCard
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
      <FreeRoamStatusCard
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
  });

  it("shows the terminal load-error imagery row with role=alert and the danger styling class", () => {
    render(
      <FreeRoamStatusCard
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
  });

  it("calls onRetryImagery exactly once when the imagery row's Retry button is pressed", () => {
    const onRetryImagery = vi.fn();
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={{ kind: "fallback" }}
        onRetryImagery={onRetryImagery}
      />,
    );
    screen.getByRole("button", { name: "Retry map imagery" }).click();
    expect(onRetryImagery).toHaveBeenCalledTimes(1);
  });

  it("shows both the offline row and the geolocation-error row together without duplicating either", () => {
    render(
      <FreeRoamStatusCard
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

  it("renders the wake-lock control inside the main region, beside the text column, not inside it", () => {
    const fake = buildFakeWakeLockSource();
    render(
      <FreeRoamStatusCard
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
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    expect(screen.queryByRole("button", { name: "Screen on" })).toBeNull();
  });

  it("groups the status label and the GPS detail line inside the same text column", () => {
    render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={null}
        onRetryImagery={noop}
      />,
    );
    const textColumn = screen.getByText("Location").closest(".ride-status-card-text");
    expect(textColumn).not.toBeNull();
    expect(screen.getByText("GPS ±8 m · Live").closest(".ride-status-card-text")).toBe(
      textColumn,
    );
  });

  it("keeps the error row outside the main region, as a direct child of the card", () => {
    const { container } = render(
      <FreeRoamStatusCard
        liveStatus={buildLiveStatus()}
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

  it("shows the connectivity indicator, the geolocation-error row and the imagery-recovery row together without duplicating any of them", () => {
    render(
      <FreeRoamStatusCard
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
});
