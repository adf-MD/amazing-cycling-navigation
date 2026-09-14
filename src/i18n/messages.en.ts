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

  // --- Planning: screen chrome --------------------------------------
  "planning.landmarkLabel": "Planning",
  "planning.title": "Plan a route",
  "planning.loadingDraft": "Loading your draft…",
  "planning.draftLoadFailed":
    "Your saved draft could not be loaded. Nothing in storage has been changed.",
  "planning.retry": "Retry",

  // --- Planning: map controls ---------------------------------------
  "planning.map.zoomIn": "Zoom in",
  "planning.map.zoomOut": "Zoom out",
  "planning.map.northUp": "North-up, top-down view",
  "planning.map.locateMe": "Locate me",
  "planning.map.locating": "Locating…",
  "planning.map.locateFailed": "Your location could not be determined.",
  "planning.map.clearWarningFirst":
    "Clear the selected warning to place or move a waypoint.",
  "planning.map.clearFeatureFirst":
    "Clear the selected route feature to place or move a waypoint.",

  // --- Planning: waypoints ------------------------------------------
  "planning.waypoints.heading": "Waypoints",
  "planning.waypoints.listLabel": "Waypoints",
  "planning.waypoints.empty":
    "No waypoints yet. Tap the map or use the crosshair button below to add one.",
  "planning.waypoints.start": "Start",
  // translator: {number} is the waypoint's position in the list, from 2.
  "planning.waypoints.numbered": "Waypoint {number}",
  // translator: {waypoint} is either the start or a numbered waypoint, from
  // the two messages above. Kept as whole sentences so the verb can move.
  "planning.waypoints.moveUp": "Move {waypoint} up",
  "planning.waypoints.moveDown": "Move {waypoint} down",
  "planning.waypoints.deleteNamed": "Delete {waypoint}",
  "planning.waypoints.actionsGroup": "{waypoint} actions",
  "planning.waypoints.delete": "Delete",
  "planning.waypoints.move": "Move",
  "planning.waypoints.insertAfter": "Insert after",

  // --- Planning: waypoint actions -----------------------------------
  "planning.actions.group": "Waypoint actions",
  "planning.actions.undo": "Undo",
  "planning.actions.redo": "Redo",
  "planning.actions.returnToStart": "Return to start",
  "planning.actions.reverse": "Reverse route",
  "planning.actions.addToEnd": "Add to end",

  // --- Planning: crosshair placement --------------------------------
  // translator: the crosshair button always says exactly what the next tap
  // will do. {waypoint} is "the start" or "waypoint N".
  "planning.place.addHere": "Add waypoint here",
  "planning.place.moveHere": "Move {waypoint} here",
  "planning.place.insertAfter": "Insert after {waypoint}",
  "planning.place.theStart": "the start",
  "planning.place.numbered": "waypoint {number}",

  // --- Planning: calculation ----------------------------------------
  "planning.calculate": "Calculate route",
  "planning.calculating": "Calculating…",
  // translator: only ever shown for two or more sections, never one.
  "planning.calculatingSections": "Calculating {count} route sections…",
  "planning.tryAgain": "Try again",
  "planning.calculateFailed": "The route could not be calculated. Try again.",

  // --- Planning: routing options ------------------------------------
  "planning.routing.profileGroup": "Cycling profile for this draft",
  // translator: {profile} is a cycling-profile name; {ferries} is one of
  // the two words below. Kept as one sentence rather than assembled.
  "planning.routing.summary": "Routing: {profile} · Ferries {ferries}",
  "planning.routing.ferriesAvoided": "avoided",
  "planning.routing.ferriesAllowed": "allowed",
  "planning.routing.change": "Change",
  "planning.routing.avoidFerries": "Avoid ferries for this draft",

  // --- Planning: stale-route status ---------------------------------
  // translator: shown while an already-calculated route is out of date.
  // {current} and {previous} are cycling-profile names.
  "planning.stale.recalculatingProfile":
    "Recalculating for {current}; showing the previous {previous} result below.",
  "planning.stale.waitingProfile":
    "Waiting to recalculate for {current}; showing the previous {previous} result below.",
  "planning.stale.recalculating":
    "Recalculating your latest changes; showing the previous result below.",
  "planning.stale.waiting":
    "Waiting to recalculate your latest changes; showing the previous result below.",

  // --- Planning: edit-copy notices ----------------------------------
  "planning.editCopy.reversedExact":
    "Reversed editable copy created. Recalculate before saving; one-way restrictions may make the new route differ from the original. The saved route remains unchanged.",
  "planning.editCopy.reversedEstimated":
    "Reversed waypoints were estimated from this route. Recalculation may follow different roads, especially around one-way restrictions. The saved route remains unchanged.",
  "planning.editCopy.exact":
    "Editable copy created from the route's original planning waypoints. The saved route will remain unchanged.",
  "planning.editCopy.estimated":
    "Editable waypoints were estimated from this route. Recalculation may follow different roads. The saved route will remain unchanged.",

  // --- Planning: save, export, clear ---------------------------------
  "planning.save.heading": "Save or export",
  "planning.save.nameLabel": "Route name",
  "planning.save.save": "Save route",
  "planning.save.saving": "Saving…",
  "planning.save.export": "Export GPX",
  "planning.save.hint": "Calculate a complete routed result before saving or exporting.",
  "planning.save.failed": "The route could not be saved on this device. Try again.",
  "planning.export.failed": "The route could not be exported.",
  "planning.clearDraft": "Clear draft",
  "planning.clearDraft.clearing": "Clearing…",
  "planning.clearDraft.confirmTitle": "Clear this draft?",
  "planning.clearDraft.confirmMessage":
    "This removes all waypoints, the calculated route and other unsaved draft details. Saved routes are not affected.",
  "planning.clearDraft.cancel": "Cancel",
  "planning.clearDraft.failed":
    "The draft could not be cleared on this device. Try again.",

  // --- Planning: no API key -----------------------------------------
  "planning.noKey.message": "Road routing requires your personal OpenRouteService key.",
  "planning.noKey.openSettings": "Open Settings",

  // --- Cycling profiles ----------------------------------------------
  "routingProfile.cyclingRoad.label": "Road bike",
  "routingProfile.cyclingRoad.description": "Prefers roads suitable for a road bike.",
  "routingProfile.cyclingRegular.label": "General cycling",
  "routingProfile.cyclingRegular.description":
    "May use more cycling infrastructure, such as cycle paths and tracks, but can also include compacted, gravel, unpaved or other surfaces that may not suit a road bike.",

  // --- Route summary -------------------------------------------------
  "routeSummary.landmarkLabel": "Route summary",
  "routeSummary.heading": "Route overview",
  // translator: {distance} and {ascent} already carry their own units.
  "routeSummary.descent": "{descent} m descent",
  "routeSummary.waypointCount": { one: "1 waypoint", other: "{count} waypoints" },
  // translator: {provider} is a machine-supplied provider name, {profile} a
  // cycling-profile label, {profileId} its machine identifier.
  "routeSummary.routedVia": "Routed via {provider}",
  "routeSummary.routedViaProfile": "Routed via {provider} · {profile} ({profileId})",
  "routeSummary.unknownProvider": "unknown provider",
  "routeSummary.surfaceLabel": "Surface breakdown",
  "routeSummary.surfacePaved": "Paved: {distance}",
  "routeSummary.surfaceQuestionable": "Questionable: {distance}",
  "routeSummary.surfaceUnsuitable": "Unsuitable: {distance}",
  "routeSummary.surfaceUnknown": "Unknown: {distance}",
  "routeSummary.surfaceCaveat":
    "Based on available data only — not a guarantee of road quality, legal access or current conditions.",
  "routeSummary.warningsHeading": "Route warnings",
  "routeSummary.clearWarningSelection": "Clear warning selection",
  "routeSummary.warningSurfaceDetail": "Surface: {surface}",
  "routeSummary.warningPosition": "Route position: {start}–{end} km",
  // translator: {warning} is a warning description, {length} a distance.
  "routeSummary.warningRowSurface": "{warning} · {length}",
  "routeSummary.warningRow": "{warning} — {length} ({start}–{end})",
  "routeSummary.warningSelected": "Selected warning: {warning} ({start}–{end}).",

  // --- Route warnings, selected at render time from semantic data -----
  "warning.surfaceKind.unknown": "Unknown surface",
  "warning.surfaceKind.questionable": "Questionable surface",
  "warning.surfaceKind.unsuitable": "Unsuitable surface",
  "warning.surfaceKind.other": "Surface",
  // translator: the full sentence form, used where a warning has no
  // separate kind/label presentation. {surface} is a surface name.
  "warning.surface.unknown": "Surface data is unavailable for this segment.",
  "warning.surface.questionable": "Questionable surface for a road bike: {surface}.",
  "warning.surface.unsuitable": "Unsuitable surface for a road bike: {surface}.",
  "warning.structural.steps": "Route includes steps.",
  "warning.structural.ferry": "Route includes a ferry.",
  "warning.structural.ford": "Route includes a ford.",
  "warning.structural.access": "Route includes an access restriction.",
  "warning.structural.other": "Route includes a construction-designated way.",

  // --- Surface names --------------------------------------------------
  "surface.unknown": "No usable surface data",
  "surface.paved": "Paved",
  "surface.asphalt": "Asphalt",
  "surface.concrete": "Concrete",
  "surface.unpavedUnspecified": "Unpaved (unspecified)",
  "surface.metal": "Metal",
  "surface.wood": "Wood",
  "surface.compactedGravel": "Compacted gravel",
  "surface.gravel": "Gravel / fine gravel",
  "surface.pavingStones": "Paving stones / cobblestone",
  "surface.grassPaver": "Grass paver",
  "surface.dirt": "Dirt",
  "surface.ground": "Ground or mud",
  "surface.ice": "Ice or snow",
  "surface.sand": "Sand",
  "surface.grass": "Grass",

  // --- Routing-provider failures, as the rider sees them --------------
  // translator: these are shown in Planning. The same function also feeds
  // the Status screen's copyable report, which deliberately passes the
  // English translator so that report stays shareable for support.
  "routingError.noApiKey": "Road routing requires your personal OpenRouteService key.",
  "routingError.invalidHeaderValue":
    "Your OpenRouteService key contains a character that cannot be sent in a request header. Check it in Settings.",
  "routingError.requestNotSent":
    "The routing request could not be prepared or sent. Try again.",
  "routingError.unauthorized":
    "Your OpenRouteService key was rejected. Check it in Settings.",
  "routingError.forbidden":
    "Access was denied — check your OpenRouteService account, permissions or daily quota in Settings.",
  "routingError.rateLimited": "The routing rate limit was reached. Try again shortly.",
  "routingError.offline": "You are offline. Connect to calculate a route.",
  "routingError.transportFailure":
    "The routing provider could not be reached. OpenRouteService may be temporarily unavailable, or the browser or network may have blocked the request. Try again later.",
  "routingError.timeout": "The routing request timed out. Try again.",
  "routingError.noRouteFound":
    "No cycling route could be found between these waypoints — they may be separated by water, a barrier, or a gap in rideable roads. Your key and connection to OpenRouteService are working; try adjusting the route.",
  "routingError.noRoutablePoint":
    "One of your waypoints is too far from a usable road for cycling. Try moving it closer to a street or cycle path. Your key and connection to OpenRouteService are working.",
  // translator: {status} is an HTTP status number, or the word below when
  // no response was received at all. Never translate the digits.
  "routingError.providerUnavailable":
    "OpenRouteService is temporarily unavailable (HTTP {status}). Your waypoints have been retained. Try again later.",
  "routingError.providerError":
    "The routing provider returned an unexpected error (HTTP {status}).",
  "routingError.unknownStatus": "error",
  // translator: appended to a sentence, so it begins with a space.
  // {code} is openrouteservice's own numeric code; never translate it.
  "routingError.providerCodeSuffix": " (provider code {code})",
  "routingError.unusableResponse":
    "The routing provider returned an unusable response. Try again.",
  "routingError.legStitchingFailed":
    "The route sections could not be joined into one continuous route. Try recalculating.",

  // --- GPX import and export failures ---------------------------------
  "gpx.error.emptyFile": "The selected file is empty.",
  // translator: {limitMb} is a whole number of megabytes.
  "gpx.error.tooLarge": "The selected file is larger than the {limitMb} MB limit.",
  "gpx.error.unsupportedType": "Only .gpx files are supported.",
  "gpx.error.malformedXml": "The file is not well-formed GPX/XML.",
  // translator: {longitude} and {latitude} are the file's own raw attribute
  // text, reproduced exactly, or the word below when the attribute is absent.
  "gpx.error.invalidCoordinate":
    "Point has an invalid or out-of-range coordinate (lon={longitude}, lat={latitude}).",
  "gpx.error.missingAttribute": "missing",
  // translator: {elevation} is the file's own raw text, reproduced exactly.
  "gpx.error.invalidElevation": 'Point has a non-numeric elevation value "{elevation}".',
  "gpx.error.noUsablePoints": "The file has no usable track or route points.",
  "gpx.error.noTrackOrRoute": "The file has no track or route to import.",
  "gpx.error.cryptoUnavailable":
    "This route's turn information and/or planning waypoints could not be preserved in the GPX export because this browser does not support the cryptography needed to bind them to the route geometry. Export was cancelled rather than silently dropping that data.",

  // --- GPX import notices ---------------------------------------------
  "gpx.notice.multipleTracks": {
    one: "This file contains 1 track; only the first was imported.",
    other: "This file contains {count} tracks; only the first was imported.",
  },
  "gpx.notice.multipleRoutes": {
    one: "This file contains 1 route; only the first was imported.",
    other: "This file contains {count} routes; only the first was imported.",
  },
  "gpx.notice.acnExtensionRejected":
    "This GPX contained turn information, but it did not match the route geometry and was ignored.",
  "gpx.notice.acnPlanningExtensionRejected":
    "This GPX contained planning waypoints, but they did not match the route geometry and were ignored. Editing this route as a copy will use estimated waypoints instead.",

  // --- Distance badges on the route ------------------------------------
  // translator: a badge marks a whole-kilometre point along the route.
  "map.badge.distance": { one: "1 kilometre", other: "{count} kilometres" },
  // translator: {list} is a locale-formatted list of whole numbers, e.g.
  // "2, 4 and 6" — several badges that coincide at one place on the map.
  "map.badge.distanceList": "{list} kilometres",
  "map.badge.fromRouteStart": "{distances} from route start",

  // --- Map imagery recovery ---------------------------------------------
  // translator: these are shown when map imagery is slow, failed or
  // unavailable. The route-riding and free-roam wordings are NOT a
  // mechanical substitution: free roam has no route on screen and must
  // never claim one is shown, and the sentences differ in article and
  // verb number, not only in the noun.
  "map.imagery.delayed.route":
    "Map imagery is taking longer than usual to load. Your route and position are still shown.",
  "map.imagery.delayed.freeRoam":
    "Map imagery is taking longer than usual to load. Your position is still shown.",
  // translator: the one message that is the same on both surfaces —
  // nothing is shown at all, so there is no route to mention.
  "map.imagery.loadError": "Map failed to load. Check your connection and try again.",
  "map.imagery.tileError.route":
    "Map imagery unavailable. The route and your position are still shown.",
  "map.imagery.tileError.freeRoam":
    "Map imagery unavailable. Your position is still shown.",
  "map.imagery.fallback.route":
    "Map imagery unavailable — showing your route on a plain background.",
  "map.imagery.fallback.freeRoam":
    "Map imagery unavailable — showing your position on a plain background.",
  "map.retryImagery": "Retry map imagery",
  "map.loading": "Loading map…",
  "map.loadTimeout": "Map is taking longer than expected to load.",

  // --- Planning waypoint markers on the map -----------------------------
  // translator: {ordinal} and {count} are waypoint positions, from 1.
  "map.marker.waypoint": "Waypoint {ordinal}",
  "map.marker.startWaypoint": "Start waypoint 1",
  "map.marker.startAndFinish": "Start and finish waypoints 1 and {count}",
  "map.marker.finishWaypoint": "Finish waypoint {ordinal}",

  // --- Shared ride chrome (Riding and free roam) ------------------------
  "ride.map.zoomIn": "Zoom in",
  "ride.map.zoomOut": "Zoom out",
  "ride.map.northUp": "North-up, top-down view",
  "ride.map.followLocation": "Follow my location",
  "ride.map.waiting": "Waiting…",
  "ride.map.followPaused": "Map follow paused.",
  "ride.online": "Online",
  "ride.offline": "Offline",
  "ride.tryAgain": "Try again",
  "ride.cancel": "Cancel",
  "ride.pause": "Pause",
  "ride.pausing": "Pausing…",
  "ride.endRide": "End ride",
  "ride.endingRide": "Ending ride…",
  "ride.gpsError": "GPS error",
  "ride.waitingForFix": "Waiting for a GPS fix…",
  // translator: {seconds} and {minutes} are whole numbers. The short form
  // has no space before its unit; the minute form does.
  "ride.fixAge.seconds": "{seconds}s ago",
  "ride.fixAge.minutes": "{minutes} min ago",
  // translator: {accuracy} is a whole number of metres; {freshness} is one
  // of the two words below, optionally followed by a parenthesised age.
  "ride.gpsStatus": "GPS ±{accuracy} m · {freshness}",
  "ride.gpsFresh": "Live",
  "ride.gpsStale": "Stale",
  "ride.gpsStaleWithAge": "Stale ({age})",

  // --- Geolocation failures ---------------------------------------------
  // translator: {surface} is the name of the screen needing location.
  "ride.geolocation.deniedRiding":
    "Location permission was denied. Allow location access in your browser settings to use Riding mode.",
  "ride.geolocation.deniedFreeRoam":
    "Location permission was denied. Allow location access in your browser settings to use Free roam.",
  "ride.geolocation.timeout":
    "Getting your location timed out. Check you have a clear view of the sky and try again.",
  "ride.geolocation.unsupported": "This browser does not support location services.",
  "ride.geolocation.unavailable": "Your location is currently unavailable.",

  // --- Riding status card -----------------------------------------------
  "ride.status.onRoute": "On route",
  "ride.status.possiblyOffRoute": "Possibly off route",
  "ride.status.offRoute": "Off route",
  "ride.status.ascentUnavailable": "ascent unavailable",
  "ride.status.ascent": "{ascent} ascent",
  // translator: the spelled-out announcement that replaces the compact
  // visible line for assistive technology. {distance} is a bare number of
  // kilometres; the unit word belongs to this message.
  "ride.status.remainingAnnouncement": "{distance} kilometres remaining, {ascent}",
  "ride.status.ascentRemainingUnavailable": "ascent remaining not available",
  "ride.status.ascentRemaining": "{ascent} metres ascent remaining",

  // --- Free roam ---------------------------------------------------------
  "freeRoam.title": "Free roam",
  "freeRoam.endFailed": "The ride could not be ended on this device. Try again.",
  "freeRoam.pauseFailed": "Free roam could not be paused on this device. Try again.",
  "freeRoam.endConfirmTitle": "End this ride?",
  "freeRoam.endConfirmMessage":
    "Your free roam position and camera state will be cleared.",
  "freeRoam.trackingLost": "Location — signal lost",
  "freeRoam.tracking": "Location",

  // --- Riding screen -----------------------------------------------------
  "riding.landmarkLabel": "Riding",
  "riding.endConfirmTitle": "End this ride?",
  "riding.endConfirmMessage":
    "Navigation progress for this ride will be cleared. The saved route will remain in your library.",
  "riding.endFailed": "The ride could not be ended on this device. Try again.",
  "riding.finishFailed": "Finish ride could not be completed on this device. Try again.",
  "riding.pauseFailed": "The ride could not be paused on this device. Try again.",
  "riding.offlineNotice":
    "Offline — the route, your position, progress and elevation still work; map imagery may be unavailable.",
  "riding.restoreFailed": "Your ride could not be restored on this device. Try again.",
  "riding.retry": "Retry",
  "riding.backToRideOptions": "Back to Ride options",
  "riding.resuming": "Resuming your ride…",
  "riding.resumePrompt": "Resume riding to continue tracking your progress.",
  "riding.startPrompt": "Location access is needed to track your progress on this ride.",
  "riding.resumeRide": "Resume ride",
  "riding.startRiding": "Start riding",
  "riding.editCopy": "Edit copy",
  "riding.creatingEditCopy": "Creating editable copy…",
  "riding.editCopyTooShort":
    "This route doesn't have enough distinct geometry to create an editable copy.",
  "riding.editCopyFailed":
    "The editable copy could not be created on this device. Try again.",
  "riding.editCopyDraftCheckFailed":
    "Your existing draft could not be checked. Try again.",
  "riding.editCopyConfirmTitle": "Replace your current draft?",
  "riding.editCopyConfirmMessage":
    "Editing this route will replace your unsaved draft in Planning. This route itself will remain unchanged.",
  "riding.editCopyConfirmLabel": "Replace and edit",
  "riding.elevationViewLabel": "Elevation profile view",
  "riding.elevationFull": "Full",
  // translator: {km} is a whole number of kilometres.
  "riding.elevationWindow": "{km} km",
  "riding.climb": "Climb",
  "riding.routeProfile": "Route profile",
  "riding.viewLabel": "Riding view",
  "riding.viewMap": "Map",
  "riding.viewProfile": "Profile",
  // translator: {number} is the climb's position on the route, from 1.
  "riding.climbChartLabel": "Elevation profile for Climb {number}",
  "riding.descentChartLabel": "Elevation profile for selected recognised descent",

  // --- Ride launcher ------------------------------------------------------
  "launcher.landmarkLabel": "Ride",
  "launcher.title": "Ride",
  "launcher.checking": "Checking for an unfinished ride…",
  "launcher.checkFailed":
    "Your unfinished ride status could not be checked. Nothing has been changed.",
  "launcher.retry": "Retry",
  "launcher.noRoute":
    "No route selected yet. Choose a route from Routes to start riding.",
  "launcher.chooseRoute": "Choose a route",
  "launcher.startFreeRoam": "Start free roam",
  "launcher.startingFreeRoam": "Starting…",
  "launcher.unfinishedRide": "You have an unfinished ride on this route.",
  "launcher.resumeRide": "Resume ride",
  "launcher.freeRoamHeading": "Free roam",
  "launcher.unfinishedFreeRoam": "You have an unfinished free roam session.",
  "launcher.resumeFreeRoam": "Resume free roam",
  "launcher.resumingFreeRoam": "Resuming…",
  "launcher.endFreeRoamFailed": "Free roam could not be ended on this device. Try again.",
  "launcher.discardTitle": "Discard unfinished ride?",
  "launcher.discardMessage":
    "Only the stored progress for this unfinished ride will be removed — no saved route is affected.",
  "launcher.discardConfirm": "Discard unfinished ride",
  "launcher.discarding": "Discarding…",
  "launcher.discardFailed":
    "This unfinished ride could not be discarded on this device. Try again.",
  "launcher.routeMissing":
    "This unfinished ride refers to a route that's no longer in your library, so it can't be resumed.",
  "launcher.unsupportedKind":
    "This unfinished ride can't be recovered by this version of the app.",

  // --- Climbs -------------------------------------------------------------
  "climb.selectorLabel": "Recognised climbs",
  "climb.empty":
    "No recognised climbs. A recognised climb must be at least 500 m long and average at least 3%.",
  "climb.allRoute": "All route",
  // translator: {number} is the climb's position, {category} its category
  // name, {start} a bare number of kilometres.
  "climb.option": "Climb {number} · {category} · starts at {start} km",
  "climb.count": {
    one: "1 recognised climb on this route",
    other: "{count} recognised climbs on this route",
  },
  "climb.heading": "Climb {number} · {category}",
  "climb.previewLabel": "Climb preview",
  "climb.progressLabel": "Climb progress",
  "climb.startsIn": "Starts in {distance}",
  "climb.distanceToSummit": "Distance to summit",
  "climb.elevationRemaining": "Elevation remaining",
  "climb.currentGradient": "Current gradient: {gradient}",
  "climb.currentElevation": "Current elevation: {elevation}",
  "climb.summitElevation": "Summit elevation: {elevation}",
  "climb.distanceCompleted": "Distance completed: {distance}",
  "climb.cueActive": "Climb active",
  "climb.cueRemaining": "{distance} remaining",
  "climb.viewClimb": "View climb",
  "climb.selectedFeatureLabel": "Selected feature summary",
  "climb.recognisedDescent": "Recognised descent",
  "climb.remaining": "{distance} remaining",
  "climb.passedAgo": "Passed {distance} ago",
  "climb.average": "{gradient} average",
  "climb.routePosition": "Route position: {start}–{end} km",

  // --- Manoeuvres: locally authored fallbacks only ------------------------
  // translator: these are ACN's own generic labels, used only when the
  // routing provider supplied no instruction at all. A provider's own
  // instruction — which carries road names — is never translated.
  "manoeuvre.start": "Start of route",
  "manoeuvre.continue": "Continue straight ahead",
  "manoeuvre.slightLeft": "Bear left",
  "manoeuvre.left": "Turn left",
  "manoeuvre.sharpLeft": "Sharp left turn",
  "manoeuvre.slightRight": "Bear right",
  "manoeuvre.right": "Turn right",
  "manoeuvre.sharpRight": "Sharp right turn",
  "manoeuvre.uTurn": "Make a U-turn",
  "manoeuvre.roundabout": "Go through the roundabout",
  "manoeuvre.waypoint": "Waypoint",
  "manoeuvre.finish": "Arrive at the finish",
  "manoeuvre.fallback": "Continue on the route",
  "manoeuvre.unavailable": "Turn information is unavailable for this route.",
  // translator: appended to an instruction; the leading space is part of
  // the message and must be preserved.
  "manoeuvre.frozenFull": " — based on your last known position",
  "manoeuvre.frozenCompact": " — last known position",

  // --- Route completion, wake lock, untrusted GPX -------------------------
  "riding.routeComplete": "Route complete",
  "riding.finishRide": "Finish ride",
  "riding.finishingRide": "Finishing ride…",
  "riding.keepRiding": "Keep riding",
  "wakeLock.label": "Screen on",
  "wakeLock.on": "On",
  "wakeLock.off": "Off",
  "wakeLock.active": "Screen staying awake.",
  "wakeLock.failed": "The screen could not be kept awake.",
  "wakeLock.retry": "Tap to try again",
  "riding.untrustedGpx":
    "No trusted turn information is available for this imported GPX. Follow the route line on the map.",
  "riding.noTurnCues": "No turn cues",
} as const;

export type MessageKey = keyof typeof en;
export type EnglishCatalogue = typeof en;
