import { describe, expect, it } from "vitest";
import {
  classifyFix,
  classifyRawFix,
  CONSECUTIVE_TO_DEESCALATE,
  CONSECUTIVE_TO_ESCALATE,
  INITIAL_OFF_ROUTE_STATE,
  MAX_TRUSTED_ACCURACY_METRES,
  nextOffRouteState,
  OFF_ROUTE_BASE_METRES,
  POSSIBLY_OFF_ROUTE_BASE_METRES,
  type OffRouteMachineState,
} from "./offRoute.ts";

describe("classifyRawFix", () => {
  it("classifies on-route below the possibly-off-route threshold", () => {
    expect(classifyRawFix(0, 0)).toBe("on-route");
    expect(classifyRawFix(POSSIBLY_OFF_ROUTE_BASE_METRES - 1, 0)).toBe("on-route");
  });

  it("classifies possibly-off-route between the two thresholds", () => {
    expect(classifyRawFix(POSSIBLY_OFF_ROUTE_BASE_METRES, 0)).toBe("possibly-off-route");
    expect(classifyRawFix(OFF_ROUTE_BASE_METRES - 1, 0)).toBe("possibly-off-route");
  });

  it("classifies off-route at or beyond the off-route threshold", () => {
    expect(classifyRawFix(OFF_ROUTE_BASE_METRES, 0)).toBe("off-route");
    expect(classifyRawFix(1000, 0)).toBe("off-route");
  });

  it("inflates both thresholds with reported accuracy", () => {
    const accuracyMetres = 10;
    expect(
      classifyRawFix(POSSIBLY_OFF_ROUTE_BASE_METRES + accuracyMetres - 1, accuracyMetres),
    ).toBe("on-route");
    expect(
      classifyRawFix(POSSIBLY_OFF_ROUTE_BASE_METRES + accuracyMetres, accuracyMetres),
    ).toBe("possibly-off-route");
    expect(classifyRawFix(OFF_ROUTE_BASE_METRES + accuracyMetres, accuracyMetres)).toBe(
      "off-route",
    );
  });

  it("is untrusted beyond the maximum trusted accuracy, regardless of lateral distance", () => {
    expect(classifyRawFix(0, MAX_TRUSTED_ACCURACY_METRES + 1)).toBe("untrusted");
    expect(classifyRawFix(1000, MAX_TRUSTED_ACCURACY_METRES + 1)).toBe("untrusted");
  });
});

describe("classifyFix", () => {
  it("treats a reacquired projection as untrusted regardless of lateral distance", () => {
    expect(classifyFix(0, 0, true)).toBe("untrusted");
    expect(classifyFix(1000, 0, true)).toBe("untrusted");
  });

  it("otherwise behaves like classifyRawFix", () => {
    expect(classifyFix(0, 0, false)).toBe("on-route");
    expect(classifyFix(1000, 0, false)).toBe("off-route");
  });
});

describe("nextOffRouteState", () => {
  it("confirms immediately when the raw classification matches the current level", () => {
    const next = nextOffRouteState(INITIAL_OFF_ROUTE_STATE, "on-route");
    expect(next).toEqual({ level: "on-route", candidateLevel: null, streak: 0 });
  });

  it("leaves state completely unchanged for an untrusted fix, preserving an in-progress streak", () => {
    const midStreak: OffRouteMachineState = {
      level: "on-route",
      candidateLevel: "possibly-off-route",
      streak: 1,
    };
    expect(nextOffRouteState(midStreak, "untrusted")).toEqual(midStreak);
  });

  it(`requires ${String(CONSECUTIVE_TO_ESCALATE)} consecutive fixes to escalate on-route -> possibly-off-route`, () => {
    let state = INITIAL_OFF_ROUTE_STATE;
    for (let i = 0; i < CONSECUTIVE_TO_ESCALATE - 1; i += 1) {
      state = nextOffRouteState(state, "possibly-off-route");
      expect(state.level).toBe("on-route");
    }
    state = nextOffRouteState(state, "possibly-off-route");
    expect(state).toEqual({
      level: "possibly-off-route",
      candidateLevel: null,
      streak: 0,
    });
  });

  it(`requires ${String(CONSECUTIVE_TO_ESCALATE)} consecutive fixes to escalate possibly-off-route -> off-route`, () => {
    let state: OffRouteMachineState = {
      level: "possibly-off-route",
      candidateLevel: null,
      streak: 0,
    };
    for (let i = 0; i < CONSECUTIVE_TO_ESCALATE - 1; i += 1) {
      state = nextOffRouteState(state, "off-route");
      expect(state.level).toBe("possibly-off-route");
    }
    state = nextOffRouteState(state, "off-route");
    expect(state.level).toBe("off-route");
  });

  it(`requires only ${String(CONSECUTIVE_TO_DEESCALATE)} consecutive fixes to de-escalate`, () => {
    let state: OffRouteMachineState = {
      level: "off-route",
      candidateLevel: null,
      streak: 0,
    };
    state = nextOffRouteState(state, "possibly-off-route");
    expect(state.level).toBe("off-route");
    state = nextOffRouteState(state, "possibly-off-route");
    expect(state).toEqual({
      level: "possibly-off-route",
      candidateLevel: null,
      streak: 0,
    });
  });

  it("allows a direct off-route -> on-route jump after enough clean fixes, with no forced intermediate step", () => {
    let state: OffRouteMachineState = {
      level: "off-route",
      candidateLevel: null,
      streak: 0,
    };
    for (let i = 0; i < CONSECUTIVE_TO_DEESCALATE - 1; i += 1) {
      state = nextOffRouteState(state, "on-route");
      expect(state.level).toBe("off-route");
    }
    state = nextOffRouteState(state, "on-route");
    expect(state).toEqual({ level: "on-route", candidateLevel: null, streak: 0 });
  });

  it("resets the streak toward a new candidate when the raw classification switches mid-streak", () => {
    let state = nextOffRouteState(INITIAL_OFF_ROUTE_STATE, "possibly-off-route");
    expect(state).toEqual({
      level: "on-route",
      candidateLevel: "possibly-off-route",
      streak: 1,
    });

    state = nextOffRouteState(state, "off-route");
    expect(state).toEqual({ level: "on-route", candidateLevel: "off-route", streak: 1 });
  });
});
