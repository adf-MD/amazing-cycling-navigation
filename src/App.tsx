import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlannedRoute } from "./domain/types.ts";
import type { MapFactory } from "./map/mapAdapter.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { logError } from "./platform/errorLog.ts";
import { generateId } from "./platform/idGenerator.ts";
import { usePwaUpdate } from "./pwa/registerSW.ts";
import { isStoredRouteRideState, toStoredFreeRoamState } from "./storage/mapping.ts";
import type { StoredFreeRoamRideState } from "./storage/db.ts";
import {
  clearActiveRideStateIfSession,
  getActiveRideState,
  getActiveRideStateWithSessionId,
  replaceActiveRideStateIfSession,
  setActiveRideState,
} from "./storage/rideStateRepository.ts";
import { getRoute } from "./storage/routesRepository.ts";
import {
  classifyRideTransition,
  type RideSessionTarget,
} from "./ui/riding/rideSessionTransition.ts";
import { RouteLibrary, type PendingRouteSwitch } from "./ui/library/RouteLibrary.tsx";
import { useRouteDeletion } from "./ui/library/useRouteDeletion.ts";
import {
  PlanningScreen,
  type SavedRouteSwitchPrompt,
} from "./ui/planning/PlanningScreen.tsx";
import { FreeRoamScreen } from "./ui/riding/FreeRoamScreen.tsx";
import { RidingLauncher } from "./ui/riding/RidingLauncher.tsx";
import { RidingScreen } from "./ui/riding/RidingScreen.tsx";
import { SettingsSection } from "./ui/settings/SettingsSection.tsx";
import { ConfirmDialog } from "./ui/shared/ConfirmDialog.tsx";
import { MainNavigation, type Screen } from "./ui/shared/MainNavigation.tsx";
import {
  isSettingsSectionView,
  resolveSettingsTabTarget,
  type PrimaryDestination,
  type SettingsSectionView,
} from "./ui/shared/screenTypes.ts";
import { useTranslate } from "./i18n/useTranslate.ts";
import type { Translator } from "./i18n/translate.ts";
import { isImmersiveRidingShell } from "./ui/shared/immersiveRidingShell.ts";
import {
  createScreenScrollMemory,
  ScreenScrollContext,
  useScreenTopRequests,
} from "./ui/shared/screenScrollMemory.ts";

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
 * A route's intent is one of two kinds, never both, each identified by a
 * token from one plain monotonic counter:
 *
 * - "resume" (backlog item 72) is a one-use resume intent: set only when
 *   requestRouteTransition's own guard check, for the launcher's Resume
 *   ride, resolves the SAME route as already persisted, and never after a
 *   confirmed different-session switch (backlog item 73) — confirming a
 *   switch is not permission to auto-start GPS for the replacement.
 *   RidingScreen consumes it at most once, only after its own restoration
 *   has genuinely completed, to start GPS and request Follow without a
 *   second in-screen tap. App owns its lifetime (backlog item 131):
 *   RidingScreen reports when it has handled the instruction — consumed
 *   it, or found no matching session to resume — and
 *   handleResumeIntentHandled then removes it, so a later Pause can never
 *   be shown as "Resuming…" and a later mount of the screen (after leaving
 *   Riding and coming back) can never replay it. Until then — while
 *   restoration is still pending or has failed — it stays, so a rider who
 *   leaves and returns before it is handled still gets the one resume they
 *   asked for.
 * - "restore" (backlog item 132) records that this route has a stored,
 *   unfinished ride: the first Ride entry after a cold start, an explicit
 *   open (a Routes card, Planning's Open saved route, a switch prompt's
 *   Retry or Return to paused ride) that found this same route stored, or
 *   RidingScreen's report that the session is in storage. It never starts
 *   tracking. It lasts as long as the content, so every later mount holds
 *   the paused controls back until the session is restored, explains a
 *   failed read, and returns to the launcher if the session has gone.
 */
interface RideIntent {
  kind: "resume" | "restore";
  token: number;
}

type RidingContent =
  | { kind: "none" }
  | {
      kind: "route";
      route: PlannedRoute;
      intent?: RideIntent;
    }
  // The free-roam session App opened (backlog item 140): App wrote it, or
  // validated it on Resume, and owns its identity; FreeRoamScreen acts only
  // on this session.
  | { kind: "free-roam"; sessionId: string };

/** What opening ride content needs: a route, or the identity of the
 * free-roam session App has just stored or validated. */
type OpenedRideTarget =
  { kind: "route"; route: PlannedRoute } | { kind: "free-roam"; sessionId: string };

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
 * into); "planning" (backlog item 124, slice 3) means Planning's own Open
 * saved route action, whose prompt Planning presents inline beneath that
 * action; "global" covers every Riding-launcher entry point, which keep
 * the page-level ConfirmDialog unchanged. Saving in Planning no longer
 * requests a transition at all. Deriving this from `screen` instead would
 * be wrong: the sticky nav stays clickable
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
  origin: "route-card" | "planning" | "global";
  existing: "route" | "free-roam" | "unsupported" | null;
  existingRouteId: string | null;
  existingRoute: PlannedRoute | null;
  /** The identity of the stored session this prompt showed (backlog item
   * 140), established by the identity-assigning read that created it — null
   * only for "check-failed". End and switch and Discard and continue act on
   * this session and no other; a newer stored session is never silently
   * substituted while the prompt stays open. */
  existingSessionId: string | null;
  status:
    | "check-failed"
    | "conflict"
    | "clearing"
    | "clear-failed"
    | "session-changed"
    | "starting-free-roam"
    | "start-free-roam-failed"
    | "returning"
    | "return-failed";
  errorMessage: string | null;
}

/** The rider's own route name, quoted — returned verbatim, never through
 * the catalogue, so braces or quotation marks inside it survive intact. */
function targetLabel(translator: Translator, target: RideSessionTarget): string {
  return target.kind === "route"
    ? translator.t("switch.quotedRouteName", { name: target.route.name })
    : translator.t("switch.freeRoamTarget");
}

