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
const ROUTE_START: Coordinate = [0, 51];
const ROUTE_TOTAL_METRES = 2000;
const INTERIOR_DISTANCE_METRES = 1000; // 50% of total — comfortably inside the 10-80% arming band

function eligibleFix(idSuffix: string): GeolocationFix {
  return {
    coordinate: ROUTE_FINAL,
    accuracyMetres: 8,
    timestampMs: Number(idSuffix),
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

function ineligibleFix(idSuffix: string): GeolocationFix {
  return {
    coordinate: ROUTE_START,
    accuracyMetres: 8,
    timestampMs: Number(idSuffix),
    speedMetresPerSecond: null,
    headingDegrees: null,
  };
}

/** Far from the finish (satisfies departure) — pair with an interior
 * reliableDistanceFromStartMetres override to satisfy arming. */
function armingFix(idSuffix: string): GeolocationFix {
  return {
    coordinate: ROUTE_START,
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
    armed: false,
    ...overrides,
  };
}

/** Pre-armed base options — isolates the completion-streak/dismiss
 * behaviour under test from the arming gate itself, mirroring a ride that
 * was already armed (fresh evidence this session, or restored armed). */
function armedBaseOptions(
  overrides: Partial<UseRouteCompletionCandidateOptions> = {},
): UseRouteCompletionCandidateOptions {
  return baseOptions({ armed: true, ...overrides });
}

describe("useRouteCompletionCandidate", () => {
  describe("completion streak (once armed)", () => {
    it("does not confirm after a single eligible fix", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      expect(result.current.isConfirmed).toBe(false);
    });

    it("confirms after the required consecutive eligible fixes", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      expect(result.current.isConfirmed).toBe(false);
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(true);
    });

    it("an ineligible fix between two eligible fixes resets the candidate count", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      rerender(armedBaseOptions({ currentFix: ineligibleFix("2") }));
      rerender(armedBaseOptions({ currentFix: eligibleFix("3") }));
      expect(result.current.isConfirmed).toBe(false);
    });

    it("dismiss suppresses confirmation for the current ride session", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(true);

      result.current.dismiss();
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(false);

      rerender(armedBaseOptions({ currentFix: eligibleFix("3") }));
      expect(result.current.isConfirmed).toBe(false);
    });

    it("re-rendering with the same fix object does not double-count", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      const fix = eligibleFix("1");
      rerender(armedBaseOptions({ currentFix: fix }));
      rerender(armedBaseOptions({ currentFix: fix }));
      rerender(armedBaseOptions({ currentFix: fix }));
      expect(result.current.isConfirmed).toBe(false);
    });

    it("StrictMode's double-invoked render never double-counts a single fix", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }), wrapper: StrictMode },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      expect(result.current.isConfirmed).toBe(false);
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(true);
    });
  });

  describe("arming", () => {
    it("armed: true from the first render seeds isArmed immediately with no fresh fixes", () => {
      const { result } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: baseOptions({ armed: true, currentFix: null }) },
      );

      expect(result.current.isArmed).toBe(true);
    });

    it("armed becoming true via a rerender is adopted without needing fresh fixes", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: baseOptions({ armed: false, currentFix: null }) },
      );
      expect(result.current.isArmed).toBe(false);

      rerender(baseOptions({ armed: true, currentFix: null }));
      expect(result.current.isArmed).toBe(true);
      // No fix was ever evaluated, so no completion evidence should exist.
      expect(result.current.isConfirmed).toBe(false);
    });

    it("a hostile near-total-at-start fix (no arming evidence) never arms or confirms", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: baseOptions({ currentFix: null }) },
      );

      // eligibleFix sits AT the finish with near-total reliable progress —
      // exactly the hostile shared-start/finish projection this feature
      // guards against. Feed several such fixes.
      rerender(baseOptions({ currentFix: eligibleFix("1") }));
      rerender(baseOptions({ currentFix: eligibleFix("2") }));
      rerender(baseOptions({ currentFix: eligibleFix("3") }));

      expect(result.current.isArmed).toBe(false);
      expect(result.current.isConfirmed).toBe(false);
    });

    it("legitimate 2 consecutive arming-eligible fixes flip isArmed exactly once", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        {
          initialProps: baseOptions({
            currentFix: null,
            reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
          }),
        },
      );

      rerender(
        baseOptions({
          currentFix: armingFix("1"),
          reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
        }),
      );
      expect(result.current.isArmed).toBe(false);

      rerender(
        baseOptions({
          currentFix: armingFix("2"),
          reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
        }),
      );
      expect(result.current.isArmed).toBe(true);

      // Stays armed even if a later fix would itself be arming-ineligible.
      rerender(baseOptions({ currentFix: eligibleFix("3") }));
      expect(result.current.isArmed).toBe(true);
    });

    it("re-rendering with the same arming fix object does not double-count the arming streak", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        {
          initialProps: baseOptions({
            currentFix: null,
            reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
          }),
        },
      );

      const fix = armingFix("1");
      rerender(
        baseOptions({
          currentFix: fix,
          reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
        }),
      );
      rerender(
        baseOptions({
          currentFix: fix,
          reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
        }),
      );
      rerender(
        baseOptions({
          currentFix: fix,
          reliableDistanceFromStartMetres: INTERIOR_DISTANCE_METRES,
        }),
      );

      expect(result.current.isArmed).toBe(false);
    });
  });

  describe("route change and reset", () => {
    it("changing routeId automatically resets the count, dismissal and armed state", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(true);
      expect(result.current.isArmed).toBe(true);

      rerender(baseOptions({ routeId: "route-2", currentFix: null, armed: false }));
      expect(result.current.isConfirmed).toBe(false);
      expect(result.current.isArmed).toBe(false);

      // Confirming on the new route still requires its own arming and
      // completion evidence.
      rerender(baseOptions({ routeId: "route-2", currentFix: eligibleFix("3") }));
      expect(result.current.isArmed).toBe(false);
      expect(result.current.isConfirmed).toBe(false);
    });

    it("explicit reset() clears the count, dismissal and armed state on the same route", () => {
      const { result, rerender } = renderHook(
        (options: UseRouteCompletionCandidateOptions) =>
          useRouteCompletionCandidate(options),
        { initialProps: armedBaseOptions({ currentFix: null }) },
      );

      rerender(armedBaseOptions({ currentFix: eligibleFix("1") }));
      rerender(armedBaseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isConfirmed).toBe(true);

      result.current.dismiss();
      result.current.reset();
      // Mirrors production: nav.finish() resets nav.completionArmed to
      // false before performFinalizeRide calls completion.reset(), so the
      // next render's own `armed` option is already false too.
      rerender(baseOptions({ currentFix: null, armed: false }));
      expect(result.current.isArmed).toBe(false);
      expect(result.current.isConfirmed).toBe(false);

      // A fresh ride on the same route needs its own arming evidence again.
      rerender(baseOptions({ currentFix: eligibleFix("2") }));
      expect(result.current.isArmed).toBe(false);
      expect(result.current.isConfirmed).toBe(false);
    });
  });
});
