import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMemo, useRef, useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsSection } from "./SettingsSection.tsx";
import { db } from "../../storage/db.ts";
import { getProviderKey, saveProviderKey } from "../../storage/providerKeyRepository.ts";
import * as providerKeyRepository from "../../storage/providerKeyRepository.ts";
import type { Screen, SettingsSectionView } from "../shared/screenTypes.ts";
import {
  createScreenScrollMemory,
  ScreenScrollContext,
} from "../shared/screenScrollMemory.ts";

// Backlog item 121. SettingsSection is what keeps an unfinished
// OpenRouteService key edit across a switch to Status and back, and what
// keeps the switcher's focus across that switch. Since backlog item 125 it
// no longer resets the scroll position (see the last describe). This
// harness stands in for App: it owns the view the way App owns `screen`,
// and it can take the rider out of the section and back, as another tab
// would.

const TYPED_KEY = "test-dummy-typed-but-unsaved-0000";
const STORED_KEY = "test-dummy-stored-key-1111";

function Harness({ initialView = "settings" }: { initialView?: SettingsSectionView }) {
  const [view, setView] = useState<SettingsSectionView>(initialView);
  const [inSection, setInSection] = useState(true);
  const headerRef = useRef<HTMLElement>(null);
  return (
    <>
      <header ref={headerRef}>
        <button
          type="button"
          onClick={() => {
            setInSection((current) => !current);
          }}
        >
          Another tab
        </button>
      </header>
      {inSection ? (
        <SettingsSection view={view} onSelectView={setView} stickyHeaderRef={headerRef} />
      ) : (
        <p>Elsewhere</p>
      )}
    </>
  );
}

function switcher() {
  return screen.getByRole("navigation", { name: "Settings and Status" });
}

function switcherButton(name: "Settings" | "Status") {
  return within(switcher()).getByRole("button", { name });
}

async function switchTo(
  user: ReturnType<typeof userEvent.setup>,
  name: "Settings" | "Status",
) {
  await user.click(switcherButton(name));
  await screen.findByRole("heading", { level: 1, name });
}

function keyInput() {
  return screen.getByLabelText("OpenRouteService API key");
}

beforeEach(async () => {
  await db.providerKeys.clear();
  await db.providerKeyVerifications.clear();
  await db.planningPreferences.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SettingsSection: the unfinished key edit", () => {
  it("keeps a typed but unsaved key across a switch to Status and back", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await switchTo(user, "Status");
    expect(screen.queryByLabelText("OpenRouteService API key")).toBeNull();
    await switchTo(user, "Settings");

    expect(keyInput()).toHaveValue(TYPED_KEY);
  });

  it("masks the key again on return, even if it was revealed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(keyInput()).toHaveAttribute("type", "text");
    await switchTo(user, "Status");
    await switchTo(user, "Settings");

    expect(keyInput()).toHaveValue(TYPED_KEY);
    expect(keyInput()).toHaveAttribute("type", "password");
  });

  it("keeps an open Replace form, and what was typed into it, across the round trip", async () => {
    await saveProviderKey(STORED_KEY);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Replace key" }));

    await user.type(keyInput(), TYPED_KEY);
    await switchTo(user, "Status");
    await switchTo(user, "Settings");

    expect(keyInput()).toHaveValue(TYPED_KEY);
    // Cancel renders only once the remounted screen's live query has
    // re-read the stored key, so it is awaited rather than assumed.
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect((await getProviderKey())?.apiKey).toBe(STORED_KEY);
  });

  it("never writes the unsaved key anywhere", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await switchTo(user, "Status");
    await switchTo(user, "Settings");

    expect(await db.providerKeys.count()).toBe(0);
  });

  it("discards the unsaved key when the rider leaves the section for another tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await user.click(screen.getByRole("button", { name: "Another tab" }));
    expect(screen.getByText("Elsewhere")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Another tab" }));
    await waitFor(() => screen.getByText("No key configured"));

    expect(keyInput()).toHaveValue("");
  });

  it("dismisses an armed Delete-key confirmation on a switch, keeping the key (item 118)", async () => {
    await saveProviderKey(STORED_KEY);
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole("button", { name: "Delete key" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await switchTo(user, "Status");
    await switchTo(user, "Settings");

    await screen.findByRole("button", { name: "Delete key" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((await getProviderKey())?.apiKey).toBe(STORED_KEY);
  });

  it("clears the draft when a save completes while Status is showing", async () => {
    let finishSave: () => void = () => undefined;
    const realSave = providerKeyRepository.saveProviderKey;
    vi.spyOn(providerKeyRepository, "saveProviderKey").mockImplementation(
      (apiKey: string) =>
        new Promise<void>((resolve, reject) => {
          finishSave = () => {
            realSave(apiKey).then(resolve, reject);
          };
        }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await user.click(screen.getByRole("button", { name: "Save on this device" }));
    await switchTo(user, "Status");
    finishSave();
    await waitFor(async () => {
      expect((await getProviderKey())?.apiKey).toBe(TYPED_KEY);
    });
    await switchTo(user, "Settings");

    await screen.findByRole("button", { name: "Delete key" });
    expect(screen.queryByLabelText("OpenRouteService API key")).toBeNull();
  });

  it("still shows a save failure that landed while Status was showing, with the draft intact", async () => {
    let failSave: () => void = () => undefined;
    vi.spyOn(providerKeyRepository, "saveProviderKey").mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          failSave = () => {
            reject(new Error("simulated storage failure"));
          };
        }),
    );
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await user.type(keyInput(), TYPED_KEY);
    await user.click(screen.getByRole("button", { name: "Save on this device" }));
    await switchTo(user, "Status");
    failSave();
    await switchTo(user, "Settings");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not/i);
    expect(keyInput()).toHaveValue(TYPED_KEY);
  });
});

