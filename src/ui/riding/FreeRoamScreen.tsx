import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MapView } from "../../map/MapView.tsx";
import type { MapFactory } from "../../map/mapAdapter.ts";
import type { GeolocationError, GeolocationSource } from "../../platform/geolocation.ts";
import { systemClock, useNow, type Clock } from "../../platform/clock.ts";
import { logError } from "../../platform/errorLog.ts";
import { useOnlineStatus } from "../../platform/onlineStatus.ts";
import { isWakeLockSupported, type WakeLockSource } from "../../platform/wakeLock.ts";
import type { StoredCameraState } from "../../storage/mapping.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { FreeRoamStatusStrip } from "./FreeRoamStatusStrip.tsx";
import { RidingImmersiveHeader } from "./RidingImmersiveHeader.tsx";
import { RidingWakeLockControl } from "./RidingWakeLockControl.tsx";
import { useFreeRoamCamera } from "./useFreeRoamCamera.ts";
import { useFreeRoamNavigation } from "./useFreeRoamNavigation.ts";

export interface FreeRoamScreenProps {
  geolocationSource?: GeolocationSource;
  mapFactory?: MapFactory;
  clock?: Clock;
  wakeLockSource?: WakeLockSource;
  onRidingActiveChange?: (active: boolean) => void;
  /** Called once a successful End ride has fully completed — mirrors
   * RidingScreen.tsx's identically-named/shaped prop exactly, including the
   * "storage cleared first, only then in-memory state reset, callback fires
   * last and its own failure is only ever logged, never surfaced as a
   * finalisation failure" contract. App.tsx is the only current caller; it
   * clears its own ride-content selection in response, which is what
   * actually unmounts this screen and shows the empty Ride launcher again. */
  onRideFinalized?: () => void;
  /** Called once a successful Pause (backlog item 55) has fully completed —
   * mirrors RidingScreen.tsx's identically-named/shaped prop exactly,
   * including the "storage retained, only the watch stopped, callback fires
   * last and its own failure is only ever logged" contract. App.tsx is the
   * only current caller; it resets its own in-memory ride-content pointer
   * in response, dropping the rider onto a Ride launcher that immediately
   * offers Resume free roam for this same session. */
  onRidePaused?: () => void;
}

const DEFAULT_CAMERA_STATE: StoredCameraState = {
  mode: "overview",
  coordinate: null,
  zoom: null,
  bearingDegrees: 0,
  pitchDegrees: 0,
};

// Mirrors RidingScreen.tsx's identical RIDING_ZOOM_STEP (backlog item 53).
const RIDING_ZOOM_STEP = 1;

function formatGeolocationError(error: GeolocationError): string {
  switch (error.reason) {
    case "permission-denied":
      return "Location permission was denied. Allow location access in your browser settings to use Free roam.";
    case "timeout":
      return "Getting your location timed out. Check you have a clear view of the sky and try again.";
    case "unsupported":
      return "This browser does not support location services.";
    case "position-unavailable":
    default:
      return "Your location is currently unavailable.";
  }
}

/**
 * Route-less "free roam" Riding mode (backlog item 42): live GPS position
 * on the ordinary map, camera follow in the direction of travel, no route
 * line/warnings/elevation/manoeuvres/completion — none of it is mounted,
 * not merely hidden. A new, small component, not a stripped-down
 * RidingScreen: reuses that screen's already-proven pieces (the hook-bridge
 * pattern, the offline notice, End-ride/ConfirmDialog, the geolocation-
 * error/waiting-for-fix states, North-up/Follow controls, the wake-lock
 * control, MapView itself) but owns none of RidingScreen's route-specific
 * machinery.
 *
 * Unlike RidingScreen, this screen has no internal idle/pre-ride panel: it
 * calls start() unconditionally on mount. This is safe specifically because
 * every mount of this component is causally downstream of an explicit
 * "Start free roam"/"Resume free roam" tap in RidingLauncher — App.tsx's
 * own navigation handler resets the selected ride content back to "none"
 * whenever the rider navigates away from the Ride screen while free roam
 * was showing (see App.tsx's handleNavigate), so simply returning to the
 * "Ride" tab always re-renders the launcher fresh, never a stale,
 * still-selected FreeRoamScreen that would otherwise auto-restart GPS with
 * no fresh tap. This deliberately does NOT apply to an open route session
 * (RidingScreen's own two-tap idle-panel pattern is untouched).
 */
