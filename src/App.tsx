import { useRef, useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory } from "./map/mapAdapter.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { logError } from "./platform/errorLog.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { isStoredRouteRideState, toStoredFreeRoamState } from "./storage/mapping.ts";
import {
  clearActiveRideState,
  getActiveRideState,
  setActiveRideState,
} from "./storage/rideStateRepository.ts";
import { getRoute } from "./storage/routesRepository.ts";
import {
  classifyRideTransition,
  type RideSessionTarget,
} from "./ui/riding/rideSessionTransition.ts";
import { DiagnosticsScreen } from "./ui/diagnostics/DiagnosticsScreen.tsx";
import { RouteLibrary, type PendingRouteSwitch } from "./ui/library/RouteLibrary.tsx";
import { PlanningScreen } from "./ui/planning/PlanningScreen.tsx";
import { FreeRoamScreen } from "./ui/riding/FreeRoamScreen.tsx";
import { RidingLauncher } from "./ui/riding/RidingLauncher.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";
import { SettingsScreen } from "./ui/settings/SettingsScreen.tsx";
import { ConfirmDialog } from "./ui/shared/ConfirmDialog.tsx";
import { MainNavigation, type Screen } from "./ui/shared/MainNavigation.tsx";
import { isImmersiveRidingShell } from "./ui/shared/immersiveRidingShell.ts";
import { useResetScrollForNewRideContent } from "./ui/shared/useResetScrollForNewRideContent.ts";

export interface AppProps {
  /** Injectable for tests, so opening a route into RidingScreen doesn't
   * mount a real, unmocked MapView (jsdom has no WebGL2 support). Defaults
   * to RidingScreen's own real MapLibre factory in production. */
  mapFactory?: MapFactory;
  /** Injectable for tests, mirroring mapFactory above — used only for a
   * fresh free-roam session's startedAt timestamp. Defaults to the real
   * system clock in production. */
  clock?: Clock;
}

/** What the Ride screen is currently showing — an explicit discriminated
 * union rather than a nullable PlannedRoute, so a route session and a
 * route-less free-roam session (backlog item 42) can never be conflated.
 * Free roam is deliberately not represented as a fake PlannedRoute.
 *
 * resumeIntentToken (backlog item 72) is a one-use resume intent: set only
 * when requestRouteTransition's own guard check resolves the SAME route as
 * already persisted (an ordinary, undialogued "Resume ride"), never for an
 * ordinary Routes-card reopen/Planning-save-then-ride, and never after a
 * confirmed different-session switch (backlog item 73) — confirming a
 * switch is not permission to auto-start GPS for the replacement.
 * RidingScreen consumes it at most once, only after its own restoration has
 * genuinely completed, to start GPS and request Follow without a second
 * in-screen tap.
 */
type RidingContent =
  | { kind: "none" }
  | {
      kind: "route";
      route: PlannedRoute;
      resumeIntentToken?: number;
    }
  | { kind: "free-roam" };

const NONE_RIDING_CONTENT: RidingContent = { kind: "none" };

/** App.tsx's own central state for backlog item 73's unfinished-session
 * switch guard — at most one of these exists at a time. `target` is what
 * the rider originally asked to open; `existing` is what the guard found
 * persisted (null only for "check-failed", where the read itself never
 * resolved). Every status after "conflict"/"check-failed" is reached only
 * via an explicit Confirm/Retry/Return press — never automatically.
 *
 * `origin` (item 73 follow-up) is captured once, at creation, from the
 * caller — never re-derived from the currently rendered `screen` — and is
 * never reassigned by any later status transition. "route-card" means this
 * came from a Routes-list card tap (the only origin with a card to expand
 * into); "global" covers Planning-save and every Riding-launcher entry
 * point, which keep the page-level ConfirmDialog unchanged. Deriving this
 * from `screen` instead would be wrong: the sticky nav stays clickable
 * while an inline card prompt is showing (it isn't a true modal), so a
 * rider could navigate away from Routes mid-prompt — a screen-derived
 * check would then leave the pending switch with no presentation at all
 * (not inline, since the card unmounted with the rest of RouteLibrary; not
 * global, since the screen-check would say "route-card"). `screen` is
 * still consulted, separately, at render time to decide whether inline
 * presentation is currently renderable — see canShowInline below.
 *
 * `existingRouteId`/`existingRoute` (item 73 follow-up) resolve the
 * currently-paused ROUTE session so the inline card can name it and offer
 * "Return to paused ride". `existingRouteId` is cheap (already in memory
 * from the storage read `checkRideTransition` performs regardless) and is
 * always populated on a route conflict; the extra `getRoute()` fetch that
 * resolves `existingRoute` only ever runs when `origin === "route-card"`
 * — the global dialog's generic copy never needs the resolved route. */
