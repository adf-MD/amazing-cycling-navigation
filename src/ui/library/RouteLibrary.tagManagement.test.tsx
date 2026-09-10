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

/** Expands the filter chooser if collapsed — backlog item 106 made it a
 * disclosure that starts closed, and opening it also closes an idle
 * manager, so ordering matters in the tests below. */
async function expandTagFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
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
    await expandTagFilters(user);
    expect(getTagFilterButton("Trail")).toBeInTheDocument();
    await expandTagFilters(user);
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
    await clickTagFilter(user, "Road");
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
    await expandTagFilters(user);
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

    // The merge is asynchronous, and the library deliberately refuses to
    // open the tag filters while a lifecycle operation is still running
    // (item 106's one-at-a-time admission check), answering "Wait for the
    // tag update to finish, then filter by tags." instead. Waiting for
    // the manager's own success message — the authoritative completion
    // signal, exactly as the sibling delete test already does — is what
    // makes the following expandTagFilters deterministic. Without it the
    // click lands during the busy window on a slow or loaded machine and
    // the disclosure never expands; that is how this test failed in a
    // real GitHub Actions run at commit d3d99f5 while passing locally.
    await waitFor(() => {
      expect(
        screen.getByText("Merged “Gravel” into “Road” on 2 routes."),
      ).toBeInTheDocument();
    });

    await expandTagFilters(user);
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
    await expandTagFilters(user);
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
    await clickTagFilter(user, "Gravel");

    const write = holdWrite();
    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    // The corpus has demonstrably caught up already — the new tag is on
    // the card and in the filter row — but the write promise has not
    // settled yet. Without prune-protection the source selection would be
    // erased here and the follow would have nothing left to follow.
    // The manager's own option list is built from the full corpus, so it
    // shows the rename has landed there without depending on a route card
    // that the (correctly still-active) "Gravel" filter now excludes.
    await waitFor(() => {
      expect(
        within(getManager()).getByRole("option", { name: /^Trail/ }),
      ).toBeInTheDocument();
    });
    // The chip ROW legitimately follows the corpus, so "Gravel" has gone
    // from it; what must survive is the SELECTION. Backlog item 106 makes
    // the chooser refuse to open while a lifecycle operation is in flight,
    // so the mid-write evidence is the collapsed summary instead — and it
    // is exactly the same evidence: Clear tag filters and the active count
    // only render while something is selected, so their presence here
    // proves the source key was protected rather than pruned.
    expect(screen.getByRole("button", { name: "Clear tag filters" })).toBeInTheDocument();
    expect(screen.getByText("1 filter active")).toBeInTheDocument();

    await act(async () => {
      await write.release();
    });
    await expandTagFilters(user);
    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "true");
    });
    await expandTagFilters(user);
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
    await clickTagFilter(user, "Gravel");

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
    await expandTagFilters(user);
    await waitFor(() => {
      expect(getTagFilterButton("Gravel")).toHaveAttribute("aria-pressed", "true");
    });

    await act(async () => {
      await live.release();
    });
    await expandTagFilters(user);
    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
          "button",
          { name: "Gravel" },
        ),
      ).not.toBeInTheDocument();
    });
    await expandTagFilters(user);
    expect(getTagFilterButton("Road")).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses a source and target that were both selected into exactly one target selection", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await clickTagFilter(user, "Gravel");
    await clickTagFilter(user, "Road");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Merge tags" }),
    );

    await expandTagFilters(user);
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
    await clickTagFilter(user, "Road");

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));

    await expandTagFilters(user);
    await waitFor(() => {
      expect(getTagFilterButton("Trail")).toBeInTheDocument();
    });
    await expandTagFilters(user);
    expect(getTagFilterButton("Trail")).toHaveAttribute("aria-pressed", "false");
    // The rider's own unrelated selection is preserved exactly.
    await expandTagFilters(user);
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
    await clickTagFilter(user, "Gravel");
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
    await clickTagFilter(user, "Gravel");
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
    // exactly as they were. Read from the collapsed summary, not the
    // chips: expanding the chooser would close the manager (item 106's
    // mutual exclusion), and this test's whole point is that the manager
    // stays open with its typed name intact.
    expect(screen.getByText("1 filter active")).toBeInTheDocument();
    expect(within(getListItemForName("Alpine Climb")).getByText("Gravel")).toBeVisible();
    expect(
      within(getManager()).getByRole("button", { name: "Rename tag" }),
    ).toHaveFocus();

    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await expandTagFilters(user);
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
    await clickTagFilter(user, "Gravel");

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
    await expandTagFilters(user);
    await waitFor(() => {
      expect(
        within(screen.getByRole("group", { name: "Filter by tags" })).queryByRole(
          "button",
          { name: "Gravel" },
        ),
      ).not.toBeInTheDocument();
    });
    await expandTagFilters(user);
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
});

