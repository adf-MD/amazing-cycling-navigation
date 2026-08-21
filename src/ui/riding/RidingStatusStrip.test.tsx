import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RidingStatusStrip } from "./RidingStatusStrip.tsx";

describe("RidingStatusStrip", () => {
  it("shows on-route status with role=status, not role=alert", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
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
        remainingAscentMetres={993}
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
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Off route");
  });

  it("shows the exact compact remaining distance/ascent text and its spelled-out accessible label", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={61_500}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText("61.5 km · 993 m ascent")).toBeInTheDocument();
    expect(
      screen.getByLabelText("61.5 kilometres remaining, 993 metres ascent remaining"),
    ).toBeInTheDocument();
  });

  it("omits the remaining-metrics line entirely when distance is null", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={null}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.queryByText(/km ·/)).toBeNull();
  });

  it("shows an honest unavailable ascent state, not a fake zero, when ascent is unknown", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={61_500}
        remainingAscentMetres={null}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText("61.5 km · ascent unavailable")).toBeInTheDocument();
    expect(
      screen.getByLabelText("61.5 kilometres remaining, ascent remaining not available"),
    ).toBeInTheDocument();
  });

  it("shows a genuinely known zero remaining ascent as 0 m ascent, not unavailable", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={500}
        remainingAscentMetres={0}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText("0.5 km · 0 m ascent")).toBeInTheDocument();
    expect(
      screen.getByLabelText("0.5 kilometres remaining, 0 metres ascent remaining"),
    ).toBeInTheDocument();
  });

  it("shows GPS ± accuracy and Live wording for a fresh fix, without the old label or dash", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Live")).toBeInTheDocument();
    expect(screen.queryByText(/GPS accuracy:/)).toBeNull();
    expect(screen.queryByText(/—/)).toBeNull();
  });

  it("shows no age parenthetical for a fresh fix even when fixAgeMs is non-null", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale={false}
        fixAgeMs={2000}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Live")).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).toBeNull();
  });

  it("shows Stale wording and fix age for a stale fix", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale
        fixAgeMs={45_000}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Stale (45s ago)")).toBeInTheDocument();
  });

  it("formats a fix age of a minute or more in minutes", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale
        fixAgeMs={125_000}
      />,
    );
    expect(screen.getByText(/2 min ago/)).toBeInTheDocument();
  });

  it("omits the fix-age parenthetical when fixAgeMs is null, even while stale", () => {
    render(
      <RidingStatusStrip
        offRouteLevel="on-route"
        distanceRemainingMetres={1200}
        remainingAscentMetres={993}
        accuracyMetres={7.4}
        isStale
        fixAgeMs={null}
      />,
    );
    expect(screen.getByText("GPS ±7 m · Stale")).toBeInTheDocument();
  });
});