interface PendingRideSwitch {
  requestId: number;
  target: RideSessionTarget;
  origin: "route-card" | "global";
  existing: "route" | "free-roam" | "unsupported" | null;
  existingRouteId: string | null;
  existingRoute: PlannedRoute | null;
  status:
    | "check-failed"
    | "conflict"
    | "clearing"
    | "clear-failed"
    | "starting-free-roam"
    | "start-free-roam-failed"
    | "returning"
    | "return-failed";
  errorMessage: string | null;
}

function targetLabel(target: RideSessionTarget): string {
  return target.kind === "route" ? `"${target.route.name}"` : "free roam";
}

function existingSessionLabel(existing: "route" | "free-roam" | "unsupported"): string {
  if (existing === "route") return "an unfinished ride on another route";
  if (existing === "free-roam") return "an unfinished free roam session";
  return "an unfinished ride that can't be recovered by this version of the app";
}

/** Whether a status belongs to the destructive End-and-switch/Discard-and-
 * continue family (item 73 follow-up) — used only to style the inline
 * card's own confirm button; the page-level ConfirmDialog is unaffected.
 * "check-failed"/"returning"/"return-failed" are all non-destructive
 * recheck/retry actions and must never render as the destructive
 * .btn-danger style. */
function isDestructiveSwitchConfirmStatus(status: PendingRideSwitch["status"]): boolean {
  return status === "conflict" || status === "clearing" || status === "clear-failed";
}

/** Supplies title/message/confirmLabel for every PendingRideSwitch status,
 * through one shared shell, deliberately using distinct language for
 * "check-failed" (a storage read failed — never described as a conflict)
 * versus every other status (a genuine different-session conflict, or
 * progress towards resolving one) — see this project's accessibility
 * requirement that a read failure must never be presented as proof of a
 * conflict, nor a conflict as a generic technical failure. Mirrors
 * RidingLauncher.tsx's own LAUNCHER_CLEAR_ACTION_COPY/
 * describeUnresumableReason pattern. This generic wording is what the
 * page-level ConfirmDialog always uses, and what the inline card falls
 * back to for every case describeInlineRouteSwitchMessage doesn't cover —
 * it must stay unchanged, since Planning-save's own e2e coverage pins it. */
function describePendingRideSwitch(pending: PendingRideSwitch): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  if (pending.status === "check-failed") {
    return {
      title: "Couldn't check for an unfinished ride",
      message:
        "Whether you have an unfinished ride could not be checked, so nothing has opened yet.",
      confirmLabel: "Retry",
    };
  }

  const existing = pending.existing ?? "unsupported";
  const isUnsupported = existing === "unsupported";
  const title = `Switch to ${targetLabel(pending.target)}?`;
  const confirmLabel = isUnsupported ? "Discard and continue" : "End and switch";

  switch (pending.status) {
    case "clearing":
      return {
        title,
        message: isUnsupported
          ? "Discarding your unfinished ride…"
          : "Ending your current ride…",
        confirmLabel: isUnsupported ? "Discarding…" : "Ending…",
      };
    case "starting-free-roam":
      return { title, message: "Starting free roam…", confirmLabel: "Starting…" };
    case "clear-failed":
      return {
        title,
        message:
          pending.errorMessage ??
          "This unfinished ride could not be ended on this device. Try again.",
        confirmLabel,
      };
    case "start-free-roam-failed":
      return {
        title,
        message:
          pending.errorMessage ??
          "Free roam could not be started on this device. Try again.",
        confirmLabel: "Try again",
      };
    case "returning":
      return { title, message: "Opening your paused ride…", confirmLabel };
    case "return-failed":
      // Deliberately never "End and switch": returnToPausedRide only
      // reaches this status once its own revalidation has shown the
      // stored session snapshot may be stale (changed or gone since the
      // prompt opened) — leaving a destructive confirm action clickable
      // against that same stale snapshot could clear a session that isn't
      // the one the rider believes they're looking at. "Check again"
      // reuses retryPendingSwitchCheck to re-establish fresh state first.
      return {
        title,
        message:
          pending.errorMessage ??
          "This paused ride could not be reopened. Check again to see its current status.",
        confirmLabel: "Check again",
      };
    default: {
      const routeNote =
        existing === "route" ? "the saved route will remain in your library, but " : "";
      return {
        title,
        message: `You have ${existingSessionLabel(existing)}. It must be ended before this can open — ${routeNote}ride progress will be cleared.`,
        confirmLabel,
      };
    }
  }
}

