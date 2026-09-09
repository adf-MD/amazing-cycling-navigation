import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouteLibrary, type PendingRouteSwitch } from "./RouteLibrary.tsx";
import { db } from "../../storage/db.ts";
import * as routesRepository from "../../storage/routesRepository.ts";
import { trackWithElevationGpx } from "../../test/fixtures/gpx.ts";
import { act } from "@testing-library/react";

// Backlog item 100 stage 4A: the global tag lifecycle (rename, merge and
// delete across every saved route). Kept in its own file rather than
// appended to the already ~3,000-line RouteLibrary.test.tsx, following
// src/App.pwaUpdateNotice.test.tsx's own split precedent. Same harness as
// that file: the real `db` (fake-indexeddb), real repositories and real
// live queries, with routes seeded by importing a real GPX fixture
// through the actual Import GPX control.

function buildGpxFile(name: string, content: string): File {
  return new File([content], name, { type: "application/gpx+xml" });
}

async function importFixture(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<void> {
  const file = buildGpxFile(name, trackWithElevationGpx);
  const expectedName = name.replace(/\.gpx$/i, "");
  await user.upload(screen.getByLabelText("Import GPX file"), file);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: expectedName })).toBeInTheDocument();
  });
}

/** Matches a route's own <li> whether it is showing its ordinary card (the
 * title is a .route-card-title button) or one of its inline editors (the
 * title is a bare <h2>), mirroring RouteLibrary.test.tsx's own helper. */
function getListItemForName(name: string): HTMLElement {
  const title =
    screen.queryByRole("button", { name }) ?? screen.getByRole("heading", { name });
  const item = title.closest("li");
  if (!item) throw new Error(`No list item found for route named ${name}`);
  return item;
}

async function tagRoute(
  user: ReturnType<typeof userEvent.setup>,
  routeName: string,
  tag: string,
): Promise<void> {
  const card = within(getListItemForName(routeName));
  const opener =
    card.queryByRole("button", { name: "Add tags" }) ??
    card.getByRole("button", { name: "Edit tags" });
  await user.click(opener);
  await user.type(screen.getByLabelText("Add a tag"), `${tag}{Enter}`);
  await user.click(screen.getByRole("button", { name: "Save tags" }));
  await waitFor(() => {
    expect(
      within(getListItemForName(routeName)).getByRole("button", { name: "Edit tags" }),
    ).toBeInTheDocument();
  });
}

