import { beforeEach, describe, expect, it } from "vitest";
import type { PlannedRoute } from "../domain/types.ts";
import type { RoutingProvider } from "./provider.ts";
import {
  RoutingError,
  type DispatchMarkers,
  type RoutingErrorReason,
} from "./openRouteServiceErrors.ts";
import {
  buildConnectionTestWaypoints,
  classifyConnectionTestStage,
  formatConnectionTestReport,
  runRoutingConnectionTest,
  type RoutingConnectionTestStage,
} from "./routingConnectionTest.ts";
import { db } from "../storage/db.ts";
import {
  getProviderKeyVerification,
  saveProviderKey,
} from "../storage/providerKeyRepository.ts";

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

const NO_DISPATCH: DispatchMarkers = {
  headersConstructed: false,
  requestConstructed: false,
  fetchInvoked: false,
  fetchReturnedPromise: false,
  responseReceived: false,
};

const FULL_DISPATCH: DispatchMarkers = {
  headersConstructed: true,
  requestConstructed: true,
  fetchInvoked: true,
  fetchReturnedPromise: true,
  responseReceived: false,
};

function buildRoute(): PlannedRoute {
  return {
    id: "route-1",
    name: "Test route",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 0,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "planner", provider: "openrouteservice", profile: "cycling-road" },
  };
}

function fakeAdapter(behaviour: () => Promise<PlannedRoute>): RoutingProvider {
  return { calculateRoute: () => behaviour() };
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
});

describe("classifyConnectionTestStage", () => {
  it("maps every reason to exactly one stage, never leaving one unclassified", () => {
    for (const reason of ALL_REASONS) {
      const stage = classifyConnectionTestStage(reason);
      expect(stage.length).toBeGreaterThan(0);
    }
    expect(classifyConnectionTestStage("success")).toBe("success");
  });

  it("does not label the ambiguous no-response case as a confirmed preflight failure", () => {
    expect(classifyConnectionTestStage("transport-failure")).toBe(
      "transport-response-unavailable",
    );
  });

  it("gives the local pipeline stages their own distinct classification, never folded into transport-response-unavailable", () => {
    const stages: RoutingConnectionTestStage[] = [
      classifyConnectionTestStage("invalid-header-value"),
      classifyConnectionTestStage("header-construction-failure"),
      classifyConnectionTestStage("invalid-request-construction"),
      classifyConnectionTestStage("fetch-invocation-failure"),
      classifyConnectionTestStage("offline"),
      classifyConnectionTestStage("timeout"),
      classifyConnectionTestStage("transport-failure"),
    ];
    expect(new Set(stages).size).toBe(stages.length);
  });
});

describe("buildConnectionTestWaypoints", () => {
  it("always returns the same fixed, documented two-point pair", () => {
    const waypoints = buildConnectionTestWaypoints();
    expect(waypoints).toEqual([
      [8.681495, 49.41461],
      [8.686507, 49.41943],
    ]);
  });
});

