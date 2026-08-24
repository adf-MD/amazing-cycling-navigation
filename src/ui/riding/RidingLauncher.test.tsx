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
import type { StoredRideState, StoredRouteRideState } from "../../storage/db.ts";

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
    let resolveRead: ((value: StoredRideState | undefined) => void) | undefined;
    const readSpy = vi.spyOn(rideStateRepository, "getActiveRideState").mockReturnValue(
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

    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking for an unfinished ride",
    );
    expect(screen.queryByRole("button", { name: "Choose a route" })).toBeNull();

    resolveRead?.(undefined);
    expect(
      await screen.findByRole("button", { name: "Choose a route" }),
    ).toBeInTheDocument();
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
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("End this ride?")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // The trigger genuinely unmounts while the confirmation is open
    // (backlog item 50's in-place confirmation morph), so the button
    // re-queried here is a freshly remounted DOM node, not the one captured
    // before the click.
    const restoredEndRideButton = screen.getByRole("button", { name: "End ride" });
    expect(restoredEndRideButton).toHaveFocus();
    expect(await getActiveRideState()).toBeDefined();

    await user.click(restoredEndRideButton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
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
    const dialog = await screen.findByRole("alertdialog");
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
    const dialog = await screen.findByRole("alertdialog");
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
    const dialog = await screen.findByRole("alertdialog");
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
    const dialog = await screen.findByRole("alertdialog");
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
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));

    const endRideButton = await screen.findByRole("button", { name: "End ride" });
    await user.click(endRideButton);
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "End ride" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The ride could not be ended on this device. Try again.",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await getActiveRideState()).toBeDefined();
    expect(screen.getByRole("button", { name: "End ride" })).toHaveFocus();

    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "End ride" }));
    const retryDialog = await screen.findByRole("alertdialog");
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
    const cancelDialog = await screen.findByRole("alertdialog");
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
      .spyOn(rideStateRepository, "clearActiveRideState")
      .mockRejectedValueOnce(new Error("boom"));
    await user.click(restoredDiscardButton);
    const failDialog = await screen.findByRole("alertdialog");
    await user.click(
      within(failDialog).getByRole("button", { name: "Discard unfinished ride" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This unfinished ride could not be discarded on this device. Try again.",
    );
    expect(await getActiveRideState()).toBeDefined();
    clearSpy.mockRestore();

    await user.click(screen.getByRole("button", { name: "Discard unfinished ride" }));
    const confirmDialog = await screen.findByRole("alertdialog");
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
      .spyOn(rideStateRepository, "getActiveRideState")
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
      const dialog = await screen.findByRole("alertdialog");
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
      const dialog = await screen.findByRole("alertdialog");
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