beforeEach(async () => {
  await db.routes.clear();
  await db.rideState.clear();
  await db.routeLibraryPreferences.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getManager(): HTMLElement {
  return screen.getByRole("group", { name: "Manage tags" });
}

function queryManager(): HTMLElement | null {
  return screen.queryByRole("group", { name: "Manage tags" });
}

function getTagFilterButton(name: string): HTMLElement {
  return within(screen.getByRole("group", { name: "Filter by tags" })).getByRole(
    "button",
    { name },
  );
}

async function openManager(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Manage tags" }));
  await waitFor(() => {
    expect(getManager()).toBeInTheDocument();
  });
}

async function chooseTag(
  user: ReturnType<typeof userEvent.setup>,
  optionLabel: string,
): Promise<void> {
  await user.selectOptions(
    within(getManager()).getByLabelText("Tag to manage"),
    within(getManager()).getByRole("option", { name: optionLabel }),
  );
}

function buildPendingRouteSwitch(
  routeId: string,
  overrides: Partial<PendingRouteSwitch> = {},
): PendingRouteSwitch {
  return {
    routeId,
    title: "Switch route?",
    message: "A ride is paused.",
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

describe("RouteLibrary — global tag management", () => {
  it("renames a tag across every route that uses it, matching by identity", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await importFixture(user, "Coastal Spin.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "gravel");

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(within(getListItemForName("Alpine Climb")).getByText("Trail")).toBeVisible();
    });
    expect(within(getListItemForName("Zebra Loop")).getByText("Trail")).toBeVisible();
    expect(getTagFilterButton("Trail")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
        "button",
        {
          name: "Gravel",
        },
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Renamed “Gravel” to “Trail” on 2 routes."),
    ).toBeInTheDocument();
  });

  it("omits the Manage tags control entirely while no route carries a tag", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");

    expect(screen.queryByRole("button", { name: "Manage tags" })).not.toBeInTheDocument();
  });

  it("offers every tag with its full-corpus route count despite an active search and tag filter", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");

    // Both a name search and a tag filter now hide "Alpine Climb", so a
    // manager deriving its choices from the filtered view would report
    // "Gravel (1 route)".
    await user.type(screen.getByLabelText("Search routes"), "Zebra");
    await user.click(getTagFilterButton("Road"));
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Alpine Climb" }),
      ).not.toBeInTheDocument();
    });

    await openManager(user);
    expect(
      within(getManager()).getByRole("option", { name: "Gravel (2 routes)" }),
    ).toBeInTheDocument();
    expect(
      within(getManager()).getByRole("option", { name: "Road (1 route)" }),
    ).toBeInTheDocument();
  });

  it("applies a display-only respelling to every route without changing the identity", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "gravel");
    await tagRoute(user, "Zebra Loop", "gravel");

    await openManager(user);
    await chooseTag(user, "gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Gravel");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(
        within(getListItemForName("Alpine Climb")).getByText("Gravel"),
      ).toBeVisible();
    });
    expect(within(getListItemForName("Zebra Loop")).getByText("Gravel")).toBeVisible();
    expect(getTagFilterButton("Gravel")).toBeInTheDocument();
  });

  it("requires an explicit merge confirmation and deduplicates a route carrying both tags", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await tagRoute(user, "Zebra Loop", "Gravel");

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    // The action itself signposts the merge before it is submitted.
    expect(
      within(getManager()).getByRole("button", { name: "Merge tags" }),
    ).toBeVisible();
    expect(
      within(getManager()).getByText("Merge “Gravel” into “Road” on 2 routes."),
    ).toBeVisible();
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Merge “Gravel” into “Road”?")).toBeVisible();
    expect(dialog).toHaveTextContent("2 routes");
    expect(dialog).toHaveTextContent("No route is deleted.");
    await user.click(within(dialog).getByRole("button", { name: "Merge tags" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
          "button",
          { name: "Gravel" },
        ),
      ).not.toBeInTheDocument();
    });
    // The route that already carried both ends with exactly one tag.
    expect(
      getListItemForName("Alpine Climb").querySelectorAll(".route-card-tag"),
    ).toHaveLength(1);
    expect(within(getListItemForName("Alpine Climb")).getByText("Road")).toBeVisible();
    expect(within(getListItemForName("Zebra Loop")).getByText("Road")).toBeVisible();
  });

  it("requires an explicit delete confirmation, and keeps every route saved", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await tagRoute(user, "Zebra Loop", "Gravel");

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Delete the tag “Gravel”?")).toBeVisible();
    expect(dialog).toHaveTextContent("removed from 2 routes");
    expect(dialog).toHaveTextContent("routes themselves are not deleted");
    await user.click(within(dialog).getByRole("button", { name: "Delete tag" }));

    await waitFor(() => {
      expect(
        screen.getByText("Deleted “Gravel” from 2 routes. Those routes are still saved."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    expect(within(getListItemForName("Alpine Climb")).getByText("Road")).toBeVisible();
    expect(getTagFilterButton("Road")).toBeInTheDocument();
  });

  it("leaves the corpus untouched when a confirmation is cancelled or dismissed with Escape", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    const lifecycle = vi.spyOn(routesRepository, "applyRouteTagLifecycle");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    expect(lifecycle).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      within(getManager()).getByRole("button", { name: "Delete tag" }),
    ).toHaveFocus();

    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(lifecycle).not.toHaveBeenCalled();
    expect(within(getListItemForName("Alpine Climb")).getByText("Gravel")).toBeVisible();
  });
});

