import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingStatusStrip } from "./RidingStatusStrip.tsx";

describe("RidingStatusStrip", () => {
  it("shows on-route status with role=status, not role=alert", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    const status = screen.getByText("On route");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows possibly-off-route status with role=status, not role=alert", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="possibly-off-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    const status = screen.getByText("Possibly off route");
    expect(status).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows off-route status with role=alert", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="off-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Off route");
  });

  it("shows the remaining distance when available", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText(/Remaining:/)).toBeInTheDocument();
  });

  it("omits the remaining-distance detail when null", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={null}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.queryByText(/Remaining:/)).toBeNull();
  });

  it("shows GPS accuracy and Live wording for a fresh fix", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText(/±7 m/)).toBeInTheDocument();
    expect(screen.getByText(/Live/)).toBeInTheDocument();
    expect(screen.queryByText(/Stale/)).toBeNull();
  });

  it("shows Stale wording and fix age for a stale fix", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale
        fixAgeMs={45_000}
      />,
    );
    expect(screen.getByText(/Stale/)).toBeInTheDocument();
    expect(screen.getByText(/45s ago/)).toBeInTheDocument();
  });

  it("formats a fix age of a minute or more in minutes", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale
        fixAgeMs={125_000}
      />,
    );
    expect(screen.getByText(/2 min ago/)).toBeInTheDocument();
  });

  it("omits the fix-age parenthetical when fixAgeMs is null", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={null}
      />,
    );
    expect(screen.getByText(/±7 m — Live$/)).toBeInTheDocument();
  });
});