function existingSessionLabel(
  translator: Translator,
  existing: "route" | "free-roam" | "unsupported",
): string {
  if (existing === "route") return translator.t("switch.existingRoute");
  if (existing === "free-roam") return translator.t("switch.existingFreeRoam");
  return translator.t("switch.existingUnsupported");
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
function describePendingRideSwitch(
  translator: Translator,
  pending: PendingRideSwitch,
): {
  title: string;
  message: string;
  confirmLabel: string;
} {
  if (pending.status === "check-failed") {
    return {
      title: translator.t("switch.checkFailedTitle"),
      message: translator.t("switch.checkFailedMessage"),
      confirmLabel: translator.t("switch.retry"),
    };
  }

  const existing = pending.existing ?? "unsupported";
  const isUnsupported = existing === "unsupported";
  const title = translator.t("switch.title", {
    target: targetLabel(translator, pending.target),
  });
  const confirmLabel = translator.t(
    isUnsupported ? "switch.discardAndContinue" : "switch.endAndSwitch",
  );

  switch (pending.status) {
    case "clearing":
      return {
        title,
        message: translator.t(isUnsupported ? "switch.discarding" : "switch.ending"),
        confirmLabel: translator.t(
          isUnsupported ? "switch.discardingLabel" : "switch.endingLabel",
        ),
      };
    case "starting-free-roam":
      return {
        title,
        message: translator.t("switch.startingFreeRoam"),
        confirmLabel: translator.t("switch.startingLabel"),
      };
    case "clear-failed":
      return {
        title,
        // An errorMessage already produced by a failing operation is
        // rendered as-is. It is a value, not a key.
        message: pending.errorMessage ?? translator.t("switch.clearFailed"),
        confirmLabel,
      };
    case "start-free-roam-failed":
      return {
        title,
        message: pending.errorMessage ?? translator.t("switch.startFreeRoamFailed"),
        confirmLabel: translator.t("switch.tryAgain"),
      };
    case "returning":
      return {
        title,
        message: translator.t("switch.returning"),
        confirmLabel,
      };
    case "session-changed":
      // Backlog item 140: End and switch found the session this prompt
      // showed already ended or replaced elsewhere, so nothing was ended,
      // written or opened. Like "return-failed" below, never a destructive
      // action against that stale snapshot: "Check again" re-runs the
      // check first. The wording is the Ride launcher's approved notice.
      return {
        title,
        message: translator.t("launcher.staleSessionNotice"),
        confirmLabel: translator.t("switch.checkAgain"),
      };
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
        message: pending.errorMessage ?? translator.t("switch.returnFailed"),
        confirmLabel: translator.t("switch.checkAgain"),
      };
    default: {
      // Two whole sentences rather than a note spliced into one: German
      // would need to reorder the clause, which a fragment cannot do.
      return {
        title,
        message: translator.t(
          existing === "route" ? "switch.conflictKeepsRoute" : "switch.conflict",
          { existing: existingSessionLabel(translator, existing) },
        ),
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
function describeInlineRouteSwitchMessage(
  translator: Translator,
  pending: PendingRideSwitch,
): string | null {
  if (
    pending.origin !== "route-card" ||
    pending.target.kind !== "route" ||
    pending.status !== "conflict" ||
    pending.existing !== "route" ||
    !pending.existingRoute
  ) {
    return null;
  }
  return translator.t("switch.inlineRouteConflict", {
    existing: pending.existingRoute.name,
    target: targetLabel(translator, pending.target),
  });
}

function App({ mapFactory, clock = systemClock }: AppProps) {
  const translator = useTranslate();
  const { t } = translator;
  const [screen, setScreen] = useState<Screen>("library");
  // Backlog item 125: each primary view's own scroll position, for this app
  // session only. Created once, with the screen App starts on; see
  // screenScrollMemory.ts.
  const [scrollMemory] = useState(() => createScreenScrollMemory("library"));
  useLayoutEffect(() => {
    scrollMemory.noteRendered(screen);
  }, [scrollMemory, screen]);
  useLayoutEffect(
    () => () => {
      scrollMemory.dispose();
    },
    [scrollMemory],
  );
  // Backlog item 121: which of the Settings section's two views the rider
  // last saw, so returning to the Settings tab from another tab reopens it.
  // Memory only, so a reload starts at Settings. Recorded by showScreen
  // below, the one setter every navigation into the section goes through.
  const [lastSettingsView, setLastSettingsView] =
    useState<SettingsSectionView>("settings");
  const [ridingContent, setRidingContent] = useState<RidingContent>(NONE_RIDING_CONTENT);
  const [isRidingActive, setIsRidingActive] = useState(false);
  const { needRefresh, updateNow, dismiss } = usePwaUpdate();
  // Read-only handle onto the sticky top navigation's own rendered box, so
  // RouteListItem (several levels below, not a DOM ancestor of this
  // element) can measure the header's live rendered height when deciding
  // whether the route-switch guard prompt needs to scroll into view
  // (backlog item 95) — App owns a page-chrome fact a screen component
  // needs.
  const stickyHeaderRef = useRef<HTMLElement>(null);
  const routesSearchQueryRef = useRef<string>("");
  // Selected tag-filter identity keys (tagIdentityKey outputs), mirroring
  // routesSearchQueryRef's own contract exactly: never one-shot-nulled,
  // continuously synced by RouteLibrary, resets only when App itself
  // remounts (backlog item 100 stage 3).
  const routesTagFilterKeysRef = useRef<readonly string[]>([]);
  // Backlog item 124, D-02: the confirmed route deletion, owned here rather
  // than by RouteLibrary so it survives the rider leaving Routes while it
  // runs — on return its card still shows "Deleting…", or its failure —
  // instead of an ordinary, fully enabled card. Memory only, like the two
  // refs above: a reload starts empty, and storage is then the truth.
  const routeDeletion = useRouteDeletion();
  // Plain monotonic counter (never a timestamp/uuid) for every RideIntent
  // token — mirrors useRideCamera.ts's own nextCameraRequestIdRef idiom
  // (backlog items 72 and 132).
  const nextRideIntentTokenRef = useRef(0);
  // Backlog item 132: whether the first Ride entry after a cold start may
  // still open a stored route ride's own paused screen in place of the
  // launcher's summary. Armed at mount — a cold start and a reload both
  // mount App afresh — and disarmed by the first check that decides it, or
  // synchronously by any ride content being opened, so it can never bring
  // the rider back after Back to Ride options or override a choice they
  // have since made.
  const coldStartAutoOpenArmedRef = useRef(true);
  // Mirrors of state that stable callbacks must read without depending on
  // it (backlog item 132). Updated in layout effects, so a report from a
  // child's effect after a commit always sees that commit's values.
  const ridingContentRef = useRef<RidingContent>(NONE_RIDING_CONTENT);
  useLayoutEffect(() => {
    ridingContentRef.current = ridingContent;
  }, [ridingContent]);
  // Backlog item 125. A top request discards a view's saved position and
  // starts it at the top, now or on its next arrival. New ride content is
  // one — the role useResetScrollForNewRideContent played before it.
  const requestTop = useScreenTopRequests(screen, scrollMemory);
  const notifyNewRideContent = useCallback(() => {
    requestTop("riding");
  }, [requestTop]);
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
  // nextRideIntentTokenRef elsewhere in this codebase), so a newer click
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
  // Backlog item 124, slice 3: the Planning-origin request, if any, whose
  // anchor vanished while one of its actions was running, so it is shown
  // page-level rather than withdrawn (see handlePlanningAnchorMissing).
  const [anchorlessPlanningRequestId, setAnchorlessPlanningRequestId] = useState<
    number | null
  >(null);
  const [pendingRideSwitch, setPendingRideSwitch] = useState<PendingRideSwitch | null>(
    null,
  );
  const pendingRideSwitchRef = useRef<PendingRideSwitch | null>(null);
  useLayoutEffect(() => {
    pendingRideSwitchRef.current = pendingRideSwitch;
  }, [pendingRideSwitch]);
  // Backlog item 119: the storage mutation — the clear, or a fresh
  // free-roam row — that a pending-switch action currently has in flight,
  // settled to success or failure. A newer ride transition waits for it
  // before classifying, so it never reads a row this mutation is about to
  // change: Resume ride tapped while an older End and switch is still
  // clearing must classify against the cleared table, not open the paused
  // ride the clear is about to erase.
  const switchStorageMutationRef = useRef<Promise<void> | null>(null);
  // Backlog item 119: starting to ride is itself a newer ride choice, even
  // when it happens on an already-open route's own screen without passing
  // through requestRouteTransition. Any pending switch prompt is stale
  // from that moment — it would sit above the immersive shell offering to
  // end the ride now in progress — so it is withdrawn, and taking a new
  // request id stops an older switch action already in flight from
  // opening its target over the ride. Stable identity: RidingScreen and
  // FreeRoamScreen report through an effect that depends on it.
  const handleRidingActiveChange = useCallback((active: boolean) => {
    setIsRidingActive(active);
    if (active) {
      transitionRequestIdRef.current += 1;
      setPendingRideSwitch(null);
    }
  }, []);
  // Backlog item 131: retires the route session's one-use resume
  // instruction once RidingScreen reports it handled. Matched on the token
  // itself — tokens are unique and monotonic — so a report from an obsolete
  // screen, about an older instruction, can never retire a newer one, for
  // the same route or another. Stable identity: RidingScreen reports from
  // an effect that depends on it.
  const handleResumeIntentHandled = useCallback((token: number) => {
    setRidingContent((current) =>
      current.kind === "route" &&
      current.intent?.kind === "resume" &&
      current.intent.token === token
        ? { kind: "route", route: current.route }
        : current,
    );
  }, []);
  // Backlog item 132: RidingLauncher's report of each check it completes.
  // While armed, the first check that finds a stored route ride opens that
  // route's own paused screen in place of the launcher's summary, with a
  // "restore" intent and no instruction to start tracking. It is not a
  // ride choice: it takes no transition request id, so it can neither
  // supersede nor withdraw a pending switch prompt, and it records no
  // Routes scroll position. While a switch prompt is pending it declines,
  // still armed, so the launcher's own guarded Resume ride stays the way
  // on, as before. Returns true only when it has opened the route. Stable
  // identity: the launcher's hydration effect depends on it.
  const handleLauncherSessionChecked = useCallback(
    (route: PlannedRoute | null): boolean => {
      if (!coldStartAutoOpenArmedRef.current) return false;
      if (pendingRideSwitchRef.current !== null) return false;
      coldStartAutoOpenArmedRef.current = false;
      if (route === null) return false;
      const token = (nextRideIntentTokenRef.current += 1);
      setRidingContent({ kind: "route", route, intent: { kind: "restore", token } });
      notifyNewRideContent();
      return true;
    },
    [notifyNewRideContent],
  );
  // Backlog item 132: the route screen found that the stored session its
  // "restore" intent promised is not there (ended or replaced elsewhere).
  // Back to the launcher, which shows what storage actually holds; the
  // auto-open is already disarmed, so it cannot reopen anything. Acts only
  // for the content that still carries that exact token, decided outside
  // the state updater so nothing runs twice under Strict Mode.
  const handleRestoredSessionMissing = useCallback(
    (token: number) => {
      const seen = ridingContentRef.current;
      if (
        seen.kind !== "route" ||
        seen.intent?.kind !== "restore" ||
        seen.intent.token !== token
      ) {
        return;
      }
      setRidingContent((current) => (current === seen ? NONE_RIDING_CONTENT : current));
      notifyNewRideContent();
    },
    [notifyNewRideContent],
  );
  // Backlog item 132: the route screen reports that this route's ride is in
  // storage. App keeps that knowledge as a "restore" intent for as long as
  // the content lasts, independently of Pause and of a consumed "resume"
  // intent, so every later mount waits for the session to be restored. It
  // never replaces an intent already there — in particular a "resume"
  // still pending, whose one-use instruction item 131 retires first, after
  // which the screen reports again.
  const handleStoredSessionKnown = useCallback((routeId: string) => {
    const seen = ridingContentRef.current;
    if (seen.kind !== "route" || seen.route.id !== routeId || seen.intent !== undefined) {
      return;
    }
    const next: RidingContent = {
      kind: "route",
      route: seen.route,
      intent: { kind: "restore", token: (nextRideIntentTokenRef.current += 1) },
    };
    setRidingContent((current) => (current === seen ? next : current));
  }, []);
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
  //
  // Backlog item 140: the read gives a stored row without an identity one,
  // in the same transaction, so a conflict's prompt — and a resumed free
  // roam — carries the identity of exactly the session it read; its unknown
  // fields, for an unsupported row, are kept. A failed assignment is a
  // failed read: "read-failed", never a conflict.
  type RideTransitionCheckResult =
    | { kind: "proceed" }
    | { kind: "resume"; sessionId: string }
    | {
        kind: "conflict";
        existing: "route" | "free-roam" | "unsupported";
        existingRouteId: string | null;
        existingSessionId: string;
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
      const stored = await getActiveRideStateWithSessionId();
      const outcome = classifyRideTransition(stored, target);
      if (outcome.kind === "proceed" || stored === undefined) return { kind: "proceed" };
      if (outcome.kind === "resume")
        return { kind: "resume", sessionId: stored.sessionId };
      return {
        ...outcome,
        existingRouteId:
          outcome.existing === "route" && isStoredRouteRideState(stored)
            ? stored.routeId
            : null,
        existingSessionId: stored.sessionId,
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

  // Every explicit opening of ride content goes through here, so it is also
  // where the cold-start auto-open is disarmed (backlog item 132): once the
  // rider has opened anything, a launcher check still in flight can no
  // longer replace it.
  function openRideTarget(
    target: OpenedRideTarget,
    options: { intent?: RideIntent } = {},
  ) {
    coldStartAutoOpenArmedRef.current = false;
    if (target.kind === "route") {
      setRidingContent({
        kind: "route",
        route: target.route,
        ...(options.intent !== undefined ? { intent: options.intent } : {}),
      });
    } else {
      setRidingContent({ kind: "free-roam", sessionId: target.sessionId });
    }
    changeScreen("riding");
    notifyNewRideContent();
  }

  // Persists a fresh, minimal free-roam session row — the single
  // authoritative write for a brand-new free-roam session, shared by both
  // the direct "no unfinished session" path and a confirmed different-
  // session switch's own replacement write. Never called before a genuine
  // "proceed"/confirmed-clear outcome; a rejection here starts no GPS and
  // leaves the rider on a retryable state (backlog item 42's own
  // requirement, preserved).
  //
  // Resolves to the new session's identity (backlog item 140), which App
  // owns and FreeRoamScreen is opened with, or null when the write failed.
  async function writeFreshFreeRoamState(): Promise<string | null> {
    const fresh = buildFreshFreeRoamState();
    try {
      await setActiveRideState(fresh);
      return fresh.sessionId;
    } catch (error) {
      logError("app-start-free-roam", error);
      return null;
    }
  }

  // A brand-new free-roam session row, with its own identity (backlog item
  // 140): written by writeFreshFreeRoamState, or, for End and switch, as
  // the guarded replacement of the session its prompt showed.
  function buildFreshFreeRoamState(): StoredFreeRoamRideState & { sessionId: string } {
    const sessionId = generateId();
    return {
      ...toStoredFreeRoamState(
        new Date(clock.now()).toISOString(),
        sessionId,
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
      sessionId,
    };
  }

  // Backlog item 119: a pending-switch action only ever changes the
  // prompt its own request still owns, so an older async step can never
  // erase or overwrite a newer request's prompt.
  function updateOwnPrompt(
    pending: PendingRideSwitch,
    next: PendingRideSwitch | null,
  ): void {
    setPendingRideSwitch((current) =>
      current?.requestId === pending.requestId ? next : current,
    );
  }

  // Backlog item 119: a newer ride choice that opens a ride withdraws every
  // older prompt — left on screen, its End and switch would act on a choice
  // the rider has already replaced.
  function withdrawPromptsOlderThan(requestId: number): void {
    setPendingRideSwitch((current) =>
      current !== null && current.requestId < requestId ? null : current,
    );
  }

  function trackSwitchStorageMutation<T>(mutation: Promise<T>): Promise<T> {
    const settled = mutation.then(
      () => undefined,
      () => undefined,
    );
    switchStorageMutationRef.current = settled;
    void settled.then(() => {
      if (switchStorageMutationRef.current === settled) {
        switchStorageMutationRef.current = null;
      }
    });
    return mutation;
  }

  async function waitForSwitchStorageMutation(): Promise<void> {
    while (switchStorageMutationRef.current) {
      await switchStorageMutationRef.current;
    }
  }

  // The shared guard entry point for every route-opening action: a Routes
  // card, Planning's Open saved route, or the launcher's own Resume ride.
  // Re-reads storage at the moment of the click rather than trusting any
  // caller's own already-hydrated state, so a stale launcher view (or any
  // other stale in-memory assumption) can never bypass this check.
  //
  // stampResumeIntent is true only for the launcher's own Resume ride
  // action; even then, the one-use "resume" intent (backlog item 72) is
  // stamped only when THIS check itself, immediately and without any
  // dialog, resolves to "resume" (the exact same route already persisted).
  // It is never stamped when the row has vanished since hydration (an
  // ordinary "never-started" pre-ride open, which must still require an
  // explicit Start riding tap) nor after a confirmed different-session
  // switch (confirming a switch is not permission to auto-start GPS for
  // the replacement). Every other "resume" outcome — a Routes card or
  // Planning's Open saved route finding this same route stored — carries a
  // "restore" intent instead (backlog item 132), which never starts GPS.
  //
  // origin (item 73 follow-up) is supplied by the caller, never inferred
  // here — see PendingRideSwitch's own doc comment for why.
  async function requestRouteTransition(
    route: PlannedRoute,
    options: { stampResumeIntent: boolean; origin: "route-card" | "planning" | "global" },
  ): Promise<void> {
    const requestId = ++transitionRequestIdRef.current;
    const triggerElement = document.activeElement as HTMLElement | null;
    const target: RideSessionTarget = { kind: "route", route };
    // Taking the request id above has already superseded any older
    // pending-switch action; waiting here means this request classifies
    // against storage that action has finished changing (item 119).
    if (switchStorageMutationRef.current) {
      await waitForSwitchStorageMutation();
      if (transitionRequestIdRef.current !== requestId) return;
    }
    const outcome = await checkRideTransition(target);
    if (transitionRequestIdRef.current !== requestId) return;
    // Backlog item 124, D-02: a route whose deletion is running, or committed
    // and awaiting the list, is never opened or prompted for. Its card
    // refuses the tap already; this closes the narrow race of a tap made
    // just before Delete route was confirmed, which settles here after it.
    if (routeDeletion.isBusyFor(route.id)) return;

    if (outcome.kind === "proceed" || outcome.kind === "resume") {
      const intent: RideIntent | undefined =
        outcome.kind === "resume"
          ? {
              kind: options.stampResumeIntent ? "resume" : "restore",
              token: (nextRideIntentTokenRef.current += 1),
            }
          : undefined;
      withdrawPromptsOlderThan(requestId);
      openRideTarget(target, { intent });
      return;
    }

    const existingRouteId = outcome.kind === "conflict" ? outcome.existingRouteId : null;
    const existingRoute =
      options.origin === "route-card"
        ? await resolveExistingRouteForConflict(existingRouteId)
        : null;
    if (transitionRequestIdRef.current !== requestId) return;
    if (routeDeletion.isBusyFor(route.id)) return;

    // Backlog item 124, D-02: a route card's prompt supersedes a failed
    // deletion's confirmation, as it closed one before D-02 — never a
    // deletion still running or awaiting the list.
    if (options.origin === "route-card") routeDeletion.clearFailed();
    pendingSwitchTriggerRef.current = triggerElement;
    setFreeRoamTransitionError(null);
    setPendingRideSwitch({
      requestId,
      target,
      origin: options.origin,
      existing: outcome.kind === "read-failed" ? null : outcome.existing,
      existingRouteId,
      existingRoute,
      existingSessionId: outcome.kind === "conflict" ? outcome.existingSessionId : null,
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
    // As in requestRouteTransition (item 119).
    if (switchStorageMutationRef.current) {
      await waitForSwitchStorageMutation();
      if (transitionRequestIdRef.current !== requestId) {
        setFreeRoamTransitionPending(false);
        return;
      }
    }
    const outcome = await checkRideTransition(target);
    if (transitionRequestIdRef.current !== requestId) {
      setFreeRoamTransitionPending(false);
      return;
    }

    if (outcome.kind === "resume") {
      setFreeRoamTransitionPending(false);
      withdrawPromptsOlderThan(requestId);
      openRideTarget({ kind: "free-roam", sessionId: outcome.sessionId });
      return;
    }

    if (outcome.kind === "proceed") {
      const writtenSessionId = await writeFreshFreeRoamState();
      if (transitionRequestIdRef.current !== requestId) {
        setFreeRoamTransitionPending(false);
        return;
      }
      setFreeRoamTransitionPending(false);
      if (writtenSessionId !== null) {
        withdrawPromptsOlderThan(requestId);
        openRideTarget({ kind: "free-roam", sessionId: writtenSessionId });
      } else {
        setFreeRoamTransitionError(t("switch.startFreeRoamFailed"));
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
      existingSessionId: outcome.kind === "conflict" ? outcome.existingSessionId : null,
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

  // Backlog item 124, slice 3 (inventory C-14): Planning's Open saved route
  // action. Saving alone no longer reaches App; opening is this explicit
  // second step, through the same guard as every other entry point, with
  // no resume intent — opening a saved route never starts location
  // tracking.
  const handleOpenSavedRoute = (route: PlannedRoute) => {
    void requestRouteTransition(route, { stampResumeIntent: false, origin: "planning" });
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

  // Confirming a pending different-session switch (backlog item 140): ends
  // only the session this prompt showed — its existingSessionId — checked
  // and applied in one transaction. A route target clears that session,
  // then opens its normal idle/pre-ride presentation: confirmation to end
  // the old ride is not permission to start GPS for the new one. A free-roam
  // target replaces that session with its own fresh row in the same single
  // transaction, so no other window's write can land between the end and
  // the start; a write that fails aborts it, leaving the old session stored,
  // so the prompt returns to "clear-failed" with End and switch — the same
  // guarded replacement — as its retry. When that session has already ended
  // or been replaced elsewhere, nothing is cleared, written, opened or
  // tracked: the prompt shows "session-changed", which offers only a fresh
  // check.
  async function confirmPendingSwitch(pending: PendingRideSwitch): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    // A superseded prompt never clears storage and never shows a busy
    // state, however it is invoked (item 119).
    if (transitionRequestIdRef.current !== pending.requestId) {
      updateOwnPrompt(pending, null);
      return;
    }
    // Only a "check-failed" prompt lacks an identity, and it never offers
    // this action.
    const expectedSessionId = pending.existingSessionId;
    if (expectedSessionId === null) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      updateOwnPrompt(pending, { ...pending, status: "clearing", errorMessage: null });
      const fresh =
        pending.target.kind === "free-roam" ? buildFreshFreeRoamState() : null;
      let outcome: "done" | "missing" | "changed";
      try {
        if (fresh) {
          const replaced = await trackSwitchStorageMutation(
            replaceActiveRideStateIfSession(expectedSessionId, fresh),
          );
          outcome = replaced === "replaced" ? "done" : replaced;
        } else {
          const cleared = await trackSwitchStorageMutation(
            clearActiveRideStateIfSession(expectedSessionId),
          );
          outcome = cleared === "cleared" ? "done" : cleared;
        }
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-clear-ride-for-switch", error);
        updateOwnPrompt(pending, {
          ...pending,
          status: "clear-failed",
          errorMessage: t("switch.clearFailed"),
        });
        return;
      }
      // Storage changed, or was found changed elsewhere — bump this
      // regardless of what happens next, even if a newer request has
      // superseded this one, so a stale RidingLauncher underneath (if that's
      // where this switch originated) never continues showing a session
      // that is no longer the stored one.
      setLauncherSessionRefreshToken((token) => token + 1);
      if (transitionRequestIdRef.current !== pending.requestId) return;

      if (outcome !== "done") {
        updateOwnPrompt(pending, {
          ...pending,
          existingRoute: null,
          status: "session-changed",
          errorMessage: null,
        });
        return;
      }
      updateOwnPrompt(pending, null);
      if (fresh) {
        openRideTarget({ kind: "free-roam", sessionId: fresh.sessionId });
      } else if (pending.target.kind === "route") {
        openRideTarget(pending.target);
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
    // As in confirmPendingSwitch (item 119).
    if (transitionRequestIdRef.current !== pending.requestId) {
      updateOwnPrompt(pending, null);
      return;
    }
    isPendingSwitchActionPendingRef.current = true;
    try {
      const outcome = await checkRideTransition(pending.target);
      if (transitionRequestIdRef.current !== pending.requestId) return;

      if (outcome.kind === "resume") {
        updateOwnPrompt(pending, null);
        if (pending.target.kind === "route") {
          openRideTarget(pending.target, {
            intent: { kind: "restore", token: (nextRideIntentTokenRef.current += 1) },
          });
        } else {
          openRideTarget({ kind: "free-roam", sessionId: outcome.sessionId });
        }
        return;
      }
      if (outcome.kind === "proceed") {
        // A route target can open immediately; a free-roam target must
        // still write its own fresh row first — the same invariant as
        // requestFreeRoamTransition's own "proceed" branch, not
        // shortcut-able just because this retry came from a dialog.
        if (pending.target.kind === "route") {
          updateOwnPrompt(pending, null);
          openRideTarget(pending.target);
          return;
        }
        updateOwnPrompt(pending, {
          ...pending,
          status: "starting-free-roam",
          errorMessage: null,
        });
        const writtenSessionId = await trackSwitchStorageMutation(
          writeFreshFreeRoamState(),
        );
        if (transitionRequestIdRef.current !== pending.requestId) return;
        if (writtenSessionId !== null) {
          updateOwnPrompt(pending, null);
          openRideTarget({ kind: "free-roam", sessionId: writtenSessionId });
        } else {
          updateOwnPrompt(pending, {
            ...pending,
            status: "start-free-roam-failed",
            errorMessage: t("switch.startFreeRoamFailed"),
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

      updateOwnPrompt(pending, {
        ...pending,
        existing: outcome.kind === "read-failed" ? null : outcome.existing,
        existingRouteId,
        existingRoute,
        // An explicit fresh check (Retry or Check again) re-anchors the
        // prompt to the session it has just read, never silently.
        existingSessionId: outcome.kind === "conflict" ? outcome.existingSessionId : null,
        status: outcome.kind === "read-failed" ? "check-failed" : "conflict",
        errorMessage: null,
      });
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  // Retries only the free-roam row write (the "start-free-roam-failed"
  // status). Since backlog item 140 that status follows only a fresh check
  // that found nothing stored — End and switch's own replacement keeps the
  // old session when it fails, and retries as End and switch — so there is
  // nothing to clear; retrying re-attempts exactly the one step that failed.
  async function retryFreeRoamWriteForPendingSwitch(
    pending: PendingRideSwitch,
  ): Promise<void> {
    if (isPendingSwitchActionPendingRef.current) return;
    // As in confirmPendingSwitch (item 119).
    if (transitionRequestIdRef.current !== pending.requestId) {
      updateOwnPrompt(pending, null);
      return;
    }
    isPendingSwitchActionPendingRef.current = true;
    try {
      updateOwnPrompt(pending, {
        ...pending,
        status: "starting-free-roam",
        errorMessage: null,
      });
      const writtenSessionId = await trackSwitchStorageMutation(
        writeFreshFreeRoamState(),
      );
      if (transitionRequestIdRef.current !== pending.requestId) return;
      if (writtenSessionId !== null) {
        updateOwnPrompt(pending, null);
        openRideTarget({ kind: "free-roam", sessionId: writtenSessionId });
      } else {
        updateOwnPrompt(pending, {
          ...pending,
          status: "start-free-roam-failed",
          errorMessage: t("switch.startFreeRoamFailed"),
        });
      }
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  // "Return to paused ride" (item 73 follow-up) — reopens the existing
  // paused route WITHOUT clearing storage, WITHOUT stamping a "resume"
  // intent, and without starting GPS: opening a route target with only a
  // "restore" intent (backlog item 132) produces the "paused, Resume ride
  // required" presentation, since RidingScreen independently re-detects
  // the matching stored row itself — the exact mechanism an ordinary
  // undialogued "resume" outcome already relies on elsewhere in this
  // guard.
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
    // As in confirmPendingSwitch (item 119).
    if (transitionRequestIdRef.current !== pending.requestId) {
      updateOwnPrompt(pending, null);
      return;
    }
    if (pending.existing !== "route" || !pending.existingRouteId) return;
    isPendingSwitchActionPendingRef.current = true;
    try {
      updateOwnPrompt(pending, { ...pending, status: "returning", errorMessage: null });

      let stored;
      try {
        stored = await getActiveRideState();
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-return-to-paused-ride", error);
        updateOwnPrompt(pending, {
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: t("switch.pausedRideCheckFailed"),
        });
        return;
      }
      if (transitionRequestIdRef.current !== pending.requestId) return;

      const stillMatches =
        stored !== undefined &&
        isStoredRouteRideState(stored) &&
        stored.routeId === pending.existingRouteId;
      if (!stillMatches) {
        updateOwnPrompt(pending, {
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: t("switch.pausedRideChanged"),
        });
        return;
      }

      let route;
      try {
        route = await getRoute(pending.existingRouteId);
      } catch (error) {
        if (transitionRequestIdRef.current !== pending.requestId) return;
        logError("app-return-to-paused-ride", error);
        updateOwnPrompt(pending, {
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: t("switch.pausedRouteCheckFailed"),
        });
        return;
      }
      if (transitionRequestIdRef.current !== pending.requestId) return;
      if (!route) {
        updateOwnPrompt(pending, {
          ...pending,
          existingRoute: null,
          status: "return-failed",
          errorMessage: t("switch.pausedRouteMissing"),
        });
        return;
      }

      updateOwnPrompt(pending, null);
      openRideTarget(
        { kind: "route", route },
        { intent: { kind: "restore", token: (nextRideIntentTokenRef.current += 1) } },
      );
    } finally {
      isPendingSwitchActionPendingRef.current = false;
    }
  }

  const handlePendingSwitchConfirm = () => {
    if (!pendingRideSwitch || isPendingSwitchActionPendingRef.current) return;
    if (
      pendingRideSwitch.status === "check-failed" ||
      pendingRideSwitch.status === "return-failed" ||
      pendingRideSwitch.status === "session-changed"
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
    // A Planning-origin prompt's focus is returned by Planning itself,
    // already, without the browser's own focus scroll (item 124's
    // cancellation rule); every other origin is unchanged.
    if (pendingRideSwitch?.origin === "planning") return;
    const trigger = pendingSwitchTriggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
    }
  };

  // Backlog item 124, slice 3: Planning reports that the anchor its prompt
  // would sit beneath — the saved-route feedback — no longer exists. That
  // happens only when Planning has remounted (the rider left and came
  // back), since Planning never clears the feedback while the prompt shows.
  // - A stale report never acts: request ids are unique and monotonic, so
  //   one naming an older request can never touch a newer prompt, even for
  //   the same route.
  // - While an action of this prompt is running (an End and switch clear,
  //   a Retry's read, a free-roam write), nothing is withdrawn: the request
  //   is marked anchorless instead, so the existing page-level dialog keeps
  //   representing the running operation and then its outcome. The
  //   continuations check only the request id, so withdrawing here could
  //   otherwise let a Retry still open the route behind a vanished prompt.
  // - An idle prompt, which nothing has authorised yet, is withdrawn, and
  //   its request is invalidated first so no continuation of it can act.
  const handlePlanningAnchorMissing = (requestId: number) => {
    if (transitionRequestIdRef.current !== requestId) return;
    if (isPendingSwitchActionPendingRef.current) {
      setAnchorlessPlanningRequestId(requestId);
      return;
    }
    transitionRequestIdRef.current += 1;
    setPendingRideSwitch((current) =>
      current?.requestId === requestId && current.origin === "planning" ? null : current,
    );
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
  // resets the in-memory ridingContent pointer to "none" and requests a top
  // start for Ride (backlog item 125's top request) so the view scrolls
  // back to the top, exactly as opening any other new Ride content does.
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
  // storage already reflects" — never a storage mutation itself. The
  // launcher shows its own summary of a still-unfinished route ride then:
  // the cold-start auto-open (backlog item 132) is disarmed by the time any
  // of these can run, since each follows ride content that was opened.
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

  // Backlog item 140: a riding screen's End ride or Finish ride — or free
  // roam's restore — found its session already ended or replaced
  // elsewhere. Nothing was deleted; the screen has stopped. Hand back to
  // the Ride launcher, which re-reads storage and, once that read has
  // succeeded, shows what is stored with the notice. `seen` is the ride
  // content that screen was showing: a report from content a newer ride
  // choice has since replaced never resets that newer choice.
  const [launcherStaleNoticeRequested, setLauncherStaleNoticeRequested] = useState(false);
  const handleSessionGone = (seen: RidingContent) => {
    if (ridingContentRef.current !== seen) return;
    setLauncherStaleNoticeRequested(true);
    resetRidingContentToLauncher();
  };
  const handleLauncherStaleNoticeRequestHandled = useCallback(() => {
    setLauncherStaleNoticeRequested(false);
  }, []);

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
  // idle panel to place an equivalent action in. Since backlog item 132
  // this is also how the rider reaches the launcher's summary, its Resume
  // ride and End ride after the first Ride entry has shown the paused
  // screen; it never bounces back, because that auto-open is disarmed.
  const handleReturnToRideLauncher = () => {
    resetRidingContentToLauncher();
  };

  // Every change of screen goes through here (backlog item 125), so the
  // view being left records its own scroll position first, while the page
  // still shows it.
  function changeScreen(nextScreen: Screen) {
    scrollMemory.leave(nextScreen);
    setScreen(nextScreen);
  }

  // Every navigation into the Settings section goes through here, so the
  // last-viewed sibling is recorded in exactly one place (backlog item 121).
  const showScreen = (nextScreen: Screen) => {
    if (isSettingsSectionView(nextScreen)) setLastSettingsView(nextScreen);
    changeScreen(nextScreen);
  };

  // Planning's missing-key notice. Always Settings, whichever sibling view
  // was last shown: the notice exists to get a key entered, so it opens at
  // the top, as before backlog item 125.
  const handleNavigateToSettings = () => {
    requestTop("settings");
    showScreen("settings");
  };

  // Edit copy opening Planning with the draft it has just written: a new
  // draft, so Planning starts at the top (backlog item 125).
  const handleNavigateToPlanning = () => {
    requestTop("planning");
    changeScreen("planning");
  };

  // Edit copy's draft written, whether or not the rider is still on Ride to
  // be taken to Planning (backlog item 125). Never scrolls anything: it
  // only stops Planning's saved position — the old draft's — from being
  // restored over the new one. Stable identity, like the reports above.
  const handleEditCopyDraftSaved = useCallback(() => {
    scrollMemory.invalidate("planning");
  }, [scrollMemory]);

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
  // gates the restart whenever no "resume" intent is present) already
  // satisfies the identical requirement for routes. A launcher Resume's
  // intent no longer outlives its handling (backlog item 131,
  // handleResumeIntentHandled above), so returning to Ride after it has
  // been handled is that same path — now with a "restore" intent once the
  // session is known to be stored (backlog item 132), which holds the
  // paused controls back until the session is restored but never starts
  // GPS.
  const handleNavigate = (nextScreen: Screen) => {
    if (screen === "riding" && nextScreen !== "riding") {
      if (ridingContent.kind === "free-roam") {
        setRidingContent(NONE_RIDING_CONTENT);
      }
    }
    showScreen(nextScreen);
  };

  // The primary navigation names destinations, not screens: the Settings tab
  // resolves to one of the section's two views (backlog item 121) — Settings
  // from inside the section, otherwise whichever was last shown.
  const handlePrimaryNavigate = (destination: PrimaryDestination) => {
    handleNavigate(
      destination === "settings"
        ? resolveSettingsTabTarget(screen, lastSettingsView)
        : destination,
    );
  };

  const scrollContext = useMemo(
    () => ({ memory: scrollMemory, view: screen }),
    [scrollMemory, screen],
  );

  const pendingSwitchCopy = pendingRideSwitch
    ? describePendingRideSwitch(translator, pendingRideSwitch)
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

  // Backlog item 124, slice 3: Planning's Open saved route prompt sits inline
  // beneath that action while Planning is the rendered screen and still
  // shows its anchor; off Planning, or once anchorless while an action
  // runs, it falls back to the page-level dialog — the same fallback the
  // route-card prompt has had since item 73's follow-up.
  const canShowPlanningInline =
    pendingRideSwitch !== null &&
    pendingRideSwitch.origin === "planning" &&
    pendingRideSwitch.target.kind === "route" &&
    screen === "planning" &&
    anchorlessPlanningRequestId !== pendingRideSwitch.requestId;

  const savedRouteSwitchPrompt: SavedRouteSwitchPrompt | null =
    canShowPlanningInline &&
    pendingRideSwitch.target.kind === "route" &&
    pendingSwitchCopy
      ? {
          requestId: pendingRideSwitch.requestId,
          routeId: pendingRideSwitch.target.route.id,
          title: pendingSwitchCopy.title,
          message: pendingSwitchCopy.message,
          confirmLabel: pendingSwitchCopy.confirmLabel,
          busy: isPendingSwitchBusy,
          onConfirm: handlePendingSwitchConfirm,
          onCancel: handlePendingSwitchCancel,
          onAnchorMissing: handlePlanningAnchorMissing,
        }
      : null;

  const routeSwitchPrompt: PendingRouteSwitch | null =
    canShowInline && pendingRideSwitch.target.kind === "route" && pendingSwitchCopy
      ? {
          routeId: pendingRideSwitch.target.route.id,
          title: pendingSwitchCopy.title,
          message:
            describeInlineRouteSwitchMessage(translator, pendingRideSwitch) ??
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
      {/* Backlog item 140: a stable, initially empty polite region, present
          before its message, announcing once that End and switch found the
          session its prompt showed already ended or replaced. The route
          card, Planning and page-level prompts show the same words but
          have no live region of their own. */}
      <p className="visually-hidden" role="status" aria-atomic="true">
        {pendingRideSwitch?.status === "session-changed"
          ? t("launcher.staleSessionNotice")
          : ""}
      </p>
      {isImmersive ? null : (
        <header className="app-header--sticky" ref={stickyHeaderRef}>
          <MainNavigation screen={screen} onNavigate={handlePrimaryNavigate} />
        </header>
      )}

      {pendingRideSwitch &&
      pendingSwitchCopy &&
      !canShowInline &&
      !canShowPlanningInline ? (
        <ConfirmDialog
          open
          title={pendingSwitchCopy.title}
          message={pendingSwitchCopy.message}
          confirmLabel={pendingSwitchCopy.confirmLabel}
          cancelLabel={t("switch.cancel")}
          confirmDisabled={isPendingSwitchBusy}
          cancelDisabled={isPendingSwitchBusy}
          onConfirm={handlePendingSwitchConfirm}
          onCancel={handlePendingSwitchCancel}
        />
      ) : null}

      {needRefresh ? (
        <div role="status">
          <p>{t("update.ready")}</p>
          <button type="button" onClick={updateNow}>
            {t("update.now")}
          </button>
          <button type="button" onClick={dismiss}>
            {t("update.later")}
          </button>
        </div>
      ) : null}

      <ScreenScrollContext.Provider value={scrollContext}>
        <main>
          {screen === "library" && (
            <RouteLibrary
              onOpenRoute={handleOpenRoute}
              restoreSearchQueryRef={routesSearchQueryRef}
              restoreTagFilterKeysRef={routesTagFilterKeysRef}
              pendingRouteSwitch={routeSwitchPrompt}
              stickyHeaderRef={stickyHeaderRef}
              routeDeletion={routeDeletion}
            />
          )}
          {screen === "riding" &&
            (ridingContent.kind === "route" ? (
              // Keyed by route id (item 119 follow-up): a RidingScreen and its
              // navigation hook hold one route's session, so a different
              // route — e.g. End and switch confirmed from Ride while a
              // paused route's screen is still mounted — must be a fresh
              // instance, never the old one with its fix and progress.
              <RidingScreen
                key={ridingContent.route.id}
                route={ridingContent.route}
                resumeIntentToken={
                  ridingContent.intent?.kind === "resume"
                    ? ridingContent.intent.token
                    : undefined
                }
                onResumeIntentHandled={handleResumeIntentHandled}
                restoreIntentToken={
                  ridingContent.intent?.kind === "restore"
                    ? ridingContent.intent.token
                    : undefined
                }
                onRestoredSessionMissing={handleRestoredSessionMissing}
                onStoredSessionKnown={handleStoredSessionKnown}
                mapFactory={mapFactory}
                onRidingActiveChange={handleRidingActiveChange}
                onNavigateToPlanning={handleNavigateToPlanning}
                onEditCopyDraftSaved={handleEditCopyDraftSaved}
                onRideFinalized={handleRideFinalized}
                onSessionGone={() => {
                  handleSessionGone(ridingContent);
                }}
                onReturnToRideLauncher={handleReturnToRideLauncher}
                onRidePaused={handleRidePaused}
                stickyHeaderRef={stickyHeaderRef}
              />
            ) : ridingContent.kind === "free-roam" ? (
              <FreeRoamScreen
                key={ridingContent.sessionId}
                sessionId={ridingContent.sessionId}
                mapFactory={mapFactory}
                onRidingActiveChange={handleRidingActiveChange}
                onRideFinalized={handleRideFinalized}
                onSessionGone={() => {
                  handleSessionGone(ridingContent);
                }}
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
                onSessionChecked={handleLauncherSessionChecked}
                staleNoticeRequested={launcherStaleNoticeRequested}
                onStaleNoticeRequestHandled={handleLauncherStaleNoticeRequestHandled}
              />
            ))}
          {screen === "planning" && (
            <PlanningScreen
              onNavigateToSettings={handleNavigateToSettings}
              onOpenSavedRoute={handleOpenSavedRoute}
              savedRouteSwitchPrompt={savedRouteSwitchPrompt}
              stickyHeaderRef={stickyHeaderRef}
            />
          )}
          {/* Backlog item 121: ONE slot for both of the Settings section's
            views, so SettingsSection stays mounted across a Settings ↔
            Status switch — which is what keeps an unfinished key edit and
            the switcher's focus — and unmounts on any other tab. Two
            separate slots would remount it on every switch. */}
          {isSettingsSectionView(screen) && (
            <SettingsSection
              view={screen}
              onSelectView={handleNavigate}
              stickyHeaderRef={stickyHeaderRef}
            />
          )}
        </main>
      </ScreenScrollContext.Provider>
    </div>
  );
}

export default App;
