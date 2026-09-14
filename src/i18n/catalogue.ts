import type { ReactNode } from "react";

/**
 * The catalogue's shape, and the types that make a wrong catalogue or a
 * wrong call site fail to compile rather than fail in front of a rider.
 *
 * Backlog item 113. Three entry kinds, one validation regime:
 *
 * - a **plain** entry is a string;
 * - a **plural** entry carries the two categories German and English
 *   share (`Intl.PluralRules` reports exactly `one` and `other` for both);
 * - a **rich** entry is a string whose placeholders are substituted with
 *   React nodes rather than text.
 *
 * Rich is a distinct kind rather than a convention because a convention
 * could not stop a rich key reaching `t()` with string parameters, or a
 * plain key reaching `<RichText>`. With the third shape those are both
 * compile errors (see the `PlainMessageKey`/`RichMessageKey` split).
 */
export type PlainEntry = string;

export interface PluralEntry {
  readonly one: string;
  readonly other: string;
}

export interface RichEntry {
  readonly rich: string;
}

export type MessageEntry = PlainEntry | PluralEntry | RichEntry;

/**
 * Maps an English entry to the shape its translation must have. A
 * translated catalogue is typed with this, so giving a plural key a plain
 * string — or a rich key a plain one — is a `tsc -b` failure, not a
 * runtime surprise. Key parity alone would not catch either.
 */
export type MatchingEntry<E> = E extends RichEntry
  ? RichEntry
  : E extends PluralEntry
    ? PluralEntry
    : PlainEntry;

/**
 * The placeholder names inside a message, as a union of string literals.
 * TypeScript infers the shortest possible leading `${string}`, so `P` is
 * the first `{name}` and `Rest` carries the remainder — recursion depth is
 * the number of placeholders in one message, which is at most a handful.
 * A message with no placeholders yields `never`.
 */
export type Placeholders<S extends string> =
  S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never;

/** What a placeholder may be substituted with in a plain/plural message. */
export type MessageValue = string | number;

/**
 * The parameters a message needs, derived from the English text itself —
 * so `t("x", { distance })` fails to compile when the message says
 * `{distanceKm}`. A message with no placeholders takes no parameters at
 * all, expressed as an empty rest tuple rather than an optional `{}`, so
 * passing one is also an error.
 */
export type ParamsFor<S extends string, V> = ParamsForExcept<S, V, never>;

/**
 * As `ParamsFor`, but with some placeholder names supplied by other
 * means. A plural message's `{count}` is passed positionally, so it must
 * not also be demanded in the parameter object — and when `count` is the
 * message's only placeholder, the call takes no parameter object at all.
 */
export type ParamsForExcept<S extends string, V, Omitted extends string> = [
  Exclude<Placeholders<S>, Omitted>,
] extends [never]
  ? []
  : [params: Readonly<Record<Exclude<Placeholders<S>, Omitted>, V>>];

/**
 * The runtime placeholder pattern, kept beside the type that mirrors it.
 *
 * A **factory**, not a shared constant: a `/g` regular expression carries
 * mutable `lastIndex`, so one shared instance used by both `.test()` and
 * `.replace()` would give different answers depending on what ran before
 * it. Each caller gets its own.
 */
export function placeholderPattern(): RegExp {
  return /\{([^{}]+)\}/g;
}

/** Every placeholder name in a message, in source order, deduplicated. */
export function placeholderNames(message: string): readonly string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(placeholderPattern())) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** Every placeholder name an entry uses, across all of its variants. */
export function entryPlaceholderNames(entry: MessageEntry): readonly string[] {
  if (typeof entry === "string") return placeholderNames(entry);
  if ("rich" in entry) return placeholderNames(entry.rich);
  return [...new Set([...placeholderNames(entry.one), ...placeholderNames(entry.other)])];
}

export function isPluralEntry(entry: MessageEntry): entry is PluralEntry {
  return typeof entry === "object" && "one" in entry;
}

export function isRichEntry(entry: MessageEntry): entry is RichEntry {
  return typeof entry === "object" && "rich" in entry;
}

/** What a rich placeholder may be substituted with. */
export type RichValue = ReactNode;
