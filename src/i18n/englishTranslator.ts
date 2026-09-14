import { catalogueFor } from "./catalogues.ts";
import { createTranslator, type Translator } from "./translate.ts";

/**
 * The English translator, as a single shared instance.
 *
 * Two callers, and they are the same fact: the fallback `useTranslate`
 * returns when no provider is mounted, and the translator a pure function
 * is given in a fixture test. English is this application's complete
 * fallback, so "no provider" and "the default" are the same thing.
 *
 * Module-level rather than constructed per call: a translator closes over
 * a catalogue and holds no mutable state, so one instance is reusable —
 * and a stable identity keeps `useTranslate`'s memo from producing a new
 * object on every render.
 */
export const englishTranslator: Translator = createTranslator("en", catalogueFor("en"));