describe("RouteLibrary — global tag management, write/live-query orderings", () => {
  /** Delays only the live query's own listRoutes emission, so the write
   * promise can be observed settling FIRST. The real read still runs, so
   * nothing is faked — only the moment the subscriber sees it. */
  function holdLiveQuery() {
    const real = routesRepository.listRoutes;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    let holding = false;
    vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
      const result = await real();
      if (holding) await gate;
      return result;
    });
    return {
      start: () => {
        holding = true;
      },
      release: async () => {
        holding = false;
        release?.();
        await gate;
      },
    };
  }

  /** Performs the real write immediately — so the live query genuinely
   * reacts to it — while holding the caller-visible promise, producing the
   * live-query-first ordering. */
  function holdWrite() {
    const real = routesRepository.applyRouteTagLifecycle;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(
      async (operation) => {
        const outcome = await real(operation);
        await gate;
        return outcome;
      },
    );
    return {
      release: async () => {
        release?.();
        await gate;
      },
    };
  }

  it("keeps a selected source filter selected while the live query lands before the write settles, then follows it", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");
    await user.click(getTagFilterButton("Gravel"));

    const write = holdWrite();
    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    // The corpus has demonstrably caught up already — the new tag is on
    // the card and in the filter row — but the write promise has not
    // settled yet. Without prune-protection the source selection would be
    // erased here and the follow would have nothing left to follow.
    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toBeInTheDocument();
    });
    // The chip ROW legitimately follows the corpus, so "Gravel" has gone
    // from it; what must survive is the SELECTION. Clear tag filters only
    // renders while something is selected, so its presence here proves the
    // source key was protected rather than pruned — and the target is not
    // selected yet, because the write signal has not arrived.
    expect(screen.getByRole("button", { name: "Clear tag filters" })).toBeInTheDocument();
    expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      await write.release();
    });
    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "true");
    });
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
        "button",
        {
          name: "Gravel",
        },
      ),
    ).not.toBeInTheDocument();
    // Both assertions matter: dropping the selection entirely would show
    // every route, which a "the renamed route is still visible" check
    // alone would happily accept.
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("follows a merge whose target already existed, even though the write settles first", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");
    await user.click(getTagFilterButton("Gravel"));

    const live = holdLiveQuery();
    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    live.start();
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Merge tags" }),
    );

    // The write has settled and the target identity already existed all
    // along, so a "target is present" test alone would clear the marker
    // right here — and the source removal that follows would then prune
    // the selection instead of carrying it across.
    await waitFor(() => {
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
    });

    await act(async () => {
      await live.release();
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
          "button",
          { name: "Gravel" },
        ),
      ).not.toBeInTheDocument();
    });
    expect(getTagFilterButton("Road")).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses a source and target that were both selected into exactly one target selection", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await user.click(getTagFilterButton("Gravel"));
    await user.click(getTagFilterButton("Road"));

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Merge tags" }),
    );

    await waitFor(() => {
      expect(getTagFilterButton("Road")).toHaveAttribute("aria-pressed", "true");
    });
    const chips = within(
      screen.getByRole("group", { name: "Filter by tags" }),
    ).getAllByRole("button");
    expect(chips).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("does not activate the target filter when the source filter was never selected", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");
    await user.click(getTagFilterButton("Road"));

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toBeInTheDocument();
    });
    expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "false");
    // The rider's own unrelated selection is preserved exactly.
    expect(getTagFilterButton("Road")).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.queryByRole("button", { name: "Alpine Climb" }),
    ).not.toBeInTheDocument();
  });

  it("removes a deleted tag from the active filter selection", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await user.click(getTagFilterButton("Gravel"));
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).not.toBeInTheDocument();

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete tag" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("reports the repository's own affected-route count, not a count captured before submitting", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Gravel");

    // A third route acquires the tag between the manager reading its
    // counts and the write running, so the UI's own "2 routes" is stale
    // by the time the operation lands.
    const real = routesRepository.applyRouteTagLifecycle;
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(
      async (operation) => {
        const extra = await routesRepository.listRoutes();
        const untagged = extra.find((route) => route.tags.length === 0);
        if (untagged) await routesRepository.updateRouteTags(untagged.id, ["Gravel"]);
        return real(operation);
      },
    );
    await importFixture(user, "Coastal Spin.gpx");

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(
        screen.getByText("Renamed “Gravel” to “Trail” on 3 routes."),
      ).toBeInTheDocument();
    });
  });
});

