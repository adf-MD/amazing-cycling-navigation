import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Coordinate } from "../../domain/types.ts";
import type { GeolocationFix } from "../../platform/geolocation.ts";
import {
  useRouteCompletionCandidate,
  type UseRouteCompletionCandidateOptions,
} from "./useRouteCompletionCandidate.ts";

const ROUTE_FINAL: Coordinate = [0.02, 51];
const ROUTE_TOTAL_METRES = 2000;

function eligibleFix(idSuffix: string): GeolocationFix {
  return {
    coordinate: ROUTE_FINAL,
    accuracyMetres: 8,
    // Distinct timestamp per fix only to make each object visually
    // distinguishable in failures; object identity (not value) is what
    // the hook actually keys off.
    timestampMs: Number(idSuffix),
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function ineligibleFix(idSuffix: string): GeolocationFix {
  return {
    coordinate: [0, 51],
    accuracyMetres: 8,
    timestampMs: Number(idSuffix),
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function baseOptions(
  overrides: Partial<UseRouteCompletionCandidateOptions> = {},
): UseRouteCompletionCandidateOptions {
  return {
    routeId: "route-1",
    isRideActive: true,
    currentFix: null,
    isStale: false,
    offRouteLevel: "on-route",
    reliableDistanceFromStartMetres: ROUTE_TOTAL_METRES,
    routeTotalDistanceMetres: ROUTE_TOTAL_METRES,
    routeFinalCoordinate: ROUTE_FINAL,
    ...overrides,
  };
}

describe("useRouteCompletionCandidate", () => {
  it("does not confirm after a single eligible fix", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    expect(result.current.isConfirmed).toBe(false);
  });

  it("confirms after the required consecutive eligible fixes", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    expect(result.current.isConfirmed).toBe(false);
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(true);
  });

  it("an ineligible fix between two eligible fixes resets the candidate count", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    rerender(baseOptions({ currentFix: ineligibleFix("2") }));
    rerender(baseOptions({ currentFix: eligibleFix("3") }));
    // Only one eligible fix since the reset (the ineligible one) — not
    // enough to confirm yet.
    expect(result.current.isConfirmed).toBe(false);
  });

  it("dismiss suppresses confirmation for the current ride session", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(true);

    result.current.dismiss();
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(false);

    // Further eligible fixes don't un-dismiss.
    rerender(baseOptions({ currentFix: eligibleFix("3") }));
    expect(result.current.isConfirmed).toBe(false);
  });

  it("changing routeId automatically resets the count and dismissal", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(true);

    rerender(baseOptions({ routeId: "route-2", currentFix: null }));
    expect(result.current.isConfirmed).toBe(false);

    // Confirming on the new route still requires its own two fixes.
    rerender(baseOptions({ routeId: "route-2", currentFix: eligibleFix("3") }));
    expect(result.current.isConfirmed).toBe(false);
  });

  it("explicit reset() clears the count and dismissal on the same route", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(true);

    result.current.dismiss();
    result.current.reset();
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(false);

    rerender(baseOptions({ currentFix: eligibleFix("3") }));
    expect(result.current.isConfirmed).toBe(true);
  });

  it("re-rendering with the same fix object does not double-count", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }) },
    );

    const fix = eligibleFix("1");
    rerender(baseOptions({ currentFix: fix }));
    rerender(baseOptions({ currentFix: fix }));
    rerender(baseOptions({ currentFix: fix }));
    expect(result.current.isConfirmed).toBe(false);
  });

  it("StrictMode's double-invoked render never double-counts a single fix", () => {
    const { result, rerender } = renderHook(
      (options: UseRouteCompletionCandidateOptions) =>
        useRouteCompletionCandidate(options),
      { initialProps: baseOptions({ currentFix: null }), wrapper: StrictMode },
    );

    rerender(baseOptions({ currentFix: eligibleFix("1") }));
    expect(result.current.isConfirmed).toBe(false);
    rerender(baseOptions({ currentFix: eligibleFix("2") }));
    expect(result.current.isConfirmed).toBe(true);
  });
});
