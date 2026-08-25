import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { db } from "../../storage/db.ts";
import {
  recordProviderKeyVerification,
  saveProviderKey,
} from "../../storage/providerKeyRepository.ts";
import { getPlanningPreferences } from "../../storage/planningPreferencesRepository.ts";
import type { Clock } from "../../platform/clock.ts";

const DUMMY_KEY = "test-dummy-settings-key-0000";

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

  it("deleting the key requires confirmation, then removes it", async () => {
    await saveProviderKey(DUMMY_KEY);
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await waitFor(() => screen.getByRole("button", { name: "Delete key" }));

    await user.click(screen.getByRole("button", { name: "Delete key" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.getByText("No key configured")).toBeInTheDocument();
    });
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
        screen.getByRole("heading", { level: 2, name: "Route planning" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { level: 2, name: "OpenRouteService" }),
      ).toBeInTheDocument();
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

  describe("Elevation and climbs / climb-score explanation (backlog item 78)", () => {
    it("keeps 'How climbs are classified' in its own collapsed disclosure, inside a dedicated Elevation and climbs panel", () => {
      render(<SettingsScreen />);

      expect(
        screen.getByRole("heading", { level: 2, name: "Elevation and climbs" }),
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

    it("opens and focuses the disclosure synchronously when climbScoreHelpFocusToken is supplied, and consumes it once", () => {
      const onClimbScoreHelpFocusConsumed = vi.fn();
      render(
        <SettingsScreen
          climbScoreHelpFocusToken={1}
          onClimbScoreHelpFocusConsumed={onClimbScoreHelpFocusConsumed}
        />,
      );

      const details = screen.getByText("How climbs are classified").closest("details");
      expect(details).toHaveAttribute("open");
      expect(document.activeElement).toBe(
        screen.getByText("How climbs are classified").closest("summary"),
      );
      expect(onClimbScoreHelpFocusConsumed).toHaveBeenCalledTimes(1);
    });

    it("does not re-fire on a rerender with the same token, but does for a genuinely new token", () => {
      const onClimbScoreHelpFocusConsumed = vi.fn();
      const { rerender } = render(
        <SettingsScreen
          climbScoreHelpFocusToken={1}
          onClimbScoreHelpFocusConsumed={onClimbScoreHelpFocusConsumed}
        />,
      );
      const details = screen.getByText("How climbs are classified").closest("details");
      expect(onClimbScoreHelpFocusConsumed).toHaveBeenCalledTimes(1);

      // Collapse it again, then rerender with the unchanged token — a
      // repeat trip through App.tsx that never cleared the prop must not
      // reopen/refocus it a second time.
      if (details) details.open = false;
      rerender(
        <SettingsScreen
          climbScoreHelpFocusToken={1}
          onClimbScoreHelpFocusConsumed={onClimbScoreHelpFocusConsumed}
        />,
      );
      expect(details).not.toHaveAttribute("open");
      expect(onClimbScoreHelpFocusConsumed).toHaveBeenCalledTimes(1);

      // A genuinely new token fires again — repeated activation works.
      rerender(
        <SettingsScreen
          climbScoreHelpFocusToken={2}
          onClimbScoreHelpFocusConsumed={onClimbScoreHelpFocusConsumed}
        />,
      );
      expect(details).toHaveAttribute("open");
      expect(onClimbScoreHelpFocusConsumed).toHaveBeenCalledTimes(2);
    });
  });
});