describe("RouteLibrary — global tag management, failures and the one-at-a-time contract", () => {
  it("keeps the manager open with the typed name and unchanged filters when the write fails, and a retry succeeds", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");
    await user.click(getTagFilterButton("Gravel"));
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(within(getManager()).getByRole("alert")).toHaveTextContent(
        "That tag could not be renamed. Try again.",
      );
    });
    expect(within(getManager()).getByLabelText("New name")).toHaveValue("Trail");
    // The transaction aborted, so the corpus and the active filters are
    // exactly as they were.
    expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
    expect(within(getListItemForName("Alpine Climb")).getByText("Gravel")).toBeVisible();
    expect(
      within(getManager()).getByRole("button", { name: "Rename tag" }),
    ).toHaveFocus();

    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "true");
    });
  });

  it("does not invent a target filter selection when a failed write races the source tag disappearing", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");
    await user.click(getTagFilterButton("Gravel"));

    // The write rejects, but meanwhile something else removes the last use
    // of "Gravel". A reconciler keyed only on "the source has gone" would
    // conclude the rename worked and select "Trail" — a filter for a tag
    // the rider never chose, from an operation that failed.
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(async () => {
      const routes = await routesRepository.listRoutes();
      const gravelRoute = routes.find((route) =>
        route.tags.some((tag) => tag.toLowerCase() === "gravel"),
      );
      if (gravelRoute) await routesRepository.updateRouteTags(gravelRoute.id, []);
      throw new Error("storage unavailable");
    });

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(within(getManager()).getByRole("alert")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
          "button",
          { name: "Gravel" },
        ),
      ).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
        "button",
        {
          name: "Trail",
        },
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear tag filters" }),
    ).not.toBeInTheDocument();
  });

  it("reports an empty new name as a real message rather than a silently disabled button", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "   ");
    const renameButton = within(getManager()).getByRole("button", { name: "Rename tag" });
    expect(renameButton).toBeEnabled();
    await user.click(renameButton);

    await waitFor(() => {
      expect(within(getManager()).getByRole("alert")).toHaveTextContent(
        "Enter a new name for this tag.",
      );
    });
    expect(within(getListItemForName("Alpine Climb")).getByText("Gravel")).toBeVisible();
  });

  it("explains a source tag that no route uses any more instead of claiming a change", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    // The tag vanishes between the manager reading its options and the
    // write running, so the operation is a genuine no-op.
    const real = routesRepository.applyRouteTagLifecycle;
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementationOnce(
      async (operation) => {
        const routes = await routesRepository.listRoutes();
        const tagged = routes.find((route) => route.tags.length > 0);
        if (tagged) await routesRepository.updateRouteTags(tagged.id, []);
        return real(operation);
      },
    );

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await waitFor(() => {
      expect(
        screen.getByText("“Gravel” is no longer used by any route, so nothing changed."),
      ).toBeInTheDocument();
    });
  });

  it("writes once when the confirmation's action is double-clicked", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    const lifecycle = vi.spyOn(routesRepository, "applyRouteTagLifecycle");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    const confirmButton = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Delete tag",
    });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(lifecycle).toHaveBeenCalledTimes(1);
  });

  it("refuses to open while a tag save is still in flight, leaving that save untouched", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    let releaseSave: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseSave = () => {
        resolve();
      };
    });
    const realUpdate = routesRepository.updateRouteTags;
    vi.spyOn(routesRepository, "updateRouteTags").mockImplementation(async (id, tags) => {
      await held;
      await realUpdate(id, tags);
    });

    await user.click(
      within(getListItemForName("Zebra Loop")).getByRole("button", { name: "Add tags" }),
    );
    await user.type(screen.getByLabelText("Add a tag"), "Road{Enter}");
    await user.click(screen.getByRole("button", { name: "Save tags" }));
    await waitFor(() => {
      expect(screen.getByText("Saving…")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Manage tags" }));
    expect(queryManager()).not.toBeInTheDocument();
    expect(
      screen.getByText("Finish saving that route's tags first, then manage tags."),
    ).toBeInTheDocument();
    // The in-flight save is left completely alone.
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    await act(async () => {
      releaseSave?.();
      await held;
    });
    await waitFor(() => {
      expect(
        within(getListItemForName("Zebra Loop")).getByRole("button", {
          name: "Edit tags",
        }),
      ).toBeInTheDocument();
    });
    await openManager(user);
  });

  it("refuses to open while a route-switch prompt is busy, leaving the prompt untouched", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    const routeId = await routesRepository
      .listRoutes()
      .then((routes) => routes[0]?.id ?? "");
    const onCancel = vi.fn();
    rerender(
      <RouteLibrary
        onOpenRoute={vi.fn()}
        pendingRouteSwitch={buildPendingRouteSwitch(routeId, { busy: true, onCancel })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Manage tags" }));

    expect(queryManager()).not.toBeInTheDocument();
    expect(
      screen.getByText("Wait for the ride switch to finish, then manage tags."),
    ).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("dismisses an idle card editor before the manager appears, and never shows both at once", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Edit tags",
      }),
    );
    expect(screen.getByLabelText("Add a tag")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Manage tags" }));
    await waitFor(() => {
      expect(getManager()).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Add a tag")).not.toBeInTheDocument();
  });

  it("refuses to open a card editor while a lifecycle operation is applying, and closes an idle manager when one opens", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    let releaseWrite: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      releaseWrite = () => {
        resolve();
      };
    });
    const real = routesRepository.applyRouteTagLifecycle;
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(
      async (operation) => {
        await held;
        return real(operation);
      },
    );

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getManager()).getByText("Applying…")).toBeInTheDocument();
    });

    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Edit tags",
      }),
    );
    expect(screen.queryByLabelText("Add a tag")).not.toBeInTheDocument();

    await act(async () => {
      releaseWrite?.();
      await held;
    });
    await waitFor(() => {
      expect(within(getListItemForName("Alpine Climb")).getByText("Trail")).toBeVisible();
    });

    // Once idle, opening a card editor closes the manager instead.
    await user.click(
      within(getListItemForName("Alpine Climb")).getByRole("button", {
        name: "Edit tags",
      }),
    );
    expect(screen.getByLabelText("Add a tag")).toBeInTheDocument();
    expect(queryManager()).not.toBeInTheDocument();
  });

  it("leaves no stale registration blocking the manager when a card unmounts with its editor open", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");

    await user.click(
      within(getListItemForName("Zebra Loop")).getByRole("button", { name: "Add tags" }),
    );
    expect(screen.getByLabelText("Add a tag")).toBeInTheDocument();

    // The card unmounts mid-edit because the search excludes it. Without
    // an unmount deregistration its route id would linger, and the manager
    // could never appear again.
    await user.type(screen.getByLabelText("Search routes"), "Alpine");
    await waitFor(() => {
      expect(screen.queryByLabelText("Add a tag")).not.toBeInTheDocument();
    });

    await openManager(user);
  });

  it("falls back to the placeholder, and refuses to act, when the chosen tag disappears while the manager is idle", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Zebra Loop", "Road");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    const lifecycle = vi.spyOn(routesRepository, "applyRouteTagLifecycle");

    const [alpine] = await routesRepository
      .listRoutes()
      .then((routes) => routes.filter((route) => route.name === "Alpine Climb"));
    await act(async () => {
      await routesRepository.updateRouteTags(alpine?.id ?? "", []);
    });

    await waitFor(() => {
      expect(within(getManager()).getByLabelText("Tag to manage")).toHaveValue("");
    });
    expect(
      within(getManager()).getByRole("button", { name: "Rename tag" }),
    ).toBeDisabled();
    expect(
      within(getManager()).getByRole("button", { name: "Delete tag" }),
    ).toBeDisabled();
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    expect(lifecycle).not.toHaveBeenCalled();
  });
});

