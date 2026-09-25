import { en } from "../i18n/messages.en.ts";
import { de } from "../i18n/messages.de.ts";
import type { MessageEntry } from "../i18n/catalogue.ts";

/**
 * A render-based check for English copy on a German screen (item 113's
 * 25 September 2026 follow-up).
 *
 * The source-text allowlists only catch literals someone remembered to
 * name, which is exactly how the route-ride `End ride` trigger survived
 * every stage of item 113 and was found on the installed iPhone instead.
 * This works the other way round: it derives the English-only phrases from
 * the catalogues themselves and looks for any of them in what a German
 * render actually shows.
 *
 * A phrase qualifies when it is a literal run of an English template (the
 * text between placeholders), at least five characters long, containing a
 * letter, and found nowhere in the German catalogue — which excludes
 * product names, endonyms and every value the two languages deliberately
 * share. Matching is whole-phrase, bounded by non-letters, with all
 * whitespace (including U+00A0) collapsed.
 */

const PLACEHOLDER = /\{[^{}]+\}/g;

function entryTexts(entry: MessageEntry): string[] {
  if (typeof entry === "string") return [entry];
  return Object.values(entry).filter(
    (value): value is string => typeof value === "string",
  );
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const GERMAN_TEXT = normalise(
  Object.values(de as Record<string, MessageEntry>)
    .flatMap(entryTexts)
    .join("\n"),
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const ENGLISH_ONLY_PHRASES: readonly string[] = [
  ...new Set(
    Object.values(en as Record<string, MessageEntry>)
      .flatMap(entryTexts)
      .flatMap((template) => template.split(PLACEHOLDER))
      .map(normalise)
      .filter((phrase) => phrase.length >= 5 && /\p{L}{3}/u.test(phrase))
      .filter((phrase) => !GERMAN_TEXT.includes(phrase)),
  ),
];

const MATCHERS = ENGLISH_ONLY_PHRASES.map((phrase) => ({
  phrase,
  pattern: new RegExp(`(?<!\\p{L})${escapeRegExp(phrase)}(?!\\p{L})`, "u"),
}));

const ACCESSIBLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"] as const;

function renderedTexts(root: Element): string[] {
  const texts: string[] = [];
  for (const element of [root, ...root.querySelectorAll("*")]) {
    texts.push(element.textContent);
    for (const attribute of ACCESSIBLE_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value) texts.push(value);
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      texts.push(element.value);
    }
  }
  return texts.map(normalise).filter((text) => text.length > 0);
}

/** Every English-only catalogue phrase visible in, or naming, `root`. */
export function findEnglishLeaks(root: Element): string[] {
  const texts = renderedTexts(root);
  return MATCHERS.filter(({ pattern }) => texts.some((text) => pattern.test(text))).map(
    ({ phrase }) => phrase,
  );
}
