import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import pkg from "../../../package.json" with { type: "json" };
import { DiagnosticsScreen } from "./DiagnosticsScreen.tsx";
import { db } from "../../storage/db.ts";
import { setActiveRideState } from "../../storage/rideStateRepository.ts";
import {
  clearRoutingDiagnostics,
  describeRoutingAttempt,
  recordRoutingAttempt,
  type RoutingAttemptDiagnostic,
} from "../../routing/routingDiagnostics.ts";
import { clearMapDiagnostics, recordMapAttempt } from "../../map/mapDiagnostics.ts";
import type { Clock } from "../../platform/clock.ts";
import { saveProviderKey } from "../../storage/providerKeyRepository.ts";
import type { RoutingProvider } from "../../routing/provider.ts";
import { RoutingError } from "../../routing/openRouteServiceErrors.ts";
import type { PlannedRoute } from "../../domain/types.ts";

// jsdom doesn't implement a real WebGL context, so the real
// isMapRenderingSupported() would otherwise log a "Not implemented:
// HTMLCanvasElement.getContext()" warning on every render (this
// component calls it inline, unconditionally). Stubbed here at the
// capability-result level, not by faking WebGL — mapSupport.test.ts
// covers the underlying decision logic (webgl2/webgl/neither) against
// its own targeted canvas.getContext stub instead.
vi.mock("../../platform/mapSupport.ts", () => ({
  isMapRenderingSupported: vi.fn(() => true),
}));
import { isMapRenderingSupported } from "../../platform/mapSupport.ts";

function fakeRoutingProvider(behaviour: () => Promise<PlannedRoute>): RoutingProvider {
  return { calculateRoute: () => behaviour() };
}

