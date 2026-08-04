import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
        });
      });

      await user.click(checkbox);
      await waitFor(() => expect(checkbox).toBeChecked());
      await waitFor(async () => {
        await expect(getPlanningPreferences()).resolves.toEqual({
          avoidFerriesByDefault: true,
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
});
