import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RidingLauncher } from "./RidingLauncher.tsx";
import { db } from "../../storage/db.ts";
import {
  getActiveRideState,
  setActiveRideState,
} from "../../storage/rideStateRepository.ts";
import * as rideStateRepository from "../../storage/rideStateRepository.ts";
import * as routesRepository from "../../storage/routesRepository.ts";
import type { PlannedRoute } from "../../domain/types.ts";
import type { StoredRouteRideState } from "../../storage/db.ts";
import type { IdentifiedStoredRideState } from "../../storage/rideStateRepository.ts";
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";
import { createReadinessRecorder } from "../../test/screenScrollReadiness.tsx";

const route: PlannedRoute = {
  id: "route-1",
  name: "Evening loop",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    { coordinate: [-1.5, 53.8], elevationMetres: 10, distanceFromStartMetres: 0 },
    { coordinate: [-1.4, 53.8], elevationMetres: 12, distanceFromStartMetres: 12_500 },
  ],
  manoeuvres: [],
  distanceMetres: 12_500,
  ascentMetres: 120,
  descentMetres: 80,
  warnings: [],
  source: { kind: "gpx-import" },
};

// Typed as Partial<StoredRouteRideState>, not Partial<StoredRideState> — see
// rideStateRepository.test.ts's identical buildRideState helper for why
// TypeScript's Partial<> doesn't distribute over a union.
function buildRideState(
  overrides: Partial<StoredRouteRideState> = {},
): StoredRouteRideState {
  return {
    id: "active",
    routeId: route.id,
    startedAt: "2026-01-01T08:00:00.000Z",
    lastFix: { coordinate: [-1.45, 53.8], accuracyMetres: 6, timestampMs: 1000 },
    lastMatchedPointIndex: 1,
    matchedDistanceFromStartMetres: 6000,
    offRouteMachineState: { level: "on-route", candidateLevel: null, streak: 0 },
    ...overrides,
  };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RidingLauncher", () => {
  it("shows a restrained loading state before hydration resolves, never a premature 'no session' state", async () => {
    let resolveRead: ((value: IdentifiedStoredRideState | undefined) => void) | undefined;
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      );

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    // Since item 140 the launcher also holds a stable, empty polite region
    // for its notice, so the checking status is found by its text.
    expect(screen.getByText(/Checking for an unfinished ride/)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();

    resolveRead?.(undefined);
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    readSpy.mockRestore();
  });

  it("reports its content ready for scroll restoration only once the check has finished, never with the Checking line (backlog item 125)", async () => {
    let resolveRead: ((value: IdentifiedStoredRideState | undefined) => void) | undefined;
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      );
    const recorder = createReadinessRecorder("riding");

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
      { wrapper: recorder.wrapper },
    );

    expect(screen.getByText(/Checking for an unfinished ride/)).toBeInTheDocument();
    expect(recorder.reports).toEqual([false]);
    resolveRead?.(undefined);
    await screen.findByRole("button", { name: "Choose a route" });
    expect(recorder.reports).toEqual([false, true]);
    readSpy.mockRestore();
  });

  it("with no active row, shows both Choose a route and Start free roam", async () => {
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start free roam" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume free roam" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End ride" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard unfinished ride" })).toBeNull();
  });

  it("Choose a route calls onChooseRoute", async () => {
    const user = userEvent.setup();
    const onChooseRoute = vi.fn();
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={onChooseRoute}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Choose a route" }));
    expect(onChooseRoute).toHaveBeenCalledTimes(1);
  });

  it("with a resumable route session, shows the route and Resume ride/End ride, with no geolocation call", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const geolocationSpy = vi.fn();
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: geolocationSpy } });

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: route.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();
    expect(geolocationSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("Resume ride calls onResumeRoute with the resolved route object", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    const onResumeRoute = vi.fn();

    render(
      <RidingLauncher
        onResumeRoute={onResumeRoute}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Resume ride" }));
    expect(onResumeRoute).toHaveBeenCalledTimes(1);
    expect(onResumeRoute).toHaveBeenCalledWith(expect.objectContaining({ id: route.id }));
  });

  it("End-ride cancellation and Escape preserve the row and restore focus", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so the button
    // re-queried here is a freshly remounted DOM node, not the one captured
    // before the click.
    const restoredEndRideButton = screen.getByRole("button", { name: "End ride" });
    expect(restoredEndRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    await user.click(restoredEndRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();
  });

  it("the resumable-route End-ride confirmation replaces the trigger in its own panel slot, with Resume ride and route info staying visible (backlog item 50)", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    const { container } = render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "End ride" }));

    // .ride-launcher-clear-row is a persistent action-slot container: it
    // stays mounted and now contains the confirmation directly, rather than
    // the confirmation being appended elsewhere on the page.
    const clearRow = container.querySelector(".ride-launcher-clear-row");
    const dialog = await screen.findByRole("dialog");
    expect(clearRow).not.toBeNull();
    expect(clearRow?.contains(dialog)).toBe(true);
    // The trigger never coexists with the confirmation — the only
    // "End ride"-named button left anywhere is the dialog's own confirm
    // button.
    expect(screen.getAllByRole("button", { name: "End ride" })).toEqual([
      within(dialog).getByRole("button", { name: "End ride" }),
    ]);
    // The rest of the panel stays visible and unaffected.
    expect(screen.getByRole("heading", { name: route.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
  });

  it("the resumable-free-roam End-ride confirmation replaces the trigger in its own panel slot, with Resume free roam staying visible (backlog item 50)", async () => {
    await setActiveRideState({
      id: "active",
      kind: "free-roam",
      startedAt: "2026-01-01T08:00:00.000Z",
      lastFix: null,
    });
    const user = userEvent.setup();
    const { container } = render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "End ride" }));

    const clearRow = container.querySelector(".ride-launcher-clear-row");
    const dialog = await screen.findByRole("dialog");
    expect(clearRow).not.toBeNull();
    expect(clearRow?.contains(dialog)).toBe(true);
    expect(screen.getAllByRole("button", { name: "End ride" })).toEqual([
      within(dialog).getByRole("button", { name: "End ride" }),
    ]);
    expect(screen.getByRole("button", { name: "Resume free roam" })).toBeInTheDocument();
  });

  it("the unresumable Discard confirmation replaces the trigger in its own panel slot, with the explanation staying visible (backlog item 50)", async () => {
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    const { container } = render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Discard unfinished ride" }),
    );

    const clearRow = container.querySelector(".ride-launcher-clear-row");
    const dialog = await screen.findByRole("dialog");
    expect(clearRow).not.toBeNull();
    expect(clearRow?.contains(dialog)).toBe(true);
    expect(screen.getAllByRole("button", { name: "Discard unfinished ride" })).toEqual([
      within(dialog).getByRole("button", { name: "Discard unfinished ride" }),
    ]);
    expect(
      screen.getByText(
        "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed.",
      ),
    ).toBeInTheDocument();
  });

  it("confirming End ride clears the row and reverts to Choose a route", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
  });

  it("an End-ride storage failure preserves the row, shows a retryable accessible error, and retry succeeds", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideStateIfSession")
      .mockRejectedValueOnce(new Error("boom"));

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();

    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("dialog");
    await user.click(within(retryDialog).getByRole("button", { name: "End ride" }));
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
  });

  it("when the stored routeId no longer resolves, explains the problem and offers only Discard unfinished ride", async () => {
    // No matching db.routes row for this rideState — simulates a deleted route.
    await setActiveRideState(buildRideState());
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Discard unfinished ride" }),
    ).toBeInTheDocument();
  });

  it("Discard unfinished ride: cancel/failure preserve the row; confirmed success clears it", async () => {
    await setActiveRideState(buildRideState());
    const user = userEvent.setup();
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    const discardButton = await screen.findByRole("button", {
      name: "Discard unfinished ride",
    });
    await user.click(discardButton);
    const cancelDialog = await screen.findByRole("dialog");
    expect(
      within(cancelDialog).getByText("Discard unfinished ride?"),
    ).toBeInTheDocument();
    await user.click(within(cancelDialog).getByRole("button", { name: "Cancel" }));
    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so the button
    // re-queried here is a freshly remounted DOM node, not the one captured
    // before the click.
    const restoredDiscardButton = screen.getByRole("button", {
      name: "Discard unfinished ride",
    });
    expect(restoredDiscardButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    const clearSpy = vi
      .spyOn(rideStateRepository, "clearActiveRideStateIfSession")
      .mockRejectedValueOnce(new Error("boom"));
    await user.click(restoredDiscardButton);
    const failDialog = await screen.findByRole("dialog");
    await user.click(
      within(failDialog).getByRole("button", { name: "Discard unfinished ride" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This unfinished ride could not be discarded on this device. Try again.",
    );
    expect(await getActiveRideState()).toBeDefined();
    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "Discard unfinished ride" }));
    const confirmDialog = await screen.findByRole("dialog");
    await user.click(
      within(confirmDialog).getByRole("button", { name: "Discard unfinished ride" }),
    );
    await waitFor(async () => {
      expect(await getActiveRideState()).toBeUndefined();
    });
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
  });

  it("an unrecognised/unsupported session kind is treated as non-resumable, never as a valid route session", async () => {
    await db.routes.put(route);
    // A present-but-unrecognised kind — simulates a future app version's
    // row, or a corrupted one. Written directly, bypassing
    // toStoredRideState (which only ever writes "route" here). Deliberately
    // NOT "free-roam" — that's now a genuinely recognised kind (see the
    // "resumable free roam" tests below) and would no longer exercise the
    // unsupported-kind path this test claims to.
    await db.rideState.put({ ...buildRideState(), kind: "training-session" });

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(
        "This unfinished ride can't be recovered by this version of the app.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Discard unfinished ride" }),
    ).toBeInTheDocument();
  });

  it("a genuine read failure shows an accessible error and retry, never falsely 'no session'", async () => {
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockRejectedValueOnce(new Error("boom"));

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    );
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();

    readSpy.mockRestore();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
  });

  it("never calls getRoute for an unsupported-kind row", async () => {
    await db.routes.put(route);
    await db.rideState.put({ ...buildRideState(), kind: "training-session" });
    const getRouteSpy = vi.spyOn(routesRepository, "getRoute");

    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );

    await screen.findByRole("button", { name: "Discard unfinished ride" });
    expect(getRouteSpy).not.toHaveBeenCalled();
  });

  describe("Start/Resume free roam — presentational only (backlog item 73)", () => {
    // The write-before-callback ordering, the persistence-failure/retry
    // guarantee, and the storage-authoritative conflict guard have all
    // moved to App.tsx (see App.test.tsx's "Ride switch guard" tests) —
    // this component no longer touches storage for free roam at all. What
    // remains here is purely prop-driven presentation.

    it("Start free roam calls onStartFreeRoam", async () => {
      const user = userEvent.setup();
      const onStartFreeRoam = vi.fn();
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={onStartFreeRoam}
          onResumeFreeRoam={vi.fn()}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "Start free roam" }));
      expect(onStartFreeRoam).toHaveBeenCalledTimes(1);
    });

    it("isFreeRoamPending disables and relabels Start free roam", async () => {
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
          isFreeRoamPending
        />,
      );

      const button = await screen.findByRole("button", { name: "Starting…" });
      expect(button).toBeDisabled();
    });

    it("freeRoamError renders as an accessible alert near Start free roam", async () => {
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
          freeRoamError="Free roam could not be started on this device. Try again."
        />,
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Free roam could not be started on this device. Try again.",
      );
    });
  });

  describe("resumable free roam", () => {
    it("a genuine free-roam row resolves to Resume free roam/End ride, with no getRoute call", async () => {
      await setActiveRideState({
        id: "active",
        kind: "free-roam",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: { coordinate: [-1.45, 53.8], accuracyMetres: 6, timestampMs: 1000 },
      });
      const getRouteSpy = vi.spyOn(routesRepository, "getRoute");
      const onResumeFreeRoam = vi.fn();
      const user = userEvent.setup();

      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={onResumeFreeRoam}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Resume free roam" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "End ride" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();
      expect(getRouteSpy).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Resume free roam" }));
      expect(onResumeFreeRoam).toHaveBeenCalledTimes(1);
    });

    it("isFreeRoamPending disables and relabels Resume free roam", async () => {
      await setActiveRideState({
        id: "active",
        kind: "free-roam",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: null,
      });
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
          isFreeRoamPending
        />,
      );

      const button = await screen.findByRole("button", { name: "Resuming…" });
      expect(button).toBeDisabled();
    });

    it("the End-ride confirmation for a free-roam session does not mention a saved route", async () => {
      await setActiveRideState({
        id: "active",
        kind: "free-roam",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: null,
      });
      const user = userEvent.setup();
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "End ride" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();
      expect(within(dialog).queryByText(/saved route/i)).toBeNull();
    });

    it("confirming End ride for a free-roam session clears the row and reverts to the none state", async () => {
      await setActiveRideState({
        id: "active",
        kind: "free-roam",
        startedAt: "2026-01-01T08:00:00.000Z",
        lastFix: null,
      });
      const user = userEvent.setup();
      render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
        />,
      );

      await user.click(await screen.findByRole("button", { name: "End ride" }));
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "End ride" }));

      await waitFor(async () => {
        expect(await getActiveRideState()).toBeUndefined();
      });
      expect(
        await screen.findByRole("button", { name: "Choose a route" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Start free roam" })).toBeInTheDocument();
    });
  });

  describe("sessionRefreshToken (backlog item 73)", () => {
    it("a bumped sessionRefreshToken re-triggers hydration, reflecting a session cleared out from under it", async () => {
      await db.routes.put(route);
      await setActiveRideState(buildRideState());
      const { rerender } = render(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
          sessionRefreshToken={0}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Resume ride" }),
      ).toBeInTheDocument();

      // Simulate App.tsx having cleared the row itself (e.g. as part of a
      // confirmed different-session switch) without this component's own
      // knowledge — only the bumped token should cause it to notice.
      await db.rideState.clear();
      rerender(
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
          sessionRefreshToken={1}
        />,
      );

      expect(
        await screen.findByRole("button", { name: "Choose a route" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
    });
  });
});

// Backlog item 132: the launcher reports each completed check, so App can
// show a stored route ride's own paused screen on the first Ride entry
// after a cold start. Every outcome other than a resumable route reports
// null and renders exactly as before.
describe("RidingLauncher — onSessionChecked (backlog item 132)", () => {
  function renderLauncher(onSessionChecked: (route: PlannedRoute | null) => boolean) {
    return render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
        onSessionChecked={onSessionChecked}
      />,
    );
  }

  it("reports a resumable route once, and keeps its checking status, never its summary, when the owner takes over", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const onSessionChecked = vi.fn(() => true);

    renderLauncher(onSessionChecked);

    await waitFor(() => {
      expect(onSessionChecked).toHaveBeenCalledOnce();
    });
    expect(onSessionChecked).toHaveBeenCalledWith(
      expect.objectContaining({ id: route.id, name: route.name }),
    );
    // Sampled: the summary never appears while the owner replaces it.
    for (let sample = 0; sample < 5; sample += 1) {
      expect(screen.getByText(/Checking for an unfinished ride/)).toHaveAttribute(
        "role",
        "status",
      );
      expect(screen.queryByText("You have an unfinished ride on this route.")).toBeNull();
      expect(screen.queryByRole("button", { name: "Resume ride" })).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(onSessionChecked).toHaveBeenCalledOnce();
  });

  it("when the owner declines, renders the resumable route's summary exactly as before", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const onSessionChecked = vi.fn(() => false);

    renderLauncher(onSessionChecked);

    expect(
      await screen.findByText("You have an unfinished ride on this route."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeInTheDocument();
    expect(onSessionChecked).toHaveBeenCalledOnce();
  });

  it("reports null for no session, a free roam, a missing route and an unsupported kind, then renders each branch as before", async () => {
    const cases: { seed: () => Promise<unknown>; expectText: string }[] = [
      { seed: () => Promise.resolve(), expectText: "Choose a route" },
      {
        seed: () =>
          setActiveRideState({
            id: "active",
            kind: "free-roam",
            startedAt: "2026-01-01T08:00:00.000Z",
            lastFix: null,
          }),
        expectText: "Resume free roam",
      },
      {
        seed: () => setActiveRideState(buildRideState()),
        expectText: "Discard unfinished ride",
      },
      {
        seed: async () => {
          await db.routes.put(route);
          await db.rideState.put({ ...buildRideState(), kind: "training-session" });
        },
        expectText: "Discard unfinished ride",
      },
    ];
    for (const { seed, expectText } of cases) {
      await db.routes.clear();
      await db.rideState.clear();
      await seed();
      // Returning true for null must still never hide a branch.
      const onSessionChecked = vi.fn(() => true);
      const { unmount } = renderLauncher(onSessionChecked);
      expect(await screen.findByRole("button", { name: expectText })).toBeInTheDocument();
      expect(onSessionChecked).toHaveBeenCalledOnce();
      expect(onSessionChecked).toHaveBeenCalledWith(null);
      unmount();
    }
  });

  it("never reports a failed read; the Retry that succeeds reports", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState());
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockRejectedValueOnce(new Error("boom"));
    const onSessionChecked = vi.fn(() => false);

    renderLauncher(onSessionChecked);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    );
    expect(onSessionChecked).not.toHaveBeenCalled();

    readSpy.mockRestore();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(onSessionChecked).toHaveBeenCalledOnce();
    });
    expect(onSessionChecked).toHaveBeenCalledWith(
      expect.objectContaining({ id: route.id }),
    );
  });

  it("never reports a check that settles after the launcher has unmounted", async () => {
    await db.routes.put(route);
    let resolveRead: ((value: IdentifiedStoredRideState | undefined) => void) | undefined;
    vi.spyOn(rideStateRepository, "getActiveRideStateWithSessionId").mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const onSessionChecked = vi.fn(() => true);

    const { unmount } = renderLauncher(onSessionChecked);
    unmount();
    resolveRead?.({ ...buildRideState(), sessionId: "session-1" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onSessionChecked).not.toHaveBeenCalled();
  });
});

