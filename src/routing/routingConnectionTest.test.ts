import { beforeEach, describe, expect, it } from "vitest";
import type { PlannedRoute } from "../domain/types.ts";
import type { RoutingProvider } from "./provider.ts";
import { RoutingError, type RoutingErrorReason } from "./openRouteServiceErrors.ts";
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

  it("gives offline and timeout their own confident stages, distinct from the ambiguous one", () => {
    const stages: RoutingConnectionTestStage[] = [
      classifyConnectionTestStage("offline"),
      classifyConnectionTestStage("timeout"),
      classifyConnectionTestStage("transport-failure"),
    ];
    expect(new Set(stages).size).toBe(3);
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
  it("reports success and a fresh attemptId on a valid route", async () => {
    const adapter = fakeAdapter(() => Promise.resolve(buildRoute()));

    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    expect(result.outcome).toBe("success");
    expect(result.stage).toBe("success");
    expect(result.attemptId.length).toBeGreaterThan(0);
    expect(result.waypointCount).toBe(2);
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
        new RoutingError("transport-failure", "The routing request failed."),
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

  it("does not mark the key as rejected for a transport failure", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError("transport-failure", "The routing request failed."),
      ),
    );

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("unavailable");
    expect(verification?.outcome).not.toBe("rejected");
  });

  it("does not mark the key as rejected for a timeout", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(new RoutingError("timeout", "The routing request timed out.")),
    );

    await runRoutingConnectionTest(adapter, buildConnectionTestWaypoints());

    const verification = await getProviderKeyVerification();
    expect(verification?.outcome).toBe("unavailable");
  });

  it("only marks the key as rejected for an actual 401", async () => {
    await saveProviderKey("dummy-test-key");
    const adapter = fakeAdapter(() =>
      Promise.reject(
        new RoutingError(
          "unauthorized",
          "The OpenRouteService key was rejected.",
          undefined,
          undefined,
          401,
        ),
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
        new RoutingError(
          "no-route-found",
          "No cycling route could be found between these waypoints.",
          undefined,
          2009,
        ),
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
        new RoutingError("transport-failure", "The routing request failed."),
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
        new RoutingError("transport-failure", "The routing request failed."),
      ),
    );
    const result = await runRoutingConnectionTest(
      adapter,
      buildConnectionTestWaypoints(),
    );

    const report = formatConnectionTestReport(result);

    expect(report).toContain("Possible causes include CORS/preflight rejection");
  });
});
