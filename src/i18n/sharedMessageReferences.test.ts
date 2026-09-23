import { describe, expect, it } from "vitest";
import { createTranslator } from "./translate.ts";
import { en } from "./messages.en.ts";
import { de } from "./messages.de.ts";

/**
 * Backlog item 113 stage 6b.
 *
 * Two Status messages quote another message. Until this stage they froze
 * the other's English text as a literal, so a German screen would have
 * quoted a sentence that appears nowhere in its own log. Each is now a
 * named placeholder fed the localised value at the call site.
 *
 * What these tests pin is the property that makes that worth doing: the
 * reference reproduces the referenced message **exactly**, in whichever
 * language is active, so the two surfaces cannot drift apart.
 */

const english = createTranslator("en", en);
const german = createTranslator("de", de);

describe("the fetch-failure disclosure quotes the log entry it refers to", () => {
  for (const [name, translator] of [
    ["English", english],
    ["German", german],
  ] as const) {
    it(`reproduces routingLog.noResponseExposed exactly in ${name}`, () => {
      const entry = translator.t("routingLog.noResponseExposed");
      const detail = translator.t("status.fetchFailureDetail", { entry });
      expect(detail).toContain(entry);
      expect(detail).not.toContain("{entry}");
    });
  }

  it("does not keep a second copy of the sentence in either catalogue", () => {
    // The whole point: the words live in exactly one entry.
    expect(en["status.fetchFailureDetail"]).toContain("{entry}");
    expect(de["status.fetchFailureDetail"]).toContain("{entry}");
    expect(en["status.fetchFailureDetail"]).not.toContain(
      en["routingLog.noResponseExposed"],
    );
    expect(de["status.fetchFailureDetail"]).not.toContain(
      de["routingLog.noResponseExposed"],
    );
  });

  it("quotes the German sentence, not the English one, in German", () => {
    const germanDetail = german.t("status.fetchFailureDetail", {
      entry: german.t("routingLog.noResponseExposed"),
    });
    expect(germanDetail).not.toContain(en["routingLog.noResponseExposed"]);
  });
});

describe("the no-HTTP-status row quotes the disclosure heading it refers to", () => {
  for (const [name, translator] of [
    ["English", english],
    ["German", german],
  ] as const) {
    it(`reproduces status.fetchFailureSummary exactly in ${name}`, () => {
      const summary = translator.t("status.fetchFailureSummary");
      const detail = translator.t("status.http.noneDetail", { summary });
      expect(detail).toContain(summary);
      expect(detail).not.toContain("{summary}");
    });
  }

  it("does not keep a second copy of the heading in either catalogue", () => {
    expect(en["status.http.noneDetail"]).toContain("{summary}");
    expect(de["status.http.noneDetail"]).toContain("{summary}");
    expect(en["status.http.noneDetail"]).not.toContain(en["status.fetchFailureSummary"]);
    expect(de["status.http.noneDetail"]).not.toContain(de["status.fetchFailureSummary"]);
  });

  it("drops the positional word, since the disclosure is not reliably above", () => {
    expect(en["status.http.noneDetail"]).not.toMatch(/\babove\b/);
    expect(de["status.http.noneDetail"]).not.toMatch(/\boben\b/);
  });

  it("keeps the qualification that no response reached the app, not that none was sent", () => {
    // A mistranslation here would claim the provider sent nothing, which
    // page JavaScript cannot establish.
    expect(en["status.http.noneDetail"]).toMatch(/available to the app/i);
    expect(de["status.http.noneDetail"]).toMatch(/der App keine HTTP-Antwort/i);
  });
});