describe("RidingLauncher — a confirmation clears only the session it showed (backlog item 140)", () => {
  const STALE_NOTICE =
    "The previously shown ride had already ended or been replaced. Nothing was deleted.";

  function renderPlainLauncher() {
    return render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
      />,
    );
  }

  /** The visible notice and the polite region's text, both read. */
  function expectStaleNoticeShown(text = STALE_NOTICE) {
    const visible = screen
      .getAllByText(text)
      .filter((element) => element.classList.contains("status-row"));
    expect(visible).toHaveLength(1);
    expect(visible[0]).not.toHaveAttribute("role");
    const region = screen
      .getAllByRole("status")
      .filter((element) => element.classList.contains("visually-hidden"));
    expect(region).toHaveLength(1);
    expect(region[0]).toHaveTextContent(text);
    expect(region[0]).toHaveAttribute("aria-atomic", "true");
  }

  function expectNoStaleNotice() {
    expect(screen.queryByText(STALE_NOTICE)).toBeNull();
  }

  /** The stored row as `expected` plus an identity, every other field exact. */
  async function expectStoredWithIdentity(expected: object): Promise<string> {
    const stored = await getActiveRideState();
    if (!stored) throw new Error("expected a stored row");
    const { sessionId, ...rest } = stored;
    expect(rest).toEqual(expected);
    if (typeof sessionId !== "string") throw new Error("expected an identity");
    return sessionId;
  }

  it("gives a stored row without an identity one when it reads it, keeps every other field, and End ride still clears it", async () => {
    await db.routes.put(route);
    const legacy = buildRideState();
    await setActiveRideState(legacy);
    const user = userEvent.setup();
    renderPlainLauncher();

    await screen.findByRole("button", { name: "End ride" });
    await expectStoredWithIdentity(legacy);

    await user.click(screen.getByRole("button", { name: "End ride" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "End ride" }),
    );

    expect(await screen.findByRole("button", { name: "Choose a route" })).toBeVisible();
    await expect(getActiveRideState()).resolves.toBeUndefined();
    expectNoStaleNotice();
  });

  it("a confirmed Discard clears an unsupported session, which is given an identity like any other", async () => {
    const unsupported = { ...buildRideState(), kind: "training-session" };
    await db.rideState.put(unsupported);
    const user = userEvent.setup();
    renderPlainLauncher();

    await user.click(
      await screen.findByRole("button", { name: "Discard unfinished ride" }),
    );
    await expectStoredWithIdentity(unsupported);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Discard unfinished ride",
      }),
    );

    expect(await screen.findByRole("button", { name: "Choose a route" })).toBeVisible();
    await expect(getActiveRideState()).resolves.toBeUndefined();
    expectNoStaleNotice();
  });

  it("End ride for a session replaced by a newer one on the same route deletes nothing, shows the newer session and says so, moving no focus", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));
    const user = userEvent.setup();
    renderPlainLauncher();

    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    // Another window ends that ride and starts a new one on the same route.
    const newer = buildRideState({
      sessionId: "session-2",
      startedAt: "2026-01-01T09:00:00.000Z",
      matchedDistanceFromStartMetres: 0,
    });
    await setActiveRideState(newer);
    expectNoStaleNotice();

    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(() => {
      expectStaleNoticeShown();
    });
    await expect(getActiveRideState()).resolves.toEqual(newer);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("You have an unfinished ride on this route.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume ride" })).toBeVisible();
    expect(screen.getByRole("button", { name: "End ride" })).toBeVisible();
    expect(document.body).toHaveFocus();

    // Opening a new confirmation clears the notice; it is for the newer
    // session and clears it.
    await user.click(screen.getByRole("button", { name: "End ride" }));
    expectNoStaleNotice();
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "End ride" }),
    );
    expect(await screen.findByRole("button", { name: "Choose a route" })).toBeVisible();
    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  it("Discard for an unsupported session replaced by an identical one without an identity deletes nothing, and offers Discard for the replacement", async () => {
    const unsupported = { ...buildRideState(), kind: "training-session" };
    await db.rideState.put(unsupported);
    const user = userEvent.setup();
    renderPlainLauncher();

    await user.click(
      await screen.findByRole("button", { name: "Discard unfinished ride" }),
    );
    const presented = await getActiveRideState();
    const presentedSessionId = presented?.sessionId;
    expect(presentedSessionId).toEqual(expect.any(String));
    // Another window rewrites the row without an identity, every other
    // field identical to the one shown.
    await db.rideState.put(unsupported);

    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Discard unfinished ride",
      }),
    );

    await waitFor(() => {
      expectStaleNoticeShown();
    });
    const replacementSessionId = await expectStoredWithIdentity(unsupported);
    expect(replacementSessionId).not.toBe(presentedSessionId);
    expect(screen.getByRole("button", { name: "Discard unfinished ride" })).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("End ride for a session that has gone shows the empty launcher and says nothing was deleted", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));
    const user = userEvent.setup();
    renderPlainLauncher();

    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    await db.rideState.clear();
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    await waitFor(() => {
      expectStaleNoticeShown();
    });
    expect(screen.getByRole("button", { name: "Choose a route" })).toBeVisible();
    await expect(getActiveRideState()).resolves.toBeUndefined();
  });

  it("when the re-read after a refused confirmation fails, shows the existing check failure and no notice, and Retry shows the stored state without one", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));
    const user = userEvent.setup();
    renderPlainLauncher();

    await user.click(await screen.findByRole("button", { name: "End ride" }));
    const dialog = await screen.findByRole("dialog");
    const newer = buildRideState({ sessionId: "session-2" });
    await setActiveRideState(newer);
    const readSpy = vi
      .spyOn(rideStateRepository, "getActiveRideStateWithSessionId")
      .mockRejectedValueOnce(new Error("synthetic re-read failure"));

    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    );
    expect(readSpy).toHaveBeenCalledOnce();
    expectNoStaleNotice();
    await expect(getActiveRideState()).resolves.toEqual(newer);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Resume ride" })).toBeVisible();
    expectNoStaleNotice();
    await expect(getActiveRideState()).resolves.toEqual(newer);
  });

  it("says nothing was deleted in German", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState({ sessionId: "session-1" }));
    const user = userEvent.setup();
    render(
      <LanguageProvider
        preference="de"
        readLanguages={() => ["de-DE"]}
        documentElement={{ lang: "" }}
      >
        <RidingLauncher
          onResumeRoute={vi.fn()}
          onChooseRoute={vi.fn()}
          onStartFreeRoam={vi.fn()}
          onResumeFreeRoam={vi.fn()}
        />
      </LanguageProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Fahrt beenden" }));
    const dialog = await screen.findByRole("dialog");
    await setActiveRideState(buildRideState({ sessionId: "session-2" }));
    await user.click(within(dialog).getByRole("button", { name: "Fahrt beenden" }));

    await waitFor(() => {
      expectStaleNoticeShown(
        "Die zuvor angezeigte Fahrt war bereits beendet oder ersetzt worden. Es wurde nichts gelöscht.",
      );
    });
  });
});