// Backlog item 105. The Manage tags panel gets a top-reveal, but only on
// one specific transition: a SUCCESSFUL rename, merge or non-final delete,
// where the panel stays open and its heading may have been scrolled under
// the sticky header. Every other transition through the same shared focus
// hand-off — a cancelled confirmation, a failed operation, a final-tag
// deletion (the panel is gone), and a manual Close (which doesn't use the
// hand-off at all) — must keep exactly the behaviour it had in 0.4.19,
// with no deliberate scroll. These tests exist to prove those paths cannot
// leak into one another.
describe("RouteLibrary — global tag management, the manager-panel reveal (item 105)", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFocus = HTMLElement.prototype.focus;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRaf = window.requestAnimationFrame;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalCancelRaf = window.cancelAnimationFrame;
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.scrollBy = originalScrollBy;
    HTMLElement.prototype.focus = originalFocus;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
  });

  // Backlog item 106: this reveal now waits for the visible-viewport
  // geometry to settle, so every scroll assertion below drives frames
  // deliberately — including the "no scroll" ones, which would otherwise
  // pass vacuously by asserting before the reveal has measured anything.
  let frames: { advanceMany: (count: number, from?: number) => void };

  beforeEach(() => {
    let nextHandle = 1;
    const pending = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (handle: number) => {
      pending.delete(handle);
    };
    frames = {
      advanceMany(count: number, from = 0) {
        for (let index = 0; index < count; index++) {
          const [entry] = [...pending.entries()];
          if (!entry) return;
          const [handle, callback] = entry;
          pending.delete(handle);
          callback(from + index * 16);
        }
      },
    };
  });

  async function settleViewport() {
    await act(async () => {
      frames.advanceMany(8);
      await Promise.resolve();
    });
  }

  function stubVisualViewport(value: { offsetTop: number; height: number } | null) {
    Object.defineProperty(window, "visualViewport", { configurable: true, value });
  }

  function stubRect(overrides: Partial<DOMRect> = {}): DOMRect {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 320,
      width: 320,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => "",
      ...overrides,
    };
  }

  /** Dispatches by class, mirroring RouteListItem.test.tsx's own
   * stubCardGeometry: the panel root (.tag-manager) and its own heading —
   * the <h2> whose parent is that root, so a card's inline-editor <h2> can
   * never be mistaken for it. Everything else gets an empty rect. */
  function stubPanelGeometry(
    panel: { top: number; bottom: number },
    heading: { top: number; bottom: number },
  ) {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("tag-manager")) {
        return stubRect(panel);
      }
      if (
        this.tagName === "H2" &&
        this.parentElement?.classList.contains("tag-manager") === true
      ) {
        return stubRect(heading);
      }
      return stubRect();
    };
  }

  function captureScrollByCalls() {
    const calls: ScrollToOptions[] = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      if (typeof options === "object") {
        calls.push(options);
      }
    };
    return calls;
  }

  /** Observes focus options while still delegating to the real
   * implementation, so activeElement (and userEvent's own behaviour) is
   * unaffected — RouteListItem.test.tsx's own convention. */
  function captureFocusCalls() {
    const calls: { target: Element; options: FocusOptions | undefined }[] = [];
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      calls.push({ target: this, options });
      originalFocus.call(this, options);
    };
    return calls;
  }

  // The panel scrolled up under the (headerless, so 8px gap only) effective
  // top boundary: delta = -220 - 8.
  const hiddenPanelGeometry = {
    panel: { top: -220, bottom: 300 },
    heading: { top: -220, bottom: -180 },
  };
  const HIDDEN_PANEL_DELTA = -228;
  // Comfortably inside jsdom's default 768px viewport — nothing to do.
  const framedPanelGeometry = {
    panel: { top: 120, bottom: 400 },
    heading: { top: 120, bottom: 160 },
  };

  async function seedTwoTags(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await tagRoute(user, "Zebra Loop", "Gravel");
  }

  function getSelect(): HTMLElement {
    return within(getManager()).getByLabelText("Tag to manage");
  }

  it("reveals the panel's top after a successful rename, focusing the select without a native scroll", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    const focusCalls = captureFocusCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getListItemForName("Alpine Climb")).getByText("Trail")).toBeVisible();
    });

    const selectFocusCall = focusCalls
      .filter((call) => call.target === getSelect())
      .at(-1);
    // Focus is immediate; only the scroll waits for the viewport.
    expect(selectFocusCall?.options).toEqual({ preventScroll: true });
    expect(scrollCalls).toHaveLength(0);

    await settleViewport();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(
      expect.objectContaining({
        top: HIDDEN_PANEL_DELTA,
        left: 0,
        behavior: "smooth",
      }),
    );
  });

  // Backlog item 106. The post-success path now shares the settling
  // lifecycle, so prove it genuinely uses the SETTLED viewport rather than
  // merely still passing once frames are flushed: the mid-transition
  // geometry here would give -348 (-220 - (120 + 8)), the settled one
  // -228. A rename is typed into the New name field, so this path is as
  // exposed to an in-flight keyboard dismissal as the card close is.
  it("computes the panel reveal from the settled viewport, not the mid-transition one", async () => {
    const user = userEvent.setup();
    const viewport = { offsetTop: 120, height: 500 };
    stubVisualViewport(viewport);
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getListItemForName("Alpine Climb")).getByText("Trail")).toBeVisible();
    });
    expect(scrollCalls).toHaveLength(0);

    // The keyboard dismisses and the page settles between the commit and
    // the frames — scrollY moves too, which is part of the signature.
    viewport.offsetTop = 0;
    viewport.height = 768;
    Object.defineProperty(window, "scrollY", { configurable: true, value: 40 });
    await settleViewport();

    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(
      expect.objectContaining({ top: HIDDEN_PANEL_DELTA, left: 0 }),
    );
  });

  it("reveals the panel's top after a confirmed merge", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Merge tags" }),
    );
    // Completion is read from the manager's own option list, which comes
    // from the full corpus: expanding the filter chooser would close the
    // very panel whose reveal this test measures, and it would be refused
    // mid-write in any case.
    await waitFor(() => {
      expect(
        within(getManager()).queryByRole("option", { name: /^Gravel/ }),
      ).not.toBeInTheDocument();
    });

    await settleViewport();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(
      expect.objectContaining({ top: HIDDEN_PANEL_DELTA, left: 0 }),
    );
  });

  it("reveals the panel's top after a confirmed non-final delete", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete tag" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText("Deleted “Gravel” from 2 routes. Those routes are still saved."),
      ).toBeInTheDocument();
    });
    // "Road" survives, so the panel is still open — there is something to
    // reveal, unlike the final-tag case below.
    expect(getManager()).toBeInTheDocument();
    await settleViewport();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(
      expect.objectContaining({ top: HIDDEN_PANEL_DELTA, left: 0 }),
    );
  });

  // The negative control for the three tests above: the identical flow, with
  // only the panel's measured position changed, must scroll nothing at all.
  // If this passed for any other reason (a reveal that never fires, a
  // mis-wired capture), the rename test above would not be able to fail.
  it("performs no redundant scroll when the panel's top is already correctly framed", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(framedPanelGeometry.panel, framedPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    const focusCalls = captureFocusCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getListItemForName("Alpine Climb")).getByText("Trail")).toBeVisible();
    });

    // Focus still moves, and still suppresses the native focus-scroll — the
    // reveal decision is about the delta, not about skipping the hand-off.
    const selectFocusCall = focusCalls
      .filter((call) => call.target === getSelect())
      .at(-1);
    expect(selectFocusCall?.options).toEqual({ preventScroll: true });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });

  it("keeps the Search focus hand-off, and never reveals, when the final tag is deleted", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (1 route)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete tag" }),
    );
    await waitFor(() => {
      expect(queryManager()).not.toBeInTheDocument();
    });

    expect(screen.getByLabelText("Search routes")).toHaveFocus();
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });

  it("restores focus without any deliberate scroll when a confirmation is cancelled, with Cancel and with Escape", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");

    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => {
      expect(
        within(getManager()).getByRole("button", { name: "Delete tag" }),
      ).toHaveFocus();
    });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);

    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        within(getManager()).getByRole("button", { name: "Delete tag" }),
      ).toHaveFocus();
    });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });

  it("restores focus without any deliberate scroll when the operation fails", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockRejectedValue(
      new Error("boom"),
    );

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getManager()).getByRole("alert")).toHaveTextContent(
        "That tag could not be renamed. Try again.",
      );
    });

    await waitFor(() => {
      expect(
        within(getManager()).getByRole("button", { name: "Rename tag" }),
      ).toHaveFocus();
    });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });

  it("never scrolls when the manager is closed manually, by Close or by the toggle", async () => {
    const user = userEvent.setup();
    stubPanelGeometry(hiddenPanelGeometry.panel, hiddenPanelGeometry.heading);
    const scrollCalls = captureScrollByCalls();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    scrollCalls.length = 0;

    await openManager(user);
    await user.click(within(getManager()).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(queryManager()).not.toBeInTheDocument();
    });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);

    await openManager(user);
    await user.click(screen.getByRole("button", { name: "Manage tags" }));
    await waitFor(() => {
      expect(queryManager()).not.toBeInTheDocument();
    });
    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });
});

