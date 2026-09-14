import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { englishTranslator } from "../../i18n/englishTranslator.ts";
import { genericManoeuvreLabel } from "./manoeuvreLabels.ts";
import { formatGpsStatusLine, formatFixAge } from "./rideStatusText.ts";
import { describeMapImageryRecovery } from "../../map/mapImageryRecoveryPresentation.ts";
import { RidingNextManoeuvrePanel } from "./RidingNextManoeuvrePanel.tsx";
import { RidingStatusCard, type RidingLiveStatus } from "./RidingStatusCard.tsx";
import { SUPPORTED_LANGUAGES, resolveLanguage } from "../../i18n/language.ts";
import { en } from "../../i18n/messages.en.ts";
import { routeWarningIdentity } from "../../domain/routeWarnings.ts";
import type { Manoeuvre } from "../../domain/types.ts";

const t = englishTranslator;

describe("provider manoeuvre text stays data, never copy", () => {
  // Hostile on purpose: catalogue placeholder syntax, a message-key-shaped
  // string, German road names, and punctuation that collides with the
  // project's own quoting. A provider instruction carries road names and
  // is runtime data — it must never pass through the catalogue.
  const HOSTILE_INSTRUCTIONS = [
    "Turn left onto Hauptstraße",
    "Continue onto Große Straße {count}",
    "manoeuvre.left",
    "Turn right onto {name} Way",
    'Bear left at the "Alte Brücke"',
  ] as const;

  function manoeuvre(instruction?: string): Manoeuvre {
    return {
      distanceFromStartMetres: 100,
      type: "left",
      ...(instruction ? { instruction } : {}),
    };
  }

  function renderPanel(m: Manoeuvre) {
    return render(
      <RidingNextManoeuvrePanel
        selection={{ index: 0, manoeuvre: m, remainingDistanceMetres: 120 }}
        sourceKind="planner"
        isTrusted={true}
        isFrozen={false}
      />,
    );
  }

  for (const instruction of HOSTILE_INSTRUCTIONS) {
    it(`renders ${JSON.stringify(instruction)} verbatim`, () => {
      const { unmount } = renderPanel(manoeuvre(instruction));
      expect(screen.getByText(instruction)).toBeInTheDocument();
      unmount();
    });
  }

  it("falls back to the local label only when the provider gave nothing", () => {
    // The fallback condition is `?.trim() ??`, so it fires ONLY for
    // null/undefined. A whitespace-only instruction is a defined string and
    // still suppresses the fallback — a documented, accepted edge case that
    // this migration must not quietly "fix".
    const { unmount } = renderPanel(manoeuvre());
    expect(screen.getByText("Turn left")).toBeInTheDocument();
    unmount();

    const whitespace = renderPanel(manoeuvre("   "));
    expect(screen.queryByText("Turn left")).not.toBeInTheDocument();
    whitespace.unmount();
  });

  it("offers a local label for every manoeuvre type, including an unknown one", () => {
    expect(genericManoeuvreLabel(t, "left")).toBe("Turn left");
    expect(genericManoeuvreLabel(t, "roundabout")).toBe("Go through the roundabout");
    // A legacy raw provider code, which the switch's default branch covers.
    expect(genericManoeuvreLabel(t, "17" as Manoeuvre["type"])).toBe(
      "Continue on the route",
    );
  });
});

describe("GPS status copy", () => {
  it("renders accuracy and freshness unchanged", () => {
    expect(
      formatGpsStatusLine(t, { accuracyMetres: 12, isStale: false, fixAgeMs: null }),
    ).toBe("GPS ±12 m · Live");
    expect(
      formatGpsStatusLine(t, { accuracyMetres: 12, isStale: true, fixAgeMs: null }),
    ).toBe("GPS ±12 m · Stale");
    expect(
      formatGpsStatusLine(t, { accuracyMetres: 12, isStale: true, fixAgeMs: 30_000 }),
    ).toBe("GPS ±12 m · Stale (30s ago)");
    expect(
      formatGpsStatusLine(t, { accuracyMetres: 12, isStale: true, fixAgeMs: 120_000 }),
    ).toBe("GPS ±12 m · Stale (2 min ago)");
  });

  it("never shows an age for a fresh fix, even when one is known", () => {
    expect(
      formatGpsStatusLine(t, { accuracyMetres: 9, isStale: false, fixAgeMs: 45_000 }),
    ).toBe("GPS ±9 m · Live");
  });

  it("keeps the two fix-age forms distinct", () => {
    expect(formatFixAge(t, 5_000)).toBe("5s ago");
    expect(formatFixAge(t, 180_000)).toBe("3 min ago");
  });
});