function buildFakeRoute(): PlannedRoute {
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

function buildAttempt(
  overrides: Partial<RoutingAttemptDiagnostic> &
    Pick<RoutingAttemptDiagnostic, "timestampIso" | "responseReceived" | "category">,
): RoutingAttemptDiagnostic {
  return {
    attemptId: overrides.timestampIso,
    providerId: "openrouteservice",
    endpointHost: "api.heigit.org",
    endpointPath: "/directions/cycling-road/geojson",
    httpMethod: "POST",
    wasOnline: true,
    isSecureContext: true,
    isServiceWorkerControlled: false,
    isStandalone: false,
    waypointCount: 2,
    elapsedMs: 0,
    headersConstructed: true,
    requestConstructed: true,
    fetchInvoked: true,
    fetchReturnedPromise: true,
    ...overrides,
  };
}

function getDetailValue(termText: string): HTMLElement {
  const term = screen.getByText(termText);
  const value = term.nextElementSibling;
  if (!value) throw new Error(`no <dd> found after <dt>${termText}</dt>`);
  return value as HTMLElement;
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
  clearRoutingDiagnostics();
  clearMapDiagnostics();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DiagnosticsScreen", () => {
  it("shows Map rendering support as Supported or Not supported, driven by isMapRenderingSupported's result", () => {
    vi.mocked(isMapRenderingSupported).mockReturnValueOnce(true);
    const { unmount } = render(<DiagnosticsScreen />);
    expect(getDetailValue("Map rendering support")).toHaveTextContent("Supported");
    unmount();

    vi.mocked(isMapRenderingSupported).mockReturnValueOnce(false);
    render(<DiagnosticsScreen />);
    expect(getDetailValue("Map rendering support")).toHaveTextContent(
      "Not supported by this browser",
    );
  });

  it("renders every field with a value or an explicit placeholder, never blank", async () => {
    render(<DiagnosticsScreen />);

    expect(getDetailValue("App version")).toHaveTextContent(__APP_VERSION__);
    expect(getDetailValue("Build")).toHaveTextContent(__BUILD_ID__);
    // __APP_VERSION__ is itself just a build-time copy of this value (see
    // vite.config.ts's `define`) — asserting against package.json directly,
    // rather than only against __APP_VERSION__, is what actually proves the
    // displayed text traces back to the single authoritative version source
    // rather than a hard-coded duplicate that happens to agree today.
    expect(getDetailValue("App version")).toHaveTextContent(pkg.version);
    expect(getDetailValue("Network")).toHaveTextContent(/online|offline/i);
    expect(getDetailValue("Service worker")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Map rendering support")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Geolocation permission")).not.toBeEmptyDOMElement();
    expect(getDetailValue("Last known fix accuracy")).toHaveTextContent(
      "Not applicable yet",
    );
    expect(getDetailValue("Last known fix age")).toHaveTextContent("Not applicable yet");
    expect(getDetailValue("Active route")).toHaveTextContent("None");
    expect(screen.getByText(/no errors recorded this session/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(getDetailValue("Storage")).toHaveTextContent(/OK \(schema version 4\)/);
    });
  });

  it("renders exactly one h1 and the four sections in order, with two h3s nested inside Routing diagnostics", () => {
    render(<DiagnosticsScreen />);

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Diagnostics" }),
    ).toBeInTheDocument();

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual([
      "System status",
      "Recent errors",
      "Routing diagnostics",
      "Recent map imagery attempts",
    ]);

    const routingRegion = screen.getByRole("region", { name: "Routing diagnostics" });
    expect(
      within(routingRegion)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["Recent routing attempts", "Test routing connection"]);
  });

  it("reflects a granted geolocation permission from the Permissions API", async () => {
    vi.stubGlobal("navigator", {
      onLine: true,
      permissions: {
        query: () =>
          Promise.resolve({
            state: "granted",
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }),
      },
      geolocation: {},
    });

    render(<DiagnosticsScreen />);

    await waitFor(() => {
      expect(getDetailValue("Geolocation permission")).toHaveTextContent("Granted");
    });
  });

  it("shows the last known fix accuracy/age and active route id from a persisted ride state", async () => {
    const fixedClock: Clock = { now: () => 60_000 };
    await setActiveRideState({
      id: "active",
      routeId: "route-42",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastFix: { coordinate: [-1.5, 53.8], accuracyMetres: 9.2, timestampMs: 30_000 },
      lastMatchedPointIndex: 3,
      matchedDistanceFromStartMetres: 150,
      offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
      elevationWindowMetres: 5000,
    });

    render(<DiagnosticsScreen clock={fixedClock} />);

    await waitFor(() => {
      expect(getDetailValue("Last known fix accuracy")).toHaveTextContent("±9 m");
    });
    expect(getDetailValue("Last known fix age")).toHaveTextContent("30s ago");
    expect(getDetailValue("Active route")).toHaveTextContent("route-42");
  });

  it("shows no routing attempts recorded this session by default", () => {
    render(<DiagnosticsScreen />);

    expect(
      screen.getByText(/no routing attempts recorded this session/i),
    ).toBeInTheDocument();
  });

  it("distinguishes a received HTTP response, offline, timeout and an unexposed fetch failure, and explains the CORS/502 ambiguity, once its disclosure is opened", async () => {
    const user = userEvent.setup();
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:00:00.000Z",
        elapsedMs: 200,
        responseReceived: true,
        httpStatus: 502,
        category: "provider-unavailable",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:01:00.000Z",
        wasOnline: false,
        responseReceived: false,
        category: "offline",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:02:00.000Z",
        elapsedMs: 15_000,
        responseReceived: false,
        category: "timeout",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:03:00.000Z",
        elapsedMs: 50,
        responseReceived: false,
        category: "transport-failure",
      }),
    );

    render(<DiagnosticsScreen />);

    expect(
      screen.getByText("HTTP response received: 502 (provider-unavailable)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Device reported offline")).toBeInTheDocument();
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
    expect(
      screen.getByText("Fetch promise rejected before an HTTP response was exposed"),
    ).toBeInTheDocument();

    const explanation = screen.getByText(/missing CORS headers/i);
    expect(explanation).not.toBeVisible();
    await user.click(screen.getByText("Why a fetch can fail before an HTTP response"));
    expect(explanation).toBeVisible();
  });

  it("keeps the fetch-failure explanation collapsed by default and reveals it on demand", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsScreen />);

    const explanation = screen.getByText(/missing CORS headers/i);
    expect(explanation).not.toBeVisible();
    await user.click(screen.getByText("Why a fetch can fail before an HTTP response"));
    expect(explanation).toBeVisible();
  });

  // Backlog item 101. Both Routing disclosures are native <details>, so
  // "collapsed" and "open" are asserted from the element's own `open`
  // property rather than by probing an ARIA role — the summaries are
  // located deterministically by their exact text and their owning
  // element's tag name is checked explicitly.
  it("keeps both routing disclosures collapsed by default and operates them independently", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsScreen />);

    const fetchSummary = screen.getByText("Why a fetch can fail before an HTTP response");
    const statusSummary = screen.getByText("What HTTP statuses mean");
    expect(fetchSummary.tagName).toBe("SUMMARY");
    expect(statusSummary.tagName).toBe("SUMMARY");

    const fetchDisclosure = fetchSummary.closest<HTMLDetailsElement>("details");
    const statusDisclosure = statusSummary.closest<HTMLDetailsElement>("details");
    if (!fetchDisclosure || !statusDisclosure) {
      throw new Error("expected each summary to live inside a native <details>");
    }
    expect(fetchDisclosure).not.toBe(statusDisclosure);
    expect(fetchDisclosure.open).toBe(false);
    expect(statusDisclosure.open).toBe(false);

    await user.click(statusSummary);
    expect(statusDisclosure.open).toBe(true);
    expect(fetchDisclosure.open).toBe(false);
    expect(screen.getByText(/missing CORS headers/i)).not.toBeVisible();

    await user.click(fetchSummary);
    expect(fetchDisclosure.open).toBe(true);
    expect(statusDisclosure.open).toBe(true);

    await user.click(statusSummary);
    expect(statusDisclosure.open).toBe(false);
    expect(fetchDisclosure.open).toBe(true);
  });

  // Backlog item 101's required categories, asserted as exact copy so the
  // deliberately hedged wording cannot drift into a claim a status alone
  // does not support (notably: 403 is never presented as a used-up
  // allowance, and 408 is never presented as the provider reporting that
  // *its own* processing took too long).
  // Backlog item 101 follow-up: the guidance is grouped by status class
  // as nested native lists — one outer <li> per group carrying a visible
  // <strong> label and an inner <ul> of code rows. Asserted group by
  // group, as exact copy, so the deliberately hedged wording cannot drift
  // into a claim a status alone does not support.
  it("groups every HTTP status category by class, in cautious language, once its disclosure is opened", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsScreen />);

    const statusSummary = screen.getByText("What HTTP statuses mean");
    const statusDisclosure = statusSummary.closest<HTMLDetailsElement>("details");
    if (!statusDisclosure) throw new Error("expected a native <details>");

    const leadIn = screen.getByText(/broad categories, not a proven cause/i);
    expect(leadIn).not.toBeVisible();

    await user.click(statusSummary);
    expect(leadIn).toBeVisible();

    // The corrected lead-in: an exposed status is recorded in Recent
    // routing attempts, a *failed* connection test also shows it, and a
    // successful one does not repeat it — the connection test's success
    // result has no HTTP status to show (RoutingProvider returns a
    // PlannedRoute, which carries none), so this states the real
    // contract rather than the earlier over-broad claim.
    const leadInText = leadIn.textContent.replace(/\s+/g, " ").trim();
    expect(leadInText).toBe(
      "When the routing provider exposes an HTTP response, its status is recorded in Recent routing attempts below. A failed connection test also shows it when the failure carried one; a successful connection test does not repeat it. These are broad categories, not a proven cause:",
    );

    const groups = [...statusDisclosure.querySelectorAll(":scope > ul > li")];
    const groupLabels = groups.map(
      (group) => group.querySelector(":scope > strong")?.textContent ?? "",
    );
    expect(groupLabels).toEqual([
      "Success (2xx)",
      "Redirects (3xx)",
      "Request or access problems (4xx)",
      "Service problems (5xx)",
      "No HTTP status",
    ]);

    const rowsOf = (index: number): string[] => {
      const group = groups[index];
      if (!group) throw new Error(`expected a status group at index ${String(index)}`);
      return [...group.querySelectorAll(":scope > ul > li")].map((row) =>
        row.textContent.replace(/\s+/g, " ").trim(),
      );
    };

    expect(rowsOf(0)).toEqual([
      "200 — the normal successful response for a routing request. HTTP success is not the whole check: ACN still checks that the response contains usable route data.",
    ]);

    expect(rowsOf(1)).toEqual([
      "The browser normally follows redirects automatically and records the final response instead, so an intermediate 3xx status is not normally shown here.",
    ]);

    expect(rowsOf(2)).toEqual([
      "400 — the request was incorrect or could not be processed.",
      "401 or 403 — the stored key, authorisation or access may have been rejected. OpenRouteService can also use 403 for an exhausted daily allowance, but the status alone does not prove which cause applies.",
      "404 — OpenRouteService documents this as either an unavailable endpoint or a request for which no result or route was found. The status alone does not say which.",
      "405 — the request method was not accepted. This is unexpected during normal ACN use.",
      "408 — an HTTP server or intermediary returned an exposed timeout response. This is not the same as ACN's own request timeout, or a fetch rejection with no exposed response.",
      "413 — the request exceeds a size or capacity limit.",
      "429 — request-rate or quota limiting. Waiting before retrying, or checking the provider allowance, may help.",
      "Other 4xx — the request was rejected, but the exact reason is not established by the status alone.",
    ]);

    expect(rowsOf(3)).toEqual([
      "500 — an unexpected service-side error.",
      "501 — the service does not support functionality required by the request.",
      "Other 5xx, including 502 to 504 — a service, gateway or upstream failure. Retrying later may help.",
    ]);

    expect(rowsOf(4)).toEqual([
      'No HTTP response was exposed to the browser, so no status can say anything about the service. See "Why a fetch can fail before an HTTP response" above.',
    ]);

    // The qualifiers themselves, called out separately from the exact
    // copy above so their absence is an obvious failure rather than a
    // buried string difference. No status is presented as proof of one
    // exact provider-specific cause.
    const problems = rowsOf(2);
    expect(problems[1]).toMatch(/does not prove which cause applies/);
    expect(problems[2]).toMatch(/does not say which/);
    expect(problems[7]).toMatch(/not established by the status alone/);
    expect(rowsOf(3)[2]).toMatch(/may help/);

    // Item 101 must complement, never duplicate, the no-response
    // disclosure: the new copy defers to it by title instead of
    // re-explaining the CORS/DNS/TLS/local-network ambiguity, which is
    // also what keeps /missing CORS headers/ a unique query.
    expect(screen.getAllByText(/missing CORS headers/i)).toHaveLength(1);
  });

  // Backlog item 101. The disclosure quotes a routing-attempt entry
  // verbatim; binding it to describeRoutingAttempt's real output stops
  // the two silently diverging again, as they had before this item (the
  // prose quoted "Fetch failed before an HTTP response was exposed to the
  // browser", a string the application never produces).
  it("quotes the no-response entry that describeRoutingAttempt actually produces", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsScreen />);

    const actualEntry = describeRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:00:00.000Z",
        responseReceived: false,
        category: "transport-failure",
      }),
    );

    await user.click(screen.getByText("Why a fetch can fail before an HTTP response"));
    const explanation = screen.getByText(/missing CORS headers/i);

    expect(explanation).toBeVisible();
    expect(explanation.textContent.replace(/\s+/g, " ")).toContain(actualEntry);

    // Meaning preserved: all four indistinguishable possibilities, and
    // the refusal to guess between them, stay exactly as they were.
    expect(explanation).toHaveTextContent(/provider outage/i);
    expect(explanation).toHaveTextContent(/missing CORS header/i);
    expect(explanation).toHaveTextContent(/DNS or TLS failure/i);
    expect(explanation).toHaveTextContent(/local network restriction/i);
    expect(explanation).toHaveTextContent(
      /cannot be told apart from this information alone/i,
    );
  });

  // Backlog item 101: the guidance must not cost the reader the exact
  // number. This covers the recent-attempts surface; the connection-test
  // surface is covered in its own describe below. The successful 200 is
  // the one a rider actually sees after Test routing connection — the
  // adapter records it here on the success path, and it is the only
  // place it appears, since the connection test's own success result
  // carries no HTTP status at all. Both halves pass on the pre-follow-up
  // implementation (describeRoutingAttempt is unchanged), so this is a
  // leak guard for the regrouped copy, not fail-first evidence.
  it("still shows a received response's exact status, success included, alongside the open guidance", async () => {
    const user = userEvent.setup();
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:00:00.000Z",
        responseReceived: true,
        httpStatus: 429,
        category: "rate-limited",
      }),
    );
    recordRoutingAttempt(
      buildAttempt({
        timestampIso: "2026-01-01T00:01:00.000Z",
        responseReceived: true,
        httpStatus: 200,
        category: "success",
      }),
    );

    render(<DiagnosticsScreen />);

    await user.click(screen.getByText("What HTTP statuses mean"));

    expect(
      screen.getByText("HTTP response received: 429 (rate-limited)"),
    ).toBeInTheDocument();
    expect(screen.getByText("HTTP response received: 200")).toBeInTheDocument();
  });

  it("shows no map imagery attempts recorded this session by default", () => {
    render(<DiagnosticsScreen />);

    expect(
      screen.getByText(/no map imagery attempts recorded this session/i),
    ).toBeInTheDocument();
  });

  it("shows recorded map imagery attempts in plain language", () => {
    recordMapAttempt({
      timestampIso: "2026-01-01T00:00:00.000Z",
      tileProviderId: "openfreemap-liberty",
      category: "fallback-activated",
      wasOnline: true,
      justResumed: false,
    });
    recordMapAttempt({
      timestampIso: "2026-01-01T00:01:00.000Z",
      tileProviderId: "openfreemap-liberty",
      category: "auto-retry",
      wasOnline: true,
      justResumed: true,
    });

    render(<DiagnosticsScreen />);

    expect(screen.getByText(/switched to the plain background/i)).toBeInTheDocument();
    // Scoped to the map-imagery row's own wording: item 101's follow-up
    // added a Routing-diagnostics guidance row that also contains
    // "automatically", so a bare /automatically/i now matches two
    // elements. Stricter, not weaker — this still proves the auto-retry
    // entry renders in plain language.
    expect(
      screen.getByText(/retry attempted automatically after resuming or reconnecting/i),
    ).toBeInTheDocument();
  });

  describe("Test routing connection", () => {
    it("states the one-request cost up front and disables the button with no key configured", () => {
      render(<DiagnosticsScreen />);

      expect(screen.getByText(/uses one API request/i)).toBeInTheDocument();
      expect(screen.getByText(/no openrouteservice key configured/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Test routing connection" }),
      ).toBeDisabled();
    });

    it("never runs automatically on mount", () => {
      const calculateRoute = vi.fn(() => Promise.resolve(buildFakeRoute()));

      render(<DiagnosticsScreen routingProvider={{ calculateRoute }} />);

      expect(calculateRoute).not.toHaveBeenCalled();
    });

    it("runs one request on click and shows a success result, never the coordinates", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const calculateRoute = vi.fn(() => Promise.resolve(buildFakeRoute()));

      render(<DiagnosticsScreen routingProvider={{ calculateRoute }} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      expect(calculateRoute).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/8\.681495/)).not.toBeInTheDocument();
    });

    it("shows the hedged, non-CORS-confirming explanation on a transport failure", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.reject(
          new RoutingError({
            reason: "transport-failure",
            message: "The routing request failed.",
            transportErrorName: "TypeError",
            transportErrorMessage: "Failed to fetch",
            transportFailureReasonCode: "generic-fetch-rejection",
            dispatchMarkers: {
              headersConstructed: true,
              requestConstructed: true,
              fetchInvoked: true,
              fetchReturnedPromise: true,
              responseReceived: false,
            },
          }),
        ),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Failed/);
      });
      expect(
        screen.getByText(/browser or network may have blocked the request/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/transport-response-unavailable/)).toBeInTheDocument();
      expect(screen.getByText("TypeError: Failed to fetch")).toBeInTheDocument();
      expect(screen.getByText("generic-fetch-rejection")).toBeInTheDocument();
    });

    it("shows every dispatch marker in the visible result, not just the copied report", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      expect(screen.getByText("Headers constructed")).toBeInTheDocument();
      expect(screen.getByText("Request constructed")).toBeInTheDocument();
      expect(screen.getByText("Fetch invoked")).toBeInTheDocument();
      expect(screen.getByText("Fetch returned a promise")).toBeInTheDocument();
      expect(screen.getByText("HTTP response received")).toBeInTheDocument();
    });

    it("copies a report that never contains the coordinates or a key", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        onLine: true,
        clipboard: { writeText },
      });

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });
      await user.click(screen.getByRole("button", { name: "Copy diagnostic report" }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      const [report] = writeText.mock.calls[0] as [string];
      expect(report).not.toContain("8.681495");
      expect(report).not.toContain("dummy-test-key");
      expect(report).toContain("App version:");
      expect(report).toContain("Build:");
      expect(report).not.toContain("0.0.0");
    });

    it("shows a read-only fallback textarea with the same redacted report on copy failure", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );
      const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
      vi.stubGlobal("navigator", {
        onLine: true,
        clipboard: { writeText },
      });

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });

      await user.click(screen.getByRole("button", { name: "Copy diagnostic report" }));
      await waitFor(() => {
        expect(screen.getByText(/could not copy automatically/i)).toBeInTheDocument();
      });

      const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
      expect(textarea.readOnly).toBe(true);
      expect(textarea.value).toContain("App version:");
      expect(textarea.value).toContain("Build:");
      expect(textarea.value).not.toContain("8.681495");
      expect(textarea.value).not.toContain("dummy-test-key");
    });

    // Backlog item 101: the connection test's own labelled "HTTP status"
    // row must keep the exact number the provider exposed, unchanged by
    // the new guidance. No real request is made — the component's
    // routingProvider prop is the injection seam, and the error carries
    // responseReceived: true so this is the exposed-response path rather
    // than a transport failure. Verified to pass on the pre-item
    // implementation too, so this is a leak guard for the new copy, not
    // fail-first evidence.
    it("keeps a received response's exact HTTP status in the connection-test result", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const routingProvider = fakeRoutingProvider(() =>
        Promise.reject(
          new RoutingError({
            reason: "rate-limited",
            message: "The routing service is rate limiting requests.",
            httpStatus: 429,
            dispatchMarkers: {
              headersConstructed: true,
              requestConstructed: true,
              fetchInvoked: true,
              fetchReturnedPromise: true,
              responseReceived: true,
            },
          }),
        ),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Failed/);
      });
      expect(getDetailValue("HTTP status")).toHaveTextContent("429");
    });

    // Backlog item 101 leak guard (passes on the pre-item implementation
    // too): opening the new guidance must not put the stored key or the
    // fixed test coordinates on screen, and must not change what the
    // copied report contains. Scoped deliberately to values this path
    // really carries — the raw request body and raw provider response are
    // covered by the adapter's own redaction tests, which inject such
    // sentinels through the adapter, and are not re-claimed here.
    it("keeps the key and coordinates redacted, and the copied report unchanged, with both disclosures open", async () => {
      await saveProviderKey("dummy-test-key");
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", {
        onLine: true,
        clipboard: { writeText },
      });
      const routingProvider = fakeRoutingProvider(() =>
        Promise.resolve(buildFakeRoute()),
      );

      render(<DiagnosticsScreen routingProvider={routingProvider} />);

      const testButton = await screen.findByRole("button", {
        name: "Test routing connection",
      });
      await waitFor(() => {
        expect(testButton).toBeEnabled();
      });
      await user.click(testButton);
      await waitFor(() => {
        expect(screen.getByRole("status")).toHaveTextContent(/Succeeded/);
      });

      await user.click(screen.getByText("Why a fetch can fail before an HTTP response"));
      await user.click(screen.getByText("What HTTP statuses mean"));

      expect(document.body.textContent).not.toContain("dummy-test-key");
      expect(screen.queryByText(/8\.681495/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Copy diagnostic report" }));
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });
      const [report] = writeText.mock.calls[0] as [string];
      expect(report).not.toContain("dummy-test-key");
      expect(report).not.toContain("8.681495");
      expect(report).not.toContain("What HTTP statuses mean");
      expect(report).not.toContain("request-rate or quota limiting");
    });
  });

  describe("Storage quota estimate", () => {
    it("shows an explicit unsupported estimate fallback once the database opens", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: undefined,
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent(/OK \(schema version 4\)/);
      });
      expect(getDetailValue("Storage")).toHaveTextContent(
        "Estimated app storage: not supported by this browser",
      );
    });

    it("shows a mid-range usage estimate with a formatted percentage and no pressure warning", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: {
          estimate: () =>
            Promise.resolve({ usage: 10 * 1024 * 1024, quota: 500 * 1024 * 1024 }),
        },
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent(
          "Estimated app storage: 10.0 MiB of 500.0 MiB used (2%)",
        );
      });
      expect(getDetailValue("Storage")).not.toHaveTextContent("Storage pressure warning");
    });

    it("shows a sub-1% usage estimate as <1% rather than a misleadingly exact 0%", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: {
          estimate: () => Promise.resolve({ usage: 1_048_576, quota: 500 * 1024 * 1024 }),
        },
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent("<1%)");
      });
    });

    it("shows an explicit pressure warning at exactly 90% usage", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: { estimate: () => Promise.resolve({ usage: 900, quota: 1000 }) },
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent("(90%)");
      });
      expect(getDetailValue("Storage")).toHaveTextContent(
        "Storage pressure warning: estimated app storage usage is high.",
      );
    });

    it("does not show a pressure warning just under 90% usage", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: { estimate: () => Promise.resolve({ usage: 899, quota: 1000 }) },
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent("(89%)");
      });
      expect(getDetailValue("Storage")).not.toHaveTextContent("Storage pressure warning");
    });

    it("shows the database as OK alongside an unavailable estimate when estimate() rejects", async () => {
      vi.stubGlobal("navigator", {
        onLine: true,
        storage: { estimate: () => Promise.reject(new Error("quota check failed")) },
      });

      render(<DiagnosticsScreen />);

      await waitFor(() => {
        expect(getDetailValue("Storage")).toHaveTextContent(/OK \(schema version 4\)/);
      });
      expect(getDetailValue("Storage")).toHaveTextContent(
        "Estimated app storage: unavailable",
      );
    });
  });
});
