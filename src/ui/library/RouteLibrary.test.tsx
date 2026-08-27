import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteLibrary, type PendingRouteSwitch } from "./RouteLibrary.tsx";
import type { PlannedRoute } from "../../domain/types.ts";
import type { Clock } from "../../platform/clock.ts";
import { db } from "../../storage/db.ts";
import * as routeLibraryPreferencesRepository from "../../storage/routeLibraryPreferencesRepository.ts";
import * as routesRepository from "../../storage/routesRepository.ts";
import { multiTrackGpx, trackWithElevationGpx } from "../../test/fixtures/gpx.ts";

function getVisibleRouteNames(): string[] {
  return Array.from(document.querySelectorAll(".route-card-title")).map(
    (element) => element.textContent,
  );
}

type SteppingClock = Clock & { advance: (ms: number) => void };

/** A Clock whose `now()` can be advanced between calls, so tests can prove
 * a deterministic pin order without depending on real clicks landing in
 * different wall-clock milliseconds. */
function buildSteppingClock(startIso: string): SteppingClock {
  let currentMs = Date.parse(startIso);
  return {
    now: () => currentMs,
    advance(ms: number) {
      currentMs += ms;
    },
  };
}

function buildGpxFile(name: string, content: string): File {
  return new File([content], name, { type: "application/gpx+xml" });
}

async function importFixture(
  user: ReturnType<typeof userEvent.setup>,
  name = "Evening Ride.gpx",
) {
  const file = buildGpxFile(name, trackWithElevationGpx);
  const expectedName = name.replace(/\.gpx$/i, "");
  await user.upload(screen.getByLabelText("Import GPX file"), file);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: expectedName })).toBeInTheDocument();
  });
}

function getListItemByRouteId(id: string): HTMLElement {
  const item = document.querySelector(`[data-route-id="${id}"]`);
  if (!(item instanceof HTMLElement)) {
    throw new Error(`No list item found for route id ${id}`);
  }
  return item;
}

/** Builds a complete PendingRouteSwitch bundle (backlog item 73 follow-up)
 * with fresh vi.fn() handlers by default — mirrors the discriminated,
 * complete-contract shape App.tsx actually builds. */