describe("runRoutingConnectionTest", () => {
  it("reports success and a fresh attemptId on a valid route, with every dispatch marker true", async () => {
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.outcome).toBe("success");
    expect(result.stage).toBe("success");
    expect(result.attemptId.length).toBeGreaterThan(0);
    expect(result.waypointCount).toBe(2);
    expect(result.headersConstructed).toBe(true);
    expect(result.requestConstructed).toBe(true);
    expect(result.fetchInvoked).toBe(true);
    expect(result.fetchReturnedPromise).toBe(true);
    expect(result.responseReceived).toBe(true);
  });

  it("generates a different attemptId on each run", async () => {
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));

    const first = await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());
    const second = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(first.attemptId).not.toBe(second.attemptId);
  });

  it("records a verified key outcome on success", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("verified");
  });

  it("maps a transport failure to the hedged stage and message, never confirming CORS", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "transport-failure",
          message: "The routing request failed.",
          dispatchMarkers: FULL_DISPATCH,
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.outcome).toBe("failure");
    expect(result.stage).toBe("transport-response-unavailable");
    expect(result.message.toLowerCase()).not.toContain(
      "cors headers were missing due to",
    );
  });

  it("carries the exact dispatch markers the adapter attached to this specific error, not a re-derived guess", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "header-construction-failure",
          message: "The routing request's headers could not be constructed.",
          transportErrorName: "TypeError",
          dispatchMarkers: NO_DISPATCH,
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.stage).toBe("header-construction");
    expect(result.headersConstructed).toBe(false);
    expect(result.requestConstructed).toBe(false);
    expect(result.fetchInvoked).toBe(false);
    expect(result.errorName).toBe("TypeError");
  });

  it("surfaces the safe reason code when the adapter attached one", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "fetch-invocation-failure",
          message: "The routing request could not be sent.",
          transportErrorName: "TypeError",
          transportFailureReasonCode: "fetch-illegal-invocation",
          dispatchMarkers: { ...NO_DISPATCH, fetchInvoked: true },
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.stage).toBe("fetch-invocation");
    expect(result.transportFailureReasonCode).toBe("fetch-illegal-invocation");
    expect(result.fetchInvoked).toBe(true);
    expect(result.fetchReturnedPromise).toBe(false);
  });

  it("does not mark the key as rejected for a transport failure", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "transport-failure",
          message: "The routing request failed.",
          dispatchMarkers: FULL_DISPATCH,
        }),
      ),
    );

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("unavailable");
    expect(verification?.outcome).not.toBe("rejected");
  });

  it("does not mark the key as rejected for a local syntax/construction error", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "invalid-header-value",
          message: "The stored key contains a character that cannot be sent in a header.",
          dispatchMarkers: NO_DISPATCH,
        }),
      ),
    );

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification).toBeUndefined();
  });

  it("does not mark the key as rejected for a timeout", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "timeout",
          message: "The routing request timed out.",
          dispatchMarkers: FULL_DISPATCH,
        }),
      ),
    );

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("unavailable");
  });

  it("only marks the key as rejected for an actual 401", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "unauthorized",
          message: "The OpenRouteService key was rejected.",
          httpStatus: 401,
          dispatchMarkers: { ...FULL_DISPATCH, responseReceived: true },
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.stage).toBe("http-response");
    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("rejected");
  });

  it("treats no-route-found as proof the connection and key work (route-processing stage)", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "no-route-found",
          message: "No cycling route could be found between these waypoints.",
          providerErrorCode: 2009,
          dispatchMarkers: { ...FULL_DISPATCH, responseReceived: true },
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.stage).toBe("route-processing");
    expect(result.message.toLowerCase()).toContain("working");
  });

  it("never includes coordinates or a key in the result's own fields", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "transport-failure",
          message: "The routing request failed.",
          dispatchMarkers: FULL_DISPATCH,
        }),
      ),
    );

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("8.681495");
    expect(serialised).not.toContain("49.41461");
  });
});

describe("formatConnectionTestReport", () => {
  it("never includes coordinates, only a waypoint count", async () => {
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));
    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    const report = formatConnectionTestReport(result);

    expect(report).not.toContain("8.681495");
    expect(report).not.toContain("49.41461");
    expect(report).toContain("Waypoints used: 2");
  });

  it("includes the stage's cautious explanation for the ambiguous transport case", async () => {
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError({
          reason: "transport-failure",
          message: "The routing request failed.",
          dispatchMarkers: FULL_DISPATCH,
        }),
      ),
    );
    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    const report = formatConnectionTestReport(result);

    expect(report).toContain("Possible causes include CORS/preflight rejection");
  });

  it("shows every dispatch marker explicitly", async () => {
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));
    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    const report = formatConnectionTestReport(result);

    expect(report).toContain("Headers constructed: yes");
    expect(report).toContain("Request constructed: yes");
    expect(report).toContain("Fetch invoked: yes");
    expect(report).toContain("Fetch returned a promise: yes");
    expect(report).toContain("HTTP response received: yes");
  });
});