export function FreeRoamScreen({
  geolocationSource,
  mapFactory,
  clock = systemClock,
  wakeLockSource,
  onRidingActiveChange,
  onRideFinalized,
  onRidePaused,
}: FreeRoamScreenProps) {
  // Bridges useFreeRoamCamera's current camera state and last-reliable
  // bearing into useFreeRoamNavigation's persistence — see
  // useFreeRoamNavigation.ts's getPersistableSnapshot doc comment for why
  // this ref-based bridge is needed (mirrors RidingScreen.tsx's identical
  // cameraStateRef/getCameraState pattern, extended to a second value).
  const persistableSnapshotRef = useRef<{
    cameraState: StoredCameraState;
    lastReliableBearingDegrees: number | null;
  }>({ cameraState: DEFAULT_CAMERA_STATE, lastReliableBearingDegrees: null });
  const getPersistableSnapshot = useCallback(() => persistableSnapshotRef.current, []);

  const nav = useFreeRoamNavigation({ geolocationSource, clock, getPersistableSnapshot });
  const camera = useFreeRoamCamera({
    currentFix: nav.currentFix,
    isStale: nav.isStale,
    restoredCameraState: nav.restoredCameraState,
    restoredLastReliableBearingDegrees: nav.restoredLastReliableBearingDegrees,
  });

  useEffect(() => {
    persistableSnapshotRef.current = {
      cameraState: camera.persistableCameraState,
      lastReliableBearingDegrees: camera.persistableLastReliableBearingDegrees,
    };
  }, [camera.persistableCameraState, camera.persistableLastReliableBearingDegrees]);

  // Zoom in/out (backlog item 53) — mirrors RidingScreen.tsx's identical
  // handlers exactly, including never calling camera.reportUserInteraction.
  const { requestZoom: cameraRequestZoom } = camera;
  const handleZoomIn = useCallback(() => {
    cameraRequestZoom(RIDING_ZOOM_STEP);
  }, [cameraRequestZoom]);
  const handleZoomOut = useCallback(() => {
    cameraRequestZoom(-RIDING_ZOOM_STEP);
  }, [cameraRequestZoom]);

  // Reports whether this session is genuinely GPS-active back to App, for
  // the immersive-Riding-shell contract (immersiveRidingShell.ts, backlog
  // item 55) — identical rationale and mechanism to RidingScreen.tsx's own
  // equivalent effect.
  useEffect(() => {
    onRidingActiveChange?.(nav.geolocationStatus !== "idle");
    return () => {
      onRidingActiveChange?.(false);
    };
  }, [nav.geolocationStatus, onRidingActiveChange]);

  const now = useNow(clock);
  const fixAgeMs = nav.currentFix ? now - nav.currentFix.timestampMs : null;
  const online = useOnlineStatus();

  const { start: navStart } = nav;
  const { requestFollow: cameraRequestFollow } = camera;
  const handleStart = useCallback(() => {
    navStart();
    cameraRequestFollow();
  }, [navStart, cameraRequestFollow]);

  // Auto-starts the GPS watch exactly once on mount — see this component's
  // own doc comment above for why this is safe here, unlike a bare
  // RidingScreen-style auto-start would be. Also requests the following
  // camera immediately, matching RidingScreen.tsx's handleStart, so a
  // brand-new session (with no persisted camera mode to restore) still ends
  // up following once a fix arrives; a genuinely persisted mode (e.g. a
  // manually free-panned camera) still wins once the async restore read
  // resolves and dispatches its own "restore" event, exactly as it already
  // does for route Riding. handleStart's own identity is genuinely stable
  // (navStart/cameraRequestFollow are each a useCallback with their own
  // stable dependencies inside their respective hooks), so listing it here
  // does not cause this effect to re-run on every render.
  useEffect(() => {
    handleStart();
  }, [handleStart]);

  const endRideTriggerRef = useRef<HTMLButtonElement>(null);
  const [isEndRideConfirmOpen, setIsEndRideConfirmOpen] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  // Synchronous guard against a rapid double End-ride submission, mirroring
  // RidingScreen.tsx's own isFinalizeActionPendingRef idiom.
  const isFinalizeActionPendingRef = useRef(false);
  // The End-ride trigger unmounts/remounts as its confirmation opens/closes
  // (item 50's in-place confirmation morph — see renderEndRideAction below),
  // so Cancel/Escape and a failed finalisation both record a pending focus
  // request here instead of calling .focus() directly — mirrors
  // PlanningScreen.tsx's pendingClearDraftFocusRef and RidingScreen.tsx's
  // identically-named ref exactly (items 49/50).
  const pendingEndRideFocusRef = useRef(false);

  // Pause (backlog item 55) — mirrors RidingScreen.tsx's identical Pause
  // state/refs exactly, including the "separate state from
  // isFinalizing/finalizeError, not a widened union" rationale and the
  // "screen-level cross-guard is the primary mutual-exclusion enforcement"
  // rationale (see RidingScreen.tsx's own isPauseActionPendingRef comment).
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const [isPausePending, setIsPausePending] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const isPauseActionPendingRef = useRef(false);

  const performFinalizeRide = async () => {
    // Cross-guard with Pause — see isPauseActionPendingRef's own comment.
    if (isFinalizeActionPendingRef.current || isPauseActionPendingRef.current) return;
    isFinalizeActionPendingRef.current = true;
    setIsFinalizing(true);
    setFinalizeError(null);
    try {
      await nav.finish();
      camera.resetCamera();
      setIsEndRideConfirmOpen(false);
      // Finalisation has now fully succeeded — storage cleared and this
      // screen's own runtime cleanup already applied above. Notify the
      // caller with its own nested try/catch, deliberately separate from
      // the outer one: a throw here would only ever indicate a bug in the
      // caller's own handler, never a genuine finalisation failure, so it
      // must never be surfaced as one — mirrors RidingScreen.tsx's
      // identical rationale exactly.
      try {
        onRideFinalized?.();
      } catch (callbackError) {
        logError("free-roam-ride-finalized-callback", callbackError);
      }
    } catch (error) {
      logError("free-roam-end-ride", error);
      setFinalizeError("The ride could not be ended on this device. Try again.");
      setIsEndRideConfirmOpen(false);
      // Restoring focus is deferred to the pending-ref effect below rather
      // than called directly here — see RidingScreen.tsx's identical
      // rationale: the trigger is still disabled/absent in the DOM at this
      // exact synchronous point.
      pendingEndRideFocusRef.current = true;
    } finally {
      isFinalizeActionPendingRef.current = false;
      setIsFinalizing(false);
    }
  };

  // Pause (backlog item 55) — mirrors RidingScreen.tsx's identical
  // performPauseRide exactly (reversible, no confirmation), minus the
  // route-progress/completion/manoeuvre no-ops it has none of.
  const performPauseRide = async () => {
    if (isPauseActionPendingRef.current || isFinalizeActionPendingRef.current) return;
    isPauseActionPendingRef.current = true;
    setIsPausePending(true);
    setPauseError(null);
    try {
      await nav.pause();
      try {
        onRidePaused?.();
      } catch (callbackError) {
        logError("free-roam-ride-paused-callback", callbackError);
      }
    } catch (error) {
      logError("free-roam-pause-ride", error);
      setPauseError("Free roam could not be paused on this device. Try again.");
    } finally {
      isPauseActionPendingRef.current = false;
      setIsPausePending(false);
    }
  };

  // Pause's own button never unmounts (no confirmation swaps it out), so
  // this follows a plain finalizeError-identity-style effect, not the
  // pendingEndRideFocusRef unmount-dance End-ride needs.
  useEffect(() => {
    if (!pauseError) return;
    pauseButtonRef.current?.focus();
  }, [pauseError]);

  // A no-deps effect re-checks pendingEndRideFocusRef's readiness (mounted
  // AND enabled) on every render, rather than consuming the request
  // unconditionally on the first post-set commit — mirrors
  // PlanningScreen.tsx's pendingClearDraftFocusRef effect exactly.
  useEffect(() => {
    if (!pendingEndRideFocusRef.current) return;
    const trigger = endRideTriggerRef.current;
    if (!trigger || trigger.disabled) return;
    pendingEndRideFocusRef.current = false;
    trigger.focus();
  });

  const handleEndRideClick = () => {
    if (isEndRideConfirmOpen || isFinalizeActionPendingRef.current) return;
    setFinalizeError(null);
    setIsEndRideConfirmOpen(true);
  };

  const handleEndRideCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too.
    if (isFinalizeActionPendingRef.current) return;
    pendingEndRideFocusRef.current = true;
    setIsEndRideConfirmOpen(false);
  };

  // Renders the End-ride action in place: either the trigger button (plus
  // any error) or the confirmation itself, never both — backlog item 50's
  // in-place confirmation morph, mirroring RidingScreen.tsx's own
  // renderEndRideAction and PlanningScreen.tsx's Clear-draft treatment
  // (item 49).
  function renderEndRideAction(): ReactNode {
    if (isEndRideConfirmOpen) {
      return (
        <ConfirmDialog
          open={isEndRideConfirmOpen}
          title="End this ride?"
          message="Your free roam position and camera state will be cleared."
          confirmLabel={isFinalizing ? "Ending ride…" : "End ride"}
          cancelLabel="Cancel"
          confirmDisabled={isFinalizing}
          cancelDisabled={isFinalizing}
          onConfirm={() => {
            void performFinalizeRide();
          }}
          onCancel={handleEndRideCancel}
        />
      );
    }
    return (
      <>
        <button
          type="button"
          className="btn-danger"
          ref={endRideTriggerRef}
          onClick={handleEndRideClick}
          disabled={isFinalizing || isPausePending}
        >
          End ride
        </button>
        {finalizeError ? (
          <p className="field-error" role="alert">
            {finalizeError}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section className="screen" aria-label="Free roam">
      {/* The immersive Pause/title/End header (backlog item 55) — renders
       * unconditionally, mirroring the unconditional <h1>/.ride-end-ride-row
       * it replaces: this screen has no idle/pre-ride panel of its own (see
       * this component's own doc comment), so there is no non-immersive
       * state to special-case the way RidingScreen's idle branch does. */}
      <RidingImmersiveHeader
        title="Free roam"
        pauseLabel={isPausePending ? "Pausing…" : "Pause"}
        onPause={() => {
          void performPauseRide();
        }}
        pauseDisabled={isPausePending || isFinalizing}
        pauseButtonRef={pauseButtonRef}
        endAction={!isEndRideConfirmOpen ? renderEndRideAction() : null}
      />
      {pauseError ? (
        <p className="field-error" role="alert">
          {pauseError}
        </p>
      ) : null}
      {isEndRideConfirmOpen ? (
        <div className="ride-end-ride-confirm-row">{renderEndRideAction()}</div>
      ) : null}

      {/* Wake-lock control moved to directly after the header block
       * (backlog item 56, correcting a post-item-55 field finding) — see
       * RidingScreen.tsx's identical fix for the full root-cause. Still
       * gated on the exact same condition, unchanged. */}
      {isWakeLockSupported() && nav.geolocationStatus !== "idle" ? (
        <RidingWakeLockControl
          desired={nav.wakeLockDesired}
          onToggleDesired={nav.setWakeLockDesired}
          wakeLockSource={wakeLockSource}
          clock={clock}
        />
      ) : null}

      {!online ? (
        <p role="status" className="status-row">
          Offline — your position and camera controls still work; map imagery may be
          unavailable.
        </p>
      ) : null}

      {nav.geolocationStatus === "error" && nav.geolocationError ? (
        <div role="alert" className="ride-alert-panel">
          <p>{formatGeolocationError(nav.geolocationError)}</p>
          <button type="button" onClick={handleStart}>
            Try again
          </button>
        </div>
      ) : null}

      {nav.geolocationStatus === "watching" && !nav.currentFix ? (
        <p role="status" className="status-row">
          Waiting for a GPS fix…
        </p>
      ) : null}

      {nav.currentFix ? (
        <FreeRoamStatusStrip
          accuracyMetres={nav.currentFix.accuracyMetres}
          isStale={nav.isStale}
          fixAgeMs={fixAgeMs}
        />
      ) : null}

      {camera.showPausedToast ? <p role="status">Map follow paused.</p> : null}

      <div
        className={`ride-map-container${
          nav.geolocationStatus !== "idle"
            ? " ride-map-container--active"
            : " ride-map-container--overview"
        }`}
      >
        <MapView
          points={[]}
          currentPosition={nav.currentFix?.coordinate}
          mapFactory={mapFactory}
          cameraTarget={camera.cameraTarget}
          zoomTarget={camera.zoomTarget}
          suppressInitialOverviewFit={true}
          onUserCameraInteraction={camera.reportUserInteraction}
          onCameraSettled={(settled) => {
            camera.reportCameraSettled(
              settled.coordinate,
              settled.zoom,
              settled.bearingDegrees,
              settled.pitchDegrees,
            );
          }}
        />
        {nav.geolocationStatus === "watching" ? (
          <div className="ride-map-zoom-controls">
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label="Zoom in"
              className="ride-map-control ride-map-control--zoom"
            >
              +
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label="Zoom out"
              className="ride-map-control ride-map-control--zoom"
            >
              −
            </button>
          </div>
        ) : null}
        {nav.geolocationStatus === "watching" ? (
          <div className="ride-map-camera-controls">
            <button
              type="button"
              onClick={camera.requestNorthUp}
              aria-label="North-up, top-down view"
              aria-pressed={camera.isNorthUpTopDown}
              className={`ride-map-control ride-map-control--north-up${
                camera.isNorthUpTopDown ? " is-pressed" : ""
              }`}
            >
              N
            </button>
            <button
              type="button"
              onClick={camera.requestFollow}
              aria-label="Follow my location"
              aria-pressed={camera.mode === "following"}
              className={`ride-map-control ride-map-control--follow${
                camera.mode === "following" ? " is-pressed" : ""
              }`}
            >
              {camera.mode === "following" && camera.awaitingFreshFix ? "Waiting…" : "⌖"}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
