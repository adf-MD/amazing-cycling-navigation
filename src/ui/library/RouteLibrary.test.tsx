import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteLibrary } from "./RouteLibrary.tsx";
import type { PlannedRoute } from "../../domain/types.ts";
import { db } from "../../storage/db.ts";
import * as routesRepository from "../../storage/routesRepository.ts";
import { multiTrackGpx, trackWithElevationGpx } from "../../test/fixtures/gpx.ts";

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

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RouteLibrary", () => {
  it("shows an empty state before any route is imported", async () => {
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no routes saved yet/i)).toBeInTheDocument();
    });
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
      expect(
        within(getListItemByRouteId(bottomRoute.id)).getByRole("button", {
          name: bottomRoute.name,
        }),
      ).toHaveFocus();
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
      expect(
        within(getListItemByRouteId(topRoute.id)).getByRole("button", {
          name: topRoute.name,
        }),
      ).toHaveFocus();
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
      expect(screen.getByRole("heading", { name: "Routes" })).toHaveFocus();
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