/** Inline-only override (item 73 follow-up) for a genuine route-to-route
 * conflict: names the paused route directly, per this fix's accepted
 * copy. Returns null for every other status/existing/origin combination
 * (including a route conflict whose existingRoute couldn't be resolved),
 * so the caller falls back to describePendingRideSwitch's generic
 * wording — used only when building the inline card view model, never by
 * the page-level ConfirmDialog. */
function describeInlineRouteSwitchMessage(pending: PendingRideSwitch): string | null {
  if (
    pending.origin !== "route-card" ||
    pending.target.kind !== "route" ||
    pending.status !== "conflict" ||
    pending.existing !== "route" ||
    !pending.existingRoute
  ) {
    return null;
  }
  return `"${pending.existingRoute.name}" is paused. Return to it, or end it and switch to ${targetLabel(pending.target)}. Ending it will clear ride progress; the saved route will remain in Routes.`;
}

function App({ mapFactory, clock = systemClock }: AppProps) {
  const [screen, setScreen] = useState<Screen>("library");
  const [ridingContent, setRidingContent] = useState<RidingContent>(NONE_RIDING_CONTENT);
  const [isRidingActive, setIsRidingActive] = useState(false);
  const { needRefresh, offlineReady, updateNow, dismiss } = usePwaUpdate();
  const routesScrollYRef = useRef<number | null>(null);
  // Read-only handle onto the sticky top navigation's own rendered box, so
  // RouteListItem (several levels below, not a DOM ancestor of this
  // element) can measure the header's live rendered height when deciding
  // whether the route-switch guard prompt needs to scroll into view
  // (backlog item 95) — mirrors routesScrollYRef's own "App owns a page-
  // chrome fact a screen component needs" shape above.
  const stickyHeaderRef = useRef<HTMLElement>(null);
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

  // Backlog item 73's central unfinished-session switch guard state. One
  // monotonic request id, incremented at the top of every one of the five
  // ride-content entry points (mirrors hydrationGenerationRef/
  // nextResumeIntentTokenRef elsewhere in this codebase), so a newer click
  // always discards an older pending check/dialog rather than racing it —
  // an older check/confirmation must never open a target after a newer
  // request has superseded or cancelled it.
  const transitionRequestIdRef = useRef(0);
  // Synchronous re-entrancy guard against a rapid double Confirm/Escape —
  // mirrors RidingLauncher.tsx's own isClearActionPendingRef idiom.
  const isPendingSwitchActionPendingRef = useRef(false);
  // Captured generically (document.activeElement) at the top of every
  // request*Transition call, since the trigger button lives in one of
  // three different mounted components (RouteLibrary, PlanningScreen,
  // RidingLauncher) depending on entry point.
  const pendingSwitchTriggerRef = useRef<HTMLElement | null>(null);
  const [pendingRideSwitch, setPendingRideSwitch] = useState<PendingRideSwitch | null>(
    null,
  );
  // Bumped once, immediately after any successful clearActiveRideState()
  // call inside the pending-switch flow, so a RidingLauncher already
  // mounted underneath (the originating screen for a Resume-route/
  // Start-free-roam/Resume-free-roam switch) re-hydrates from storage
  // rather than continuing to show its own now-stale sessionState — e.g.
  // if the switch then fails at a later step and the rider cancels back to
  // the launcher, it must never appear to have "restored" the session that
  // was just deliberately ended.
  const [launcherSessionRefreshToken, setLauncherSessionRefreshToken] = useState(0);
  const [freeRoamTransitionPending, setFreeRoamTransitionPending] = useState(false);
  const [freeRoamTransitionError, setFreeRoamTransitionError] = useState<string | null>(
    null,
  );

  // checkRideTransition's own return type — classifyRideTransition's pure
  // outcome (see rideSessionTransition.ts) plus the storage-read-failure
  // case that only this async wrapper can observe, plus (item 73 follow-up)
  // a conflict's existingRouteId, read from the same already-fetched
  // `stored` row before it would otherwise be discarded — no extra I/O.
  // Resolving that id to a full route (for the inline card's name/Return
  // action) is deliberately NOT done here; see resolveExistingRouteForConflict.
  type RideTransitionCheckResult =
    | { kind: "proceed" }
    | { kind: "resume" }
    | {
        kind: "conflict";
        existing: "route" | "free-roam" | "unsupported";
        existingRouteId: string | null;
      }
    | { kind: "read-failed" };

  // Reads the persisted singleton active-session row AT THE MOMENT of the
  // explicit user action (never relying on stale in-memory ridingContent or
  // launcher hydration alone) and classifies it against the requested
  // destination. A storage-read failure fails closed — never silently
  // treated as "no conflict" — surfaced as its own "read-failed" outcome,
  // distinct from classifyRideTransition's own pure "conflict" outcomes so
  // callers/copy can tell "couldn't check" apart from "found a conflict".
  async function checkRideTransition(
    target: RideSessionTarget,
  ): Promise<RideTransitionCheckResult> {
    try {
      const stored = await getActiveRideState();
      const outcome = classifyRideTransition(stored, target);
      if (outcome.kind !== "conflict") return outcome;
      return {
        ...outcome,
        existingRouteId:
          outcome.existing === "route" &&
          stored !== undefined &&
          isStoredRouteRideState(stored)
            ? stored.routeId
            : null,
      };
    } catch (error) {
      logError("app-check-ride-transition", error);
      return { kind: "read-failed" };
    }
  }

  // Resolves the paused route named by a conflict's existingRouteId, for
  // the inline card's own copy/Return action (item 73 follow-up). Never
  // throws to its caller — a lookup failure or "not found" both simply
  // mean no name/Return can be offered, handled the same as any other
  // unresolved existingRoute.
  async function resolveExistingRouteForConflict(
    existingRouteId: string | null,
  ): Promise<PlannedRoute | null> {
    if (!existingRouteId) return null;
    try {
      return (await getRoute(existingRouteId)) ?? null;
    } catch (error) {
      logError("app-resolve-existing-route-for-switch", error);
      return null;
    }
  }

  function openRideTarget(
    target: RideSessionTarget,
    options: { resumeIntentToken?: number } = {},
  ) {
    if (target.kind === "route") {
      routesScrollYRef.current = window.scrollY;
      setRidingContent({
        kind: "route",
        route: target.route,
        ...(options.resumeIntentToken !== undefined
          ? { resumeIntentToken: options.resumeIntentToken }
          : {}),
      });
    } else {
      setRidingContent({ kind: "free-roam" });
    }
    setScreen("riding");
    notifyNewRideContent();
  }

  // Persists a fresh, minimal free-roam session row — the single
  // authoritative write for a brand-new free-roam session, shared by both
  // the direct "no unfinished session" path and a confirmed different-
  // session switch's own replacement write. Never called before a genuine
  // "proceed"/confirmed-clear outcome; a rejection here starts no GPS and
  // leaves the rider on a retryable state (backlog item 42's own
  // requirement, preserved).
  async function writeFreshFreeRoamState(): Promise<boolean> {
    try {
      await setActiveRideState(
        toStoredFreeRoamState(
          new Date(clock.now()).toISOString(),
          null,
          {
            mode: "overview",
            coordinate: null,
            zoom: null,
            bearingDegrees: 0,
            pitchDegrees: 0,
          },
          null,
          false,
        ),
      );
      return true;
    } catch (error) {
      logError("app-start-free-roam", error);
      return false;
    }
  }

  // The shared guard entry point for every route-opening action: a Routes
  // card, a Planning save, or the launcher's own Resume ride. Re-reads
  // storage at the moment of the click rather than trusting any caller's
  // own already-hydrated state, so a stale launcher view (or any other
  // stale in-memory assumption) can never bypass this check.
  //
  // stampResumeIntent is true only for the launcher's own Resume ride
  // action; even then, the one-use resumeIntentToken (backlog item 72) is
  // stamped only when THIS check itself, immediately and without any
  // dialog, resolves to "resume" (the exact same route already persisted).
  // It is never stamped when the row has vanished since hydration (an
  // ordinary "never-started" pre-ride open, which must still require an
  // explicit Start riding tap) nor after a confirmed different-session
  // switch (confirming a switch is not permission to auto-start GPS for
  // the replacement).
  //
  // origin (item 73 follow-up) is supplied by the caller, never inferred
  // here — see PendingRideSwitch's own doc comment for why.
  async function requestRouteTransition(
    route: PlannedRoute,
    options: { stampResumeIntent: boolean; origin: "route-card" | "global" },
  ): Promise<void> {
    const requestId = ++transitionRequestIdRef.current;
    const triggerElement = document.activeElement as HTMLElement | null;
    const target: RideSessionTarget = { kind: "route", route };
    const outcome = await checkRideTransition(target);
    if (transitionRequestIdRef.current !== requestId) return;

    if (outcome.kind === "proceed" || outcome.kind === "resume") {
      const resumeIntentToken =
        options.stampResumeIntent && outcome.kind === "resume"
          ? (nextResumeIntentTokenRef.current += 1)
          : undefined;
      openRideTarget(target, { resumeIntentToken });
      return;
    }

    const existingRouteId = outcome.kind === "conflict" ? outcome.existingRouteId : null;
    const existingRoute =
      options.origin === "route-card"
        ? await resolveExistingRouteForConflict(existingRouteId)
        : null;
    if (transitionRequestIdRef.current !== requestId) return;

    pendingSwitchTriggerRef.current = triggerElement;
    setFreeRoamTransitionError(null);
    setPendingRideSwitch({
      requestId,
      target,
      origin: options.origin,
      existing: outcome.kind === "read-failed" ? null : outcome.existing,
      existingRouteId,
      existingRoute,
      status: outcome.kind === "read-failed" ? "check-failed" : "conflict",
      errorMessage: null,
    });
  }

  // The shared guard entry point for both free-roam actions (Start and
  // Resume) — the classification, not which button was pressed, is what
  // actually determines whether this is a fresh write, a no-op resume of
  // an already-existing row, or a genuine conflict. This also correctly
  // handles a stale "Start free roam" render that no longer matches
  // storage (e.g. a free-roam row already exists there): free-roam vs.
  // free-roam always classifies as "resume", so the existing row is opened
  // as-is rather than blindly overwritten by a fresh-state write.
  async function requestFreeRoamTransition(): Promise<void> {
    const requestId = ++transitionRequestIdRef.current;
    const triggerElement = document.activeElement as HTMLElement | null;
    const target: RideSessionTarget = { kind: "free-roam" };
    setFreeRoamTransitionError(null);
    setFreeRoamTransitionPending(true);
    const outcome = await checkRideTransition(target);
    if (transitionRequestIdRef.current !== requestId) {
      setFreeRoamTransitionPending(false);
      return;
    }

    if (outcome.kind === "resume") {
      setFreeRoamTransitionPending(false);
      openRideTarget(target);
      return;
    }

    if (outcome.kind === "proceed") {
      const wroteState = await writeFreshFreeRoamState();
      if (transitionRequestIdRef.current !== requestId) {
        setFreeRoamTransitionPending(false);
        return;
      }
      setFreeRoamTransitionPending(false);
      if (wroteState) {
        openRideTarget(target);
      } else {
        setFreeRoamTransitionError(
          "Free roam could not be started on this device. Try again.",
        );
      }
      return;
    }

    setFreeRoamTransitionPending(false);
    pendingSwitchTriggerRef.current = triggerElement;
    setPendingRideSwitch({
      requestId,
      target,
      // Free roam never originates from a route card — always the
      // launcher — so this is always "global", and existingRoute is never
      // resolved (the page-level dialog's generic copy doesn't need it).
      origin: "global",
      existing: outcome.kind === "read-failed" ? null : outcome.existing,
      existingRouteId: outcome.kind === "conflict" ? outcome.existingRouteId : null,
      existingRoute: null,
      status: outcome.kind === "read-failed" ? "check-failed" : "conflict",
      errorMessage: null,
    });
  }

  const handleOpenRoute = (route: PlannedRoute) => {
    void requestRouteTransition(route, {
      stampResumeIntent: false,
      origin: "route-card",
    });
  };

  const handleRouteSaved = (route: PlannedRoute) => {
    void requestRouteTransition(route, { stampResumeIntent: false, origin: "global" });
  };

  const handleResumeRoute = (route: PlannedRoute) => {
    void requestRouteTransition(route, { stampResumeIntent: true, origin: "global" });
  };

  const handleStartFreeRoam = () => {
    void requestFreeRoamTransition();
  };

  const handleResumeFreeRoam = () => {
    void requestFreeRoamTransition();
  };

  // Confirming a pending different-session switch: clear storage first
  // (the sole authoritative clear path, item 29's convention), only then
  // complete the originally requested transition. A route target opens its
  // normal idle/pre-ride presentation immediately once the clear succeeds
  // — confirmation to end the old ride is not permission to start GPS for
  // the new one. A free-roam target must persist its own fresh minimal row
  // before mounting, exactly like the direct "no conflict" path.
  async function confirmPendingSwitch(pending: PendingRideSwitch): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      setPendingRideSwitch({ ...pending, status: "clearing", errorMessage: null });
      try {
        await clearActiveRideState();
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-clear-ride-for-switch", error);
        setPendingRideSwitch({
          ...pending,
          status: "clear-failed",
          errorMessage:
            "This unfinished ride could not be ended on this device. Try again.",
        });
        return;
      }
      if (transitionRequestIdRef.current !== pending.requestId) return;
      // The clear genuinely succeeded — bump this regardless of what
      // happens next, so a stale RidingLauncher underneath (if that's
      // where this switch originated) never continues showing the
      // just-cleared session, even if the steps below fail.
      setLauncherSessionRefreshToken((token) => token + 1);

      if (pending.target.kind === "route") {
        setPendingRideSwitch(null);
        openRideTarget(pending.target);
        return;
      }

      setPendingRideSwitch({
        ...pending,
        status: "starting-free-roam",
        errorMessage: null,
      });
      const wroteState = await writeFreshFreeRoamState();
      if (transitionRequestIdRef.current !== pending.requestId) return;
      if (wroteState) {
        setPendingRideSwitch(null);
        openRideTarget(pending.target);
      } else {
        setPendingRideSwitch({
          ...pending,
          status: "start-free-roam-failed",
          errorMessage: "Free roam could not be started on this device. Try again.",
        });
      }
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  // Retries only the original storage read/classification (the
  // "check-failed" status) — nothing has been cleared or written yet at
  // this point, so this simply re-runs the same guard the entry point
  // itself already used.
  async function retryPendingSwitchCheck(pending: PendingRideSwitch): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      const outcome = await checkRideTransition(pending.target);
      if (transitionRequestIdRef.current !== pending.requestId) return;

      if (outcome.kind === "resume") {
        setPendingRideSwitch(null);
        openRideTarget(pending.target);
        return;
      }
      if (outcome.kind === "proceed") {
        // A route target can open immediately; a free-roam target must
        // still write its own fresh row first — the same invariant as
        // requestFreeRoamTransition's own "proceed" branch, not
        // shortcut-able just because this retry came from a dialog.
        if (pending.target.kind === "route") {
          setPendingRideSwitch(null);
          openRideTarget(pending.target);
          return;
        }
        setPendingRideSwitch({
          ...pending,
          status: "starting-free-roam",
          errorMessage: null,
        });
        const wroteState = await writeFreshFreeRoamState();
        if (transitionRequestIdRef.current !== pending.requestId) return;
        if (wroteState) {
          setPendingRideSwitch(null);
          openRideTarget(pending.target);
        } else {
          setPendingRideSwitch({
            ...pending,
            status: "start-free-roam-failed",
            errorMessage: "Free roam could not be started on this device. Try again.",
          });
        }
        return;
      }

      const existingRouteId =
        outcome.kind === "conflict" ? outcome.existingRouteId : null;
      const existingRoute =
        pending.origin === "route-card"
          ? await resolveExistingRouteForConflict(existingRouteId)
          : null;
      if (transitionRequestIdRef.current !== pending.requestId) return;

      setPendingRideSwitch({
        ...pending,
        existing: outcome.kind === "read-failed" ? null : outcome.existing,
        existingRouteId,
        existingRoute,
        status: outcome.kind === "read-failed" ? "check-failed" : "conflict",
        errorMessage: null,
      });
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  // Retries only the free-roam row write (the "start-free-roam-failed"
  // status) — the old session was already successfully cleared, so there
  // is nothing left to reclear; retrying re-attempts exactly the one step
  // that failed.
  async function retryFreeRoamWriteForPendingSwitch(
    pending: PendingRideSwitch,
  ): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      setPendingRideSwitch({
        ...pending,
        status: "starting-free-roam",
        errorMessage: null,
      });
      const wroteState = await writeFreshFreeRoamState();
      if (transitionRequestIdRef.current !== pending.requestId) return;
      if (wroteState) {
        setPendingRideSwitch(null);
        openRideTarget(pending.target);
      } else {
        setPendingRideSwitch({
          ...pending,
          status: "start-free-roam-failed",
          errorMessage: "Free roam could not be started on this device. Try again.",
        });
      }
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  // "Return to paused ride" (item 73 follow-up) — reopens the existing
  // paused route WITHOUT clearing storage, WITHOUT stamping a
  // resumeIntentToken, and without starting GPS: opening a route target
  // through openRideTarget with no resumeIntentToken already produces the
  // correct "paused, Resume ride required" presentation, since
  // RidingScreen independently re-detects the matching stored row itself
  // — the exact mechanism an ordinary undialogued "resume" outcome already
  // relies on elsewhere in this guard.
  //
  // Revalidates fresh at click time rather than trusting the snapshot the
  // prompt opened with, so a stale prompt can never reopen or silently
  // resume a session that has since changed or vanished (e.g. ended from
  // another tab). Any mismatch/failure lands on "return-failed", which
  // nulls existingRoute so a dangling Return button doesn't just fail
  // again — "Check again" (routed through retryPendingSwitchCheck) is the
  // only way back to a fresh, actionable state.
  async function returnToPausedRide(pending: PendingRideSwitch): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    if (pending.existing !== "route" || !pending.existingRouteId) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      setPendingRideSwitch({ ...pending, status: "returning", errorMessage: null });

      let stored;
      try {
        stored = await getActiveRideState();
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-return-to-paused-ride", error);
        setPendingRideSwitch({
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: "This paused ride's status could not be checked. Try again.",
        });
        return;
      }
      if (transitionRequestIdRef.current !== pending.requestId) return;

      const stillMatches =
        stored !== undefined &&
        isStoredRouteRideState(stored) &&
        stored.routeId === pending.existingRouteId;
      if (!stillMatches) {
        setPendingRideSwitch({
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage:
            "This paused ride has changed since this screen opened. Check again to see its current status.",
        });
        return;
      }

      let route;
      try {
        route = await getRoute(pending.existingRouteId);
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-return-to-paused-ride", error);
        setPendingRideSwitch({
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: "This paused ride's route could not be checked. Try again.",
        });
        return;
      }
      if (transitionRequestIdRef.current !== pending.requestId) return;
      if (!route) {
        setPendingRideSwitch({
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage:
            "This route is no longer in your library, so this paused ride can't be reopened.",
        });
        return;
      }

      setPendingRideSwitch(null);
      openRideTarget({ kind: "route", route });
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  const handlePendingSwitchConfirm = () => {
    if (!pendingRideSwitch || isPendingSwitchActionPendingRef.current) return;
    if (
      pendingRideSwitch.status === "check-failed" ||
      pendingRideSwitch.status === "return-failed"
    ) {
      void retryPendingSwitchCheck(pendingRideSwitch);
    } else if (pendingRideSwitch.status === "start-free-roam-failed") {
      void retryFreeRoamWriteForPendingSwitch(pendingRideSwitch);
    } else {
      void confirmPendingSwitch(pendingRideSwitch);
    }
  };

  const handlePendingSwitchReturn = () => {
    if (!pendingRideSwitch || isPendingSwitchActionPendingRef.current) return;
    if (pendingRideSwitch.status !== "conflict") return;
    void returnToPausedRide(pendingRideSwitch);
  };

  const handlePendingSwitchCancel = () => {
    // Escape can bypass a disabled Cancel button, so guard here too — a
    // clear already in flight (or a free-roam write already in flight)
    // must never appear cancellable.
    if (isPendingSwitchActionPendingRef.current) return;
    setPendingRideSwitch(null);
    const trigger = pendingSwitchTriggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
    }
  };

  // Item 73 follow-up: RouteLibrary reports back when the pending switch's
  // target route stops being visible in the current (search-filtered)
  // list — deleted, or no longer matching the search text — so this can
  // cancel safely rather than leaving an invisible actionable prompt or
  // having RouteLibrary fabricate a card that doesn't match the query. No
  // focus assumption is made here — the trigger element's card may be gone
  // too. Only cancels if the pending switch still targets that exact
  // route, so a stale report can't clobber a newer, different pending
  // switch.
  const handleSwitchTargetMissing = (routeId: string) => {
    setPendingRideSwitch((current) =>
      current?.target.kind === "route" && current.target.route.id === routeId
        ? null
        : current,
    );
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
  //   scroll contract — see its own comment).
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
  const handleNavigate = (nextScreen: Screen) => {
    if (screen === "riding" && nextScreen !== "riding") {
      if (ridingContent.kind === "free-roam") {
        setRidingContent(NONE_RIDING_CONTENT);
      }
    }
    setScreen(nextScreen);
  };

  const pendingSwitchCopy = pendingRideSwitch
    ? describePendingRideSwitch(pendingRideSwitch)
    : null;
  const isPendingSwitchBusy =
    pendingRideSwitch?.status === "clearing" ||
    pendingRideSwitch?.status === "starting-free-roam" ||
    pendingRideSwitch?.status === "returning";

  // Item 73 follow-up: inline presentation requires BOTH the immutable
  // origin captured at request time AND the currently rendered screen —
  // see PendingRideSwitch's own doc comment for why the latter can't be
  // dropped (a rider navigating away from Routes mid-prompt must fall
  // back to the page-level dialog, not vanish silently).
  const canShowInline =
    pendingRideSwitch !== null &&
    pendingRideSwitch.origin === "route-card" &&
    pendingRideSwitch.target.kind === "route" &&
    screen === "library";

  const routeSwitchPrompt: PendingRouteSwitch | null =
    canShowInline && pendingRideSwitch.target.kind === "route" && pendingSwitchCopy
      ? {
          routeId: pendingRideSwitch.target.route.id,
          title: pendingSwitchCopy.title,
          message:
            describeInlineRouteSwitchMessage(pendingRideSwitch) ??
            pendingSwitchCopy.message,
          confirmLabel: pendingSwitchCopy.confirmLabel,
          confirmVariant: isDestructiveSwitchConfirmStatus(pendingRideSwitch.status)
            ? "danger"
            : "secondary",
          offerReturn:
            pendingRideSwitch.existing === "route" &&
            pendingRideSwitch.existingRoute !== null,
          busy: isPendingSwitchBusy,
          onCancel: handlePendingSwitchCancel,
          onConfirm: handlePendingSwitchConfirm,
          onReturn: handlePendingSwitchReturn,
          onTargetMissing: handleSwitchTargetMissing,
        }
      : null;

  return (
    <div className="app-shell">
      {isImmersive ? null : (
        <header className="app-header--sticky" ref={stickyHeaderRef}>
          <MainNavigation screen={screen} onNavigate={handleNavigate} />
        </header>
      )}

      {pendingRideSwitch && pendingSwitchCopy && !canShowInline ? (
        <ConfirmDialog
          open
          title={pendingSwitchCopy.title}
          message={pendingSwitchCopy.message}
          confirmLabel={pendingSwitchCopy.confirmLabel}
          cancelLabel="Cancel"
          confirmDisabled={isPendingSwitchBusy}
          cancelDisabled={isPendingSwitchBusy}
          onConfirm={handlePendingSwitchConfirm}
          onCancel={handlePendingSwitchCancel}
        />
      ) : null}

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
            pendingRouteSwitch={routeSwitchPrompt}
            stickyHeaderRef={stickyHeaderRef}
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
              onStartFreeRoam={handleStartFreeRoam}
              onResumeFreeRoam={handleResumeFreeRoam}
              isFreeRoamPending={freeRoamTransitionPending}
              freeRoamError={freeRoamTransitionError}
              sessionRefreshToken={launcherSessionRefreshToken}
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