function buildPendingRouteSwitch(
  routeId: string,
  overrides: Partial<PendingRouteSwitch> = {},
): PendingRouteSwitch {
  return {
    routeId,
    title: 'Switch to "Route B"?',
    message: '"Route A" is paused. Return to it, or end it and switch to "Route B".',
    confirmLabel: "End and switch",
    confirmVariant: "danger",
    offerReturn: true,
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onReturn: vi.fn(),
    onTargetMissing: vi.fn(),
    ...overrides,
  };
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  await db.routeLibraryPreferences.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteLibrary", () => {
  it("shows an empty state before any route is imported, with no search/sort toolbar", async () => {
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Search routes")).toBeNull();
    expect(screen.queryByLabelText("Sort by")).toBeNull();
  });

  it("imports a GPX file and lists it with its distance", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    await importFixture(user);

    expect(screen.getByText(/km/)).toBeInTheDocument();
  });

  it("surfaces a notice when a multi-track file only imports the first track", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    const file = buildGpxFile("multi.gpx", multiTrackGpx);
    await user.upload(screen.getByLabelText("Import GPX file"), file);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/2 tracks/);
    });
  });

  it("shows an explicit error for an invalid file without adding a route", async () => {
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => screen.getByText(/no routes saved yet/i));

    // The input's accept=".gpx" is only a picker hint (userEvent.upload
    // itself enforces it, so it can't be used to reach this path) — this
    // exercises the app's own validateGpxFile defence-in-depth for a file
    // that reaches the change handler despite that hint, e.g. a renamed
    // extension.
    const file = buildGpxFile("notes.txt", trackWithElevationGpx);
    const input = screen.getByLabelText("Import GPX file");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
  });

  it("renames a route through the list item", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Route name");
    await user.clear(input);
    await user.type(input, "Renamed loop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renamed loop" })).toBeInTheDocument();
    });
  });

  it("renaming one of two routes leaves the other route's own list item and actions untouched, with no stray list item", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    await importFixture(user, "Second Ride.gpx");
    const [routeA, routeB] = (await routesRepository.listRoutes()) as [
      PlannedRoute,
      PlannedRoute,
    ];

    await user.click(
      within(getListItemByRouteId(routeB.id)).getByRole("button", { name: "Rename" }),
    );
    const input = within(getListItemByRouteId(routeB.id)).getByLabelText("Route name");
    await user.clear(input);
    await user.type(input, "Renamed second");
    await user.click(
      within(getListItemByRouteId(routeB.id)).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(
        within(getListItemByRouteId(routeB.id)).getByRole("button", {
          name: "Renamed second",
        }),
      ).toBeInTheDocument();
    });

    const itemA = getListItemByRouteId(routeA.id);
    expect(itemA).toHaveClass("route-card");
    expect(within(itemA).getByRole("button", { name: routeA.name })).toBeInTheDocument();
    expect(within(itemA).getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(within(itemA).getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(within(itemA).getByRole("button", { name: "Delete" })).toBeInTheDocument();

    // No stray <li> anywhere in the document beyond the two known routes —
    // the old bare, detached rename <li> would have shown up as a third.
    expect(document.querySelectorAll("li")).toHaveLength(2);
  });

  it("opens a route when its name is clicked", async () => {
    const user = userEvent.setup();
    const onOpenRoute = vi.fn();
    render(<RouteLibrary onOpenRoute={onOpenRoute} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Evening Ride" }));

    expect(onOpenRoute).toHaveBeenCalledOnce();
    const [openedRoute] = onOpenRoute.mock.calls[0] as [{ name: string }];
    expect(openedRoute.name).toBe("Evening Ride");
  });

  it("exports a route by triggering a file download", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock"),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);

    await user.click(screen.getByRole("button", { name: "Export" }));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalledOnce();
    });

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  describe("search", () => {
    it("filters the rendered list by name, case- and diacritic-insensitively", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Hütte Loop.gpx");

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "HUTTE");

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Hütte Loop" })).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
    });

    it("clearing search restores the full list", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
      });

      await user.click(screen.getByRole("button", { name: "Clear search" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
      });
      expect(search).toHaveValue("");
    });

    it("shows a distinct no-match message rather than the empty-library message", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "mountain");

      await waitFor(() => {
        expect(screen.getByText("No routes match “mountain”.")).toBeInTheDocument();
      });
      expect(screen.queryByText(/no routes saved yet/i)).toBeNull();
    });
  });

  describe("sort", () => {
    it("Most recent is the default order", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
      });
      expect(screen.getByLabelText("Sort by")).toHaveValue("most-recent");
    });

    it("changing the sort order reorders the rendered route cards", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
      });

      await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");

      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
      });
    });

    it("the sort choice persists across a remount, reading from IndexedDB rather than local state", async () => {
      const user = userEvent.setup();
      const first = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
      });
      first.unmount();

      render(<RouteLibrary onOpenRoute={vi.fn()} />);

      await waitFor(() => {
        expect(screen.getByLabelText("Sort by")).toHaveValue("name-asc");
      });
      expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
    });

    it("shows a transient Saving indicator while a sort-preference write is in flight, then clears it", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      let resolveSave: () => void = () => undefined;
      const deferred = new Promise<void>((resolve) => {
        resolveSave = resolve;
      });
      vi.spyOn(
        routeLibraryPreferencesRepository,
        "saveRouteLibraryPreferences",
      ).mockReturnValue(deferred);

      await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");

      await waitFor(() => {
        expect(screen.getByText("Saving…")).toBeInTheDocument();
      });

      resolveSave();

      await waitFor(() => {
        expect(screen.queryByText("Saving…")).toBeNull();
      });
    });

    it("shows an inline error and reverts to the last-persisted value when saving a sort preference fails", async () => {
      const user = userEvent.setup();
      vi.spyOn(
        routeLibraryPreferencesRepository,
        "saveRouteLibraryPreferences",
      ).mockRejectedValueOnce(new Error("Save failed."));
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      const sortSelect = screen.getByLabelText("Sort by");
      await user.selectOptions(sortSelect, "name-asc");

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "This preference could not be saved on this device. Try again.",
        );
      });
      await waitFor(() => {
        expect(sortSelect).toHaveValue("most-recent");
      });
    });

    it("shows Loading until both routes and the sort preference have resolved, never a flash of the wrong order", async () => {
      const user = userEvent.setup();
      const seeding = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);
      seeding.unmount();

      let resolvePreferences: (value: { sortOrder: "most-recent" }) => void = () =>
        undefined;
      const deferred = new Promise<{ sortOrder: "most-recent" }>((resolve) => {
        resolvePreferences = resolve;
      });
      vi.spyOn(
        routeLibraryPreferencesRepository,
        "getRouteLibraryPreferences",
      ).mockReturnValue(deferred);

      render(<RouteLibrary onOpenRoute={vi.fn()} />);

      expect(screen.getByText(/loading routes/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Evening Ride" })).toBeNull();
      expect(screen.queryByLabelText("Sort by")).toBeNull();

      resolvePreferences({ sortOrder: "most-recent" });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();
      });
    });
  });

  describe("focus adaptations under an active search filter", () => {
    it("deleting the last route visible under an active search filter focuses the search input, not the heading", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(screen.getByText("No routes match “alpine”.")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByLabelText("Search routes")).toHaveFocus();
      });
    });

    it("renaming a route out of the active filter moves focus to the next surviving visible route", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Ridge.gpx");
      await importFixture(user, "Alpine Climb.gpx");
      // listRoutes() returns newest-first, and Alpine Climb was imported
      // last (more recent), so it's index 0.
      const [climbRoute, ridgeRoute] = (await routesRepository.listRoutes()) as [
        PlannedRoute,
        PlannedRoute,
      ];

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Alpine Ridge"]);
      });

      // Alpine Climb (climbRoute) is imported later, so it renders first
      // under the default Most recent order.
      await user.click(
        within(getListItemByRouteId(climbRoute.id)).getByRole("button", {
          name: "Rename",
        }),
      );
      const input = within(getListItemByRouteId(climbRoute.id)).getByLabelText(
        "Route name",
      );
      await user.clear(input);
      await user.type(input, "Mountain Pass");
      await user.click(
        within(getListItemByRouteId(climbRoute.id)).getByRole("button", { name: "Save" }),
      );

      await waitFor(() => {
        expect(document.querySelector(`[data-route-id="${climbRoute.id}"]`)).toBeNull();
      });
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(ridgeRoute.id)).getByRole("button", {
            name: "Alpine Ridge",
          }),
        ).toHaveFocus();
      });
    });

    it("renaming the only route matching the active filter moves focus to the search field", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Rename" }));
      const input = screen.getByLabelText("Route name");
      await user.clear(input);
      await user.type(input, "Mountain Pass");
      await user.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(screen.getByText("No routes match “alpine”.")).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByLabelText("Search routes")).toHaveFocus();
      });
    });

    it("an intervening unrelated re-render does not drop the pending rename-focus marker before the write lands", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Ridge.gpx");
      await importFixture(user, "Alpine Climb.gpx");
      // listRoutes() returns newest-first, and Alpine Climb was imported
      // last (more recent), so it's index 0.
      const [climbRoute, ridgeRoute] = (await routesRepository.listRoutes()) as [
        PlannedRoute,
        PlannedRoute,
      ];

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Alpine Ridge"]);
      });

      let resolveRename: () => void = () => undefined;
      const renameHeld = new Promise<void>((resolve) => {
        resolveRename = resolve;
      });
      vi.spyOn(routesRepository, "renameRoute").mockImplementation(
        async (id: string, name: string) => {
          await renameHeld;
          await db.routes.update(id, { name });
        },
      );

      await user.click(
        within(getListItemByRouteId(climbRoute.id)).getByRole("button", {
          name: "Rename",
        }),
      );
      const input = within(getListItemByRouteId(climbRoute.id)).getByLabelText(
        "Route name",
      );
      await user.clear(input);
      await user.type(input, "Mountain Pass");
      await user.click(
        within(getListItemByRouteId(climbRoute.id)).getByRole("button", { name: "Save" }),
      );
      // The rename's own write is still held pending. Force an unrelated,
      // routes-driven re-render — a different route's pin — before it
      // lands: pre-fix, this alone would silently discard the pending
      // rename-focus marker, since the consuming effect nulled it on any
      // viewRoutes/routes-changing render, not only the one caused by
      // this rename's own write.
      await user.click(
        within(getListItemByRouteId(ridgeRoute.id)).getByRole("button", {
          name: "Pin Alpine Ridge",
        }),
      );
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(ridgeRoute.id)).getByRole("button", {
            name: "Unpin Alpine Ridge",
          }),
        ).toBeInTheDocument();
      });

      // Now let the rename's own write land.
      resolveRename();

      await waitFor(() => {
        expect(document.querySelector(`[data-route-id="${climbRoute.id}"]`)).toBeNull();
      });
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(ridgeRoute.id)).getByRole("button", {
            name: "Alpine Ridge",
          }),
        ).toHaveFocus();
      });
    });
  });

  describe("deleting a route", () => {
    it("shows the confirmation inline inside the route's own list item, not as a detached dialog", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));

      const [route] = (await db.routes.toArray()) as [PlannedRoute];
      const listItem = getListItemByRouteId(route.id);
      expect(within(listItem).getByRole("alertdialog")).toBeInTheDocument();
      expect(within(listItem).getByText("Delete “Evening Ride”?")).toBeInTheDocument();
    });

    it("cancelling leaves the route, closes the confirmation and returns focus to the Delete button", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });

    it("Escape performs the same cancellation", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    });

    it("confirms deletion, calls deleteRoute exactly once, and the live list removes the route", async () => {
      const user = userEvent.setup();
      const deleteSpy = vi.spyOn(routesRepository, "deleteRoute");
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);
      const [route] = (await db.routes.toArray()) as [PlannedRoute];

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
      });
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith(route.id);
    });

    it("repeated clicks cannot invoke deleteRoute twice while deletion is pending", async () => {
      const user = userEvent.setup();
      const deleteSpy = vi.spyOn(routesRepository, "deleteRoute");
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      const confirmButton = screen.getByRole("button", { name: "Delete route" });
      // fireEvent (not userEvent) so a second dispatch is attempted even
      // though the button becomes disabled synchronously after the first
      // click's state update — proving the disabled state, not test
      // timing, is what prevents a second invocation.
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      await waitFor(() => {
        expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
      });
      expect(deleteSpy).toHaveBeenCalledTimes(1);
    });

    it("opening a second route's delete confirmation replaces the first", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "First Ride.gpx");
      await importFixture(user, "Second Ride.gpx");
      const [routeA, routeB] = (await routesRepository.listRoutes()) as [
        PlannedRoute,
        PlannedRoute,
      ];

      await user.click(
        within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
      );
      expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

      await user.click(
        within(getListItemByRouteId(routeB.id)).getByRole("button", { name: "Delete" }),
      );

      const dialogs = screen.getAllByRole("alertdialog");
      expect(dialogs).toHaveLength(1);
      expect(
        within(getListItemByRouteId(routeB.id)).getByRole("alertdialog"),
      ).toBeInTheDocument();
      expect(
        within(getListItemByRouteId(routeA.id)).queryByRole("alertdialog"),
      ).toBeNull();
    });

    it("deleting one of two routes moves focus to the next surviving route's name button", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "First Ride.gpx");
      await importFixture(user, "Second Ride.gpx");
      const [topRoute, bottomRoute] = (await routesRepository.listRoutes()) as [
        PlannedRoute,
        PlannedRoute,
      ];

      await user.click(
        within(getListItemByRouteId(topRoute.id)).getByRole("button", { name: "Delete" }),
      );
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(document.querySelector(`[data-route-id="${topRoute.id}"]`)).toBeNull();
      });
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(bottomRoute.id)).getByRole("button", {
            name: bottomRoute.name,
          }),
        ).toHaveFocus();
      });
    });

    it("deleting the last of two routes moves focus to the previous surviving route's name button", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "First Ride.gpx");
      await importFixture(user, "Second Ride.gpx");
      const [topRoute, bottomRoute] = (await routesRepository.listRoutes()) as [
        PlannedRoute,
        PlannedRoute,
      ];

      await user.click(
        within(getListItemByRouteId(bottomRoute.id)).getByRole("button", {
          name: "Delete",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(document.querySelector(`[data-route-id="${bottomRoute.id}"]`)).toBeNull();
      });
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(topRoute.id)).getByRole("button", {
            name: topRoute.name,
          }),
        ).toHaveFocus();
      });
    });

    it("deleting the only remaining route moves focus to the Routes heading", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
      });
      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Routes" })).toHaveFocus();
      });
    });

    it("shows an inline error and keeps the confirmation open when deletion fails, allowing cancel or retry", async () => {
      const user = userEvent.setup();
      vi.spyOn(routesRepository, "deleteRoute").mockRejectedValueOnce(
        new Error("Delete failed."),
      );
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user);

      await user.click(screen.getByRole("button", { name: "Delete" }));
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent("Delete failed.");
      });
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Evening Ride" })).toBeInTheDocument();

      // Recoverable without reopening: the confirmation stayed open after
      // the failure, so retrying now hits the real implementation
      // (mockRejectedValueOnce only overrides the first call).
      await user.click(screen.getByRole("button", { name: "Delete route" }));
      await waitFor(() => {
        expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
      });
    });
  });

  describe("pinning", () => {
    it("shows one continuous list, with no group headings, when nothing is pinned", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      expect(document.querySelectorAll("h2")).toHaveLength(0);
      expect(document.querySelectorAll(".route-list")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Pin Alpine Climb" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("pinning a route moves it above the unpinned routes, in one continuous list", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Unpin Zebra Loop" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      expect(document.querySelectorAll("h2")).toHaveLength(0);
      expect(document.querySelectorAll(".route-list")).toHaveLength(1);
      expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
    });

    it("pinning a second route places it above the first, using a deterministic clock rather than real click timing", async () => {
      const user = userEvent.setup();
      const clock = buildSteppingClock("2026-02-01T09:00:00.000Z");
      render(<RouteLibrary onOpenRoute={vi.fn()} clock={clock} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      clock.advance(1000);
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));

      // Both routes are pinned at this point, so the full flattened order
      // already is the pinned order — no separate sublist to locate.
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
      });
    });

    it("changing the sort order reorders only the unpinned routes, leaving pinned order unchanged", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      // Import order (oldest -> newest): Mountain Pass, Alpine Climb, Zebra
      // Loop. Mountain Pass is pinned; the remaining unpinned pair (Alpine
      // Climb, Zebra Loop) genuinely orders differently under Most recent
      // (Zebra Loop is newer, so first) vs Name A-Z (Alpine Climb first) —
      // mirroring the plain, unpinned "changing the sort order..." test
      // above, so this test actually proves a reorder happened rather than
      // two orders that coincide.
      await importFixture(user, "Mountain Pass.gpx");
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Mountain Pass" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Mountain Pass" }),
        ).toHaveAttribute("aria-pressed", "true");
      });
      expect(getVisibleRouteNames()).toEqual([
        "Mountain Pass",
        "Zebra Loop",
        "Alpine Climb",
      ]);

      await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");

      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual([
          "Mountain Pass",
          "Alpine Climb",
          "Zebra Loop",
        ]);
      });
    });

    it("unpinning returns a route to its correct position among unpinned routes", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Zebra Loop" }),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: "Unpin Zebra Loop" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Pin Zebra Loop" })).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });
      expect(document.querySelectorAll("h2")).toHaveLength(0);
      expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
    });

    it("pinning a route again after unpinning makes it the newest pinned route", async () => {
      const user = userEvent.setup();
      const clock = buildSteppingClock("2026-02-01T09:00:00.000Z");
      render(<RouteLibrary onOpenRoute={vi.fn()} clock={clock} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toBeInTheDocument();
      });
      clock.advance(1000);
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Zebra Loop" }),
        ).toBeInTheDocument();
      });
      clock.advance(1000);
      await user.click(screen.getByRole("button", { name: "Unpin Alpine Climb" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Pin Alpine Climb" }),
        ).toBeInTheDocument();
      });
      clock.advance(1000);

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));

      // Both routes are pinned at this point, so the full flattened order
      // already is the pinned order — no separate sublist to locate.
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
      });
    });

    it("search filters across pinned and unpinned routes", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
      });

      const search = screen.getByLabelText("Search routes");
      await user.type(search, "alpine");

      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual(["Alpine Climb"]);
      });
      expect(document.querySelectorAll("h2")).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });

    it("successful pin/unpin restores focus to the route's own toggle at its new position", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Unpin Alpine Climb" })).toHaveFocus();
      });
    });

    it("pinning a route while both pinned and unpinned routes already exist keeps focus on its own toggle", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toBeInTheDocument();
      });

      // Pinned (Alpine Climb) and unpinned (Zebra Loop) are both non-empty;
      // pinning Zebra Loop moves it from the unpinned tail to the front of
      // the pinned group, crossing a boundary that used to sit between two
      // separate <ul> parents.
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Unpin Zebra Loop" })).toHaveFocus();
      });
      expect(getVisibleRouteNames()).toEqual(["Zebra Loop", "Alpine Climb"]);
    });

    it("unpinning a route while both pinned and unpinned routes remain keeps focus on its own toggle", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Zebra Loop" }),
        ).toBeInTheDocument();
      });

      // Both routes are pinned; unpinning Zebra Loop moves it out of the
      // still-non-empty pinned group (Alpine Climb remains) into the
      // unpinned tail.
      await user.click(screen.getByRole("button", { name: "Unpin Zebra Loop" }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Pin Zebra Loop" })).toHaveFocus();
      });
      expect(getVisibleRouteNames()).toEqual(["Alpine Climb", "Zebra Loop"]);
    });

    it("a pin write that resolves while an unrelated delete is in flight is not stranded once the delete settles", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Delete Me.gpx");
      await importFixture(user, "Pin Me.gpx");
      const allRoutes = await routesRepository.listRoutes();
      const deleteTarget = allRoutes.find((route) => route.name === "Delete Me");
      const pinTarget = allRoutes.find((route) => route.name === "Pin Me");
      if (!deleteTarget || !pinTarget) throw new Error("fixture routes not found");

      // Both writes are held on deferred promises so this test controls
      // the exact interleaving deterministically, rather than depending
      // on real IndexedDB timing.
      let resolvePinWrite: () => void = () => undefined;
      const pinWriteHeld = new Promise<void>((resolve) => {
        resolvePinWrite = resolve;
      });
      vi.spyOn(routesRepository, "pinRoute").mockImplementation(async (id: string) => {
        await pinWriteHeld;
        await db.routes.update(id, { pinnedAt: new Date().toISOString() });
      });

      let resolveDeleteWrite: () => void = () => undefined;
      const deleteWriteHeld = new Promise<void>((resolve) => {
        resolveDeleteWrite = resolve;
      });
      vi.spyOn(routesRepository, "deleteRoute").mockImplementation(async (id: string) => {
        await db.routes.delete(id); // real write: the live query still reacts.
        await deleteWriteHeld; // holds the caller's own .then() (isDeleting=false) back.
      });

      // Start the pin write first, while the toggle is still enabled
      // (isDeleting is still false) — the pin toggle becomes disabled the
      // instant an unrelated delete starts (isDeleting is a single flag
      // shared by every row), so the pin click must happen before that.
      await user.click(
        within(getListItemByRouteId(pinTarget.id)).getByRole("button", {
          name: `Pin ${pinTarget.name}`,
        }),
      );

      // Now start an unrelated delete on a different route — this sets
      // isDeleting=true synchronously, before the pin write above has any
      // chance to resolve.
      await user.click(
        within(getListItemByRouteId(deleteTarget.id)).getByRole("button", {
          name: "Delete",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      // Let the pin write land while isDeleting is still true — its own
      // .then() sets the pending-focus marker, but the toggle stays
      // disabled for a reason (isDeleting) the pre-fix dependency array
      // never observed.
      resolvePinWrite();
      await waitFor(() => {
        expect(
          within(getListItemByRouteId(pinTarget.id)).getByRole("button", {
            name: `Unpin ${pinTarget.name}`,
          }),
        ).toBeDisabled();
      });

      // Now let the unrelated delete settle, clearing isDeleting with no
      // accompanying groups/pinPendingIds change.
      resolveDeleteWrite();

      await waitFor(() => {
        expect(
          within(getListItemByRouteId(pinTarget.id)).getByRole("button", {
            name: `Unpin ${pinTarget.name}`,
          }),
        ).toHaveFocus();
      });
    });

    it("a failed pin write keeps the previous order and shows an inline error", async () => {
      const user = userEvent.setup();
      vi.spyOn(routesRepository, "pinRoute").mockRejectedValueOnce(
        new Error("Pin failed."),
      );
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "This route could not be pinned. Try again.",
        );
      });
      expect(document.querySelectorAll("h2")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Pin Alpine Climb" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("duplicate rapid clicks cannot invoke pinRoute twice while a write is pending", async () => {
      const pinSpy = vi.spyOn(routesRepository, "pinRoute");
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      const button = screen.getByRole("button", { name: "Pin Alpine Climb" });
      // fireEvent (not userEvent) so a second dispatch is attempted even
      // though the button becomes disabled synchronously after the first
      // click's state update — proving the disabled state, not test
      // timing, is what prevents a second invocation (mirrors the
      // equivalent delete-button test above).
      fireEvent.click(button);
      fireEvent.click(button);

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toBeInTheDocument();
      });
      expect(pinSpy).toHaveBeenCalledTimes(1);
    });

    it("clicking pin while this route's delete confirmation is open cancels the confirmation first", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await user.click(screen.getByRole("button", { name: "Delete" }));
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Pin Alpine Climb" }));

      expect(screen.queryByRole("alertdialog")).toBeNull();
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Alpine Climb" }),
        ).toBeInTheDocument();
      });
    });

    it("deletion focus uses the full displayed pinned-then-unpinned order", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await user.click(screen.getByRole("button", { name: "Pin Zebra Loop" }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Unpin Zebra Loop" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      });
      const [climbRoute] = (await routesRepository.listRoutes()).filter(
        (route) => route.name === "Alpine Climb",
      );
      if (!climbRoute) throw new Error("Alpine Climb route not found");

      // Deleting the sole "Other routes" entry (the last displayed route,
      // combined pinned-then-unpinned order) should fall back to the
      // previous displayed route — Zebra Loop, at the top of Pinned.
      await user.click(
        within(getListItemByRouteId(climbRoute.id)).getByRole("button", {
          name: "Delete",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Delete route" }));

      await waitFor(() => {
        expect(document.querySelector(`[data-route-id="${climbRoute.id}"]`)).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Zebra Loop" })).toHaveFocus();
      });
    });
  });
});

