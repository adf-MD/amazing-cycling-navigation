import {
  entryPlaceholderNames,
  isPluralEntry,
  isRichEntry,
  placeholderNames,
  placeholderPattern,
  type MatchingEntry,
  type MessageEntry,
  type MessageValue,
  type ParamsFor,
  type ParamsForExcept,
  type Placeholders,
  type PluralEntry,
  type RichEntry,
} from "./catalogue.ts";
import { en, type EnglishCatalogue, type MessageKey } from "./messages.en.ts";
import { INTL_LOCALES, type AppLanguage } from "./language.ts";
import { logError } from "../platform/errorLog.ts";

/**
 * Message lookup and substitution.
 *
 * Backlog item 113. Four layers of protection, in order of how early they
 * catch a mistake:
 *
 * 1. key and shape parity, at compile time, from `Catalogue` below;
 * 2. placeholder-name parity between catalogues, in a test;
 * 3. parameter names derived from the English text, at compile time;
 * 4. runtime validation that throws in development and test, and falls
 *    back to English in production.
 *
 * Layer 4 exists because a naive `{name}` splitter that silently emits an
 * unsubstituted placeholder is exactly the failure a rider would see and
 * nobody else would.
 */

/** A translated catalogue: every English key, each with a matching shape. */
export type Catalogue = {
  readonly [K in MessageKey]: MatchingEntry<EnglishCatalogue[K]>;
};

type EntryOf<K extends MessageKey> = EnglishCatalogue[K];

/** Keys whose entry is a plain string. */
export type PlainMessageKey = {
  [K in MessageKey]: EntryOf<K> extends string ? K : never;
}[MessageKey];

/** Keys whose entry carries `one`/`other`. */
export type PluralMessageKey = {
  [K in MessageKey]: EntryOf<K> extends PluralEntry ? K : never;
}[MessageKey];

/** Keys whose entry is substituted with React nodes rather than text. */
export type RichMessageKey = {
  [K in MessageKey]: EntryOf<K> extends RichEntry ? K : never;
}[MessageKey];

type PlainArgs<K extends PlainMessageKey> = ParamsFor<EntryOf<K> & string, MessageValue>;

/**
 * Plain keys whose message has no placeholders, so `t(key)` needs no
 * second argument.
 *
 * This exists because a component that stores keys in a table — the
 * primary navigation's `NAV_ITEMS`, for instance — cannot type them as
 * the whole `MessageKey` union: some of those messages require
 * parameters, and `t` rightly refuses a bare call for them. Naming the
 * parameterless subset keeps that guarantee intact rather than casting
 * around it.
 */
export type ParameterlessMessageKey = {
  [K in PlainMessageKey]: [Placeholders<EntryOf<K> & string>] extends [never] ? K : never;
}[PlainMessageKey];

/**
 * A plural message's parameters, derived from its `other` variant — the
 * one that carries every placeholder, since `one` may legitimately spell
 * its count out ("1 route"). `{count}` is excluded because it is supplied
 * positionally, so `plural("routes.count", 3)` needs no parameter object
 * at all while `plural("tags.preview.merge", 3, { source, target })` does.
 *
 * Placeholder-name parity between catalogues is what keeps deriving this
 * from `other` alone safe: a translation cannot introduce a placeholder in
 * `one` that `other` lacks without failing that check.
 */
type PluralArgs<K extends PluralMessageKey> = ParamsForExcept<
  (EntryOf<K> & PluralEntry)["other"],
  MessageValue,
  "count"
>;

/**
 * Thrown for a message that cannot be rendered correctly. Never surfaced
 * to a rider: `translateWithCatalogue` catches it in production and falls
 * back to English, recording the failure in the existing error log.
 */
export class MessageFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageFormatError";
  }
}

/**
 * Development and test fail loudly; production must not throw at a rider
 * mid-ride. `import.meta.env.DEV` is Vite's own flag and is statically
 * replaced at build time, so the throwing branch is not shipped.
 */
function shouldThrowOnMessageError(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === "test";
}

/**
 * Substitutes `{name}` placeholders. Validates in both directions: a
 * supplied parameter the message does not use is as much a mistake as a
 * placeholder nothing supplies, because both mean the call site and the
 * message have drifted apart.
 *
 * **Validation reads the template, never the substituted result.** This is
 * load-bearing, not a style choice. Substituted values routinely carry
 * user-authored text — a route name, a tag — which may legitimately
 * contain braces: `My {weird} route` is a perfectly valid route name. An
 * earlier version swept the *result* for leftover placeholder syntax and
 * so rejected exactly that, turning a rider's own punctuation into a
 * formatting error. Checking the template up front catches every defect
 * that sweep was meant to catch (a placeholder with no value) while
 * leaving user content inert.
 *
 * Substituted text is never re-scanned either: `String.prototype.replace`
 * with a function callback walks the original string once, so a value
 * containing `{b}` is not mistaken for the `b` parameter.
 */