describe("map imagery wording keeps its surface distinctions", () => {
  it("says the route is shown only for route riding", () => {
    expect(describeMapImageryRecovery(t, "delayed", "route-riding").message).toBe(
      "Map imagery is taking longer than usual to load. Your route and position are still shown.",
    );
    expect(describeMapImageryRecovery(t, "tile-error", "route-riding").message).toBe(
      "Map imagery unavailable. The route and your position are still shown.",
    );
    expect(describeMapImageryRecovery(t, "fallback", "route-riding").message).toBe(
      "Map imagery unavailable — showing your route on a plain background.",
    );
  });

  it("never claims a route is shown in free roam", () => {
    // Free roam has no route on screen. This is a semantic invariant, not
    // a wording preference, and it must hold in every language.
    for (const kind of ["delayed", "load-error", "tile-error", "fallback"] as const) {
      expect(
        describeMapImageryRecovery(t, kind, "free-roam").message.toLowerCase(),
        kind,
      ).not.toContain("route");
    }
  });

  it("uses position-only wording for free roam", () => {
    expect(describeMapImageryRecovery(t, "delayed", "free-roam").message).toBe(
      "Map imagery is taking longer than usual to load. Your position is still shown.",
    );
    expect(describeMapImageryRecovery(t, "tile-error", "free-roam").message).toBe(
      "Map imagery unavailable. Your position is still shown.",
    );
    expect(describeMapImageryRecovery(t, "fallback", "free-roam").message).toBe(
      "Map imagery unavailable — showing your position on a plain background.",
    );
  });

  it("says the same thing in both surfaces when nothing is shown at all", () => {
    expect(describeMapImageryRecovery(t, "load-error", "route-riding").message).toBe(
      describeMapImageryRecovery(t, "load-error", "free-roam").message,
    );
  });

  it("keeps role, testId and retryability out of the catalogue", () => {
    // These drive behaviour and announcement severity, not wording, and
    // must not become language-dependent.
    expect(describeMapImageryRecovery(t, "load-error", "route-riding").role).toBe(
      "alert",
    );
    expect(describeMapImageryRecovery(t, "delayed", "route-riding").role).toBe("status");
    expect(describeMapImageryRecovery(t, "delayed", "route-riding").retryable).toBe(
      false,
    );
    expect(describeMapImageryRecovery(t, "tile-error", "free-roam").retryable).toBe(true);
    expect(describeMapImageryRecovery(t, "fallback", "free-roam").testId).toBe(
      "map-fallback-banner",
    );
  });
});

describe("the supported-language gate is untouched by this stage", () => {
  it("still offers English only", () => {
    expect(SUPPORTED_LANGUAGES).toEqual(["en"]);
  });

  it("still resolves a German device and a stored German preference to English", () => {
    expect(resolveLanguage("device", ["de-DE", "en-GB"])).toBe("en");
    expect(resolveLanguage("de", ["de-DE"])).toBe("en");
  });
});

describe("lifecycle hooks author no copy", () => {
  it("keeps the translator out of the modules that own the ride lifecycle", async () => {
    // The safety property this stage depends on: a copy change must never
    // restart a geolocation watch, reacquire a wake lock or recreate the
    // camera. The simplest guarantee is that those modules never see a
    // translator at all, so nothing about copy can reach their dependency
    // arrays.
    const sources = import.meta.glob("./use*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const lifecycleModules = [
      "./useRideNavigation.ts",
      "./useRideCamera.ts",
      "./useScreenWakeLock.ts",
      "./useFreeRoamNavigation.ts",
      "./useFreeRoamCamera.ts",
    ];
    for (const name of lifecycleModules) {
      const source = sources[name];
      expect(source, `${name} should exist`).toBeDefined();
      expect(source, name).not.toContain("useTranslate");
      expect(source, name).not.toContain("Translator");
    }
    await Promise.resolve();
    vi.clearAllMocks();
  });
});

