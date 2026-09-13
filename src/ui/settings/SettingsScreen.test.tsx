import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { db } from "../../storage/db.ts";
import {
  deleteProviderKey,
  getProviderKey,
  recordProviderKeyVerification,
  saveProviderKey,
} from "../../storage/providerKeyRepository.ts";
import * as providerKeyRepository from "../../storage/providerKeyRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import type { Clock } from "../../platform/clock.ts";

const DUMMY_KEY = "test-dummy-settings-key-0000";
const REPLACEMENT_KEY = "test-dummy-settings-key-1111";

/** saveProviderKey stamps savedAt from the wall clock, and backlog item 118
 * binds the armed delete confirmation to exactly that value. Two saves
 * inside one millisecond would therefore be indistinguishable, so a test
 * that needs a genuinely different stored key waits for the clock to move
 * rather than assuming it has. */
async function saveKeyWithDistinctTimestamp(apiKey: string) {
  const previous = (await getProviderKey())?.savedAt;
  for (;;) {
    await saveProviderKey(apiKey);
    if ((await getProviderKey())?.savedAt !== previous) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** The OpenRouteService card itself — the <section className="panel"> whose
 * own h3 names it. Every item 118 assertion about containment resolves the
 * card this way, through its accessible name, never through its class. */
function openRouteServiceCard() {
  return screen.getByRole("region", { name: "OpenRouteService" });
}

async function openDeleteConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
  await user.click(screen.getByRole("button", { name: "Delete key" }));
  return screen.getByRole("alertdialog");
}

function buildFixedClock(startMs: number): Clock {
  return { now: () => startMs };
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
  await db.planningPreferences.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsScreen", () => {
  it("shows no key configured, with a save form, when nothing has been saved", async () => {
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText("No key configured")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("OpenRouteService API key")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /openrouteservice key/i })).toHaveAttribute(
      "href",
      "https://account.heigit.org/signup",
    );
  });

  it("does not claim the key is encrypted, and warns clearing browser data removes it", () => {
    render(<SettingsScreen />);

    expect(screen.getByText(/not encrypted/i)).toBeInTheDocument();
    expect(screen.getByText(/clearing safari/i)).toBeInTheDocument();
  });

  it("discloses that the key and waypoints are sent to HeiGIT when calculating a route", () => {
    render(<SettingsScreen />);

    expect(
      screen.getByText(
        /your key and the waypoints you have placed are sent directly to heigit/i,
      ),
    ).toBeInTheDocument();
  });

  it("saving a key shows the masked saved state with Replace/Delete actions", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(screen.getByLabelText("OpenRouteService API key"), DUMMY_KEY);
    await user.click(screen.getByRole("button", { name: "Save on this device" }));

    await waitFor(() => {
      expect(
        screen.getByText("Key saved on this device, not yet verified"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/hidden/)).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenRouteService API key")).toBeNull();
    expect(screen.getByRole("button", { name: "Replace key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete key" })).toBeInTheDocument();
  });

  it("paste is not blocked on the key input", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText("No key configured"));

    const input = screen.getByLabelText("OpenRouteService API key");
    await user.click(input);
    await user.paste(DUMMY_KEY);

    expect(input).toHaveValue(DUMMY_KEY);
  });

  it("reveal/hide toggles the input between password and text", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText("No key configured"));

    const input = screen.getByLabelText("OpenRouteService API key");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(input).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("replacing the key shows a fresh blank input, not the previous value", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByRole("button", { name: "Replace key" }));

    await user.click(screen.getByRole("button", { name: "Replace key" }));

    const input = screen.getByLabelText("OpenRouteService API key");
    expect(input).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("OpenRouteService API key")).toBeNull();
  });

  it("deleting the key requires confirmation, then removes it — and the same card shows the no-key state", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    const card = openRouteServiceCard();
    await openDeleteConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("No key configured")).toBeInTheDocument();
    });
    expect(await getProviderKey()).toBeUndefined();
    // Scoped to the very same card element captured before the deletion —
    // backlog item 118's "Confirm updates the same card to its no-key
    // state", asserted by identity rather than by re-querying.
    expect(within(card).getByText("No key configured")).toBeInTheDocument();
    expect(within(card).getByLabelText("OpenRouteService API key")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Backlog item 118 — the delete confirmation belongs to the
  // OpenRouteService card, not to the screen. Before this item
  // <ConfirmDialog> was the last child of <section className="screen">, so
  // it painted below every panel and, because its Cancel carries autoFocus,
  // tapping Delete key scrolled the viewport to the bottom of Settings.
  // ---------------------------------------------------------------------

  it("opens the confirmation inside the OpenRouteService card, directly after the action that opened it", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    const dialog = await openDeleteConfirmation(user);

    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(within(openRouteServiceCard()).getByRole("alertdialog")).toBe(dialog);
    // The nearest owning section is the OpenRouteService card itself — a
    // relationship assertion, so a peer rendered anywhere else on the
    // screen fails it however it is classed.
    expect(dialog.closest("section[aria-labelledby]")).toHaveAttribute(
      "aria-labelledby",
      "ors-settings-heading",
    );
    // ...and it follows Delete key in reading order rather than preceding it.
    const deleteButton = screen.getByRole("button", { name: "Delete key" });
    expect(
      deleteButton.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("titles the confirmation one level below the card, leaving item 112's heading hierarchy intact", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    const dialog = await openDeleteConfirmation(user);

    expect(
      screen.getByRole("heading", { name: "Delete OpenRouteService key", level: 4 }),
    ).toBeInTheDocument();
    expect(dialog).toHaveAccessibleName("Delete OpenRouteService key");
    // Item 112's outline is unchanged while the confirmation is open: an h2
    // here would read as a third top-level group, an h3 as a sibling of the
    // card it is supposed to belong to.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(2);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
  });

  it("opening the confirmation deletes nothing and never exposes the key", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    expect((await getProviderKey())?.apiKey).toBe(DUMMY_KEY);
    expect(screen.getByText(/•••• \(hidden\)/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(DUMMY_KEY);
  });

  it("Cancel keeps the stored key, closes the confirmation and returns focus to Delete key", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect((await getProviderKey())?.apiKey).toBe(DUMMY_KEY);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete key" })).toHaveFocus();
  });

  it("Escape behaves exactly as Cancel does, key and focus included", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await user.keyboard("{Escape}");

    expect((await getProviderKey())?.apiKey).toBe(DUMMY_KEY);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete key" })).toHaveFocus();
  });

  it("a successful deletion moves focus to the card's own heading, not to the document or the key field", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "OpenRouteService", level: 3 }),
      ).toHaveFocus();
    });
    // Deliberately not the key input: focusing a text field here would
    // raise the software keyboard immediately after a destructive action.
    // findBy, not getBy: the heading is focused in deleteProviderKey's own
    // .then(), which resolves before the live query has re-emitted and
    // rendered the form, so a synchronous query races the re-render.
    expect(await screen.findByLabelText("OpenRouteService API key")).not.toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "OpenRouteService", level: 3 }),
    ).toHaveFocus();
  });

  it("a failed deletion keeps the key, moves no focus and adds no error presentation", async () => {
    await saveProviderKey(DUMMY_KEY);
    vi.spyOn(providerKeyRepository, "deleteProviderKey").mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect((await getProviderKey())?.apiKey).toBe(DUMMY_KEY);
    expect(
      screen.getByRole("heading", { name: "OpenRouteService", level: 3 }),
    ).not.toHaveFocus();
    // The pre-item-118 behaviour is deliberately unchanged: the failure is
    // logged, nothing new is shown, and the masked saved-key row remains.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/•••• \(hidden\)/)).toBeInTheDocument();
  });

  it("Replace key resolves an armed confirmation instead of leaving it armed behind the form", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await user.click(screen.getByRole("button", { name: "Replace key" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // ...and cancelling the edit does not bring it back.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a key deleted in another tab disarms the confirmation, which cannot resurrect over a newly saved key", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await deleteProviderKey();

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    await saveKeyWithDistinctTimestamp(REPLACEMENT_KEY);
    await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await getProviderKey())?.apiKey).toBe(REPLACEMENT_KEY);
  });

  // ---------------------------------------------------------------------
  // Backlog item 118's conditional-reveal follow-up. jsdom has no layout
  // engine, so every branch here is driven by deliberately stubbed
  // geometry — the harness mirrors RouteListItem.test.tsx's own item
  // 95/106 scroll-and-focus harness. The rendered result is proved in
  // e2e/settings.spec.ts; these tests prove the decisions.
  // ---------------------------------------------------------------------
  describe("delete-confirmation reveal", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalFocus = HTMLElement.prototype.focus;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalScrollBy = window.scrollBy;
    const originalVisualViewport = window.visualViewport;

    afterEach(() => {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
      HTMLElement.prototype.focus = originalFocus;
      window.scrollBy = originalScrollBy;
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: originalVisualViewport,
      });
    });

    function rect(top: number, bottom: number): DOMRect {
      return {
        top,
        bottom,
        left: 0,
        right: 358,
        width: 358,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => "",
      };
    }

    /** The confirmation reports `inset`; the sticky header reports
     * `header`; everything else reports an empty box. */
    function stubGeometry(
      inset: { top: number; bottom: number },
      header = { top: 0, bottom: 0 },
    ) {
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.getAttribute("role") === "alertdialog") {
          return rect(inset.top, inset.bottom);
        }
        if (this.tagName === "HEADER") return rect(header.top, header.bottom);
        return rect(0, 0);
      };
    }

    function captureScrollByCalls() {
      const calls: ScrollToOptions[] = [];
      window.scrollBy = (options?: ScrollToOptions | number) => {
        if (typeof options === "object") calls.push(options);
      };
      return calls;
    }

    /** Records focus and scroll in one ordered log, so the React commit
     * ordering this design depends on is pinned as a fact rather than
     * assumed. Delegates to the real focus so activeElement and
     * userEvent's own keyboard handling are unaffected. */
    function captureOrderedLog() {
      const log: string[] = [];
      HTMLElement.prototype.focus = function focus(
        this: HTMLElement,
        options?: FocusOptions,
      ) {
        log.push(`focus:${this.textContent.trim().slice(0, 12)}`);
        originalFocus.call(this, options);
      };
      window.scrollBy = (options?: ScrollToOptions | number) => {
        if (typeof options === "object") log.push("scrollBy");
      };
      return log;
    }

    function stubVisualViewport(value: { offsetTop: number; height: number } | null) {
      Object.defineProperty(window, "visualViewport", { configurable: true, value });
    }

    async function openConfirmation() {
      const user = userEvent.setup();
      render(<SettingsScreen />);
      await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
      await user.click(screen.getByRole("button", { name: "Delete key" }));
      return user;
    }

    it("issues one immediate, horizontally neutral scroll when the inset is clipped below", async () => {
      await saveProviderKey(DUMMY_KEY);
      // jsdom's window.innerHeight is 768; an inset ending at 900 is clipped.
      stubGeometry({ top: 600, bottom: 900 });
      const calls = captureScrollByCalls();

      await openConfirmation();

      expect(calls).toHaveLength(1);
      // 900 - (768 - 8) = 140. left: 0 is what keeps this reveal from
      // disturbing the 200%-text horizontal containment guarantees.
      expect(calls[0]).toEqual({ top: 140, left: 0, behavior: "auto" });
    });

    it("does not scroll at all when the whole inset already fits", async () => {
      await saveProviderKey(DUMMY_KEY);
      stubGeometry({ top: 200, bottom: 500 });
      const calls = captureScrollByCalls();

      await openConfirmation();

      expect(calls).toEqual([]);
    });

    it("corrects upwards by the minimum when the sticky header occludes the inset", async () => {
      await saveProviderKey(DUMMY_KEY);
      // A 120px sticky header; the inset starts at 60, i.e. under it.
      stubGeometry({ top: 60, bottom: 400 }, { top: 0, bottom: 120 });
      const calls = captureScrollByCalls();
      // The real header lives in App, which threads its ref down; this
      // supplies the same shape so the prop itself is exercised.
      const header = document.createElement("header");
      document.body.appendChild(header);
      const user = userEvent.setup();
      render(<SettingsScreen stickyHeaderRef={{ current: header }} />);
      await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
      await user.click(screen.getByRole("button", { name: "Delete key" }));

      // 60 - (120 + 8) = -68: up by exactly enough to clear the header.
      expect(calls).toHaveLength(1);
      expect(calls[0]?.top).toBe(-68);
      expect(calls[0]?.behavior).toBe("auto");
      header.remove();
    });

    it("keeps the actions in view by anchoring the inset's bottom when it cannot fit", async () => {
      await saveProviderKey(DUMMY_KEY);
      // 1000px tall against jsdom's 768px viewport: the overflow branch.
      stubGeometry({ top: -100, bottom: 900 });
      const calls = captureScrollByCalls();

      await openConfirmation();

      expect(calls).toHaveLength(1);
      // The inset's bottom lands exactly on the band's bottom, so the
      // action row below the warning is complete.
      expect(calls[0]?.top).toBe(900 - (768 - 8));
    });

    it("measures the visual viewport, not the layout viewport", async () => {
      await saveProviderKey(DUMMY_KEY);
      // Comfortably inside jsdom's 768px layout viewport, but not inside a
      // 400px visual viewport.
      stubGeometry({ top: 150, bottom: 400 });
      stubVisualViewport({ offsetTop: 0, height: 400 });
      const calls = captureScrollByCalls();

      await openConfirmation();

      expect(calls).toHaveLength(1);
      expect(calls[0]?.top).toBe(400 - (400 - 8));
    });

    it("focuses Cancel before it measures, so only the residual movement is applied", async () => {
      await saveProviderKey(DUMMY_KEY);
      stubGeometry({ top: 600, bottom: 900 });
      const log = captureOrderedLog();

      await openConfirmation();

      // React commits the child host mount — and the focusing steps' own
      // scroll — before this parent's layout effect runs. If a future
      // React changed that, this reveal would fight the native one.
      // The click's own focus on the trigger comes first and is not part
      // of the claim, so the assertion is on the relative order.
      expect(log).toContain("focus:Cancel");
      expect(log).toContain("scrollBy");
      expect(log.indexOf("focus:Cancel")).toBeLessThan(log.indexOf("scrollBy"));
      expect(log.filter((entry) => entry === "scrollBy")).toHaveLength(1);
    });

    it("issues no scroll of its own when focusing Cancel has already revealed the inset", async () => {
      await saveProviderKey(DUMMY_KEY);
      let insetBottom = 900;
      Element.prototype.getBoundingClientRect = function (this: Element) {
        if (this.getAttribute("role") === "alertdialog") {
          return rect(insetBottom - 300, insetBottom);
        }
        return rect(0, 0);
      };
      // Models the browser's native focus scroll bringing it fully into view.
      HTMLElement.prototype.focus = function focus(
        this: HTMLElement,
        options?: FocusOptions,
      ) {
        insetBottom = 500;
        originalFocus.call(this, options);
      };
      const calls = captureScrollByCalls();

      await openConfirmation();

      expect(calls).toEqual([]);
    });

    it("reveals once per arming, not on unrelated re-renders or clock ticks", async () => {
      await saveProviderKey(DUMMY_KEY);
      stubGeometry({ top: 600, bottom: 900 });
      const calls = captureScrollByCalls();
      let nowMs = 1_000;
      const user = userEvent.setup();
      render(<SettingsScreen clock={{ now: () => nowMs }} />);
      await waitFor(() => screen.getByRole("button", { name: "Delete key" }));
      await user.click(screen.getByRole("button", { name: "Delete key" }));
      expect(calls).toHaveLength(1);

      // An unrelated Settings control commits a real state change and a
      // storage write while the confirmation is open.
      nowMs += 5_000;
      await user.click(
        screen.getByRole("checkbox", { name: "Avoid ferries by default" }),
      );
      await waitFor(async () => {
        expect((await getPlanningPreferences()).avoidFerriesByDefault).toBe(false);
      });

      expect(calls).toHaveLength(1);
    });

    it("re-evaluates from the geometry that exists when it is reopened", async () => {
      await saveProviderKey(DUMMY_KEY);
      let inset = { top: 600, bottom: 900 };
      Element.prototype.getBoundingClientRect = function (this: Element) {
        return this.getAttribute("role") === "alertdialog"
          ? rect(inset.top, inset.bottom)
          : rect(0, 0);
      };
      const calls = captureScrollByCalls();
      const user = await openConfirmation();
      expect(calls).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      // The rider has scrolled; the confirmation now opens lower down, so
      // a different correction is required.
      inset = { top: 700, bottom: 1000 };
      await user.click(screen.getByRole("button", { name: "Delete key" }));

      expect(calls).toHaveLength(2);
      expect(calls[0]?.top).toBe(900 - (768 - 8));
      expect(calls[1]?.top).toBe(1000 - (768 - 8));

      // ...and a third opening, at a position that already fits, correctly
      // decides to do nothing rather than repeating the last correction.
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      inset = { top: 200, bottom: 500 };
      await user.click(screen.getByRole("button", { name: "Delete key" }));
      expect(calls).toHaveLength(2);
    });

    it("adds no second movement when Cancel or a successful deletion closes it", async () => {
      await saveProviderKey(DUMMY_KEY);
      stubGeometry({ top: 600, bottom: 900 });
      const calls = captureScrollByCalls();
      const user = await openConfirmation();
      expect(calls).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(calls).toHaveLength(1);

      await user.click(screen.getByRole("button", { name: "Delete key" }));
      expect(calls).toHaveLength(2);
      await user.click(screen.getByRole("button", { name: "Delete" }));
      await waitFor(() => {
        expect(screen.getByText("No key configured")).toBeInTheDocument();
      });

      expect(calls).toHaveLength(2);
    });

    it("never scrolls merely because the confirmation was measured, and deletes nothing", async () => {
      await saveProviderKey(DUMMY_KEY);
      stubGeometry({ top: 600, bottom: 900 });
      captureScrollByCalls();

      await openConfirmation();

      expect((await getProviderKey())?.apiKey).toBe(DUMMY_KEY);
    });
  });

  it("a key replaced in another tab disarms the confirmation, which can never delete the replacement", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await openDeleteConfirmation(user);

    await saveKeyWithDistinctTimestamp(REPLACEMENT_KEY);

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    // The replacement is still there — the armed confirmation was bound to
    // the key it was armed for, so it disarmed rather than deleting a key
    // the rider never saw it armed against.
    expect((await getProviderKey())?.apiKey).toBe(REPLACEMENT_KEY);
    expect(screen.getByRole("button", { name: "Delete key" })).toBeInTheDocument();
  });

  it("shows a rejected-key status message after a failed verification, never concealed in a disclosure", async () => {
    await saveProviderKey(DUMMY_KEY);
    await recordProviderKeyVerification("rejected");
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/was rejected when last checked/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/was rejected when last checked/i).closest("details"),
    ).toBeNull();
  });

  it("shows a quota-limited status message with a fixed clock", async () => {
    await saveProviderKey(DUMMY_KEY);
    await recordProviderKeyVerification("quota-limited", "2026-08-01T00:00:00.000Z");
    const clock = buildFixedClock(Date.parse("2026-07-23T00:00:00.000Z"));
    render(<SettingsScreen clock={clock} />);

    await waitFor(() => {
      expect(screen.getByText(/quota reached, retry after/i)).toBeInTheDocument();
    });
  });

  it("shows a specific, key-free message for a key with an embedded control character, and does not save it", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText("No key configured"));

    // A plain <input> silently strips CR/LF from pasted/typed content per
    // the HTML value-sanitisation algorithm (confirmed against jsdom too),
    // so an embedded newline can never actually reach this field — a NUL
    // byte is not stripped the same way, and does reach saveProviderKey.
    const input = screen.getByLabelText("OpenRouteService API key");
    await user.click(input);
    await user.paste("abc\0def");
    await user.click(screen.getByRole("button", { name: "Save on this device" }));

    await waitFor(() => {
      expect(screen.getByText(/cannot be sent in a request header/i)).toBeInTheDocument();
    });
    expect(screen.getByText("No key configured")).toBeInTheDocument();
  });

  it("saves a key with only a trailing newline without showing an error", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByText("No key configured"));

    const input = screen.getByLabelText("OpenRouteService API key");
    await user.click(input);
    await user.paste(`${DUMMY_KEY}\n`);
    await user.click(screen.getByRole("button", { name: "Save on this device" }));

    await waitFor(() => {
      expect(
        screen.getByText("Key saved on this device, not yet verified"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/cannot be sent in a request header/i)).toBeNull();
  });

  it("shows an offline indicator without hiding the form, never concealed in a disclosure", async () => {
    vi.stubGlobal("navigator", { onLine: false });

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/offline/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("OpenRouteService API key")).toBeInTheDocument();
    expect(screen.getByText(/offline/i).closest("details")).toBeNull();
  });

  describe("visual hierarchy", () => {
    it("has exactly one h1 and the expected panel headings", () => {
      render(<SettingsScreen />);

      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole("heading", { level: 1, name: "Settings" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 3, name: "Route planning" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 3, name: "OpenRouteService" }),
      ).toBeInTheDocument();
    });

    // Backlog item 112. Before this, Settings was four peer h2 panels of which
    // two carried controls and two carried none, with nothing saying which was
    // which. The group level is what makes the screen self-describing, so it
    // is asserted by level, by membership and by order rather than by copy.
    it("groups the four panels under exactly two headings: Preferences, then Explanations", () => {
      render(<SettingsScreen />);

      expect(
        screen
          .getAllByRole("heading", { level: 2 })
          .map((heading) => heading.textContent),
      ).toEqual(["Preferences", "Explanations"]);
    });

    it("puts the two configurable panels under Preferences and the two explanation-only panels under Explanations", () => {
      render(<SettingsScreen />);

      const preferences = screen.getByRole("region", { name: "Preferences" });
      expect(
        within(preferences)
          .getAllByRole("heading", { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(["Route planning", "OpenRouteService"]);

      const explanations = screen.getByRole("region", { name: "Explanations" });
      expect(
        within(explanations)
          .getAllByRole("heading", { level: 3 })
          .map((heading) => heading.textContent),
      ).toEqual(["Elevation and climbs", "Riding"]);

      // The three genuinely configurable properties all live under
      // Preferences, and no control leaks into Explanations.
      expect(
        within(preferences).getByRole("group", { name: "Default cycling profile" }),
      ).toBeInTheDocument();
      expect(
        within(preferences).getByRole("checkbox", { name: "Avoid ferries by default" }),
      ).toBeInTheDocument();
      expect(
        within(preferences).getByLabelText("OpenRouteService API key"),
      ).toBeInTheDocument();
      expect(within(explanations).queryAllByRole("button")).toHaveLength(0);
      expect(within(explanations).queryAllByRole("checkbox")).toHaveLength(0);
      expect(within(explanations).queryAllByRole("textbox")).toHaveLength(0);
    });

    it("keeps all four panel cards, each as its own panel beneath its group", () => {
      render(<SettingsScreen />);

      for (const name of [
        "Route planning",
        "OpenRouteService",
        "Elevation and climbs",
        "Riding",
      ]) {
        const panel = screen.getByRole("heading", { level: 3, name }).closest("section");
        expect(panel).not.toBeNull();
        expect(panel).toHaveClass("panel");
      }
    });

    it("keeps the longer key/route-data explanation in a collapsed, keyboard-operable disclosure", () => {
      render(<SettingsScreen />);

      const details = screen.getByText(/not encrypted/i).closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");
      expect(
        screen.getByText("How the key and route data are used").closest("summary"),
      ).not.toBeNull();
      // The HeiGIT data-flow sentence lives in the same disclosure.
      expect(
        screen
          .getByText(
            /your key and the waypoints you have placed are sent directly to heigit/i,
          )
          .closest("details"),
      ).toBe(details);
      // The sign-up sentence and link stay outside the disclosure.
      expect(
        screen.getByRole("link", { name: /openrouteservice key/i }).closest("details"),
      ).toBeNull();
    });

    it("explains route-section recalculation in a collapsed disclosure inside Route planning (backlog item 48)", () => {
      render(<SettingsScreen />);

      const recalcDetails = screen
        .getByText(/calculated in sections between waypoints/i)
        .closest("details");
      expect(recalcDetails).not.toBeNull();
      expect(recalcDetails).not.toHaveAttribute("open");
      expect(
        screen.getByText("How recalculation works").closest("summary"),
      ).not.toBeNull();

      // Lives inside the Route planning panel specifically, not the
      // OpenRouteService one.
      const routePlanningSection = screen
        .getByRole("heading", { name: "Route planning" })
        .closest("section");
      expect(routePlanningSection).toContainElement(recalcDetails);

      // A distinct disclosure from the OpenRouteService key/data one.
      const keyDataDetails = screen.getByText(/not encrypted/i).closest("details");
      expect(keyDataDetails).not.toBe(recalcDetails);
    });
  });

  describe("Avoid ferries by default", () => {
    it("is checked by default when no preferences row has been saved", async () => {
      render(<SettingsScreen />);

      await waitFor(() => {
        expect(
          screen.getByRole("checkbox", { name: "Avoid ferries by default" }),
        ).toBeChecked();
      });
    });

    it("uses draft terminology, not plan, for the hint text", async () => {
      render(<SettingsScreen />);

      await waitFor(() => {
        expect(screen.getByText("Used when a new draft is created.")).toBeInTheDocument();
      });
    });

    it("unchecking then rechecking persists each value", async () => {
      const user = userEvent.setup();
      render(<SettingsScreen />);
      const checkbox = await screen.findByRole("checkbox", {
        name: "Avoid ferries by default",
      });
      await waitFor(() => expect(checkbox).toBeChecked());

      await user.click(checkbox);
      await waitFor(() => expect(checkbox).not.toBeChecked());
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: false,
          profileByDefault: "cycling-road",
        });
      });

      await user.click(checkbox);
      await waitFor(() => expect(checkbox).toBeChecked());
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: true,
          profileByDefault: "cycling-road",
        });
      });
    });

    it("shows an inline error and leaves the checkbox at its last persisted value when saving fails", async () => {
      const putSpy = vi
        .spyOn(db.planningPreferences, "put")
        .mockRejectedValueOnce(new Error("simulated failure"));
      const user = userEvent.setup();
      render(<SettingsScreen />);
      const checkbox = await screen.findByRole("checkbox", {
        name: "Avoid ferries by default",
      });
      await waitFor(() => expect(checkbox).toBeChecked());

      await user.click(checkbox);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
      });
      expect(checkbox).toBeChecked();
      expect(screen.getByRole("alert")).not.toHaveTextContent("simulated failure");

      putSpy.mockRestore();
    });
  });

  describe("Default cycling profile", () => {
    it("has Road bike pressed by default when no preferences row has been saved", async () => {
      render(<SettingsScreen />);

      const group = await screen.findByRole("group", { name: "Default cycling profile" });
      const roadBike = within(group).getByRole("button", { name: "Road bike" });
      const generalCycling = within(group).getByRole("button", {
        name: "General cycling",
      });

      await waitFor(() => {
        expect(roadBike).toHaveAttribute("aria-pressed", "true");
      });
      expect(generalCycling).toHaveAttribute("aria-pressed", "false");
    });

    it("clicking General cycling persists it and flips the pressed state on both buttons", async () => {
      const user = userEvent.setup();
      render(<SettingsScreen />);

      const group = await screen.findByRole("group", { name: "Default cycling profile" });
      const roadBike = within(group).getByRole("button", { name: "Road bike" });
      const generalCycling = within(group).getByRole("button", {
        name: "General cycling",
      });
      await waitFor(() => expect(roadBike).toHaveAttribute("aria-pressed", "true"));

      await user.click(generalCycling);

      await waitFor(() => {
        expect(generalCycling).toHaveAttribute("aria-pressed", "true");
      });
      expect(roadBike).toHaveAttribute("aria-pressed", "false");
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: true,
          profileByDefault: "cycling-regular",
        });
      });
    });

    it("changing the profile preserves the ferries default, and changing ferries preserves the profile default", async () => {
      const user = userEvent.setup();
      render(<SettingsScreen />);

      const checkbox = await screen.findByRole("checkbox", {
        name: "Avoid ferries by default",
      });
      await waitFor(() => expect(checkbox).toBeChecked());
      await user.click(checkbox);
      await waitFor(() => expect(checkbox).not.toBeChecked());
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: false,
          profileByDefault: "cycling-road",
        });
      });

      const group = screen.getByRole("group", { name: "Default cycling profile" });
      const generalCycling = within(group).getByRole("button", {
        name: "General cycling",
      });
      await user.click(generalCycling);

      await waitFor(() => {
        expect(generalCycling).toHaveAttribute("aria-pressed", "true");
      });
      // The ferries value from the earlier write must still be the one
      // persisted — not reverted back to the default true, which would
      // happen if this write captured a stale pre-toggle value.
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: false,
          profileByDefault: "cycling-regular",
        });
      });
      // And the reverse: the checkbox must still reflect the earlier write.
      expect(checkbox).not.toBeChecked();
    });

    it("shows an inline error and leaves both controls at their last persisted values when saving fails", async () => {
      const putSpy = vi
        .spyOn(db.planningPreferences, "put")
        .mockRejectedValueOnce(new Error("simulated failure"));
      const user = userEvent.setup();
      render(<SettingsScreen />);

      const group = await screen.findByRole("group", { name: "Default cycling profile" });
      const roadBike = within(group).getByRole("button", { name: "Road bike" });
      const generalCycling = within(group).getByRole("button", {
        name: "General cycling",
      });
      await waitFor(() => expect(roadBike).toHaveAttribute("aria-pressed", "true"));

      await user.click(generalCycling);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/could not be saved/i);
      });
      expect(roadBike).toHaveAttribute("aria-pressed", "true");
      expect(generalCycling).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("alert")).not.toHaveTextContent("simulated failure");

      putSpy.mockRestore();
    });

    it("disables both the profile buttons and the ferries checkbox while a write is in flight", async () => {
      let resolve!: () => void;
      const promise = new Promise<void>((res) => {
        resolve = res;
      });
      const putSpy = vi
        .spyOn(db.planningPreferences, "put")
        .mockImplementationOnce(
          () => promise as unknown as ReturnType<typeof db.planningPreferences.put>,
        );
      const user = userEvent.setup();
      render(<SettingsScreen />);

      const group = await screen.findByRole("group", { name: "Default cycling profile" });
      const roadBike = within(group).getByRole("button", { name: "Road bike" });
      const generalCycling = within(group).getByRole("button", {
        name: "General cycling",
      });
      const checkbox = screen.getByRole("checkbox", { name: "Avoid ferries by default" });
      await waitFor(() => expect(roadBike).toHaveAttribute("aria-pressed", "true"));

      await user.click(generalCycling);

      await waitFor(() => {
        expect(screen.getByText("Saving…")).toBeInTheDocument();
      });
      expect(roadBike).toBeDisabled();
      expect(generalCycling).toBeDisabled();
      expect(checkbox).toBeDisabled();

      resolve();
      putSpy.mockRestore();
    });
  });

  describe("Elevation and climbs (backlog item 78, extended by item 79)", () => {
    it("keeps 'How climbs are classified' in its own collapsed disclosure, inside a dedicated Elevation and climbs panel", () => {
      render(<SettingsScreen />);

      expect(
        screen.getByRole("heading", { level: 3, name: "Elevation and climbs" }),
      ).toBeInTheDocument();

      const details = screen.getByText("How climbs are classified").closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");

      const elevationClimbsSection = screen
        .getByRole("heading", { name: "Elevation and climbs" })
        .closest("section");
      expect(elevationClimbsSection).toContainElement(details);

      // A distinct panel/disclosure from Route planning's and
      // OpenRouteService's own disclosures.
      const recalcDetails = screen
        .getByText(/calculated in sections between waypoints/i)
        .closest("details");
      expect(recalcDetails).not.toBe(details);
    });

    it("explains every recognition and category threshold using the authoritative exported constants, not a second hand-typed copy", () => {
      render(<SettingsScreen />);

      expect(screen.getByText(/500 m/)).toBeInTheDocument();
      expect(screen.getByText(/at least 3%/)).toBeInTheDocument();
      expect(screen.getByText(/minimum score of 1,500/)).toBeInTheDocument();

      expect(screen.getByText(/Uncategorised: below 8,000/)).toBeInTheDocument();
      expect(screen.getByText(/Category 4: 8,000 to 15,999/)).toBeInTheDocument();
      expect(screen.getByText(/Category 3: 16,000 to 31,999/)).toBeInTheDocument();
      expect(screen.getByText(/Category 2: 32,000 to 63,999/)).toBeInTheDocument();
      expect(screen.getByText(/Category 1: 64,000 to 79,999/)).toBeInTheDocument();
      expect(screen.getByText(/HC: 80,000 or more/)).toBeInTheDocument();
    });

    it("leaves the disclosure collapsed and moves no focus on an ordinary Settings visit", () => {
      render(<SettingsScreen />);

      const details = screen.getByText("How climbs are classified").closest("details");
      expect(details).not.toHaveAttribute("open");
      expect(document.activeElement).not.toBe(
        screen.getByText("How climbs are classified"),
      );
    });
  });

  describe("Local gradient colours (backlog item 79)", () => {
    it("is present as a sibling disclosure after 'How climbs are classified', inside the same panel, collapsed by default", () => {
      render(<SettingsScreen />);

      const classificationDetails = screen
        .getByText("How climbs are classified")
        .closest("details");
      const paletteDetails = screen
        .getByText("Local gradient colours")
        .closest("details");
      expect(paletteDetails).not.toBeNull();
      expect(paletteDetails).not.toHaveAttribute("open");

      const elevationClimbsSection = screen
        .getByRole("heading", { name: "Elevation and climbs" })
        .closest("section");
      expect(elevationClimbsSection).toContainElement(paletteDetails);
      expect(classificationDetails?.compareDocumentPosition(paletteDetails as Node)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it("shows the complete climb-local legend, independent of any open route", () => {
      render(<SettingsScreen />);
      const details = screen.getByText("Local gradient colours").closest("details");
      expect(details).not.toBeNull();
      if (details) details.open = true;

      expect(screen.getByText(/Gentle, flat or brief descent/)).toBeInTheDocument();
      expect(screen.getByText(/Moderate climb/)).toBeInTheDocument();
      expect(screen.getByText(/Hard climb/)).toBeInTheDocument();
      expect(screen.getByText(/Very hard climb/)).toBeInTheDocument();
      expect(screen.getByText(/Extremely steep climb/)).toBeInTheDocument();
      expect(screen.getByText(/9% to just below 12%/)).toBeInTheDocument();
      expect(screen.getByText(/12% or more/)).toBeInTheDocument();
    });

    it("shows the complete descent-local legend, including neutral", () => {
      render(<SettingsScreen />);
      const details = screen.getByText("Local gradient colours").closest("details");
      if (details) details.open = true;

      expect(
        screen.getByText(/Shallower than the descent threshold/),
      ).toBeInTheDocument();
      expect(screen.getByText(/Moderate descent/)).toBeInTheDocument();
      expect(screen.getByText(/Steep descent/)).toBeInTheDocument();
      expect(screen.getByText(/Very steep descent/)).toBeInTheDocument();
      expect(screen.getByText(/light blue/)).toBeInTheDocument();
      expect(screen.getByText(/dark blue/)).toBeInTheDocument();
    });

    it("explains the ~100 m local smoothing, the green-for-brief-flat-sections rule and the descent safety limitation", () => {
      render(<SettingsScreen />);
      const details = screen.getByText("Local gradient colours").closest("details");
      if (details) details.open = true;

      expect(screen.getByText(/approximately 100 m/)).toBeInTheDocument();
      expect(
        screen.getByText(/brief flat or descending section within a recognised climb/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Blue intensity reflects gradient steepness only, not surface, bends, traffic or other conditions\./,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("Riding — Screen on explanation (backlog item 82)", () => {
    it("has its own dedicated panel, with the explanation in a collapsed disclosure", () => {
      render(<SettingsScreen />);

      expect(
        screen.getByRole("heading", { level: 3, name: "Riding" }),
      ).toBeInTheDocument();

      const details = screen.getByText("Screen on").closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");

      const ridingSection = screen
        .getByRole("heading", { name: "Riding" })
        .closest("section");
      expect(ridingSection).toContainElement(details);
    });

    it("explains what Screen on does and includes an explicit battery warning", () => {
      render(<SettingsScreen />);
      const details = screen.getByText("Screen on").closest("details");
      if (details) details.open = true;

      expect(
        screen.getByText(/keeps the display on while an active riding or free-roam/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/may increase battery use/i)).toBeInTheDocument();
    });

    it("makes clear this only applies to a visible active screen, not background tracking", () => {
      render(<SettingsScreen />);
      const details = screen.getByText("Screen on").closest("details");
      if (details) details.open = true;

      expect(screen.getByText(/not background location tracking/i)).toBeInTheDocument();
    });

    it("does not duplicate the live wake-lock toggle in Settings", () => {
      render(<SettingsScreen />);

      expect(screen.queryByRole("button", { name: "Screen on" })).not.toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /screen on/i })).toBeNull();
    });
  });
});