export function formatMessage(
  message: string,
  params: Readonly<Record<string, MessageValue>> | undefined,
  describeKey: string,
): string {
  const required = placeholderNames(message);

  for (const name of required) {
    if (params?.[name] === undefined) {
      throw new MessageFormatError(
        `Message "${describeKey}" has no value for placeholder {${name}}.`,
      );
    }
  }

  for (const supplied of Object.keys(params ?? {})) {
    if (!required.includes(supplied)) {
      throw new MessageFormatError(
        `Message "${describeKey}" was given an unused parameter "${supplied}".`,
      );
    }
  }

  return message.replace(placeholderPattern(), (_whole, rawName: string) => {
    // Guaranteed present by the template check above.
    const value = params?.[rawName];
    return typeof value === "number" ? String(value) : (value ?? "");
  });
}

/**
 * `count` is supplied implicitly for every plural message, but many plural
 * messages never interpolate it — they only use it to choose a variant. It
 * is dropped rather than exempted from the unused-parameter check, so that
 * an explicitly passed, genuinely unused parameter is still an error.
 */
function dropUnusedCount(
  text: string,
  params: Readonly<Record<string, MessageValue>> | undefined,
): Readonly<Record<string, MessageValue>> | undefined {
  if (params === undefined || !("count" in params)) return params;
  if (placeholderNames(text).includes("count")) return params;
  return Object.fromEntries(Object.entries(params).filter(([name]) => name !== "count"));
}

function plainText(
  entry: MessageEntry,
  count: number | undefined,
  locale: string,
): string {
  if (typeof entry === "string") return entry;
  if (isRichEntry(entry)) return entry.rich;
  const category = new Intl.PluralRules(locale).select(count ?? 0);
  return category === "one" ? entry.one : entry.other;
}

/**
 * Renders one message, falling back to English on any failure rather than
 * letting a formatting mistake reach a rider as an exception. The failure
 * is recorded through `src/platform/errorLog.ts` — the application's
 * existing session-only, redacting error log, already surfaced on the
 * Status screen. No new logging mechanism is introduced for localisation.
 */
function renderText(
  catalogue: Catalogue,
  language: AppLanguage,
  key: MessageKey,
  params: Readonly<Record<string, MessageValue>> | undefined,
  count: number | undefined,
): string {
  const locale = INTL_LOCALES[language];
  try {
    const text = plainText(catalogue[key], count, locale);
    return formatMessage(text, dropUnusedCount(text, params), key);
  } catch (error) {
    if (shouldThrowOnMessageError()) throw error;
    logError("i18n", error);
    try {
      const fallback = plainText(en[key], count, INTL_LOCALES.en);
      return formatMessage(fallback, dropUnusedCount(fallback, params), key);
    } catch {
      // Both catalogues failed, so there is nothing truthful left to
      // render. An empty string is preferable to leaking a message key,
      // which would be meaningless to a rider.
      return "";
    }
  }
}

export interface Translator {
  readonly language: AppLanguage;
  /** The BCP 47 locale for `Intl`, distinct from the document's tag. */
  readonly locale: string;
  /** A plain message. Takes no parameters unless its text has some. */
  t: <K extends PlainMessageKey>(key: K, ...args: PlainArgs<K>) => string;
  /** A plural message. `count` selects the category and is also available as {count}. */
  plural: <K extends PluralMessageKey>(
    key: K,
    count: number,
    ...args: PluralArgs<K>
  ) => string;
  /** The raw text of a rich message, for the RichText component to split. */
  richTemplate: (key: RichMessageKey) => string;
}

export function createTranslator(
  language: AppLanguage,
  catalogue: Catalogue,
): Translator {
  return {
    language,
    locale: INTL_LOCALES[language],
    t: (key, ...args) => renderText(catalogue, language, key, args[0], undefined),
    plural: (key, count, ...args) =>
      renderText(
        catalogue,
        language,
        key,
        { count, ...((args[0] ?? {}) as Readonly<Record<string, MessageValue>>) },
        count,
      ),
    richTemplate: (key) => {
      const entry = catalogue[key];
      if (isRichEntry(entry)) return entry.rich;
      const english = en[key];
      return isRichEntry(english) ? english.rich : "";
    },
  };
}

export { entryPlaceholderNames, isPluralEntry, isRichEntry, placeholderNames };