describe("RouteLibrary — global tag management, the final-tag empty state", () => {
  async function seedSingleTaggedRoute(
    user: ReturnType<typeof userEvent.setup>,
  ): Promise<void> {
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
  }

  async function expectFinalTagEmptyState(): Promise<void> {
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Manage tags" }),
      ).not.toBeInTheDocument();
    });
    expect(queryManager()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Filter by tags" }),
    ).not.toBeInTheDocument();
    // Every route stays accessible, and focus lands on a stable control
    // rather than being destroyed with the panel.
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search routes")).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  }

  it("hands focus to Search and closes the manager when the write settles before the live query", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedSingleTaggedRoute(user);

    const real = routesRepository.listRoutes;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    let holding = false;
    vi.spyOn(routesRepository, "listRoutes").mockImplementation(async () => {
      const result = await real();
      if (holding) await gate;
      return result;
    });

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    holding = true;
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete tag" }),
    );

    // The write has settled but the corpus has not caught up, so the
    // manager must still be on screen — completion waits for both.
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(getManager()).toBeInTheDocument();

    await act(async () => {
      holding = false;
      release?.();
      await gate;
    });
    await expectFinalTagEmptyState();
  });

  it("hands focus to Search and closes the manager when the live query lands before the write settles", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedSingleTaggedRoute(user);

    const real = routesRepository.applyRouteTagLifecycle;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => {
        resolve();
      };
    });
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(
      async (operation) => {
        const outcome = await real(operation);
        await gate;
        return outcome;
      },
    );

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete tag" }),
    );

    // The corpus is already tagless — the filter region and the entry
    // point have gone — but the panel must stay mounted, or focus would be
    // destroyed before the hand-off could run.
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Manage tags" }),
      ).not.toBeInTheDocument();
    });
    expect(getManager()).toBeInTheDocument();
    expect(
      within(getManager()).getByText(
        "No tags left. Add tags from a route to manage them here.",
      ),
    ).toBeVisible();

    await act(async () => {
      release?.();
      await gate;
    });
    await expectFinalTagEmptyState();
  });

  it("never triggers the card-top reveal scroll for a global operation", async () => {
    const user = userEvent.setup();
    // Mirrors RouteListItem.test.tsx's own scrollBy capture convention,
    // including its unbound-method disable for reading the original off
    // window before replacing it.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollBy = window.scrollBy;
    const scrollByCalls: unknown[] = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      scrollByCalls.push(options);
    };
    try {
      render(<RouteLibrary onOpenRoute={vi.fn()} />);
      await seedSingleTaggedRoute(user);
      scrollByCalls.length = 0;

      await openManager(user);
      await chooseTag(user, "Gravel (1 route)");
      await user.type(within(getManager()).getByLabelText("New name"), "Trail");
      await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
      await waitFor(() => {
        expect(
          within(getListItemForName("Alpine Climb")).getByText("Trail"),
        ).toBeVisible();
      });

      // The reveal belongs to a card's own successful Save tags press
      // (backlog item 100's 0.4.18 follow-up) and must not fire for a
      // global rename that no card editor was involved in.
      expect(scrollByCalls).toEqual([]);
    } finally {
      window.scrollBy = originalScrollBy;
    }
  });
});
