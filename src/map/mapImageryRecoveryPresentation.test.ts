import { describe, expect, it } from "vitest";
import {
  describeMapImageryRecovery,
  type MapImageryPresentationContext,
  type MapImageryStatusKind,
} from "./mapImageryRecoveryPresentation.ts";

/**
 * Backlog item 108. This module had no test file of its own before this
 * item — it was only ever exercised indirectly through the two status
 * cards, which is exactly how the free-roam wording defect ("the route ...
 * is still shown", in a mode with no route) survived item 83 unnoticed.
 * It is now the single copy authority for BOTH surfaces that present an
 * imagery message (MapView's in-map overlay and the relocated status-card
 * row), so it is tested directly.
 */
const ALL_KINDS: readonly MapImageryStatusKind[] = [
  "delayed",
  "load-error",
  "tile-error",
  "fallback",
];
const ALL_CONTEXTS: readonly MapImageryPresentationContext[] = [
  "route-riding",
  "free-roam",
];

describe("describeMapImageryRecovery", () => {
  describe("route riding keeps the wording item 83 established", () => {
    it("describes the delayed state as still showing the route and position", () => {
      const presentation = describeMapImageryRecovery("delayed", "route-riding");
      expect(presentation.message).toBe(
        "Map imagery is taking longer than usual to load. Your route and position are still shown.",
      );
      expect(presentation.testId).toBe("map-imagery-delayed-banner");
      expect(presentation.role).toBe("status");
    });

    it("describes a tile error as still showing the route and position", () => {
      expect(describeMapImageryRecovery("tile-error", "route-riding").message).toBe(
        "Map imagery unavailable. The route and your position are still shown.",
      );
    });

    it("describes the fallback style as still showing the route", () => {
      expect(describeMapImageryRecovery("fallback", "route-riding").message).toBe(
        "Map imagery unavailable — showing your route on a plain background.",
      );
    });
  });

  describe("free roam never claims a route it does not have", () => {
    it("describes the delayed state in terms of position only", () => {
      expect(describeMapImageryRecovery("delayed", "free-roam").message).toBe(
        "Map imagery is taking longer than usual to load. Your position is still shown.",
      );
    });

    it("describes a tile error in terms of position only", () => {
      expect(describeMapImageryRecovery("tile-error", "free-roam").message).toBe(
        "Map imagery unavailable. Your position is still shown.",
      );
    });

    it("describes the fallback style in terms of position only", () => {
      expect(describeMapImageryRecovery("fallback", "free-roam").message).toBe(
        "Map imagery unavailable — showing your position on a plain background.",
      );
    });

    it("mentions no route in any message, for any kind", () => {
      for (const kind of ALL_KINDS) {
        const { message } = describeMapImageryRecovery(kind, "free-roam");
        expect(message.toLowerCase()).not.toContain("route");
      }
    });
  });

  describe("the terminal load-error message is context-independent", () => {
    it("says the same thing in both contexts, because it names neither a route nor a position", () => {
      const routeRiding = describeMapImageryRecovery("load-error", "route-riding");
      const freeRoam = describeMapImageryRecovery("load-error", "free-roam");
      expect(routeRiding.message).toBe(
        "Map failed to load. Check your connection and try again.",
      );
      expect(freeRoam.message).toBe(routeRiding.message);
    });
  });

  describe("retryability", () => {
    it("offers no retry for the transient delayed state, in either context", () => {
      for (const context of ALL_CONTEXTS) {
        expect(describeMapImageryRecovery("delayed", context).retryable).toBe(false);
      }
    });

    it("keeps retry available for all three terminal states, in either context", () => {
      for (const context of ALL_CONTEXTS) {
        for (const kind of ["load-error", "tile-error", "fallback"] as const) {
          expect(describeMapImageryRecovery(kind, context).retryable).toBe(true);
        }
      }
    });
  });

  describe("roles and test ids", () => {
    it("reserves role=alert for the terminal load-error state alone", () => {
      for (const context of ALL_CONTEXTS) {
        for (const kind of ALL_KINDS) {
          expect(describeMapImageryRecovery(kind, context).role).toBe(
            kind === "load-error" ? "alert" : "status",
          );
        }
      }
    });

    it("maps each kind to its own stable test id, identically in both contexts", () => {
      const expected: Record<MapImageryStatusKind, string> = {
        delayed: "map-imagery-delayed-banner",
        "load-error": "map-load-error",
        "tile-error": "tiles-unavailable-banner",
        fallback: "map-fallback-banner",
      };
      for (const context of ALL_CONTEXTS) {
        for (const kind of ALL_KINDS) {
          expect(describeMapImageryRecovery(kind, context).testId).toBe(expected[kind]);
        }
      }
    });
  });

  describe("connectivity is never restated", () => {
    // Both status cards already carry their own Online/Offline indicator,
    // and imagery can be delayed or unavailable while the browser still
    // reports Online — so no message here may claim the device is offline.
    it("never says offline or online in any message", () => {
      for (const context of ALL_CONTEXTS) {
        for (const kind of ALL_KINDS) {
          const message = describeMapImageryRecovery(kind, context).message.toLowerCase();
          expect(message).not.toContain("offline");
          expect(message).not.toContain("online");
        }
      }
    });
  });

  describe("every kind is genuinely handled", () => {
    it("returns a non-empty message for every kind in every context", () => {
      for (const context of ALL_CONTEXTS) {
        for (const kind of ALL_KINDS) {
          expect(
            describeMapImageryRecovery(kind, context).message.length,
          ).toBeGreaterThan(0);
        }
      }
    });
  });
});