describe("SettingsSection: the switcher and focus", () => {
  it("keeps focus on the very button pressed, which becomes the current page", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const statusButton = switcherButton("Status");

    await switchTo(user, "Status");

    expect(document.activeElement).toBe(statusButton);
    expect(statusButton).toHaveAttribute("aria-current", "page");
    expect(switcherButton("Settings")).not.toHaveAttribute("aria-current");
  });

  it("keeps focus on the same node when switched from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness initialView="diagnostics" />);
    const settingsButton = switcherButton("Settings");
    settingsButton.focus();

    await user.keyboard("{Enter}");
    await screen.findByRole("heading", { level: 1, name: "Settings" });

    expect(document.activeElement).toBe(settingsButton);
    expect(settingsButton).toHaveAttribute("aria-current", "page");
  });
});

// Backlog item 125 replaced item 121's interim top reset: App's screen
// scroll memory restores each view's own position, and the section itself
// never scrolls the page. These tests pin both halves: no scrolling here,
// and each view's report that its content has loaded.
describe("SettingsSection: scroll position (backlog item 125)", () => {
  it("never scrolls the page itself — on entry, on a switch, or for updates within a view", async () => {
    const scrollSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => screen.getByText("No key configured"));

    await switchTo(user, "Status");
    await switchTo(user, "Settings");
    // A disclosure, a preference change (which also re-emits a live query)
    // and typing — none of them changes the rendered view.
    await user.click(screen.getByText("How the key and route data are used"));
    await user.click(screen.getByRole("checkbox", { name: /ferries/i }));
    await waitFor(async () => {
      expect((await db.planningPreferences.toArray()).length).toBe(1);
    });
    await user.type(keyInput(), "a");
    // Pressing the switcher button of the view already shown.
    await user.click(switcherButton("Settings"));

    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("reports each view's content as loaded, under that view, once its reads have answered", async () => {
    const reports: [Screen, boolean][] = [];
    const memory = {
      ...createScreenScrollMemory("settings"),
      arrive: (view: Screen, ready: boolean) => {
        reports.push([view, ready]);
      },
    };
    function ProvidedHarness() {
      const [view, setView] = useState<SettingsSectionView>("settings");
      const headerRef = useRef<HTMLElement>(null);
      return (
        <ScreenScrollContext.Provider value={useMemo(() => ({ memory, view }), [view])}>
          <header ref={headerRef} />
          <SettingsSection
            view={view}
            onSelectView={setView}
            stickyHeaderRef={headerRef}
          />
        </ScreenScrollContext.Provider>
      );
    }
    const user = userEvent.setup();
    render(<ProvidedHarness />);

    expect(reports[0]).toEqual(["settings", false]);
    await waitFor(() => {
      expect(reports.at(-1)).toEqual(["settings", true]);
    });

    await switchTo(user, "Status");
    await waitFor(() => {
      expect(reports.at(-1)).toEqual(["diagnostics", true]);
    });
    expect(reports).toContainEqual(["diagnostics", false]);
  });
});
