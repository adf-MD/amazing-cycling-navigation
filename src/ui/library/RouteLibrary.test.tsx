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

    describe("distance and total ascent (item 99)", () => {
      // Imports three routes then overwrites their canonical
      // distanceMetres/ascentMetres directly (the same db.routes.update
      // precedent this file already uses for name/pinnedAt), since
      // importFixture always uploads the same GPX content and this file's
      // convention is to vary fields this way rather than via distinct GPX
      // fixtures. "Mid Unknown" gets a genuine null ascent, distinct from
      // "Short Flat"'s known zero.
      async function seedDistinctRoutes(user: ReturnType<typeof userEvent.setup>) {
        await importFixture(user, "Short Flat.gpx");
        await importFixture(user, "Long Climb.gpx");
        await importFixture(user, "Mid Unknown.gpx");

        const routes = await routesRepository.listRoutes();
        const short = routes.find((route) => route.name === "Short Flat");
        const long = routes.find((route) => route.name === "Long Climb");
        const mid = routes.find((route) => route.name === "Mid Unknown");
        if (!short || !long || !mid) throw new Error("fixture routes not found");

        await db.routes.update(short.id, { distanceMetres: 5_000, ascentMetres: 0 });
        await db.routes.update(long.id, { distanceMetres: 40_000, ascentMetres: 900 });
        await db.routes.update(mid.id, { distanceMetres: 15_000, ascentMetres: null });
      }

      it("the select exposes exactly four sort choices with the intended values and labels (item 99 follow-up)", async () => {
        const user = userEvent.setup();
        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await importFixture(user);

        const select = screen.getByLabelText("Sort by");
        const options = within(select).getAllByRole("option");
        expect(
          options.map((option) => [
            (option as HTMLOptionElement).value,
            option.textContent,
          ]),
        ).toEqual([
          ["most-recent", "Most recent"],
          ["name-asc", "Name A–Z"],
          ["distance-desc", "Longest route"],
          ["ascent-desc", "Most total ascent"],
        ]);
      });

      it("a raw legacy distance-asc preference (written by 0.4.12 or earlier) renders with distance-desc selected (item 99 follow-up)", async () => {
        const user = userEvent.setup();
        await db.routeLibraryPreferences.put({
          id: "route-library",
          sortOrder: "distance-asc",
        });
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => undefined);

        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await importFixture(user);

        const select = await screen.findByLabelText("Sort by");
        await waitFor(() => {
          expect(select).toHaveValue("distance-desc");
        });
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
      });

      it("a raw legacy ascent-asc preference (written by 0.4.12 or earlier) renders with ascent-desc selected (item 99 follow-up)", async () => {
        const user = userEvent.setup();
        await db.routeLibraryPreferences.put({
          id: "route-library",
          sortOrder: "ascent-asc",
        });
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => undefined);

        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await importFixture(user);

        const select = await screen.findByLabelText("Sort by");
        await waitFor(() => {
          expect(select).toHaveValue("ascent-desc");
        });
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
      });

      it("distance-desc reorders the rendered cards by canonical distanceMetres (item 99)", async () => {
        const user = userEvent.setup();
        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await seedDistinctRoutes(user);

        await user.selectOptions(screen.getByLabelText("Sort by"), "distance-desc");
        await waitFor(() => {
          expect(getVisibleRouteNames()).toEqual([
            "Long Climb",
            "Mid Unknown",
            "Short Flat",
          ]);
        });
      });

      it("ascent-desc reorders the rendered cards by canonical ascentMetres, with unknown ascent last (item 99)", async () => {
        const user = userEvent.setup();
        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        // short: ascentMetres 0 (known); long: 900 (known); mid: null (unknown)
        await seedDistinctRoutes(user);

        await user.selectOptions(screen.getByLabelText("Sort by"), "ascent-desc");
        await waitFor(() => {
          expect(getVisibleRouteNames()).toEqual([
            "Long Climb",
            "Short Flat",
            "Mid Unknown",
          ]);
        });
      });

      it("a distance/ascent sort choice persists across a remount, reading from IndexedDB rather than local state", async () => {
        const user = userEvent.setup();
        const first = render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await seedDistinctRoutes(user);

        await user.selectOptions(screen.getByLabelText("Sort by"), "distance-desc");
        await waitFor(() => {
          expect(getVisibleRouteNames()).toEqual([
            "Long Climb",
            "Mid Unknown",
            "Short Flat",
          ]);
        });
        first.unmount();

        render(<RouteLibrary onOpenRoute={vi.fn()} />);

        await waitFor(() => {
          expect(screen.getByLabelText("Sort by")).toHaveValue("distance-desc");
        });
        expect(getVisibleRouteNames()).toEqual([
          "Long Climb",
          "Mid Unknown",
          "Short Flat",
        ]);
      });

      it("shows an inline error and reverts to the last-persisted value when saving a new distance/ascent preference fails", async () => {
        const user = userEvent.setup();
        vi.spyOn(
          routeLibraryPreferencesRepository,
          "saveRouteLibraryPreferences",
        ).mockRejectedValueOnce(new Error("Save failed."));
        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await importFixture(user);

        const sortSelect = screen.getByLabelText("Sort by");
        await user.selectOptions(sortSelect, "ascent-desc");

        await waitFor(() => {
          expect(screen.getByRole("alert")).toHaveTextContent(
            "This preference could not be saved on this device. Try again.",
          );
        });
        await waitFor(() => {
          expect(sortSelect).toHaveValue("most-recent");
        });
      });

      it("keeps keyboard focus on the Sort by select through a distance/ascent reorder", async () => {
        const user = userEvent.setup();
        render(<RouteLibrary onOpenRoute={vi.fn()} />);
        await seedDistinctRoutes(user);

        const sortSelect = screen.getByLabelText("Sort by");
        await user.selectOptions(sortSelect, "distance-desc");
        await waitFor(() => {
          expect(getVisibleRouteNames()).toEqual([
            "Long Climb",
            "Mid Unknown",
            "Short Flat",
          ]);
        });
        expect(sortSelect).toHaveFocus();
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

    // Item 99: at least TWO pinned routes, whose pin-recency order actively
    // conflicts with their distance order, so this genuinely proves the
    // internal pinned order survives a distance/ascent sort — a single
    // pinned route (as in the name-asc test above) can only prove
    // pinned-vs-unpinned partitioning, not that the pinned block's own
    // internal order is untouched.
    it("changing the sort order to distance-desc still leaves the pinned block's own newest-pinned-first order unchanged, even though it conflicts with distance order (item 99)", async () => {
      const user = userEvent.setup();
      const clock = buildSteppingClock("2026-02-01T09:00:00.000Z");
      render(<RouteLibrary onOpenRoute={vi.fn()} clock={clock} />);
      await importFixture(user, "Older Pin Long.gpx");
      await importFixture(user, "Newer Pin Short.gpx");
      await importFixture(user, "Unpinned Mid.gpx");
      await importFixture(user, "Unpinned Short.gpx");

      const routes = await routesRepository.listRoutes();
      const olderPinLong = routes.find((route) => route.name === "Older Pin Long");
      const newerPinShort = routes.find((route) => route.name === "Newer Pin Short");
      const unpinnedMid = routes.find((route) => route.name === "Unpinned Mid");
      const unpinnedShort = routes.find((route) => route.name === "Unpinned Short");
      if (!olderPinLong || !newerPinShort || !unpinnedMid || !unpinnedShort) {
        throw new Error("fixture routes not found");
      }

      // Pinned-first order will be [Newer Pin Short, Older Pin Long]
      // (newest-pinned-first), but distance-desc order alone would want
      // the OPPOSITE (Newer Pin Short is shortest) — so both pinned routes
      // are also interleaved with distinct unpinned distances, which a
      // whole-list (not unpinned-only) sort would scatter rather than
      // merely transpose.
      await db.routes.update(olderPinLong.id, { distanceMetres: 40_000 });
      await db.routes.update(newerPinShort.id, { distanceMetres: 5_000 });
      await db.routes.update(unpinnedMid.id, { distanceMetres: 20_000 });
      await db.routes.update(unpinnedShort.id, { distanceMetres: 10_000 });

      await user.click(screen.getByRole("button", { name: "Pin Older Pin Long" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Older Pin Long" }),
        ).toHaveAttribute("aria-pressed", "true");
      });
      clock.advance(1000);
      await user.click(screen.getByRole("button", { name: "Pin Newer Pin Short" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Newer Pin Short" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      await user.selectOptions(screen.getByLabelText("Sort by"), "distance-desc");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toEqual([
          "Newer Pin Short",
          "Older Pin Long",
          "Unpinned Mid",
          "Unpinned Short",
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

  // Backlog item 100 stage 2: the compact tag editor and reusable
  // suggestions, exercised end-to-end against the real fake-indexeddb db.
  describe("tag editing", () => {
    async function openTagEditor(
      user: ReturnType<typeof userEvent.setup>,
      routeName: string,
      label: "Add tags" | "Edit tags" = "Add tags",
    ) {
      await user.click(
        within(getListItemForName(routeName)).getByRole("button", { name: label }),
      );
    }

    // Falls back to the heading role because a card whose own tag editor
    // is open renders its route name as a plain <h2>, not the normal-mode
    // title <button> — needed so a test can locate a card while its
    // editor is still open (e.g. mid-save), not only in normal mode.
    function getListItemForName(name: string): HTMLElement {
      const title =
        screen.queryByRole("button", { name }) ?? screen.getByRole("heading", { name });
      const item = title.closest("li");
      if (!item) throw new Error(`No list item found for route named ${name}`);
      return item;
    }

    it("a tag saved on one route appears as a suggestion opening another route's editor, without a reload, and a typed variant adopts the established spelling", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      await openTagEditor(user, "Zebra Loop");
      // Backlog item 100 stage 3 added a "Filter by tags" chip of the
      // same name once any route carries "Gravel" — scoped to this
      // route's own editor to disambiguate it from that chip.
      const zebraLoopEditor = within(getListItemForName("Zebra Loop"));
      expect(zebraLoopEditor.getByRole("button", { name: "Gravel" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      // A case/whitespace variant of the established suggestion adopts its
      // spelling rather than creating a second identity.
      await user.type(screen.getByLabelText("Add a tag"), "  gravel  {Enter}");
      expect(zebraLoopEditor.queryAllByRole("button", { name: /gravel/i })).toHaveLength(
        1,
      );
      expect(zebraLoopEditor.getByRole("button", { name: "Gravel" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Zebra Loop")).getByText("Gravel"),
        ).toBeInTheDocument();
      });
    });

    it("a suggestion remains available for another route even while the tagged route is excluded by the active name search", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");

      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      // Excludes "Alpine Climb" from the visible/filtered list.
      await user.type(screen.getByLabelText("Search routes"), "Zebra");
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
      });

      await openTagEditor(user, "Zebra Loop");
      // Backlog item 100 stage 3 added a "Filter by tags" chip of the
      // same name once any route carries "Gravel" — scoped to this
      // route's own editor to disambiguate it from that chip.
      expect(
        within(getListItemForName("Zebra Loop")).getByRole("button", { name: "Gravel" }),
      ).toBeInTheDocument();
    });

    it("search continues to match route names only — a term matching only a tag returns no results", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      await user.type(screen.getByLabelText("Search routes"), "Gravel");

      await waitFor(() => {
        expect(screen.getByText("No routes match “Gravel”.")).toBeInTheDocument();
      });
    });

    it("all four sort modes and pin priority remain unchanged after a tag save", async () => {
      const user = userEvent.setup();
      const clock = buildSteppingClock("2026-02-01T09:00:00.000Z");
      render(<RouteLibrary onOpenRoute={vi.fn()} clock={clock} />);
      await importFixture(user, "Older Pin Long.gpx");
      await importFixture(user, "Newer Pin Short.gpx");
      await importFixture(user, "Unpinned Mid.gpx");
      await importFixture(user, "Unpinned Short.gpx");

      const routes = await routesRepository.listRoutes();
      const olderPinLong = routes.find((route) => route.name === "Older Pin Long");
      const newerPinShort = routes.find((route) => route.name === "Newer Pin Short");
      const unpinnedMid = routes.find((route) => route.name === "Unpinned Mid");
      const unpinnedShort = routes.find((route) => route.name === "Unpinned Short");
      if (!olderPinLong || !newerPinShort || !unpinnedMid || !unpinnedShort) {
        throw new Error("fixture routes not found");
      }
      await db.routes.update(olderPinLong.id, {
        distanceMetres: 40_000,
        ascentMetres: 100,
      });
      await db.routes.update(newerPinShort.id, {
        distanceMetres: 5_000,
        ascentMetres: 400,
      });
      await db.routes.update(unpinnedMid.id, {
        distanceMetres: 20_000,
        ascentMetres: 200,
      });
      await db.routes.update(unpinnedShort.id, {
        distanceMetres: 10_000,
        ascentMetres: 300,
      });

      await user.click(screen.getByRole("button", { name: "Pin Older Pin Long" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Older Pin Long" }),
        ).toHaveAttribute("aria-pressed", "true");
      });
      clock.advance(1000);
      await user.click(screen.getByRole("button", { name: "Pin Newer Pin Short" }));
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: "Unpin Newer Pin Short" }),
        ).toHaveAttribute("aria-pressed", "true");
      });

      const ordersBySortOrder = new Map<string, string[]>();
      for (const sortOrder of [
        "most-recent",
        "name-asc",
        "distance-desc",
        "ascent-desc",
      ]) {
        await user.selectOptions(screen.getByLabelText("Sort by"), sortOrder);
        await waitFor(() => {
          expect(screen.getByLabelText<HTMLSelectElement>("Sort by").value).toBe(
            sortOrder,
          );
        });
        ordersBySortOrder.set(sortOrder, getVisibleRouteNames());
      }

      await openTagEditor(user, "Unpinned Mid");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Unpinned Mid")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      for (const sortOrder of [
        "most-recent",
        "name-asc",
        "distance-desc",
        "ascent-desc",
      ]) {
        await user.selectOptions(screen.getByLabelText("Sort by"), sortOrder);
        await waitFor(() => {
          expect(screen.getByLabelText<HTMLSelectElement>("Sort by").value).toBe(
            sortOrder,
          );
        });
        expect(getVisibleRouteNames()).toEqual(ordersBySortOrder.get(sortOrder));
      }
    });

    it("tag persistence survives an unmount/remount of RouteLibrary", async () => {
      const user = userEvent.setup();
      const { unmount } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      unmount();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);

      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByText("Gravel"),
        ).toBeInTheDocument();
      });
    });

    it("a rejected updateRouteTags write keeps the editor open with the draft intact, shows generic recovery copy, and a retry then succeeds", async () => {
      const user = userEvent.setup();
      vi.spyOn(routesRepository, "updateRouteTags").mockRejectedValueOnce(
        new Error("Save failed."),
      );
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");

      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "This route's tags could not be saved. Try again.",
        );
      });
      expect(screen.getByRole("button", { name: "Gravel" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      // mockRejectedValueOnce only overrides the first call — the retry
      // falls through to the real implementation.
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByText("Gravel"),
        ).toBeInTheDocument();
      });
    });

    it("the editor never closes onto stale chips: it stays open until the (deliberately delayed) live query demonstrably reflects the save", async () => {
      const user = userEvent.setup();
      const originalListRoutes = routesRepository.listRoutes;
      vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return originalListRoutes();
      });

      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      // Sample repeatedly across the whole delayed window (the write path
      // itself is completely real/undelayed — only the read side is
      // slowed) rather than checking once: at every sampled instant, if
      // the editor has closed, the chip list must already show "Gravel",
      // never the pre-save (untagged) state.
      const deadline = Date.now() + 400;
      let observedClosed = false;
      while (Date.now() < deadline) {
        const stillEditing = screen.queryByRole("button", { name: "Save tags" }) !== null;
        if (!stillEditing) {
          observedClosed = true;
          expect(
            within(getListItemForName("Alpine Climb")).getByText("Gravel"),
          ).toBeInTheDocument();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      if (!observedClosed) {
        await waitFor(() => {
          expect(
            within(getListItemForName("Alpine Climb")).getByText("Gravel"),
          ).toBeInTheDocument();
        });
      }
    });

    it("Ordering B (real pipeline): the write's caller-visible resolution is deliberately held until after the live query has already propagated the real write elsewhere", async () => {
      const user = userEvent.setup();
      const originalUpdateRouteTags = routesRepository.updateRouteTags;
      let releaseWrite: (() => void) | undefined;
      const heldWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      vi.spyOn(routesRepository, "updateRouteTags").mockImplementation(
        async (id: string, tags: readonly string[]) => {
          // The real underlying write commits now — Dexie's live query
          // can react to it immediately — while the CALLER
          // (handleSaveTags's own .then()) is deliberately held until the
          // test releases it below. This constructs the exact ordering
          // that broke CI (item 100 stage 2, run 226) rather than merely
          // making it likely with a fixed delay: proven, not assumed, by
          // checking the write's real effect (a reusable suggestion on a
          // DIFFERENT route's editor) before this promise is ever
          // released.
          await originalUpdateRouteTags(id, tags);
          await heldWrite;
        },
      );

      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await openTagEditor(user, "Alpine Climb");
      await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
      await user.click(screen.getByRole("button", { name: "Save tags" }));

      // A failed assertion below must not leave the mocked write's
      // internal await heldWrite dangling unresolved for a later test —
      // always release it, even if the intermediate proof fails.
      try {
        // Prove the live query has already propagated the real write —
        // the ordering-B condition — before the write's caller-visible
        // promise has resolved at all: "Gravel" is already offered as a
        // suggestion opening a DIFFERENT route's editor, which can only
        // be true once RouteLibrary's own live query has re-emitted with
        // Alpine Climb's new tags and recomputed tagSuggestions from the
        // full route list.
        await openTagEditor(user, "Zebra Loop");
        await waitFor(() => {
          expect(
            within(getListItemForName("Zebra Loop")).getByRole("button", {
              name: "Gravel",
            }),
          ).toBeInTheDocument();
        });

        // Alpine Climb's own card must still be open/saving — the
        // write's caller-visible resolution has not been released yet.
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Save tags",
          }),
        ).toBeInTheDocument();
      } finally {
        releaseWrite?.();
      }

      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });
      expect(
        within(getListItemForName("Alpine Climb")).getByText("Gravel"),
      ).toBeInTheDocument();
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

