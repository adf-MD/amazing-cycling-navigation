import { describe, expect, it } from "vitest";
import { RoutingError, type RoutingErrorReason } from "./openRouteServiceErrors.ts";
import {
  describeRoutingError,
  mapErrorReasonToOutcome,
} from "./routingErrorPresentation.ts";

const ALL_REASONS: RoutingErrorReason[] = [
  "no-api-key",
  "invalid-header-value",
  "header-construction-failure",
  "invalid-request-construction",
  "fetch-invocation-failure",
  "unauthorized",
  "forbidden",
  "rate-limited",
  "offline",
  "transport-failure",
  "timeout",
  "no-route-found",
  "no-routable-point",
  "provider-unavailable",
  "provider-error",
  "malformed-response",
  "no-geometry",
  "unknown",
];

describe("describeRoutingError", () => {
  it("produces a non-empty, generic message for every reason", () => {
    for (const reason of ALL_REASONS) {
      const message = describeRoutingError(
        new RoutingError({ reason, message: "generic" }),
      );
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("never echoes a raw HTTP status/provider code text the caller didn't supply structurally", () => {
    const error = new RoutingError({
      reason: "provider-error",
      message: "generic",
      providerErrorCode: 9999,
      httpStatus: 404,
    });
    expect(describeRoutingError(error)).toContain("404");
    expect(describeRoutingError(error)).toContain("9999");
  });

  it("reassures that the key and connection work for no-route-found/no-routable-point", () => {
    expect(
      describeRoutingError(
        new RoutingError({ reason: "no-route-found", message: "generic" }),
      ),
    ).toContain("working");
    expect(
      describeRoutingError(
        new RoutingError({ reason: "no-routable-point", message: "generic" }),
      ),
    ).toContain("working");
  });

  it("distinguishes a local key-format problem from an unreachable provider", () => {
    const message = describeRoutingError(
      new RoutingError({ reason: "invalid-header-value", message: "generic" }),
    );
    expect(message).toContain("key");
    expect(message).not.toMatch(/unavailable|could not be reached/i);
  });
});

describe("mapErrorReasonToOutcome", () => {
  it("never treats a connectivity/timeout/outage reason as key rejection", () => {
    for (const reason of [
      "offline",
      "transport-failure",
      "timeout",
      "provider-unavailable",
    ] as const) {
      expect(mapErrorReasonToOutcome(reason)).toBe("unavailable");
    }
  });

  it("only treats unauthorized as rejected", () => {
    expect(mapErrorReasonToOutcome("unauthorized")).toBe("rejected");
  });

  it("treats forbidden/rate-limited as quota-limited", () => {
    expect(mapErrorReasonToOutcome("forbidden")).toBe("quota-limited");
    expect(mapErrorReasonToOutcome("rate-limited")).toBe("quota-limited");
  });

  it("treats a well-formed no-route/no-routable-point response as verified", () => {
    expect(mapErrorReasonToOutcome("no-route-found")).toBe("verified");
    expect(mapErrorReasonToOutcome("no-routable-point")).toBe("verified");
  });

  it("is uninformative (null) for reasons that prove nothing about the key", () => {
    for (const reason of [
      "no-api-key",
      "malformed-response",
      "no-geometry",
      "unknown",
    ] as const) {
      expect(mapErrorReasonToOutcome(reason)).toBeNull();
    }
  });

  it("never maps a local syntax/construction error to provider unavailability", () => {
    for (const reason of [
      "invalid-header-value",
      "header-construction-failure",
      "invalid-request-construction",
      "fetch-invocation-failure",
    ] as const) {
      expect(mapErrorReasonToOutcome(reason)).toBeNull();
    }
  });
});
