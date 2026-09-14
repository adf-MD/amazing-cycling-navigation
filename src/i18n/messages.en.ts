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

  // --- Route Library: screen chrome ---------------------------------
  "routes.landmarkLabel": "Route library",
  "routes.title": "Routes",
  "routes.searchLabel": "Search routes",
  "routes.clearSearch": "Clear search",
  "routes.sortLabel": "Sort by",
  "routes.sort.mostRecent": "Most recent",
  // translator: A-Z is an alphabetical range, not two letters. Use the
  // range your language's alphabet actually spans. The dash is an en dash.
  "routes.sort.nameAsc": "Name A–Z",
  "routes.sort.longest": "Longest route",
  "routes.sort.mostAscent": "Most total ascent",
  "routes.saving": "Saving…",
  "routes.loading": "Loading routes…",
  "routes.emptyLibrary": "No routes saved yet. Import a GPX file to get started.",
  // translator: {query} is the rider's own search text, reproduced exactly.
  // The quotation marks are the message's, so use your language's own.
  "routes.noMatchQueryAndTags": "No routes match “{query}” and the selected tags.",
  "routes.noMatchTags": "No routes match the selected tags.",
  "routes.noMatchQuery": "No routes match “{query}”.",
  "routes.preferenceSaveFailed":
    "This preference could not be saved on this device. Try again.",

  // --- Route Library: tag filtering ---------------------------------
  "routes.filterByTags": "Filter by tags",
  "routes.manageTags": "Manage tags",
  "routes.clearTagFilters": "Clear tag filters",
  "routes.count": { one: "1 route", other: "{count} routes" },
  "routes.filtersActive": { one: "1 filter active", other: "{count} filters active" },
  "routes.noneWouldRemain": "No routes would remain",
  "routes.wouldRemain": {
    one: "1 route would remain",
    other: "{count} routes would remain",
  },

  // --- Route Library: busy guards -----------------------------------
  "routes.busy.savingTags": "Finish saving that route's tags first, then manage tags.",
  "routes.busy.deleting": "Wait for the route deletion to finish, then manage tags.",
  "routes.busy.switching": "Wait for the ride switch to finish, then manage tags.",
  "routes.busy.tagUpdate": "Wait for the tag update to finish, then filter by tags.",

  // --- Route Library: failures --------------------------------------
  "routes.error.import": "That file could not be imported.",
  "routes.error.export": "That route could not be exported.",
  "routes.error.delete": "That route could not be deleted.",
  "routes.error.pin": "This route could not be pinned. Try again.",
  "routes.error.unpin": "This route could not be unpinned. Try again.",
  "routes.error.saveTags": "This route's tags could not be saved. Try again.",
  "routes.error.renameTag": "That tag could not be renamed. Try again.",
  "routes.error.deleteTag": "That tag could not be deleted. Try again.",
  "routes.error.tagNameRequired": "Enter a new name for this tag.",

  // --- Route card ----------------------------------------------------
  "routes.card.nameLabel": "Route name",
  "routes.card.save": "Save",
  "routes.card.cancel": "Cancel",
  "routes.card.addTagLabel": "Add a tag",
  "routes.card.addTag": "Add tag",
  "routes.card.tagSuggestions": "Tag suggestions",
  "routes.card.saveTags": "Save tags",
  "routes.card.tags": "Tags",
  "routes.card.rename": "Rename",
  "routes.card.editTags": "Edit tags",
  "routes.card.addTags": "Add tags",
  "routes.card.export": "Export",
  "routes.card.delete": "Delete",
  // translator: {name} is the rider's own route name, reproduced exactly.
  "routes.card.pin": "Pin {name}",
  "routes.card.unpin": "Unpin {name}",
  "routes.card.deleteConfirmTitle": "Delete “{name}”?",
  "routes.card.deleteConfirmBody":
    "This route will be permanently deleted from this device. This cannot be undone.",
  "routes.card.deleteConfirm": "Delete route",
  "routes.card.deleting": "Deleting…",
  "routes.card.returnToPausedRide": "Return to paused ride",

  // --- Manage tags ---------------------------------------------------
  "tags.manage.heading": "Manage tags",
  "tags.manage.empty": "No tags left. Add tags from a route to manage them here.",
  "tags.manage.close": "Close",
  "tags.manage.selectLabel": "Tag to manage",
  "tags.manage.selectPlaceholder": "Choose a tag",
  // translator: {tag} is a rider-created tag, reproduced exactly.
  "tags.manage.option": { one: "{tag} (1 route)", other: "{tag} ({count} routes)" },
  "tags.manage.newNameLabel": "New name",
  "tags.manage.hint": "Choose a tag to rename, merge or delete it everywhere it is used.",
  "tags.manage.applying": "Applying…",
  "tags.manage.merge": "Merge tags",
  "tags.manage.rename": "Rename tag",
  "tags.manage.delete": "Delete tag",
  "tags.manage.cancel": "Cancel",

  // --- Tag lifecycle: preview ----------------------------------------
  // translator: {source} and {target} are rider-created tag names,
  // reproduced exactly; the quotation marks belong to the message.
  "tags.preview.rename": {
    one: "Rename “{source}” on 1 route.",
    other: "Rename “{source}” on {count} routes.",
  },
  "tags.preview.merge": {
    one: "Merge “{source}” into “{target}” on 1 route.",
    other: "Merge “{source}” into “{target}” on {count} routes.",
  },
  "tags.preview.renameTo": {
    one: "Rename “{source}” to “{target}” on 1 route.",
    other: "Rename “{source}” to “{target}” on {count} routes.",
  },

  // --- Tag lifecycle: confirmations ----------------------------------
  // translator: destructive. Keep this vocabulary consistent with every
  // other delete and merge action in the application.
  "tags.confirm.mergeTitle": "Merge “{source}” into “{target}”?",
  "tags.confirm.mergeMessage": {
    one: "“{target}” already exists, so this merges the two tags on 1 route. “{source}” will no longer exist. No route is deleted.",
    other:
      "“{target}” already exists, so this merges the two tags on {count} routes. “{source}” will no longer exist. No route is deleted.",
  },
  "tags.confirm.deleteTitle": "Delete the tag “{tag}”?",
  "tags.confirm.deleteMessage": {
    one: "“{tag}” will be removed from 1 route. The routes themselves are not deleted and stay in your library.",
    other:
      "“{tag}” will be removed from {count} routes. The routes themselves are not deleted and stay in your library.",
  },

  // --- Tag lifecycle: outcomes ---------------------------------------
  "tags.success.unused": "“{source}” is no longer used by any route, so nothing changed.",
  "tags.success.deleted": {
    one: "Deleted “{source}” from 1 route. Those routes are still saved.",
    other: "Deleted “{source}” from {count} routes. Those routes are still saved.",
  },
  "tags.success.merged": {
    one: "Merged “{source}” into “{target}” on 1 route.",
    other: "Merged “{source}” into “{target}” on {count} routes.",
  },
  "tags.success.renamed": {
    one: "Renamed “{source}” to “{target}” on 1 route.",
    other: "Renamed “{source}” to “{target}” on {count} routes.",
  },

  // --- GPX import ----------------------------------------------------
  "gpx.import": "Import GPX",
  "gpx.importFile": "Import GPX file",
} as const;

export type MessageKey = keyof typeof en;
export type EnglishCatalogue = typeof en;