// Backlog item 106. Opening a Merge/Delete confirmation must bring it into
// view, or the press can look like it did nothing — the installed-iPhone
// report on `0.4.20`. Unlike the panel-top reveal above, a confirmation is
// a whole card whose ACTIONS matter most, so it reuses the established
// item-95 confirmation-card priority (isCardAlreadyFullyVisible plus an
// end-aligned scrollIntoView), not the top-prioritising delta path.
describe("RouteLibrary — Manage tags confirmation reveal (item 106)", () => {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollBy = window.scrollBy;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFocus = HTMLElement.prototype.focus;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalRaf = window.requestAnimationFrame;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalCancelRaf = window.cancelAnimationFrame;
  const originalVisualViewport = window.visualViewport;

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.scrollBy = originalScrollBy;
    HTMLElement.prototype.focus = originalFocus;
    Element.prototype.scrollIntoView = originalScrollIntoView;
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCancelRaf;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalVisualViewport,
    });
  });

  let frames: { advanceMany: (count: number, from?: number) => void };

  beforeEach(() => {
    let nextHandle = 1;
    const pending = new Map<number, FrameRequestCallback>();
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    };
    window.cancelAnimationFrame = (handle: number) => {
      pending.delete(handle);
    };
    frames = {
      advanceMany(count: number, from = 0) {
        for (let index = 0; index < count; index++) {
          const [entry] = [...pending.entries()];
          if (!entry) return;
          const [handle, callback] = entry;
          pending.delete(handle);
          callback(from + index * 16);
        }
      },
    };
    Element.prototype.scrollIntoView = vi.fn();
  });

  async function settleViewport() {
    await act(async () => {
      frames.advanceMany(8);
      await Promise.resolve();
    });
  }

  function stubRect(overrides: Partial<DOMRect> = {}): DOMRect {
    return {
      top: 0,
      bottom: 0,
      left: 0,
      right: 320,
      width: 320,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => "",
      ...overrides,
    };
  }

  /** Only the confirmation's own rect matters here; everything else gets an
   * empty rect, which is safely "already visible" and so never scrolls. */
  function stubConfirmGeometry(confirm: { top: number; bottom: number }) {
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.classList.contains("route-delete-confirm")) {
        return stubRect(confirm);
      }
      return stubRect();
    };
  }

  // Extends past jsdom's default 768px visible bottom — the actions are
  // below the fold, which is exactly the reported symptom.
  const offScreenConfirm = { top: 600, bottom: 900 };
  const visibleConfirm = { top: 200, bottom: 400 };

  function captureScrollIntoViewCalls() {
    const calls: (boolean | ScrollIntoViewOptions | undefined)[] = [];
    Element.prototype.scrollIntoView = function (
      this: Element,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      calls.push(options);
    };
    return calls;
  }

  function captureFocusCalls() {
    const calls: { target: Element; options: FocusOptions | undefined }[] = [];
    HTMLElement.prototype.focus = function focus(
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      calls.push({ target: this, options });
      originalFocus.call(this, options);
    };
    return calls;
  }

  async function seedTwoTags(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await tagRoute(user, "Zebra Loop", "Gravel");
  }

  it("scrolls an off-screen delete confirmation into view, end-aligned, after the viewport settles", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    stubConfirmGeometry(offScreenConfirm);
    const scrollCalls = captureScrollIntoViewCalls();

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await settleViewport();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(
      expect.objectContaining({ block: "end", behavior: "smooth" }),
    );
  });

  it("scrolls an off-screen merge confirmation into view too", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    stubConfirmGeometry(offScreenConfirm);
    const scrollCalls = captureScrollIntoViewCalls();

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Road");
    await user.click(within(getManager()).getByRole("button", { name: "Merge tags" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await settleViewport();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]).toEqual(expect.objectContaining({ block: "end" }));
  });

  it("focuses the confirmation's Cancel immediately, with preventScroll, before any frame is driven", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    stubConfirmGeometry(offScreenConfirm);
    const focusCalls = captureFocusCalls();

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));

    // No frames driven yet: focus must NOT wait for the settle loop, or an
    // open alertdialog would be left focused on its now-disabled trigger.
    const dialog = screen.getByRole("alertdialog");
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    const cancelFocusCall = focusCalls.filter((call) => call.target === cancel).at(-1);
    expect(cancelFocusCall?.options).toEqual({ preventScroll: true });
  });

  it("does not scroll a confirmation that is already fully visible, but still focuses Cancel immediately", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    stubConfirmGeometry(visibleConfirm);
    const scrollCalls = captureScrollIntoViewCalls();

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await settleViewport();
    expect(scrollCalls).toHaveLength(0);
  });

  it("still performs no deliberate scroll when the confirmation is cancelled", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    stubConfirmGeometry(offScreenConfirm);

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    const deleteTag = within(getManager()).getByRole("button", { name: "Delete tag" });
    await user.click(deleteTag);
    await settleViewport();

    const scrollCalls = captureScrollIntoViewCalls();
    const scrollByCalls: unknown[] = [];
    window.scrollBy = (options?: ScrollToOptions | number) => {
      scrollByCalls.push(options);
    };
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    await settleViewport();

    expect(
      within(getManager()).getByRole("button", { name: "Delete tag" }),
    ).toHaveFocus();
    expect(scrollCalls).toHaveLength(0);
    expect(scrollByCalls).toHaveLength(0);
  });
});

