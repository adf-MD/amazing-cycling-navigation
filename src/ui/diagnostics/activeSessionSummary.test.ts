import { englishTranslator } from "../../i18n/englishTranslator.ts";
import { describe, expect, it } from "vitest";
import { describeActiveSession } from "./activeSessionSummary.ts";
import type { StoredRideState } from "../../storage/db.ts";

const ROUTE_ID = "3f9c2a10-9b7e-4c21-8f6d-5a1e0c7b4d83";
const OTHER_ROUTE_ID = "8b1d4e77-2c30-4a95-9e6f-1d2c3b4a5e60";

function routeSession(routeId = ROUTE_ID): StoredRideState {
  return {
    id: "active",
    routeId,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: null,
    lastMatchedPointIndex: 0,
    matchedDistanceFromStartMetres: 0,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
  };
}

const freeRoamSession: StoredRideState = {
  id: "active",
  kind: "free-roam",
  startedAt: "2026-01-01T08:00:00.000Z",
  lastFix: null,
};

describe("describeActiveSession (backlog item 117)", () => {
  it("reads None with no stored session", () => {
    expect(describeActiveSession(englishTranslator, undefined, undefined)).toBe("None");
  });

  it("reads Free roam for a free-roam session", () => {
    expect(describeActiveSession(englishTranslator, freeRoamSession, undefined)).toBe(
      "Free roam",
    );
  });

  it("shows the resolved route name for a route-backed session", () => {
    expect(
      describeActiveSession(englishTranslator, routeSession(), {
        routeId: ROUTE_ID,
        name: "Evening loop",
      }),
    ).toBe("Evening loop");
  });

  it("never returns the route identifier, whatever the lookup produced", () => {
    const results = [
      describeActiveSession(englishTranslator, routeSession(), undefined),
      describeActiveSession(englishTranslator, routeSession(), {
        routeId: ROUTE_ID,
        name: null,
      }),
      describeActiveSession(englishTranslator, routeSession(), {
        routeId: ROUTE_ID,
        name: "Evening loop",
      }),
      describeActiveSession(englishTranslator, routeSession(), {
        routeId: OTHER_ROUTE_ID,
        name: "Stale",
      }),
    ];

    for (const result of results) {
      expect(result).not.toContain(ROUTE_ID);
      expect(result).not.toContain(OTHER_ROUTE_ID);
    }
  });

  it("falls back honestly when the route no longer exists, rather than to None", () => {
    const result = describeActiveSession(englishTranslator, routeSession(), {
      routeId: ROUTE_ID,
      name: null,
    });

    expect(result).toBe("Route unavailable");
    expect(result).not.toBe("None");
  });

  it("falls back when a stored name is blank, since no field may render empty", () => {
    expect(
      describeActiveSession(englishTranslator, routeSession(), {
        routeId: ROUTE_ID,
        name: "   ",
      }),
    ).toBe("Route unavailable");
  });

  it("shows a placeholder rather than the previous route's name while resolving", () => {
    // The guard this file exists to make testable. useLiveQuery keeps the
    // value it already holds when its querier changes, so without the
    // routeId comparison a switch from one route to another would render
    // the old route's name against the new session.
    expect(
      describeActiveSession(englishTranslator, routeSession(OTHER_ROUTE_ID), {
        routeId: ROUTE_ID,
        name: "Evening loop",
      }),
    ).toBe("Checking…");
  });

  it("shows a placeholder, not a fallback, before the first lookup resolves", () => {
    expect(describeActiveSession(englishTranslator, routeSession(), undefined)).toBe(
      "Checking…",
    );
  });

  it("does not call a session of an unrecognised kind Free roam", () => {
    const unsupported = {
      ...routeSession(),
      kind: "some-future-kind",
    } as unknown as StoredRideState;

    const result = describeActiveSession(englishTranslator, unsupported, undefined);

    expect(result).toBe("Session unavailable");
    expect(result).not.toBe("Free roam");
    expect(result).not.toContain(ROUTE_ID);
  });
});
