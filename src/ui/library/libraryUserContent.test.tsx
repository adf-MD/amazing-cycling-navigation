import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteListItem } from "./RouteListItem.tsx";
import { RouteTagManager } from "./RouteTagManager.tsx";
import type { LibraryRoute, PlannedRoute } from "../../domain/types.ts";
import { englishTranslator } from "../../i18n/englishTranslator.ts";
import {
  describeDeleteConfirmation,
  describeMergeConfirmation,
  describeTagLifecyclePreview,
  describeTagLifecycleSuccess,
} from "./tagLifecycleMessages.ts";
import { tagIdentityKey } from "../../domain/routeTags.ts";

/**
 * Backlog item 113 stage 2. Rider-authored text — a route name, a tag —
 * is data, never copy. It passes through the localisation boundary
 * completely untouched.
 *
 * The interesting case is a name containing `{braces}`, because that is
 * exactly the syntax the catalogue uses for its own placeholders. A
 * formatter that validated its substituted *result* rather than its
 * template would reject such a name outright; one that re-scanned its own
 * output could substitute a second time. Neither may happen.
 */

// Names chosen to be hostile on purpose: catalogue placeholder syntax, a
// key-shaped string, German sharp s and umlauts, and curly quotes that
// collide with the project's own quoting.
const AWKWARD_NAMES = [
  "My {weird} route",
  "{name}",
  "routes.card.delete",
  "Straße nach Köln",
  "Große Höhenmeter-Tour",
  "A “quoted” ride",
  "100% {count} of {total}",
] as const;

function buildRoute(overrides: Partial<LibraryRoute> = {}): LibraryRoute {
  return {
    id: "route-1",
    name: "Evening loop",
    createdAt: "2026-01-01T00:00:00.000Z",
    points: [],
    manoeuvres: [],
    distanceMetres: 12345,
    ascentMetres: null,
    descentMetres: null,
    warnings: [],
    source: { kind: "gpx-import" },
    tags: [],
    ...overrides,
  };
}

function renderCard(route: LibraryRoute, extra: Record<string, unknown> = {}) {
  return render(
    <RouteListItem
      route={route}
      onOpen={vi.fn<(route: PlannedRoute) => void>()}
      onRename={vi.fn<(id: string, name: string) => void>()}
      onExport={vi.fn<(route: PlannedRoute) => void>()}
      onDeleteRequest={vi.fn<(id: string) => void>()}
      onDeleteCancel={vi.fn<(id: string) => void>()}
      onDeleteConfirm={vi.fn<(id: string) => void>()}
      isDeletePending={false}
      isDeleting={false}
      deleteError={null}
      isPinned={false}
      isPinPending={false}
      pinError={null}
      onPinToggle={vi.fn<(route: PlannedRoute) => void>()}
      tagSuggestions={[]}
      onTagsSave={vi.fn<(id: string, tags: readonly string[]) => Promise<void>>()}
      nameButtonRef={() => undefined}
      pinButtonRef={() => undefined}
      switchPrompt={null}
      {...extra}
    />,
  );
}

describe("route names pass through the boundary verbatim", () => {
  for (const name of AWKWARD_NAMES) {
    it(`renders the pin control's name around ${JSON.stringify(name)}`, () => {
      const { unmount } = renderCard(buildRoute({ name }));
      expect(screen.getByRole("button", { name: `Pin ${name}` })).toBeInTheDocument();
      unmount();
    });

    it(`renders the delete confirmation around ${JSON.stringify(name)}`, () => {
      const { unmount } = renderCard(buildRoute({ name }), {
        isDeletePending: true,
      });
      expect(
        screen.getByRole("heading", { name: `Delete “${name}”?` }),
      ).toBeInTheDocument();
      unmount();
    });
  }

  it("uses the unpinned and pinned names as two whole messages", () => {
    const route = buildRoute({ name: "My {weird} route" });
    const { unmount } = renderCard(route, { isPinned: true });
    const control = screen.getByRole("button", { name: "Unpin My {weird} route" });
    // The accessible name and the tooltip are the same message, so they
    // cannot drift apart in one language and not the other.
    expect(control).toHaveAttribute("title", "Unpin My {weird} route");
    unmount();
  });
});

describe("tag names pass through the boundary verbatim", () => {
  for (const tag of ["Straße", "{count}", "a “quoted” tag"]) {
    it(`keeps ${JSON.stringify(tag)} unaltered in every lifecycle message`, () => {
      expect(describeDeleteConfirmation(englishTranslator, tag, 3).title).toBe(
        `Delete the tag “${tag}”?`,
      );
      expect(describeDeleteConfirmation(englishTranslator, tag, 3).message).toContain(
        `“${tag}” will be removed from 3 routes.`,
      );
      expect(
        describeTagLifecyclePreview(englishTranslator, {
          sourceTag: tag,
          targetTag: null,
          isMerge: false,
          routeCount: 2,
        }),
      ).toBe(`Rename “${tag}” on 2 routes.`);
      expect(
        describeTagLifecycleSuccess(
          englishTranslator,
          { kind: "delete", sourceTag: tag },
          1,
        ),
      ).toBe(`Deleted “${tag}” from 1 route. Those routes are still saved.`);
    });
  }

  it("never re-substitutes one tag's braces as another parameter", () => {
    // "{target}" as a source tag must stay literal, not become the target.
    const confirmation = describeMergeConfirmation(
      englishTranslator,
      "{target}",
      "Hills",
      2,
    );
    expect(confirmation.title).toBe("Merge “{target}” into “Hills”?");
    expect(confirmation.message).toBe(
      "“Hills” already exists, so this merges the two tags on 2 routes. “{target}” will no longer exist. No route is deleted.",
    );
  });

  it("shows a tag verbatim in the Manage tags list, beside its own count", () => {
    const tags = ["Straße", "{count}"] as const;
    render(
      <RouteTagManager
        panelId="p"
        tags={tags}
        routeCountsByTagKey={
          new Map([
            [tagIdentityKey("Straße"), 1],
            [tagIdentityKey("{count}"), 4],
          ])
        }
        sourceKey={tagIdentityKey("Straße")}
        newName=""
        isBusy={false}
        errorMessage={null}
        confirmation={null}
        onSourceKeyChange={vi.fn<(key: string) => void>()}
        onNewNameChange={vi.fn<(name: string) => void>()}
        onRenameRequest={vi.fn<() => void>()}
        onDeleteRequest={vi.fn<() => void>()}
        onConfirm={vi.fn<() => void>()}
        onCancelConfirm={vi.fn<() => void>()}
        onClose={vi.fn<() => void>()}
      />,
    );
    expect(screen.getByRole("option", { name: "Straße (1 route)" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "{count} (4 routes)" }),
    ).toBeInTheDocument();
  });
});

describe("tag identity is untouched by the copy migration", () => {
  it("still does not unify the German sharp s with a double s", () => {
    // A persisted identity contract, documented in domain/routeTags.ts.
    // Localising the messages that *display* a tag must not alter how two
    // tags are judged to be the same one.
    expect(tagIdentityKey("Straße")).not.toBe(tagIdentityKey("Strasse"));
    expect(tagIdentityKey("STRASSE")).toBe(tagIdentityKey("strasse"));
  });
});