// Backlog item 106's third strand: Filter by tags and Manage tags are peer
// disclosures in their own section, only one open at a time, with the
// filter chooser collapsed to begin with. Collapsed must never mean
// invisible: an active filter still shows a count and a real Clear action.
describe("RouteLibrary — tag-control disclosures (item 106)", () => {
  async function seedTwoTags(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await importFixture(user, "Alpine Climb.gpx");
    await importFixture(user, "Zebra Loop.gpx");
    await tagRoute(user, "Alpine Climb", "Gravel");
    await tagRoute(user, "Alpine Climb", "Road");
    await tagRoute(user, "Zebra Loop", "Gravel");
  }

  function filterDisclosure(): HTMLElement {
    return screen.getByRole("button", { name: "Filter by tags" });
  }

  function manageDisclosure(): HTMLElement {
    return screen.getByRole("button", { name: "Manage tags" });
  }

  it("starts collapsed, with no chips rendered and nothing hidden in the tab order", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "false");
    expect(filterDisclosure()).not.toHaveAttribute("aria-controls");
    expect(
      screen.queryByRole("group", { name: "Filter by tags" }),
    ).not.toBeInTheDocument();
    // Not merely hidden — genuinely absent, so no unreachable control can
    // sit in the tab order.
    expect(document.querySelectorAll(".tag-filter-chip")).toHaveLength(0);
  });

  it("expands to the chip interface and points aria-controls at the panel", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    await user.click(filterDisclosure());

    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "true");
    const panelId = filterDisclosure().getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId ?? "")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Filter by tags" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(2);
  });

  it("keeps the two disclosures mutually exclusive in both directions", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    await user.click(filterDisclosure());
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "true");

    await user.click(manageDisclosure());
    await waitFor(() => {
      expect(getManager()).toBeInTheDocument();
    });
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("group", { name: "Filter by tags" }),
    ).not.toBeInTheDocument();

    await user.click(filterDisclosure());
    await waitFor(() => {
      expect(queryManager()).not.toBeInTheDocument();
    });
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "true");
    // Switching to filters must NOT hand focus to the Manage tags button,
    // which closeTagManager() would have done.
    expect(filterDisclosure()).toHaveFocus();
  });

  it("closes an armed but idle confirmation when switching to filters, without stealing focus", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.click(within(getManager()).getByRole("button", { name: "Delete tag" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(filterDisclosure());
    await waitFor(() => {
      expect(queryManager()).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "true");
    expect(filterDisclosure()).toHaveFocus();
  });

  it("refuses to open the filter chooser while a lifecycle operation is busy, leaving the manager open and focus in place", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realLifecycle = routesRepository.applyRouteTagLifecycle;
    vi.spyOn(routesRepository, "applyRouteTagLifecycle").mockImplementation(
      async (operation) => {
        await gate;
        return realLifecycle(operation);
      },
    );

    await openManager(user);
    await chooseTag(user, "Gravel (2 routes)");
    await user.type(within(getManager()).getByLabelText("New name"), "Trail");
    await user.click(within(getManager()).getByRole("button", { name: "Rename tag" }));
    await waitFor(() => {
      expect(within(getManager()).getByRole("status")).toHaveTextContent("Applying…");
    });

    await user.click(filterDisclosure());

    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "false");
    expect(getManager()).toBeInTheDocument();
    expect(filterDisclosure()).toHaveFocus();
    expect(
      screen.getByText("Wait for the tag update to finish, then filter by tags."),
    ).toBeInTheDocument();

    await act(async () => {
      release?.();
      await gate;
    });
  });

  it("leaves the filter chooser exactly as it was when opening the manager is refused", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);
    await user.click(filterDisclosure());
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "true");

    // A tag save in flight refuses the manager outright.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realSave = routesRepository.updateRouteTags;
    vi.spyOn(routesRepository, "updateRouteTags").mockImplementation(async (id, tags) => {
      await gate;
      return realSave(id, tags);
    });
    const card = within(getListItemForName("Zebra Loop"));
    await user.click(card.getByRole("button", { name: "Edit tags" }));
    await user.type(screen.getByLabelText("Add a tag"), "Commute{Enter}");
    await user.click(screen.getByRole("button", { name: "Save tags" }));

    await user.click(manageDisclosure());
    expect(
      screen.getByText("Finish saving that route's tags first, then manage tags."),
    ).toBeInTheDocument();
    expect(queryManager()).not.toBeInTheDocument();

    await act(async () => {
      release?.();
      await gate;
    });
  });

  it("shows an active count and a Clear action while collapsed, and exactly one Clear at a time", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    await clickTagFilter(user, "Gravel");
    expect(screen.getAllByRole("button", { name: "Clear tag filters" })).toHaveLength(1);

    // Collapse: the selection survives and stays visible.
    await user.click(filterDisclosure());
    expect(filterDisclosure()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("1 filter active")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear tag filters" })).toHaveLength(1);
    // Still genuinely filtering while collapsed.
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();

    await clickTagFilter(user, "Road");
    await user.click(filterDisclosure());
    expect(screen.getByText("2 filters active")).toBeInTheDocument();
    // AND semantics are unchanged by the disclosure.
    expect(screen.queryByRole("button", { name: "Zebra Loop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpine Climb" })).toBeInTheDocument();
  });

  it("returns focus to the Filter by tags disclosure when Clear removes the last filter, collapsed or expanded", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    await clickTagFilter(user, "Gravel");
    await user.click(screen.getByRole("button", { name: "Clear tag filters" }));
    expect(filterDisclosure()).toHaveFocus();
    expect(screen.queryByText("1 filter active")).not.toBeInTheDocument();

    await clickTagFilter(user, "Gravel");
    await user.click(filterDisclosure());
    await user.click(screen.getByRole("button", { name: "Clear tag filters" }));
    expect(filterDisclosure()).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "Clear tag filters" }),
    ).not.toBeInTheDocument();
  });

  it("keeps focus on the disclosure when the chooser is collapsed from inside it", async () => {
    const user = userEvent.setup();
    render(<RouteLibrary onOpenRoute={vi.fn()} />);
    await seedTwoTags(user);

    await expandTagFilters(user);
    getTagFilterButton("Gravel").focus();
    expect(getTagFilterButton("Gravel")).toHaveFocus();

    await user.click(filterDisclosure());
    expect(
      screen.queryByRole("group", { name: "Filter by tags" }),
    ).not.toBeInTheDocument();
    expect(filterDisclosure()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });
});