// Backlog item 73 follow-up: the inline unfinished-session switch prompt
// and its cross-card coordination with delete-confirmation, both owned
// here (RouteLibrary), where pendingDeleteId already lives.
describe("RouteLibrary — pending route switch", () => {
  // Saved only to restore afterwards, never called unbound.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView at all — mirrors
    // RouteSummaryPanel.test.tsx's/RouteListItem.test.tsx's own identical
    // precedent, needed since a pending switch now renders inline.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("renders the prompt inline inside the target route's own list item", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    await importFixture(user, "Second Ride.gpx");
    const [routeA, routeB] = (await routesRepository.listRoutes()) as [
      PlannedRoute,
      PlannedRoute,
    ];

    rerender(
      <RouteLibrary
        onOpenRoute={vi.fn()}
        pendingRouteSwitch={buildPendingRouteSwitch(routeB.id)}
      />,
    );

    expect(
      within(getListItemByRouteId(routeB.id)).getByRole("alertdialog"),
    ).toBeInTheDocument();
    expect(within(getListItemByRouteId(routeA.id)).queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });

  it("forwards onCancel, onReturn and onConfirm to the matching card's own buttons", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);
    const [route] = (await routesRepository.listRoutes()) as [PlannedRoute];
    const pendingRouteSwitch = buildPendingRouteSwitch(route.id);

    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );
    await user.click(screen.getByRole("button", { name: "Return to paused ride" }));
    expect(pendingRouteSwitch.onReturn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "End and switch" }));
    expect(pendingRouteSwitch.onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pendingRouteSwitch.onCancel).toHaveBeenCalledTimes(1);
  });

  it("reports the target as missing (rather than fabricating a non-matching card) when the current search text excludes it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    const [route] = (await routesRepository.listRoutes()) as [PlannedRoute];
    const pendingRouteSwitch = buildPendingRouteSwitch(route.id);
    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );
    expect(
      within(getListItemByRouteId(route.id)).getByRole("alertdialog"),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/search/i), "no such route");

    await waitFor(() => {
      expect(pendingRouteSwitch.onTargetMissing).toHaveBeenCalledWith(route.id);
    });
    expect(document.querySelector(`[data-route-id="${route.id}"]`)).toBeNull();
  });

  it("reports the target as missing when its routeId isn't in the live routes query at all", async () => {
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
    });
    const pendingRouteSwitch = buildPendingRouteSwitch("route-that-does-not-exist");

    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );

    await waitFor(() => {
      expect(pendingRouteSwitch.onTargetMissing).toHaveBeenCalledWith(
        "route-that-does-not-exist",
      );
    });
  });

  // The full cancel-then-open round trip (this callback's mock onCancel
  // doesn't itself flip the pendingRouteSwitch prop back to null the way
  // App's real setPendingRideSwitch(null) does, batched with this same
  // click) is proved end-to-end, with real state, by App.test.tsx's own
  // A-card/B-card integration test. Here, in isolation, only the call
  // itself is provable.
  it("requesting delete while a switch prompt is pending on the same card cancels the switch prompt first", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);
    const [route] = (await routesRepository.listRoutes()) as [PlannedRoute];
    const pendingRouteSwitch = buildPendingRouteSwitch(route.id);
    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(pendingRouteSwitch.onCancel).toHaveBeenCalledTimes(1);
  });

  it("A-card/B-card: requesting delete on a different card than the pending switch cancels the switch prompt first too, not only a same-card one", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    await importFixture(user, "Second Ride.gpx");
    const [routeA, routeB] = (await routesRepository.listRoutes()) as [
      PlannedRoute,
      PlannedRoute,
    ];
    const pendingRouteSwitch = buildPendingRouteSwitch(routeB.id);
    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);

    await user.click(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
    );

    expect(pendingRouteSwitch.onCancel).toHaveBeenCalledTimes(1);
  });

  it("a switch prompt appearing while a different card's delete confirmation is open cancels that delete confirmation reactively, regardless of which card either belongs to", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    await importFixture(user, "Second Ride.gpx");
    const [routeA, routeB] = (await routesRepository.listRoutes()) as [
      PlannedRoute,
      PlannedRoute,
    ];

    await user.click(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
    );
    expect(
      within(getListItemByRouteId(routeA.id)).getByRole("alertdialog"),
    ).toBeInTheDocument();

    rerender(
      <RouteLibrary
        onOpenRoute={vi.fn()}
        pendingRouteSwitch={buildPendingRouteSwitch(routeB.id)}
      />,
    );

    expect(within(getListItemByRouteId(routeA.id)).queryByRole("alertdialog")).toBeNull();
    expect(
      within(getListItemByRouteId(routeB.id)).getByRole("alertdialog"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  });

  it("does not cancel or interrupt a busy switch prompt merely because Delete was requested elsewhere", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "First Ride.gpx");
    await importFixture(user, "Second Ride.gpx");
    const [routeA, routeB] = (await routesRepository.listRoutes()) as [
      PlannedRoute,
      PlannedRoute,
    ];
    const pendingRouteSwitch = buildPendingRouteSwitch(routeB.id, { busy: true });
    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );

    await user.click(
      within(getListItemByRouteId(routeA.id)).getByRole("button", { name: "Delete" }),
    );

    expect(pendingRouteSwitch.onCancel).not.toHaveBeenCalled();
    expect(within(getListItemByRouteId(routeA.id)).queryByRole("alertdialog")).toBeNull();
    expect(
      within(getListItemByRouteId(routeB.id)).getByRole("alertdialog"),
    ).toBeInTheDocument();
  });
});