describe("the status card announces a ride in catalogue copy", () => {
  const noop = () => {
    /* no-op */
  };

  function buildLiveStatus(overrides: Partial<RidingLiveStatus> = {}): RidingLiveStatus {
    return {
      offRouteLevel: "on-route",
      distanceRemainingMetres: 1200,
      remainingAscentMetres: 993,
      accuracyMetres: 7.4,
      isStale: false,
      fixAgeMs: 2000,
      ...overrides,
    };
  }

  function renderCard(props: {
    liveStatus?: RidingLiveStatus;
    imageryRecoveryStatus?: {
      kind: "delayed" | "load-error" | "tile-error" | "fallback";
    } | null;
  }) {
    return render(
      <RidingStatusCard
        liveStatus={props.liveStatus ?? buildLiveStatus()}
        geolocationErrorMessage={null}
        onRetryGeolocation={noop}
        online={true}
        imageryRecoveryStatus={props.imageryRecoveryStatus ?? null}
        onRetryImagery={noop}
      />,
    );
  }

  it("keeps role severity with the state, not with the wording", () => {
    // The announcement severity must be a property of the ride state. If
    // it ever came from the catalogue, a translator could silently
    // downgrade an off-route alert to a passive status.
    const onRoute = renderCard({});
    expect(screen.getByText(t.t("ride.status.onRoute"))).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    onRoute.unmount();

    renderCard({ liveStatus: buildLiveStatus({ offRouteLevel: "off-route" }) });
    expect(screen.getByText(t.t("ride.status.offRoute"))).toHaveAttribute(
      "role",
      "alert",
    );
  });

  it("renders exactly one imagery message, and it is the route-riding wording", () => {
    // MapView suppresses its own in-overlay copy while a host presents
    // the status (item 108). Both sides now read the same catalogue
    // entry, so a duplicate would be the identical sentence twice.
    renderCard({ imageryRecoveryStatus: { kind: "tile-error" } });
    const expected = describeMapImageryRecovery(t, "tile-error", "route-riding").message;
    expect(screen.getAllByText(expected)).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: t.t("map.retryImagery") })).toHaveLength(
      1,
    );
  });

  it("gives the retry action an accessible name from the catalogue", () => {
    renderCard({ imageryRecoveryStatus: { kind: "tile-error" } });
    expect(screen.getByRole("button", { name: "Retry map imagery" })).toBeInTheDocument();
  });

  it("shows no imagery message at all when imagery is healthy", () => {
    renderCard({});
    expect(screen.queryByRole("button", { name: t.t("map.retryImagery") })).toBeNull();
  });
});

describe("the stage 2 and stage 3 boundaries are still intact", () => {
  it("keeps the Route Library and Planning catalogue prefixes populated", () => {
    // Stage 4 threads a translator through new call sites; it must not
    // have moved or renamed anything the earlier stages migrated.
    const keys = Object.keys(en);
    for (const prefix of [
      "routes.",
      "tags.",
      "gpx.",
      "planning.",
      "warning.",
      "surface.",
    ]) {
      expect(
        keys.some((key) => key.startsWith(prefix)),
        prefix,
      ).toBe(true);
    }
  });

  it("keeps route-warning identity semantic rather than message-based", () => {
    const surface = {
      kind: "questionable-surface" as const,
      startDistanceMetres: 0,
      endDistanceMetres: 100,
      message: "whatever was stored",
      surface: { type: "gravel" as const, label: "Gravel" },
    };
    const sameTypeDifferentMessage = { ...surface, message: "something else entirely" };
    expect(routeWarningIdentity(surface)).toBe(
      routeWarningIdentity(sameTypeDifferentMessage),
    );
  });
});