describe("RidingLauncher — a notice requested by a riding screen's hand-back (backlog item 140)", () => {
  const STALE_NOTICE =
    "The previously shown ride had already ended or been replaced. Nothing was deleted.";

  function renderRequested(onHandled = vi.fn()) {
    render(
      <RidingLauncher
        onResumeRoute={vi.fn()}
        onChooseRoute={vi.fn()}
        onStartFreeRoam={vi.fn()}
        onResumeFreeRoam={vi.fn()}
        staleNoticeRequested
        onStaleNoticeRequestHandled={onHandled}
      />,
    );
    return onHandled;
  }

  it("shows the notice with what is stored once the launcher's own read has succeeded, and reports the request handled once", async () => {
    await db.routes.put(route);
    await setActiveRideState(buildRideState({ sessionId: "session-newer" }));

    const onHandled = renderRequested();

    expect(await screen.findByRole("button", { name: "Resume ride" })).toBeVisible();
    const visible = screen
      .getAllByText(STALE_NOTICE)
      .filter((element) => element.classList.contains("status-row"));
    expect(visible).toHaveLength(1);
    expect(
      screen
        .getAllByRole("status")
        .filter((element) => element.textContent === STALE_NOTICE),
    ).toHaveLength(1);
    expect(onHandled).toHaveBeenCalledOnce();
  });

  it("after a failed read shows the existing check failure and no notice, and Retry brings none", async () => {
    vi.spyOn(
      rideStateRepository,
      "getActiveRideStateWithSessionId",
    ).mockRejectedValueOnce(new Error("synthetic read failure"));

    renderRequested();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your unfinished ride status could not be checked. Nothing has been changed.",
    );
    expect(screen.queryByText(STALE_NOTICE)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Choose a route" })).toBeVisible();
    expect(screen.queryByText(STALE_NOTICE)).toBeNull();
  });
});
