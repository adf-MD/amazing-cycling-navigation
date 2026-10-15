// Backlog items 97 and 145: component-level proof of the untrusted-GPX trust
// notice's presentation, in isolation from RidingScreen's mount/unmount
// lifecycle (see RidingScreen.untrustedGpxNotice.test.tsx for that boundary
// proof). Since item 145 it is one concise, non-interactive status from the
// start: no timer, no compact control and no expandable explanation. The
// fake-timer test advances well past item 97's old ten seconds to prove
// nothing changes there.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { LanguageProvider } from "../../i18n/LanguageProvider.tsx";
import { RidingUntrustedGpxNotice } from "./RidingUntrustedGpxNotice.tsx";

const NOTICE_TEXT = {
  en: "No turn guidance available.",
  de: "Keine Abbiegehinweise verfügbar.",
} as const;

describe("RidingUntrustedGpxNotice", () => {
  for (const language of ["en", "de"] as const) {
    it(`shows exactly the concise notice as a single status (${language})`, () => {
      render(
        <LanguageProvider
          preference={language}
          readLanguages={() => ["en-GB"]}
          documentElement={{ lang: "" }}
        >
          <RidingUntrustedGpxNotice />
        </LanguageProvider>,
      );
      const statusElements = screen.getAllByRole("status");
      expect(statusElements).toHaveLength(1);
      expect(statusElements[0]?.textContent).toBe(NOTICE_TEXT[language]);
    });
  }

  it("is not interactive: no button, no expansion control and no alert", () => {
    const { container } = render(<RidingUntrustedGpxNotice />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the same element and text long after item 97's old ten seconds", () => {
    vi.useFakeTimers();
    try {
      render(<RidingUntrustedGpxNotice />);
      const status = screen.getByRole("status");
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe(NOTICE_TEXT.en);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
