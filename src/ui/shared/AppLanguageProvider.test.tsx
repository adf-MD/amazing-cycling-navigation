import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AppLanguageProvider } from "./AppLanguageProvider.tsx";
import { useLanguageContext } from "../../i18n/useTranslate.ts";
import { db } from "../../storage/db.ts";
import { getAppPreferences } from "../../storage/appPreferencesRepository.ts";

function Probe() {
  const context = useLanguageContext();
  return (
    <>
      <p data-testid="preference">{context?.preference ?? "none"}</p>
      <p data-testid="language">{context?.language ?? "none"}</p>
      <button
        type="button"
        onClick={() => {
          context?.selectPreference("de");
        }}
      >
        choose German
      </button>
    </>
  );
}

beforeEach(async () => {
  await db.appPreferences.clear();
});

describe("AppLanguageProvider", () => {
  it("uses the bootstrap's preference until the live query lands", () => {
    render(
      <AppLanguageProvider initialPreference="de">
        <Probe />
      </AppLanguageProvider>,
    );
    expect(screen.getByTestId("preference")).toHaveTextContent("de");
  });

  it("corrects a bootstrap that timed out, once the stored row arrives", async () => {
    // The other half of the bounded pre-render read. A slow or failing
    // bootstrap renders with the default; this live query is what makes
    // that honest rather than permanent.
    await db.appPreferences.put({ id: "app", language: "de" });

    render(
      <AppLanguageProvider initialPreference="device">
        <Probe />
      </AppLanguageProvider>,
    );
    expect(screen.getByTestId("preference")).toHaveTextContent("device");

    await waitFor(() => {
      expect(screen.getByTestId("preference")).toHaveTextContent("de");
    });
    // Still English, because the gate has not opened — the correction is
    // of the stored choice, not of the rendered language.
    expect(screen.getByTestId("language")).toHaveTextContent("en");
  });

  it("persists a chosen preference so it survives the next launch", async () => {
    render(
      <AppLanguageProvider initialPreference="device">
        <Probe />
      </AppLanguageProvider>,
    );

    screen.getByRole("button", { name: "choose German" }).click();

    await waitFor(async () => {
      expect(await getAppPreferences()).toEqual({ language: "de" });
    });
    // Written exactly as chosen, not clamped to what this build can show.
    expect((await db.appPreferences.get("app"))?.language).toBe("de");
  });
});
