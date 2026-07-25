import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsScreen } from "./SettingsScreen.tsx";
import { db } from "../../storage/db.ts";
import {
  recordProviderKeyVerification,
  saveProviderKey,
} from "../../storage/providerKeyRepository.ts";
import type { Clock } from "../../platform/clock.ts";

const DUMMY_KEY = "test-dummy-settings-key-0000";

function buildFixedClock(startMs: number): Clock {
  return { now: () => startMs };
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
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

  it("shows a rejected-key status message after a failed verification", async () => {
    await saveProviderKey(DUMMY_KEY);
    await recordProviderKeyVerification("rejected");
    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/was rejected when last checked/i)).toBeInTheDocument();
    });
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

  it("shows an offline indicator without hiding the form", async () => {
    vi.stubGlobal("navigator", { onLine: false });

    render(<SettingsScreen />);

    await waitFor(() => {
      expect(screen.getByText(/offline/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("OpenRouteService API key")).toBeInTheDocument();
  });
});