function installScrollToSpy() {
  window.scrollY = 0;
  return vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
    const [a, b] = args;
    if (typeof a === "object" && a !== null && "top" in a) {
      const top = (a as ScrollToOptions).top;
      if (typeof top === "number") window.scrollY = top;
    } else if (typeof b === "number") {
      window.scrollY = b;
    }
  });
}

describe("RouteLibrary — scroll restoration", () => {
  it("restores the given scrollY only once real route cards have rendered, never the Loading placeholder, and a later reactive update (rename) does not reapply it", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();

    // Seed a route through a throwaway mount first (real UI import, per this
    // file's own convention), then unmount and remount — mirroring the real
    // "return to an already-populated Routes" scenario a restoration is for,
    // rather than importing after the restoring instance is already mounted
    // (which would make the very first, real, non-"Loading" liveQuery
    // emission be a genuinely empty array before the import lands).
    const seeding = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user);
    seeding.unmount();
    expect(scrollToSpy).not.toHaveBeenCalled();

    const restoreScrollYRef = { current: 1500 };
    render(<RouteLibrary onOpenRoute={vi.fn()} restoreScrollYRef={restoreScrollYRef} />);

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledTimes(1);
    });
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1500, left: 0, behavior: "auto" });
    expect(restoreScrollYRef.current).toBeNull();

    // A genuine new useLiveQuery emission (rename) must not reapply it.
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByLabelText("Route name");
    await user.clear(input);
    await user.type(input, "Renamed loop");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Renamed loop" })).toBeInTheDocument();
    });
    expect(scrollToSpy).toHaveBeenCalledTimes(1);
  });

  it("does not scroll when there is nothing to restore", async () => {
    const user = userEvent.setup();
    const scrollToSpy = installScrollToSpy();

    render(<RouteLibrary onOpenRoute={vi.fn()} restoreScrollYRef={{ current: null }} />);
    await importFixture(user);

    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
