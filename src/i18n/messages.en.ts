/**
 * The canonical English catalogue, and the source of `MessageKey`.
 *
 * Backlog item 113. English is the complete fallback: every key exists
 * here first, and a translated catalogue is typed against this object, so
 * a missing, extra or wrongly-shaped translation cannot compile.
 *
 * Conventions:
 *
 * - keys are stable and semantic, grouped by feature, and never derived
 *   from the English text, so rewording is not a key change;
 * - messages are whole sentences with named `{placeholders}` — never
 *   fragments concatenated at the call site, which German word order
 *   would need to reorder;
 * - British spelling, per this project's interface rules;
 * - a `translator:` comment accompanies anything ambiguous,
 *   safety-critical or space-constrained.
 *
 * **Every string here is byte-identical to the literal it replaced.** That
 * is what makes the existing body of Vitest and Playwright assertions the
 * regression proof for this migration rather than 6000 edits: if a word
 * moved, they fail.
 *
 * `as const` is load-bearing — it preserves the literal types that
 * catalogue.ts's placeholder and shape machinery reads.
 */
export const en = {
  // --- Primary navigation -------------------------------------------
  // translator: these five labels each render in a fifth of the viewport
  // width at 0.7rem, and are the most space-constrained copy in the
  // application. Read the item's own measurements before changing one.
  "nav.landmarkLabel": "Main",
  "nav.routes": "Routes",
  "nav.ride": "Ride",
  "nav.plan": "Plan",
  // translator: the destination showing system status, recent errors and
  // the routing connection test — a status noun, never a verb.
  "nav.status": "Status",
  "nav.settings": "Settings",

  // --- Settings: screen chrome --------------------------------------
  "settings.landmarkLabel": "Settings",
  "settings.title": "Settings",
  "settings.offline":
    "Offline — you can still view or edit your saved key, but calculating a route needs a connection.",
  // translator: the group heading over every card a rider can change. It
  // sits directly beneath the screen title, so it must not repeat it.
  "settings.group.preferences": "Preferences",
  // translator: the group heading over the cards that only explain.
  "settings.group.explanations": "Explanations",

  // --- Settings: route planning -------------------------------------
  "settings.routePlanning.heading": "Route planning",
  "settings.routePlanning.defaultProfile": "Default cycling profile",
  "settings.routePlanning.avoidFerries": "Avoid ferries by default",
  "settings.routePlanning.avoidFerriesHint": "Used when a new draft is created.",
  "settings.routePlanning.saving": "Saving…",
  "settings.routePlanning.saveFailed":
    "This preference could not be saved on this device. Try again.",
  "settings.routePlanning.recalculationSummary": "How recalculation works",
  "settings.routePlanning.recalculationBody":
    "A route is calculated in sections between waypoints. The first calculation uses one routing request per section; later edits normally recalculate only changed sections.",

  // --- Settings: OpenRouteService -----------------------------------
  "settings.ors.heading": "OpenRouteService",
  // translator: a rich message — {link} is the sign-up link itself, whose
  // own text is settings.ors.signUpLink. Keep it one sentence so the
  // link can sit wherever the language needs it.
  "settings.ors.intro": {
    rich: "Road-bike route planning uses your own free key from {link}, obtained from the HeiGIT account dashboard, then pasted below.",
  },
  "settings.ors.signUpLink": "HeiGIT — sign up for an OpenRouteService key",
  "settings.ors.keyInputLabel": "OpenRouteService API key",
  "settings.ors.hide": "Hide",
  "settings.ors.reveal": "Reveal",
  "settings.ors.save": "Save on this device",
  "settings.ors.cancel": "Cancel",
  "settings.ors.saved": "Key saved on this device: •••• (hidden)",
  "settings.ors.replace": "Replace key",
  // translator: destructive. Keep this vocabulary consistent with every
  // other delete action in the application.
  "settings.ors.delete": "Delete key",
  "settings.ors.deleteConfirmTitle": "Delete OpenRouteService key",
  "settings.ors.deleteConfirmMessage":
    "This removes your saved key from this device. Route planning will be unavailable until you enter a key again. Any routes you have already saved remain fully usable without it.",
  "settings.ors.deleteConfirmLabel": "Delete",
  "settings.ors.saveFailedInvalidHeader":
    "This key contains a character that cannot be sent in a request header. Check for an accidental line break introduced while copying it.",
  "settings.ors.saveFailed": "The key could not be saved on this device. Try again.",
  "settings.ors.usageSummary": "How the key and route data are used",
  "settings.ors.usageBody":
    "When you calculate a route in Planning, your key and the waypoints you have placed are sent directly to HeiGIT to compute the route. Your riding GPS location is never sent to HeiGIT.",
  // translator: a rich message, and a safety statement — {emphasis} is the
  // words "not encrypted" rendered strongly. Do not soften it.
  "settings.ors.usageStorage": {
    rich: "This is {emphasis}. It is stored on this device only to keep it out of this app's source code and away from accidental publication — any JavaScript running on this site can still read it. Clearing Safari's or your browser's site data for this app removes it, and you will need to enter it again.",
  },
  "settings.ors.usageStorageEmphasis": "not encrypted",

  // --- Settings: elevation and climbs -------------------------------
  "settings.elevation.heading": "Elevation and climbs",
  "settings.elevation.classificationSummary": "How climbs are classified",
  "settings.elevation.climbScore":
    "Climb score is climb length in metres multiplied by average gradient percentage.",
  // translator: {length} is a formatted distance such as "500 m", {gradient}
  // a bare percentage figure such as "3", and {score} a grouped whole
  // number such as "1,500". Keep all three inside one sentence.
  "settings.elevation.recognitionThresholds":
    "A climb is recognised once it is at least {length} long, averages at least {gradient}% and reaches a minimum score of {score}.",
  "settings.elevation.uncategorised": "Uncategorised: below {score}",
  // translator: one row of the climb-category table — {name} is the
  // category's own name, {from} and {to} grouped whole numbers.
  "settings.elevation.categoryRange": "{name}: {from} to {to}",
  "settings.elevation.categoryOrMore": "{name}: {score} or more",
  "settings.elevation.localColoursSummary": "Local gradient colours",
  "settings.elevation.localColoursBody":
    "Detailed colours along a route show local gradient, smoothed over approximately 100 m — not a climb's overall category or a single point's exact grade.",
  "settings.elevation.localColoursFlat":
    "A brief flat or descending section within a recognised climb uses the green, below-3% band.",
  "settings.elevation.localColoursDescent":
    "A recognised descent reuses the same three blues locally; any locally shallow stretch shows the plain route colour instead.",
  "settings.elevation.localColoursCaveat":
    "Blue intensity reflects gradient steepness only, not surface, bends, traffic or other conditions.",

  // --- Settings: riding ----------------------------------------------
  // translator: this card explains what happens while a ride is on screen.
  // It must not reuse the "Ride" navigation label.
  "settings.riding.heading": "Riding",
  "settings.riding.screenOnSummary": "Screen on",
  "settings.riding.screenOnBody":
    "Keeps the display on while an active Riding or free-roam screen is visible. This may increase battery use.",
  "settings.riding.screenOnCaveat":
    "This only applies while that screen is open and visible — it is not background location tracking, and does not guarantee the display can stay on if your browser does not support this feature.",
} as const;

export type MessageKey = keyof typeof en;
export type EnglishCatalogue = typeof en;