// Backlog item 100 stage 3: tag filtering. Uses the real fake-indexeddb
// storage and the real stage-2 tag editor throughout, following this
// file's own established convention (rather than seeding private
// component state), with own locally-scoped helpers per the "tag
// editing" describe block's own precedent.
describe("RouteLibrary — tag filtering", () => {
  function getListItemForName(name: string): HTMLElement {
    const title =
      screen.queryByRole("button", { name }) ?? screen.getByRole("heading", { name });
    const item = title.closest("li");
    if (!item) throw new Error(`No list item found for route named ${name}`);
    return item;
  }

  async function openTagEditor(
    user: ReturnType<typeof userEvent.setup>,
    routeName: string,
    label: "Add tags" | "Edit tags" = "Add tags",
  ) {
    await user.click(
      within(getListItemForName(routeName)).getByRole("button", { name: label }),
    );
  }

  async function tagRoute(
    user: ReturnType<typeof userEvent.setup>,
    routeName: string,
    tag: string,
    label: "Add tags" | "Edit tags" = "Add tags",
  ) {
    await openTagEditor(user, routeName, label);
    await user.type(screen.getByLabelText("Add a tag"), `${tag}{Enter}`);
    await user.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => {
      expect(
        within(getListItemForName(routeName)).getByRole("button", { name: "Edit tags" }),
      ).toBeInTheDocument();
    });
  }

  // Scopes a filter-chip lookup to the "Filter by tags" region, since an
  // open card editor's own suggestion button can share the same
  // accessible name (e.g. two "Gravel" buttons on screen at once).
  /** Expands the filter chooser if it is collapsed. Backlog item 106 made
   * it a disclosure that starts closed, so the chips below only exist once
   * it has been opened — they are not rendered at all while collapsed, so
   * nothing unreachable is left in the tab order. */
  async function expandTagFilters(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    const disclosure = screen.getByRole("button", { name: "Filter by tags" });
    if (disclosure.getAttribute("aria-expanded") === "true") return;
    await user.click(disclosure);
    await waitFor(() => {
      expect(screen.getByRole("group", { name: "Filter by tags" })).toBeInTheDocument();
    });
  }

  async function clickTagFilter(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ): Promise<void> {
    await expandTagFilters(user);
    await user.click(getTagFilterButton(name));
  }

  function getTagFilterButton(name: string): HTMLElement {
    return within(screen.getByRole("group", { name: "Filter by tags" })).getByRole(
      "button",
      {
        name,
      },
    );
  }

  // Toggles a suggestion INSIDE an open card editor (as opposed to the
  // top-level filter chip of the same name) by tag name.
  async function toggleSuggestion(
    user: ReturnType<typeof userEvent.setup>,
    routeName: string,
    tag: string,
  ) {
    await user.click(
      within(getListItemForName(routeName)).getByRole("button", { name: tag }),
    );
  }

  it("omits the tag-filter region when no imported route has any tag", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");

    expect(screen.queryByRole("button", { name: "Filter by tags" })).toBeNull();
  });

  it("selecting a single tag filter narrows the visible list to routes carrying that tag", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await clickTagFilter(user, "Gravel");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("selecting two tag filters together narrows to routes carrying both (AND), not either", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Both Tags.gpx");
    await importFixture(user, "Gravel Only.gpx");
    await importFixture(user, "Weekend Only.gpx");
    await tagRoute(user, "Both Tags", "Gravel");
    await tagRoute(user, "Both Tags", "Weekend", "Edit tags");
    await tagRoute(user, "Gravel Only", "Gravel");
    await tagRoute(user, "Weekend Only", "Weekend");

    await clickTagFilter(user, "Gravel");
    await clickTagFilter(user, "Weekend");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Both Tags" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Gravel Only" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Weekend Only" })).toBeNull();
  });

  it("a chip's aria-pressed reflects and toggles selection state", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await expandTagFilters(user);
    const chip = getTagFilterButton("Gravel");
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.className).not.toContain("is-selected");

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    // A visible non-colour cue independent of aria-pressed.
    expect(chip.className).toContain("is-selected");

    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("matches a route tagged with a case/whitespace-differing spelling of the selected filter", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await openTagEditor(user, "Alpine Climb");
    await user.type(screen.getByLabelText("Add a tag"), "  GRAVEL  {Enter}");
    await user.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => {
      expect(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeInTheDocument();
    });

    // The suggestion grid adopts the established (first-seen) spelling —
    // "GRAVEL" here, since no prior route established "Gravel" first.
    await clickTagFilter(user, "GRAVEL");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    });
  });

  it("composes name search and an active tag filter as an intersection", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Alpine Descent.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await user.type(screen.getByLabelText("Search routes"), "alpine");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Alpine Descent" })).toBeInTheDocument();
    });

    await clickTagFilter(user, "Gravel");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpine Descent" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("search stays name-only under an active tag filter — a tag-only term still returns no results", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await clickTagFilter(user, "Gravel");

    await user.type(screen.getByLabelText("Search routes"), "Gravel");

    await waitFor(() => {
      expect(
        screen.getByText("No routes match “Gravel” and the selected tags."),
      ).toBeInTheDocument();
    });
  });

  it("pin priority and all four sort orders survive an active tag filter", async () => {
    const user = userEvent.setup();
    const clock = buildSteppingClock("2026-02-01T09:00:00.000Z");
    render(<RouteLibrary onOpenRoute={vi.fn()} clock={clock} />);
    await importFixture(user, "Older Pin Long.gpx");
    await importFixture(user, "Newer Pin Short.gpx");
    await importFixture(user, "Unpinned Mid.gpx");
    await importFixture(user, "Unpinned Short.gpx");

    const routes = await routesRepository.listRoutes();
    const byName = (name: string) => {
      const route = routes.find((r) => r.name === name);
      if (!route) throw new Error(`fixture route not found: ${name}`);
      return route;
    };
    await db.routes.update(byName("Older Pin Long").id, {
      distanceMetres: 40_000,
      ascentMetres: 100,
    });
    await db.routes.update(byName("Newer Pin Short").id, {
      distanceMetres: 5_000,
      ascentMetres: 400,
    });
    await db.routes.update(byName("Unpinned Mid").id, {
      distanceMetres: 20_000,
      ascentMetres: 200,
    });
    await db.routes.update(byName("Unpinned Short").id, {
      distanceMetres: 10_000,
      ascentMetres: 300,
    });

    for (const name of [
      "Older Pin Long",
      "Newer Pin Short",
      "Unpinned Mid",
      "Unpinned Short",
    ]) {
      await tagRoute(user, name, "Gravel");
    }

    await user.click(screen.getByRole("button", { name: "Pin Older Pin Long" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Unpin Older Pin Long" }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    clock.advance(1000);
    await user.click(screen.getByRole("button", { name: "Pin Newer Pin Short" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Unpin Newer Pin Short" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(getVisibleRouteNames()).toHaveLength(4);
    });

    for (const sortOrder of ["most-recent", "name-asc", "distance-desc", "ascent-desc"]) {
      await user.selectOptions(screen.getByLabelText("Sort by"), sortOrder);
      await waitFor(() => {
        expect(screen.getByLabelText<HTMLSelectElement>("Sort by").value).toBe(sortOrder);
      });
      // Pinned pair always first, in pin-recency order, regardless of sortOrder.
      expect(getVisibleRouteNames().slice(0, 2)).toEqual([
        "Newer Pin Short",
        "Older Pin Long",
      ]);
    }
  });

  it("hides a non-matching pinned route under an active tag filter", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Pinned No Tag.gpx");
    await importFixture(user, "Unpinned Tagged.gpx");
    await tagRoute(user, "Unpinned Tagged", "Gravel");
    await user.click(screen.getByRole("button", { name: "Pin Pinned No Tag" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unpin Pinned No Tag" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    await clickTagFilter(user, "Gravel");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Pinned No Tag" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Unpinned Tagged" })).toBeInTheDocument();
  });

  it("derives available filter chips from the full route corpus, not the currently filtered view", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Weekend");

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });

    // "Weekend" belongs only to the now-hidden Zebra Loop, yet its own
    // chip must remain present and selectable.
    expect(screen.getByRole("button", { name: "Weekend" })).toBeInTheDocument();
  });

  it("Clear tag filters is absent with none selected, appears once one is, restores the full list and moves focus to the region's own label", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    expect(screen.queryByRole("button", { name: "Clear tag filters" })).toBeNull();

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear tag filters" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Clear tag filters" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Clear tag filters" })).toBeNull();
    expect(screen.getByRole("button", { name: "Filter by tags" })).toHaveFocus();
  });

  it("tagging a route through the live editor immediately affects an active filter's result, with no reload", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    // Tag Zebra Loop too, before the filter is active, so its card is
    // still reachable through the ordinary Route Library UI — an active
    // filter that already excludes it would also unmount its editor
    // button entirely.
    await tagRoute(user, "Zebra Loop", "Gravel");

    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();

    // Now remove Gravel from Zebra Loop through its own live editor —
    // still reachable since it currently matches the active filter — and
    // confirm the filtered RESULT updates immediately, with no reload.
    await openTagEditor(user, "Zebra Loop", "Edit tags");
    await toggleSuggestion(user, "Zebra Loop", "Gravel");
    await user.click(
      within(getListItemForName("Zebra Loop")).getByRole("button", { name: "Save tags" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  // Backlog item 111 changed how this state is REACHED, not whether it
  // exists: a chip whose prospective count is zero can no longer be
  // tapped, so two filters can never be combined into an empty result by
  // pressing them. The state still arises the way it does in real use —
  // a live retag pulling the last shared route out from under an
  // already-valid selection — and that is what this now constructs. The
  // copy under test is unchanged.
  it("tag-only no-match copy is shown when a live retag leaves an active tag filter excluding every route", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await openTagEditor(user, "Alpine Climb", "Edit tags");
    await user.type(screen.getByLabelText("Add a tag"), "Weekend{Enter}");
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Save tags",
      }),
    );
    await waitFor(() => {
      expect(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeInTheDocument();
    });
    await tagRoute(user, "Zebra Loop", "Weekend");

    // Both selections are legitimate while Alpine Climb carries both.
    await clickTagFilter(user, "Gravel");
    await clickTagFilter(user, "Weekend");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    });

    // Now take Weekend off Alpine Climb. Neither key is pruned — Gravel
    // still lives on Alpine Climb and Weekend on Zebra Loop — so the
    // selection survives and its intersection becomes empty.
    await openTagEditor(user, "Alpine Climb", "Edit tags");
    await toggleSuggestion(user, "Alpine Climb", "Weekend");
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Save tags",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("No routes match the selected tags.")).toBeInTheDocument();
    });
  });

  it("moves focus to the next visible route when the currently-edited route drops out of an active tag filter", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Zebra Loop.gpx");
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Zebra Loop", "Weekend");
    await tagRoute(user, "Alpine Climb", "Weekend");

    await clickTagFilter(user, "Weekend");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    });

    // most-recent order: Alpine Climb (imported second) is first, Zebra
    // Loop second — editing away Alpine Climb's own match leaves Zebra
    // Loop as the next visible route.
    await openTagEditor(user, "Alpine Climb", "Edit tags");
    await toggleSuggestion(user, "Alpine Climb", "Weekend");
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Save tags",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toHaveFocus();
    });
  });

  it("moves focus to the Clear tag filters button when the disappearing route was the only match under an AND filter, with no route to fall back to", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Weekend Only.gpx");
    await importFixture(user, "Gravel Only.gpx");

    await openTagEditor(user, "Alpine Climb");
    await user.type(screen.getByLabelText("Add a tag"), "Weekend{Enter}");
    await user.type(screen.getByLabelText("Add a tag"), "Gravel{Enter}");
    await user.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => {
      expect(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeInTheDocument();
    });
    await tagRoute(user, "Weekend Only", "Weekend");
    await tagRoute(user, "Gravel Only", "Gravel");

    await clickTagFilter(user, "Weekend");
    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Weekend Only" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Gravel Only" })).toBeNull();

    await openTagEditor(user, "Alpine Climb", "Edit tags");
    await toggleSuggestion(user, "Alpine Climb", "Gravel"); // toggle off
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Save tags",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
    });
    // "Gravel" stays valid (Gravel Only still carries it) so it is NOT
    // pruned — Clear tag filters remains rendered and is the correct
    // fallback, since no route now matches the AND filter.
    expect(screen.getByRole("button", { name: "Clear tag filters" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Clear tag filters" })).toHaveFocus();
    });
  });

  it("prunes a selected tag filter once its last backing route is deleted, and does not silently reactivate it if the same spelling is retagged later in the session", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear tag filters" }),
      ).toBeInTheDocument();
    });

    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", { name: "Delete" }),
    );
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Delete route",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Filter by tags" })).toBeNull();
    });

    // Retagging Zebra Loop with the identical spelling later in the same
    // session must not resurrect the previously-selected (now-pruned)
    // filter — the fresh "Gravel" chip must start unselected.
    await tagRoute(user, "Zebra Loop", "Gravel");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Filter by tags" })).toBeInTheDocument();
    });
    await expandTagFilters(user);
    expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
  });

  it("prunes a selected tag filter once the last route using it is edited to remove it", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await clickTagFilter(user, "Gravel");
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Clear tag filters" }),
      ).toBeInTheDocument();
    });

    await openTagEditor(user, "Alpine Climb", "Edit tags");
    await toggleSuggestion(user, "Alpine Climb", "Gravel"); // toggle off
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Save tags",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Filter by tags" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("cancels an actionable pending switch prompt whose target a newly-selected tag filter hides, via onTargetMissing", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    // Zebra Loop carries BOTH, so selecting Weekend below leaves it
    // visible: a chip that would empty the list is no longer operable at
    // all (backlog item 111), and this test is about hiding the prompt's
    // own target, not about emptying the library.
    await tagRoute(user, "Zebra Loop", "Gravel");
    await openTagEditor(user, "Zebra Loop", "Edit tags");
    await user.type(screen.getByLabelText("Add a tag"), "Weekend{Enter}");
    await user.click(
      within(getListItemForName("Zebra Loop")).getByRole("button", {
        name: "Save tags",
      }),
    );
    await waitFor(() => {
      expect(
        within(getListItemForName("Zebra Loop")).getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeInTheDocument();
    });
    const routes = await routesRepository.listRoutes();
    const alpine = routes.find((route) => route.name === "Alpine Climb");
    if (!alpine) throw new Error("Alpine Climb not found");
    const pendingRouteSwitch = buildPendingRouteSwitch(alpine.id);
    rerender(
      <RouteLibrary onOpenRoute={vi.fn()} pendingRouteSwitch={pendingRouteSwitch} />,
    );
    expect(
      within(getListItemForName("Alpine Climb")).getByRole("alertdialog"),
    ).toBeInTheDocument();

    // A filter Alpine Climb DOES carry must not cancel the prompt.
    await clickTagFilter(user, "Gravel");
    expect(pendingRouteSwitch.onTargetMissing).not.toHaveBeenCalled();

    // Adding a second, AND-combined filter Alpine Climb does NOT carry
    // hides it — the prompt must be reported missing rather than left
    // invisible.
    await clickTagFilter(user, "Weekend");

    await waitFor(() => {
      expect(pendingRouteSwitch.onTargetMissing).toHaveBeenCalledWith(alpine.id);
    });
  });

  describe("session restoration", () => {
    it("hydrates the selected filters from restoreTagFilterKeysRef on mount", async () => {
      const user = userEvent.setup();
      const seed = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await tagRoute(user, "Alpine Climb", "Gravel");
      seed.unmount();

      const restoreTagFilterKeysRef = { current: ["gravel"] };
      render(
        <RouteLibrary
          onOpenRoute={vi.fn()}
          restoreTagFilterKeysRef={restoreTagFilterKeysRef}
        />,
      );

      // The chooser starts collapsed (item 106), so the restored selection
      // is first visible as the count/Clear summary — collapsed filtering
      // is never invisible filtering — and reaches the chip once expanded.
      await waitFor(() => {
        expect(screen.getByText("1 filter active")).toBeInTheDocument();
      });
      await expandTagFilters(user);
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
    });

    it("writes a toggled selection through to restoreTagFilterKeysRef", async () => {
      const user = userEvent.setup();
      const restoreTagFilterKeysRef = { current: [] as readonly string[] };
      render(
        <RouteLibrary
          onOpenRoute={vi.fn()}
          restoreTagFilterKeysRef={restoreTagFilterKeysRef}
        />,
      );
      await importFixture(user, "Alpine Climb.gpx");
      await tagRoute(user, "Alpine Climb", "Gravel");

      await clickTagFilter(user, "Gravel");

      await waitFor(() => {
        expect(restoreTagFilterKeysRef.current).toEqual(["gravel"]);
      });
    });

    it("a restored tag-filter selection survives while routes is initially undefined, and is not written back to the restoration ref as empty during that window", async () => {
      const user = userEvent.setup();
      const seed = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await tagRoute(user, "Alpine Climb", "Gravel");
      seed.unmount();

      const originalListRoutes = routesRepository.listRoutes;
      let releaseRoutes: (() => void) | undefined;
      const heldRoutes = new Promise<void>((resolve) => {
        releaseRoutes = resolve;
      });
      vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
        await heldRoutes;
        return originalListRoutes();
      });

      const restoreTagFilterKeysRef = { current: ["gravel"] };
      render(
        <RouteLibrary
          onOpenRoute={vi.fn()}
          restoreTagFilterKeysRef={restoreTagFilterKeysRef}
        />,
      );

      expect(screen.getByText("Loading routes…")).toBeInTheDocument();
      // Must not have been pruned to empty (and synced back as such)
      // merely because the real route/tag corpus hasn't loaded yet.
      expect(restoreTagFilterKeysRef.current).toEqual(["gravel"]);

      releaseRoutes?.();

      await waitFor(() => {
        expect(screen.getByText("1 filter active")).toBeInTheDocument();
      });
      await expandTagFilters(user);
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
      // The restored filter is genuinely applied, collapsed or not.
      expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
      expect(restoreTagFilterKeysRef.current).toEqual(["gravel"]);
    });

    it("does not restore scroll position until both tag-filter hydration and the loaded/filtered route list are established", async () => {
      const scrollToSpy = installScrollToSpy();
      const user = userEvent.setup();
      const seed = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await tagRoute(user, "Alpine Climb", "Gravel");
      seed.unmount();

      const originalListRoutes = routesRepository.listRoutes;
      let releaseRoutes: (() => void) | undefined;
      const heldRoutes = new Promise<void>((resolve) => {
        releaseRoutes = resolve;
      });
      vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
        await heldRoutes;
        return originalListRoutes();
      });

      render(
        <RouteLibrary
          onOpenRoute={vi.fn()}
          restoreScrollYRef={{ current: 400 }}
          restoreTagFilterKeysRef={{ current: ["gravel"] }}
        />,
      );

      expect(screen.getByText("Loading routes…")).toBeInTheDocument();
      expect(scrollToSpy).not.toHaveBeenCalled();

      releaseRoutes?.();

      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("ordering-sensitive tag-save focus repair (mirrors item 100 stage 2's own race)", () => {
    it("moves focus correctly even when the live query reflects a tag change before the save's own caller-visible promise resolves", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await tagRoute(user, "Alpine Climb", "Weekend");
      await openTagEditor(user, "Zebra Loop");
      await toggleSuggestion(user, "Zebra Loop", "Weekend");
      await user.click(
        within(getListItemForName("Zebra Loop")).getByRole("button", {
          name: "Save tags",
        }),
      );
      await waitFor(() => {
        expect(
          within(getListItemForName("Zebra Loop")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      await clickTagFilter(user, "Weekend");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();

      const originalUpdateRouteTags = routesRepository.updateRouteTags;
      let releaseWrite: (() => void) | undefined;
      const heldWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      vi.spyOn(routesRepository, "updateRouteTags").mockImplementation(
        async (id: string, tags: readonly string[]) => {
          // The exact ordering that broke item 100 stage 2 (39e45fe ->
          // 6f3e2d3): the real write commits (so the live query can react
          // immediately) while the CALLER's own promise is held.
          await originalUpdateRouteTags(id, tags);
          await heldWrite;
        },
      );

      await openTagEditor(user, "Alpine Climb", "Edit tags");
      await toggleSuggestion(user, "Alpine Climb", "Weekend"); // toggle off
      await user.click(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Save tags",
        }),
      );

      try {
        // The live query has already propagated the real write — Alpine
        // Climb's card has already unmounted from the active filter's
        // view — even though the save's own promise is still held.
        await waitFor(() => {
          expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
        });
        await waitFor(() => {
          expect(screen.getByRole("button", { name: "Zebra Loop" })).toHaveFocus();
        });
      } finally {
        releaseWrite?.();
      }
    });

    it("moves focus correctly even when the save's own caller-visible promise resolves well before the (deliberately delayed) live query reflects the change", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await tagRoute(user, "Alpine Climb", "Weekend");
      await openTagEditor(user, "Zebra Loop");
      await toggleSuggestion(user, "Zebra Loop", "Weekend");
      await user.click(
        within(getListItemForName("Zebra Loop")).getByRole("button", {
          name: "Save tags",
        }),
      );
      await waitFor(() => {
        expect(
          within(getListItemForName("Zebra Loop")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });

      await clickTagFilter(user, "Weekend");
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
      });

      const originalListRoutes = routesRepository.listRoutes;
      vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return originalListRoutes();
      });

      await openTagEditor(user, "Alpine Climb", "Edit tags");
      await toggleSuggestion(user, "Alpine Climb", "Weekend"); // toggle off
      await user.click(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Save tags",
        }),
      );

      // The write itself is real and unheld (only the READ side is
      // delayed) — the card must not disappear, and focus must not move,
      // until the delayed live query genuinely reflects the change. Its
      // own editor stays open ("Saving…") throughout, per the unchanged
      // stage-2 child handshake, so it is looked up by heading, not by
      // its (currently absent) name button.
      expect(screen.getByRole("heading", { name: "Alpine Climb" })).toBeInTheDocument();

      await waitFor(
        () => {
          expect(screen.queryByRole("heading", { name: "Alpine Climb" })).toBeNull();
          expect(screen.queryByRole("button", { name: "Alpine Climb" })).toBeNull();
        },
        { timeout: 2000 },
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Zebra Loop" })).toHaveFocus();
      });
    });

    it("a failed tag save clears only its own pending focus intent, leaving a different, still-pending save's intent untouched", async () => {
      const user = userEvent.setup();
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Coastal Ride.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await tagRoute(user, "Alpine Climb", "Weekend");
      await openTagEditor(user, "Coastal Ride");
      await toggleSuggestion(user, "Coastal Ride", "Weekend");
      await user.click(
        within(getListItemForName("Coastal Ride")).getByRole("button", {
          name: "Save tags",
        }),
      );
      await waitFor(() => {
        expect(
          within(getListItemForName("Coastal Ride")).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });
      await tagRoute(user, "Zebra Loop", "Weekend");

      await clickTagFilter(user, "Weekend");
      await waitFor(() => {
        expect(getVisibleRouteNames()).toHaveLength(3);
      });

      const [alpine] = (await routesRepository.listRoutes()).filter(
        (route) => route.name === "Alpine Climb",
      );
      if (!alpine) throw new Error("Alpine Climb not found");

      const originalUpdateRouteTags = routesRepository.updateRouteTags;
      let rejectAlpineWrite: (() => void) | undefined;
      vi.spyOn(routesRepository, "updateRouteTags").mockImplementation(
        (id: string, tags: readonly string[]) => {
          if (id === alpine.id) {
            return new Promise<void>((_resolve, reject) => {
              rejectAlpineWrite = () => {
                reject(new Error("Save failed."));
              };
            });
          }
          return originalUpdateRouteTags(id, tags);
        },
      );

      // Alpine Climb's own save is started (and its intent recorded)
      // first, then Zebra Loop's save overwrites the single shared
      // marker — the accepted, documented narrow gap — before Alpine
      // Climb's write is rejected.
      await openTagEditor(user, "Alpine Climb", "Edit tags");
      await toggleSuggestion(user, "Alpine Climb", "Weekend");
      await user.click(
        within(getListItemForName("Alpine Climb")).getByRole("button", {
          name: "Save tags",
        }),
      );

      await openTagEditor(user, "Zebra Loop", "Edit tags");
      await toggleSuggestion(user, "Zebra Loop", "Weekend");
      await user.click(
        within(getListItemForName("Zebra Loop")).getByRole("button", {
          name: "Save tags",
        }),
      );

      rejectAlpineWrite?.();

      // Alpine Climb's own editor recovers locally with its draft intact
      // and its own error shown.
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByRole("alert"),
        ).toHaveTextContent("This route's tags could not be saved. Try again.");
      });

      // Zebra Loop's save is real and unheld: it commits, drops out of
      // the filter, and focus repair must still apply — proof that
      // Alpine Climb's failed save did not null out Zebra Loop's own,
      // still-pending intent. Coastal Ride is the adjacent surviving
      // route in most-recent order.
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeNull();
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Coastal Ride" })).toHaveFocus();
      });
    });
  });

  // Backlog item 111: contextual tag-filter counts. Real fake-indexeddb
  // storage, real tag editor, real live queries throughout — same harness
  // as the rest of this describe.
  describe("contextual prospective counts (item 111)", () => {
    async function tagRouteWith(
      user: ReturnType<typeof userEvent.setup>,
      routeName: string,
      tags: readonly string[],
    ) {
      const trigger = within(getListItemForName(routeName)).queryByRole("button", {
        name: "Add tags",
      })
        ? "Add tags"
        : "Edit tags";
      await openTagEditor(user, routeName, trigger);
      const input = screen.getByLabelText("Add a tag");
      for (const tag of tags) {
        await user.type(input, `${tag}{Enter}`);
      }
      await user.click(screen.getByRole("button", { name: "Save tags" }));
      await waitFor(() => {
        expect(
          within(getListItemForName(routeName)).getByRole("button", {
            name: "Edit tags",
          }),
        ).toBeInTheDocument();
      });
    }

    /** Alpine Climb: Gravel + Long. Zebra Loop: Gravel + Weekend.
     * Coastal Ride: Weekend. So with nothing selected the counts are
     * Gravel 2, Long 1, Weekend 2; with Gravel selected they are Long 1
     * and Weekend 1; and with Gravel AND Long selected, Weekend is 0. */
    async function seedThreeRoutes(user: ReturnType<typeof userEvent.setup>) {
      const view = render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await importFixture(user, "Alpine Climb.gpx");
      await importFixture(user, "Zebra Loop.gpx");
      await importFixture(user, "Coastal Ride.gpx");
      await tagRouteWith(user, "Alpine Climb", ["Gravel", "Long"]);
      await tagRouteWith(user, "Zebra Loop", ["Gravel", "Weekend"]);
      await tagRouteWith(user, "Coastal Ride", ["Weekend"]);
      return view;
    }

    function chipCount(name: string): string | null {
      return (
        getTagFilterButton(name).querySelector(".tag-filter-count")?.textContent ?? null
      );
    }

    function chipDescription(name: string): string | null {
      const id = getTagFilterButton(name).getAttribute("aria-describedby");
      if (id === null) return null;
      return document.getElementById(id)?.textContent ?? null;
    }

    function visibleRouteNames(): string[] {
      return [...document.querySelectorAll(".route-card-title")].map(
        (element) => element.textContent,
      );
    }

    it("shows a count on every unselected chip only once the chooser is expanded", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);

      // Collapsed: no chips exist at all, so no counts can leak.
      expect(document.querySelectorAll(".tag-filter-count")).toHaveLength(0);

      await expandTagFilters(user);
      expect(chipCount("Gravel")).toBe("2");
      expect(chipCount("Long")).toBe("1");
      expect(chipCount("Weekend")).toBe("2");
      expect(chipDescription("Gravel")).toBe("2 routes would remain");
      expect(chipDescription("Long")).toBe("1 route would remain");

      await user.click(screen.getByRole("button", { name: "Filter by tags" }));
      await waitFor(() => {
        expect(document.querySelectorAll(".tag-filter-count")).toHaveLength(0);
      });
    });

    it("recalculates every other chip's count the moment one tag is selected", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");

      await waitFor(() => {
        expect(chipCount("Long")).toBe("1");
      });
      expect(chipCount("Weekend")).toBe("1");
      expect(chipDescription("Weekend")).toBe("1 route would remain");
    });

    it("follows AND semantics when a second tag is added", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await user.click(getTagFilterButton("Long"));

      // Gravel AND Long is Alpine Climb alone, which carries no Weekend
      // tag. Under OR this would read 2.
      await waitFor(() => {
        expect(chipCount("Weekend")).toBe("0");
      });
    });

    it("gives a selected chip its pressed state and no count, and still removes the filter", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");

      const gravel = getTagFilterButton("Gravel");
      await waitFor(() => {
        expect(gravel).toHaveAttribute("aria-pressed", "true");
      });
      expect(gravel.className).toContain("is-selected");
      // A selected tag's meaning is removal, not "what if I added it".
      expect(chipCount("Gravel")).toBeNull();
      expect(gravel.getAttribute("aria-describedby")).toBeNull();
      expect(gravel.getAttribute("aria-disabled")).toBeNull();

      await user.click(gravel);
      await waitFor(() => {
        expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "false");
      });
      expect(chipCount("Gravel")).toBe("2");
    });

    it("marks a zero-result chip aria-disabled and subdued, keeping its name and explaining why", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await user.click(getTagFilterButton("Long"));

      await waitFor(() => {
        expect(getTagFilterButton("Weekend")).toHaveAttribute("aria-disabled", "true");
      });
      const weekend = getTagFilterButton("Weekend");
      // The accessible name is still the bare tag: getTagFilterButton
      // itself resolves by exact name, so reaching this line proves it.
      expect(weekend.className).toContain("is-unavailable");
      expect(weekend).not.toHaveAttribute("disabled");
      expect(chipCount("Weekend")).toBe("0");
      expect(chipDescription("Weekend")).toBe("No routes would remain");
    });

    it("makes pointer and keyboard activation of a zero-result chip a no-op", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await user.click(getTagFilterButton("Long"));
      await waitFor(() => {
        expect(getTagFilterButton("Weekend")).toHaveAttribute("aria-disabled", "true");
      });
      expect(visibleRouteNames()).toEqual(["Alpine Climb"]);

      await user.click(getTagFilterButton("Weekend"));
      getTagFilterButton("Weekend").focus();
      await user.keyboard("{Enter}");
      await user.keyboard(" ");

      // Nothing moved: not the chip, not the selection, not the list.
      expect(getTagFilterButton("Weekend")).toHaveAttribute("aria-pressed", "false");
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
      expect(getTagFilterButton("Long")).toHaveAttribute("aria-pressed", "true");
      expect(visibleRouteNames()).toEqual(["Alpine Climb"]);
    });

    it("never disables a selected chip, so an empty result is always recoverable", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await user.click(getTagFilterButton("Long"));

      // An empty result can never be reached by TAPPING a zero-result
      // chip — that is exactly what this item prevents — so it is reached
      // the way a rider really would: a search that the current tag
      // selection cannot satisfy.
      await user.type(screen.getByLabelText("Search routes"), "zebra");
      await waitFor(() => {
        expect(
          screen.getByText("No routes match “zebra” and the selected tags."),
        ).toBeInTheDocument();
      });

      // Both selected chips stay fully operable with nothing on screen,
      // so the rider is never trapped.
      for (const name of ["Gravel", "Long"]) {
        const chip = getTagFilterButton(name);
        expect(chip).toHaveAttribute("aria-pressed", "true");
        expect(chip.getAttribute("aria-disabled")).toBeNull();
        expect(chip).not.toHaveAttribute("disabled");
      }
      expect(
        screen.getByRole("button", { name: "Clear tag filters" }),
      ).toBeInTheDocument();

      // Removing one recovers a result without touching the search.
      await user.click(getTagFilterButton("Long"));
      await waitFor(() => {
        expect(visibleRouteNames()).toEqual(["Zebra Loop"]);
      });
    });

    it("keeps exactly one Clear tag filters action, working from expanded and collapsed", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");

      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Clear tag filters" })).toHaveLength(
          1,
        );
      });
      await user.click(screen.getByRole("button", { name: "Clear tag filters" }));
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Clear tag filters" })).toBeNull();
      });

      // Again, this time clearing from the collapsed summary row.
      await clickTagFilter(user, "Gravel");
      await user.click(screen.getByRole("button", { name: "Filter by tags" }));
      await waitFor(() => {
        expect(screen.getByText("1 filter active")).toBeInTheDocument();
      });
      expect(screen.getAllByRole("button", { name: "Clear tag filters" })).toHaveLength(
        1,
      );
      await user.click(screen.getByRole("button", { name: "Clear tag filters" }));
      await waitFor(() => {
        expect(visibleRouteNames()).toHaveLength(3);
      });
    });

    it("recalculates counts from the active name search", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await expandTagFilters(user);

      await user.type(screen.getByLabelText("Search routes"), "loop");
      // "loop" matches Zebra Loop alone: Gravel and Weekend fall to 1 and
      // Long, carried only by Alpine Climb, becomes unavailable.
      await waitFor(() => {
        expect(chipCount("Gravel")).toBe("1");
      });
      expect(chipCount("Weekend")).toBe("1");
      expect(chipCount("Long")).toBe("0");
      expect(getTagFilterButton("Long")).toHaveAttribute("aria-disabled", "true");

      await user.clear(screen.getByLabelText("Search routes"));
      await waitFor(() => {
        expect(chipCount("Long")).toBe("1");
      });
      expect(getTagFilterButton("Long").getAttribute("aria-disabled")).toBeNull();
    });

    it("recalculates from a live tag update without closing the chooser or dropping the selection", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await waitFor(() => {
        expect(chipCount("Weekend")).toBe("1");
      });

      // Give Alpine Climb the Weekend tag too, through the real editor.
      await tagRouteWith(user, "Alpine Climb", ["Weekend"]);

      await waitFor(() => {
        expect(chipCount("Weekend")).toBe("2");
      });
      // The chooser is still open and Gravel is still selected.
      expect(screen.getByRole("button", { name: "Filter by tags" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
    });

    it("leaves the tag manager's own counts whole-corpus", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await clickTagFilter(user, "Gravel");
      await waitFor(() => {
        expect(chipCount("Weekend")).toBe("1");
      });

      await user.click(screen.getByRole("button", { name: "Manage tags" }));
      const select = await screen.findByLabelText("Tag to manage");
      // Weekend's prospective count under the active Gravel filter is 1,
      // but the manager must still offer its true corpus-wide count.
      expect(
        within(select).getByRole("option", { name: "Weekend (2 routes)" }),
      ).toBeInTheDocument();
      expect(
        within(select).getByRole("option", { name: "Gravel (2 routes)" }),
      ).toBeInTheDocument();
    });

    it("shows current counts, not stale ones, after collapsing and reopening", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await expandTagFilters(user);
      expect(chipCount("Weekend")).toBe("2");

      await user.click(screen.getByRole("button", { name: "Filter by tags" }));
      await waitFor(() => {
        expect(document.querySelectorAll(".tag-filter-count")).toHaveLength(0);
      });
      // Change the corpus while the chooser is shut.
      await tagRouteWith(user, "Alpine Climb", ["Weekend"]);

      await expandTagFilters(user);
      expect(chipCount("Weekend")).toBe("3");
    });

    it("reserves the count slot from the corpus size, not from the largest visible count", async () => {
      const user = userEvent.setup();
      await seedThreeRoutes(user);
      await expandTagFilters(user);

      const group = screen.getByRole("group", { name: "Filter by tags" });
      expect(group.style.getPropertyValue("--tag-filter-count-digits")).toBe("1");

      // Narrowing the results drops every count, but the reserved slot
      // must not move — otherwise every chip row would reflow as the
      // rider typed.
      await user.type(screen.getByLabelText("Search routes"), "loop");
      await waitFor(() => {
        expect(chipCount("Long")).toBe("0");
      });
      expect(
        screen
          .getByRole("group", { name: "Filter by tags" })
          .style.getPropertyValue("--tag-filter-count-digits"),
      ).toBe("1");
    });

    it("still starts collapsed after a route is opened and returned from, then shows fresh counts", async () => {
      const user = userEvent.setup();
      const seed = await seedThreeRoutes(user);
      const restoreTagFilterKeysRef = { current: [] as readonly string[] };
      seed.unmount();

      // The route-open/return round trip: RouteLibrary unmounts and
      // remounts, with App owning the restored selection.
      render(
        <RouteLibrary
          onOpenRoute={vi.fn()}
          restoreTagFilterKeysRef={restoreTagFilterKeysRef}
        />,
      );
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Filter by tags" })).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      });
      expect(document.querySelectorAll(".tag-filter-count")).toHaveLength(0);

      await expandTagFilters(user);
      expect(chipCount("Gravel")).toBe("2");
    });
  });
});
