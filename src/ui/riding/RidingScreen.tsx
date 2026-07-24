import { useCallback, useEffect, useRef } from "react";
import type { PlannedRoute } from "../../domain/types.ts";
import { MapView } from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import type { GeolocationError, GeolocationSource } from "../../platform/geolocation.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import type { OffRouteLevel } from "../../navigation/types.ts";
import { ELEVATION_WINDOW_OPTIONS_METRES } from "../../navigation/upcomingElevation.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import { ElevationChart } from "../shared/ElevationChart.tsx";
import { formatAscent, formatDistanceKm } from "../shared/routeSummary.ts";
import { useRideCamera } from "./useRideCamera.ts";
import { useRideNavigation } from "./useRideNavigation.ts";

export interface RidingScreenProps {
  route: PlannedRoute;
  geolocationSource?: GeolocationSource;
  mapFactory?: MapFactory;
  clock?: Clock;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
};

function formatGeolocationError(error: GeolocationError): string {
  switch (error.reason) {
    case "permission-denied":
      return "Location permission was denied. Allow location access in your browser settings to use Riding mode.";
    case "timeout":
      return "Getting your location timed out. Check you have a clear view of the sky and try again.";
    case "unsupported":
      return "This browser does not support location services.";
    case "position-unavailable":
    default:
      return "Your location is currently unavailable.";
  }
}

const OFF_ROUTE_LABEL: Record<OffRouteLevel, string> = {
  "on-route": "On route",
  "possibly-off-route": "Possibly off route",
  "off-route": "Off route",
};

function formatFixAge(ageMs: number): string {
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  if (seconds < 60) return `${String(seconds)}s ago`;
  return `${String(Math.round(seconds / 60))} min ago`;
}

export function RidingScreen({
  route,
  geolocationSource,
  mapFactory,
  clock = systemClock,
}: RidingScreenProps) {
  // Bridges useRideCamera's current camera state into useRideNavigation's
  // persistence. Both hooks are called in this same render, and
  // useRideCamera needs useRideNavigation's restoredCameraState as an
  // input, so neither can feed the other's *current* render output back
  // into its own call — a stable getter reading a ref (updated below,
  // once camera exists) avoids that without a setState-in-effect bridge.
  const cameraStateRef = useRef<StoredCameraState>(DEFAULT_CAMERA_STATE);
  const getCameraState = useCallback(() => cameraStateRef.current, []);

  const nav = useRideNavigation(route, { geolocationSource, clock, getCameraState });
  const camera = useRideCamera({
    routeId: route.id,
    currentFix: nav.currentFix,
    isStale: nav.isStale,
    restoredCameraState: nav.restoredCameraState,
  });

  useEffect(() => {
    cameraStateRef.current = camera.persistableCameraState;
  }, [camera.persistableCameraState]);

  const now = useNow(clock);
  const fixAgeMs = nav.currentFix ? now - nav.currentFix.timestampMs : null;
  const online = useOnlineStatus();

  const handleStart = () => {
    nav.start();
    camera.requestFollow();
  };

  return (
    <section aria-label="Riding">
      <h2>{route.name}</h2>
      <p>
        {formatDistanceKm(route.distanceMetres)} · {formatAscent(route.ascentMetres)}
      </p>

      {!online ? (
        <p role="status">
          Offline — the route, your position, progress and elevation still work; map
          imagery may be unavailable.
        </p>
      ) : null}

      {nav.geolocationStatus === "idle" ? (
        <div>
          <p>
            {nav.currentFix
              ? "Resume riding to continue tracking your progress."
              : "Location access is needed to track your progress on this ride."}
          </p>
          <button type="button" onClick={handleStart}>
            {nav.currentFix ? "Resume riding" : "Start riding"}
          </button>
        </div>
      ) : null}

      {nav.geolocationStatus === "error" && nav.geolocationError ? (
        <div role="alert">
          <p>{formatGeolocationError(nav.geolocationError)}</p>
          <button type="button" onClick={handleStart}>
            Try again
          </button>
        </div>
      ) : null}

      {nav.geolocationStatus === "watching" && !nav.currentFix ? (
        <p role="status">Waiting for a GPS fix…</p>
      ) : null}

      {nav.currentFix ? (
        <div>
          <div role={nav.offRouteLevel === "off-route" ? "alert" : "status"}>
            {OFF_ROUTE_LABEL[nav.offRouteLevel]}
          </div>

          <p>
            GPS accuracy: ±{Math.round(nav.currentFix.accuracyMetres)} m —{" "}
            {nav.isStale ? "Stale" : "Live"}
            {fixAgeMs !== null ? ` (${formatFixAge(fixAgeMs)})` : null}
          </p>

          {nav.distanceRemainingMetres !== null ? (
            <p>Remaining: {formatDistanceKm(nav.distanceRemainingMetres)}</p>
          ) : null}
        </div>
      ) : null}

      {camera.showPausedToast ? <p role="status">Map follow paused.</p> : null}

      {/* Shown before Start riding is tapped, too — the whole route is
       * already known and privacy-safe (no live location involved), so
       * there's no reason to wait for a GPS fix to preview it. MapView
       * always frames the entire route regardless of ride progress. */}
      <div style={{ height: 320, position: "relative" }}>
        <MapView
          points={route.points}
          matchedDistanceFromStartMetres={nav.matchedDistanceFromStartMetres ?? 0}
          currentPosition={nav.currentFix?.coordinate}
          mapFactory={mapFactory}
          cameraTarget={camera.cameraTarget}
          suppressInitialOverviewFit={camera.mode !== "overview"}
          onUserCameraInteraction={camera.reportUserInteraction}
          onCameraSettled={(settled) => {
            camera.reportCameraSettled(settled.coordinate, settled.zoom);
          }}
        />
        {nav.geolocationStatus === "watching" ? (
          <button
            type="button"
            onClick={camera.requestFollow}
            aria-label="Follow my location"
            aria-pressed={camera.mode === "following"}
            style={{
              position: "absolute",
              bottom: 12,
              right: 12,
              minWidth: 48,
              minHeight: 48,
              borderRadius: "50%",
              border:
                camera.mode === "following" ? "none" : "2px solid var(--colour-text)",
              background:
                camera.mode === "following" ? "var(--colour-accent)" : "var(--colour-bg)",
              color: camera.mode === "following" ? "#ffffff" : "var(--colour-text)",
              fontSize: "0.75rem",
              lineHeight: 1.1,
            }}
          >
            {camera.mode === "following" && camera.awaitingFreshFix ? "Waiting…" : "⌖"}
          </button>
        ) : null}
      </div>

      {nav.currentFix ? (
        <div role="group" aria-label="Upcoming elevation window">
          {ELEVATION_WINDOW_OPTIONS_METRES.map((windowMetres) => (
            <button
              key={windowMetres}
              type="button"
              aria-pressed={nav.elevationWindowMetres === windowMetres}
              onClick={() => {
                nav.setElevationWindowMetres(windowMetres);
              }}
            >
              {windowMetres / 1000} km
            </button>
          ))}
        </div>
      ) : null}
      {/* Before riding starts, show the whole route's profile; once
       * riding, switch to the windowed upcoming view above. */}
      <ElevationChart
        points={nav.currentFix ? nav.upcomingElevation.points : route.points}
      />
    </section>
  );
}
