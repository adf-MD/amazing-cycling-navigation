import { useRef, useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory } from "./map/mapAdapter.ts";
import { logError } from "./platform/errorLog.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { isStoredFreeRoamRideState } from "./storage/mapping.ts";
import { getActiveRideState } from "./storage/rideStateRepository.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary } from "./ui/library/RouteLibrary.tsx";
import { PlanningScreen } from "./ui/planning/PlanningScreen.tsx";
import { FreeRoamScreen } from "./ui/riding/FreeRoamScreen.tsx";
import { RidingLauncher } from "./ui/riding/RidingLauncher.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";
import { SettingsScreen } from "./ui/settings/SettingsScreen.tsx";
import { MainNavigation, type Screen } from "./ui/shared/MainNavigation.tsx";
import { isImmersiveRidingShell } from "./ui/shared/immersiveRidingShell.ts";
import { useResetScrollForNewRideContent } from "./ui/shared/useResetScrollForNewRideContent.ts";

export interface AppProps {
  /** Injectable for tests, so opening a route into RidingScreen doesn't
   * mount a real, unmocked MapView (jsdom has no WebGL2 support). Defaults
   * to RidingScreen's own real MapLibre factory in production. */
  mapFactory?: MapFactory;
}

/** What the Ride screen is currently showing — an explicit discriminated
 * union rather than a nullable PlannedRoute, so a route session and a
 * route-less free-roam session (backlog item 42) can never be conflated.
 * Free roam is deliberately not represented as a fake PlannedRoute.
 *
 * resumeIntentToken (backlog item 72) is a one-use resume intent: set only
 * by handleResumeRoute (the launcher's own "Resume ride" action), never by
 * handleOpenRoute/handleRouteSaved (an ordinary Routes-card reopen or a
 * Planning-save-then-ride, both of which keep today's explicit-tap idle
 * screen unchanged). RidingScreen consumes it at most once, only after its
 * own restoration has genuinely completed, to start GPS and request Follow
 * without a second in-screen tap. */
type RidingContent =
  | { kind: "none" }
  | { kind: "route"; route: PlannedRoute; resumeIntentToken?: number }
  | { kind: "free-roam" };

const NONE_RIDING_CONTENT: RidingContent = { kind: "none" };

/** Why a route-open attempt (from Routes or a Planning save) was blocked —
 * see checkFreeRoamConflict's own doc comment. Distinguishes a genuine
 * conflict from a failed check so RidingLauncher can show honest, distinct
 * copy for each rather than treating "couldn't tell" the same as "yes,
 * there's a conflict". */
type BlockedRouteOpenReason = "free-roam-unfinished" | "check-failed";

