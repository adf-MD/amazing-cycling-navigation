import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";
import { SettingsStatusSwitcher } from "./SettingsStatusSwitcher.tsx";

describe("SettingsStatusSwitcher", () => {
  it("is a labelled navigation landmark of two buttons, Settings then Status", () => {
    render(<SettingsStatusSwitcher view="settings" onSelectView={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Settings and Status" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Settings", "Status"]);
  });

  it("marks exactly the view showing as the current page", () => {
    const { rerender } = render(
      <SettingsStatusSwitcher view="settings" onSelectView={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Status" })).not.toHaveAttribute(
      "aria-current",
    );

    rerender(<SettingsStatusSwitcher view="diagnostics" onSelectView={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Status" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Settings" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("asks for the other view, by its internal key", async () => {
    const user = userEvent.setup();
    const onSelectView = vi.fn();
    render(<SettingsStatusSwitcher view="settings" onSelectView={onSelectView} />);

    await user.click(screen.getByRole("button", { name: "Status" }));

    expect(onSelectView).toHaveBeenCalledExactlyOnceWith("diagnostics");
  });

  it("does nothing for the view already showing, which stays enabled and focusable", async () => {
    const user = userEvent.setup();
    const onSelectView = vi.fn();
    render(<SettingsStatusSwitcher view="diagnostics" onSelectView={onSelectView} />);
    const current = screen.getByRole("button", { name: "Status" });

    await user.click(current);

    expect(onSelectView).not.toHaveBeenCalled();
    expect(current).toBeEnabled();
    expect(document.activeElement).toBe(current);
  });

  it("reads in German", () => {
    render(
      <LanguageProvider preference="de">
        <SettingsStatusSwitcher view="settings" onSelectView={vi.fn()} />
      </LanguageProvider>,
    );

    const nav = screen.getByRole("navigation", { name: "Einstellungen und Status" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Einstellungen", "Status"]);
  });
});