function App({ mapFactory }: AppProps) {
  const [screen, setScreen] = useState<Screen>("library");
  const [ridingContent, setRidingContent] = useState<RidingContent>(NONE_RIDING_CONTENT);
  const [isRidingActive, setIsRidingActive] = useState(false);
  const [blockedRouteOpenReason, setBlockedRouteOpenReason] =
    useState<BlockedRouteOpenReason | null>(null);
  const { needRefresh, offlineReady, updateNow, dismiss } = usePwaUpdate();
  const routesScrollYRef = useRef<number | null>(null);
  const routesSearchQueryRef = useRef<string>("");
  // Plain monotonic counter (never a timestamp/uuid) for resumeIntentToken —
  // mirrors useRideCamera.ts's own nextCameraRequestIdRef idiom (backlog
  // item 72).
  const nextResumeIntentTokenRef = useRef(0);
  const notifyNewRideContent = useResetScrollForNewRideContent(screen);
  // Whether the app shell is in immersive-Riding mode (backlog item 55):
  // MainNavigation and its wrapping <header> render at all only when this
  // is false — while true, RidingScreen's/FreeRoamScreen's own compact
  // Pause/title/End header replaces them entirely, not merely repositions
  // them (see immersiveRidingShell.ts, which supersedes item 24's old
  // "static-but-visible" nav state for this one case).
  const isImmersive = isImmersiveRidingShell(screen, isRidingActive);

  // rideState is a singleton row — a route session and a free-roam session
  // can never both be "the current unfinished session" simultaneously.
  // handleOpenRoute/handleRouteSaved are the two entry points that bypass
  // RidingLauncher entirely (a route card click from Routes, or a Planning
  // save), so they're the only places that need this explicit check —
  // handleResumeRoute can only ever fire from the launcher's own "Resume
  // route" button, which can only render once the launcher's own hydration
  // already found a route row, so it can never fire while free roam is the
  // unfinished session. Fails closed: a storage-read error is treated as a
  // conflict, never silently as "no conflict".
  async function checkFreeRoamConflict(): Promise<BlockedRouteOpenReason | null> {
    try {
      const stored = await getActiveRideState();
      return stored && isStoredFreeRoamRideState(stored) ? "free-roam-unfinished" : null;
    } catch (error) {
      logError("app-check-free-roam-conflict", error);
      return "check-failed";
    }
  }

  const handleOpenRoute = (route: PlannedRoute) => {
    void (async () => {
      const conflict = await checkFreeRoamConflict();
      if (conflict) {
        setBlockedRouteOpenReason(conflict);
        setScreen("riding");
        return;
      }
      setBlockedRouteOpenReason(null);
      routesScrollYRef.current = window.scrollY;
      setRidingContent({ kind: "route", route });
      setScreen("riding");
      notifyNewRideContent();
    })();
  };

  const handleRouteSaved = (route: PlannedRoute) => {
    void (async () => {
      const conflict = await checkFreeRoamConflict();
      if (conflict) {
        setBlockedRouteOpenReason(conflict);
        setScreen("riding");
        return;
      }
      setBlockedRouteOpenReason(null);
      setRidingContent({ kind: "route", route });
      setScreen("riding");
      notifyNewRideContent();
    })();
  };

  // Opens a resumable route session discovered by the Ride launcher itself
  // (getActiveRideState()/getRoute()) — App.tsx never inspects persisted
  // ride state directly for this path (see checkFreeRoamConflict's own doc
  // comment for why no conflict check is needed here). Deliberately does
  // not capture window.scrollY into routesScrollYRef the way handleOpenRoute
  // does: the rider is already on the Ride screen (the launcher), not
  // Routes, so capturing the launcher's own scroll offset here would
  // wrongly overwrite the Routes-restore ref. This function itself still
  // never starts geolocation — it only generates a fresh one-use
  // resumeIntentToken (backlog item 72) alongside the route; RidingScreen's
  // own effect is what actually starts GPS and requests Follow, and only
  // once its restoration has genuinely completed.
  const handleResumeRoute = (route: PlannedRoute) => {
    nextResumeIntentTokenRef.current += 1;
    setRidingContent({
      kind: "route",
      route,
      resumeIntentToken: nextResumeIntentTokenRef.current,
    });
    setScreen("riding");
    notifyNewRideContent();
  };

  // Fired by RidingLauncher once a free-roam session is ready to display —
  // covers both "Start free roam" (which already persisted a fresh session
  // row before calling this) and "Resume free roam" (the row already
  // existed) alike; this function doesn't need to distinguish the two.
  const handleOpenFreeRoam = () => {
    setRidingContent({ kind: "free-roam" });
    notifyNewRideContent();
  };

  // Shared two-line body behind every non-finalising reset back to the
  // empty/resumable Ride launcher while staying on screen === "riding":
  // resets the in-memory ridingContent pointer to "none" and notifies
  // useResetScrollForNewRideContent so the view scrolls back to the top,
  // exactly as opening any other new Ride content already does.
  //
  // ridingContent can be reset to "none" by four distinct paths, each with
  // its own storage contract:
  // - handleRideFinalized (End/Finish ride, below): storage already
  //   cleared by the caller's own finish() before this fires — the empty
  //   launcher shows no resumable session.
  // - handleRidePaused (Pause, below, backlog item 55; collapsed to one tap
  //   for routes by item 72): storage deliberately NOT cleared — the
  //   caller's own pause() already wrote a fresh resumable snapshot and
  //   stopped the watch before this fires. handleRidePaused itself only
  //   calls this helper for a free-roam session, which re-hydrates the
  //   launcher into "Resume free roam"; a route session is left mounted
  //   instead, so this helper is never invoked on that path at all.
  // - handleReturnToRideLauncher (backlog item 51, below): no active watch
  //   ever existed for this call and no persisted-storage mutation of any
  //   kind occurs — a still-unfinished session's row (if any) is left
  //   completely untouched.
  // - handleNavigate's own free-roam-specific inline reset, which
  //   deliberately does NOT call this helper at all: that path is leaving
  //   the "riding" screen entirely (a different, deliberately silent
  //   scroll contract — see its own comment) and also clears
  //   blockedRouteOpenReason, neither of which belongs here.
  //
  // In every one of the first three cases, this helper's own job is only
  // ever "drop back to whatever the Ride launcher's own re-hydration from
  // storage already reflects" — never a storage mutation itself.
  const resetRidingContentToLauncher = () => {
    setRidingContent(NONE_RIDING_CONTENT);
    notifyNewRideContent();
  };

  // The sole success-path integration point from RidingScreen's/
  // FreeRoamScreen's shared End ride/Finish ride finalisation lifecycle.
  // Called only once the underlying navigation hook's finish() has already
  // cleared the persisted active-ride row and the screen's own runtime
  // cleanup has already applied. Delegates its body to
  // resetRidingContentToLauncher — see that helper's own comment for how
  // this fits alongside handleRidePaused/handleReturnToRideLauncher.
  // Clearing ridingContent here is what actually unmounts the active
  // screen and shows the empty Ride launcher in its place; screen
  // deliberately stays "riding" throughout.
  const handleRideFinalized = () => {
    resetRidingContentToLauncher();
  };

  // The sole success-path integration point from RidingScreen's/
  // FreeRoamScreen's shared Pause lifecycle (backlog item 55). Called only
  // once the underlying navigation hook's pause() has already written a
  // fresh resumable snapshot and stopped the watch — storage is
  // deliberately NOT cleared (contrast with handleRideFinalized above).
  //
  // Backlog item 72 collapsed the route side of this to one tap: a route
  // session's ridingContent is deliberately left untouched, so RidingScreen
  // stays mounted and its own idle/pre-ride branch — already unconditional
  // on nav.geolocationStatus leaving "watching" — renders the resumable
  // "Resume ride" panel directly, with no launcher round-trip. Free roam
  // keeps its existing, unaffected one-tap contract (FreeRoamScreen has no
  // idle panel of its own, so it must still drop back to the launcher,
  // which is what makes its own "Resume free roam" tap meaningful).
  const handleRidePaused = () => {
    if (ridingContent.kind === "free-roam") {
      resetRidingContentToLauncher();
    }
  };

  // Fired by RidingScreen's pre-ride-only "Back to Ride options" action
  // (backlog item 51) — a synchronous, non-destructive reset: performs no
  // persisted mutation of any kind, and never starts or stops geolocation,
  // camera, or wake-lock state. Delegates to the same
  // resetRidingContentToLauncher helper handleRideFinalized uses, since the
  // in-memory effect is identical (drop back to whatever the Ride launcher
  // state storage actually reflects); the two differ only in whether a
  // persisted-storage clear preceded the call, which is entirely
  // RidingScreen's own concern. Not wired to FreeRoamScreen — out of scope
  // for item 51, which is pre-ride-panel-only and FreeRoamScreen has no
  // idle panel to place an equivalent action in.
  const handleReturnToRideLauncher = () => {
    resetRidingContentToLauncher();
  };

  const handleNavigateToSettings = () => {
    setScreen("settings");
  };

  const handleNavigateToPlanning = () => {
    setScreen("planning");
  };

  // Wraps MainNavigation's plain screen setter with one free-roam-specific
  // rule: leaving the Ride screen while it was showing an active free-roam
  // session resets the in-memory ridingContent pointer back to "none"
  // (never the persisted row — FreeRoamScreen's own unmount already stops
  // its GPS watch and releases its wake lock via ordinary cleanup effects).
  // This makes "returning to Ride must require an explicit Resume free
  // roam action" true by construction: since FreeRoamScreen itself has no
  // internal idle panel and auto-starts GPS on every mount (see its own
  // doc comment), simply returning to the "Ride" tab always re-renders
  // RidingLauncher fresh, which re-hydrates from storage and requires a
  // fresh, explicit tap before GPS restarts — rather than silently
  // resuming a still-selected FreeRoamScreen instance. Deliberately NOT
  // applied when ridingContent is a route session: RidingScreen's own
  // existing, tested idle-panel pattern (an in-screen "Resume ride" button
  // gates the restart whenever no resumeIntentToken is present, e.g. this
  // ordinary Routes-card/tab-navigation path) already satisfies the
  // identical requirement for routes, and changing that behaviour here is
  // out of scope for this slice.
  //
  // Also clears any stale blockedRouteOpenReason on leaving the Ride
  // screen — it's only meaningful while looking at the launcher/screen it
  // was raised on, and RidingLauncher's own self-contained End-ride flow
  // for a conflicting free-roam session has no other way to tell App.tsx
  // the conflict it reported may now be resolved.
  const handleNavigate = (nextScreen: Screen) => {
    if (screen === "riding" && nextScreen !== "riding") {
      if (ridingContent.kind === "free-roam") {
        setRidingContent(NONE_RIDING_CONTENT);
      }
      setBlockedRouteOpenReason(null);
    }
    setScreen(nextScreen);
  };

  return (
    <div className="app-shell">
      {isImmersive ? null : (
        <header className="app-header--sticky">
          <MainNavigation screen={screen} onNavigate={handleNavigate} />
        </header>
      )}

      {needRefresh ? (
        <div role="status">
          <p>An update is ready.</p>
          <button type="button" onClick={updateNow}>
            Update now
          </button>
          <button type="button" onClick={dismiss}>
            Later
          </button>
        </div>
      ) : null}
      {offlineReady && !needRefresh ? (
        <div role="status">
          <p>Ready to work offline.</p>
          <button type="button" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      ) : null}

      <main>
        {screen === "library" && (
          <RouteLibrary
            onOpenRoute={handleOpenRoute}
            restoreScrollYRef={routesScrollYRef}
            restoreSearchQueryRef={routesSearchQueryRef}
          />
        )}
        {screen === "riding" &&
          (ridingContent.kind === "route" ? (
            <RidingScreen
              route={ridingContent.route}
              resumeIntentToken={ridingContent.resumeIntentToken}
              mapFactory={mapFactory}
              onRidingActiveChange={setIsRidingActive}
              onNavigateToPlanning={handleNavigateToPlanning}
              onRideFinalized={handleRideFinalized}
              onReturnToRideLauncher={handleReturnToRideLauncher}
              onRidePaused={handleRidePaused}
            />
          ) : ridingContent.kind === "free-roam" ? (
            <FreeRoamScreen
              mapFactory={mapFactory}
              onRidingActiveChange={setIsRidingActive}
              onRideFinalized={handleRideFinalized}
              onRidePaused={handleRidePaused}
            />
          ) : (
            <RidingLauncher
              onResumeRoute={handleResumeRoute}
              onChooseRoute={() => {
                handleNavigate("library");
              }}
              onOpenFreeRoam={handleOpenFreeRoam}
              blockedRouteOpenReason={blockedRouteOpenReason}
            />
          ))}
        {screen === "planning" && (
          <PlanningScreen
            onNavigateToSettings={handleNavigateToSettings}
            onRouteSaved={handleRouteSaved}
          />
        )}
        {screen === "diagnostics" && <DiagnosticsScreen />}
        {screen === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}

export default App;
