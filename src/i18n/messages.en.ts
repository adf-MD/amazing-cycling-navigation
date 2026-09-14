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

  // --- Shared unit and figure formatters ---------------------------------
  // translator: these carry the unit with the number, so the unit itself is
  // part of the message rather than appended at the call site. The numeric
  // value arrives already formatted with an explicit locale, so a German
  // catalogue must not try to re-punctuate it.
  "format.distanceKm": "{distance} km",
  "format.metres": "{metres} m",
  "format.gradientPercent": "{gradient}%",
  "format.ascent": "{metres} m ascent",
  "format.ascentUnavailable": "ascent not available",
  "format.descentLoss": "{metres} m loss",

  // --- Recognised climbs and descents: presentation ----------------------
  // translator: the KEYS below are the application's semantic identity for
  // a route feature and never change. Only these rendered names do. The
  // same key must always select the same colour, the same warning kind and
  // the same behaviour in every language.
  "feature.colour.green": "green",
  "feature.colour.yellow": "yellow",
  "feature.colour.orange": "orange",
  "feature.colour.red": "red",
  "feature.colour.darkRed": "dark red",
  "feature.colour.lightBlue": "light blue",
  "feature.colour.blue": "blue",
  "feature.colour.darkBlue": "dark blue",

  // Bare category name, with no "climb" suffix — for the pre-ride
  // selector's numbered heading ("Climb 2 · Category 3"), where "Climb N"
  // has already established that it is a climb.
  "feature.category.uncategorised": "Uncategorised",
  "feature.category.category4": "Category 4",
  "feature.category.category3": "Category 3",
  "feature.category.category2": "Category 2",
  "feature.category.category1": "Category 1",
  "feature.category.hc": "HC",

  "feature.label.uncategorised": "Uncategorised climb",
  "feature.label.category4": "Category 4 climb",
  "feature.label.category3": "Category 3 climb",
  "feature.label.category2": "Category 2 climb",
  "feature.label.category1": "Category 1 climb",
  "feature.label.hc": "HC climb",
  // translator: described by magnitude (steepness), not signed value —
  // "just below" reads confusingly against negative numbers that grow
  // more negative as they steepen. Every boundary value (6%, 9%) is
  // unambiguously owned by exactly one entry.
  "feature.label.moderate": "Recognised descent (moderate, 3% to just below 6%)",
  "feature.label.steep": "Recognised descent (steep, 6% to just below 9%)",
  "feature.label.verySteep": "Recognised descent (very steep, 9% or more)",
  "feature.label.uncategorisedOrCategory4": "Uncategorised or Category 4 climb",

  // translator: short codes for space-constrained map labels. The hollow
  // down-arrows are deliberate, so a macro descent glyph can never be
  // confused with a climb glyph; keep them as they are.
  "feature.shortLabel.uncategorised": "UC",
  "feature.shortLabel.category4": "C4",
  "feature.shortLabel.category3": "C3",
  "feature.shortLabel.category2": "C2",
  "feature.shortLabel.category1": "C1",
  "feature.shortLabel.hc": "HC",
  "feature.shortLabel.moderate": "▽",
  "feature.shortLabel.steep": "▽▽",
  "feature.shortLabel.verySteep": "▽▽▽",
  "feature.shortLabel.uncategorisedOrCategory4": "UC/C4",

  "feature.ordinaryRoute":
    "Ordinary route (including sections with missing or insufficient elevation data, and any locally shallow stretch within a selected descent) · green",
  "feature.recognisedDescent": "Recognised descent",

  // translator: local-gradient wording, deliberately never "Category N" —
  // a local band describes only the smoothed gradient at one point within
  // a climb, not the climb's own length-and-average score.
  "feature.band.gentleOrDescending": "Gentle, flat or brief descent",
  "feature.band.moderateClimb": "Moderate climb",
  "feature.band.hardClimb": "Hard climb",
  "feature.band.veryHardClimb": "Very hard climb",
  "feature.band.extremelySteepClimb": "Extremely steep climb",
  "feature.bandRange.gentleOrDescending": "Below 3%",
  "feature.bandRange.moderateClimb": "3% to just below 6%",
  "feature.bandRange.hardClimb": "6% to just below 9%",
  "feature.bandRange.veryHardClimb": "9% to just below 12%",
  "feature.bandRange.extremelySteepClimb": "12% or more",

  "feature.descentLocal.moderate": "Moderate descent",
  "feature.descentLocal.steep": "Steep descent",
  "feature.descentLocal.verySteep": "Very steep descent",
  "feature.descentLocal.neutral": "Shallower than the descent threshold",
  "feature.descentLocalRange.neutral": "Below 3%",
  "feature.descentLocalRange.moderate": "3% to just below 6%",
  "feature.descentLocalRange.steep": "6% to just below 9%",
  "feature.descentLocalRange.verySteep": "9% or more",

  // --- Shared legends, disclosures and detail panels ---------------------
  "legend.climbCategories": "Climb categories",
  "legend.climbGradient": "Detailed climb gradient legend",
  "legend.descentGradient": "Detailed descent gradient legend",
  "legend.routeFeatures": "Recognised route features legend",
  "legend.localClimbColours": "Local gradient colours on this climb",
  "legend.localDescentColours": "Local gradient colours on this descent",
  "legend.gradientColours": "Gradient colours",
  "legend.recognisedRouteFeatures": "Recognised route features",
  "legend.detailedLocalGradient": "Detailed local gradient",
  "legend.macroExplanation":
    "Overall climb colours depend on climb length and average gradient. Recognised descents use one of three blues based on average gradient and are specific to this app.",
  "legend.localExplanation":
    "Detailed colours show local gradient over approximately 100 m within the selected or currently active climb. Brief flat or descending sections inside a climb are green. A selected or currently active descent reuses the same three blues shown above, applied to its local sections instead of its whole length — any locally shallow stretch there shows the plain route colour instead.",
  "legend.clearSelection": "Clear selection",

  "featureDetails.landmarkLabel": "Route feature details",
  "featureDetails.heading": "Climb {number} · {category}",
  "featureDetails.routePosition": "Route position: {start}–{end} km",
  "featureDetails.length": "Length: {distance}",
  "featureDetails.elevationGain": "Elevation gain: {elevation}",
  "featureDetails.elevationLoss": "Elevation loss: {elevation}",
  "featureDetails.averageGradient": "Average gradient: {gradient}",
  "featureDetails.maximumLocalGradient": "Maximum local gradient: {gradient}",
  "featureDetails.steepestLocalGradient": "Steepest local gradient: {gradient}",
  "featureDetails.climbScore": "Climb score: {score}",

  "segmentDetails.landmarkLabel": "Gradient segment details",
  "segmentDetails.heading": "{band} · {gradient}",
  "segmentDetails.elevation": "Elevation: {start} m to {end} m",

  // --- Elevation chart ---------------------------------------------------
  "elevation.noRoute": "No route loaded.",
  "elevation.noData": "Elevation data is not available for this route.",
  "elevation.landmarkLabel": "Elevation profile",
  "elevation.chartLabel": "Elevation profile chart",
  "elevation.range": "{min}–{max} m",
  "elevation.rangeWithGaps": "{min}–{max} m (some sections have no elevation data)",
  "elevation.markerCurrent": "Current route position: {position} of {total}.",
  "elevation.markerStale": "Last known position: {position} of {total}.",
  // translator: an accessible-only description of the distance guides on
  // the chart. `distances` is an already-punctuated list of numbers.
  "elevation.distanceGuides": {
    one: "Distance guides ahead at {distances} kilometre",
    other: "Distance guides ahead at {distances} kilometres",
  },

  // --- Stored routing key: status ----------------------------------------
  // translator: every one of these is deliberately phrased as a historical
  // fact, never a live assertion about the provider's current state — a
  // reload re-checks nothing. Keep that tense in translation. `checkedAt`
  // is an already-formatted timestamp, always in UTC and marked as such.
  "providerKey.none": "No key configured",
  "providerKey.unverified": "Key saved on this device, not yet verified",
  "providerKey.verified": "Key last verified {checkedAt}",
  "providerKey.rejected": "Key was rejected when last checked {checkedAt}",
  "providerKey.quotaRetryAfter": "Quota reached, retry after {resetAt}",
  "providerKey.quotaReached":
    "Quota was reached when last checked {checkedAt} — you can try again",
  "providerKey.unavailable": "Provider was unavailable when last checked {checkedAt}",
  // translator: the trailing zone marker. The timestamp really is UTC, not
  // the rider's local time, so this must stay explicit.
  "providerKey.utcTimestamp": "{timestamp} UTC",

  // --- Status: on-screen diagnostic log lines ----------------------------
  // translator: these lead phrases are rider-facing prose on the Status
  // screen. Everything they interpolate — an HTTP status, a browser error
  // class such as TypeError, a provider category, a transport reason code
  // — is a machine token supplied verbatim and MUST NOT be translated.
  // The copied diagnostic report is a separate surface and stays English
  // (approved decision R4); these lines never appear in it.
  "routingLog.responseReceived": "HTTP response received: {status}",
  "routingLog.responseReceivedWithCategory":
    "HTTP response received: {status} ({category})",
  "routingLog.offline": "Device reported offline",
  "routingLog.timeout": "Request timed out",
  "routingLog.invalidHeaderValue": "The stored key could not be used in a request header",
  "routingLog.headerConstructionFailure": "Request headers could not be constructed",
  "routingLog.invalidRequestConstruction": "Request could not be constructed",
  "routingLog.fetchInvocationFailure": "Fetch could not be invoked",
  "routingLog.noResponseExposed":
    "Fetch promise rejected before an HTTP response was exposed",
  // translator: `detail` is an already-assembled machine string, e.g.
  // "TypeError: Failed to fetch; reason: generic-fetch-rejection".
  "routingLog.withDetail": "{base} ({detail})",
  "routingLog.unknownStatus": "unknown",

  "mapLog.styleRequestOrParseFailure": "Map style failed to load or parse",
  "mapLog.tileRequestFailure": "A map tile request failed",
  "mapLog.spriteFailure": "Map sprite (icons) failed to load",
  "mapLog.workerFailure": "The map's background worker did not respond in time",
  "mapLog.webglInitFailure":
    "This device or browser could not initialise map graphics (WebGL)",
  "mapLog.initialLoadTimeout": "Map style did not become ready in time",
  "mapLog.fallbackActivated": "Switched to the plain background",
  "mapLog.manualRetry": "Map imagery retry requested",
  "mapLog.autoRetry":
    "Map imagery retry attempted automatically after resuming or reconnecting",
  "mapLog.imageryRecovered": "Map imagery loaded successfully",

  // --- Status: routing connection test -----------------------------------
  // translator: these describe observed facts, never an assumed root
  // cause. "transport-response-unavailable" in particular is deliberately
  // hedged — page JavaScript cannot establish WHY the browser withheld a
  // response, so a translation must never present CORS as confirmed.
  //
  // These same entries also appear in the copied diagnostic report, which
  // stays entirely English under approved decision R4. The report reads
  // them through the English translator explicitly, so it is English by
  // construction rather than by omission, and there is exactly one source
  // for the sentence.
  "connectionTest.stage.notAttemptedNoKey":
    "No OpenRouteService key is configured, so no request was sent.",
  "connectionTest.stage.invalidKeySyntax":
    "The stored key itself contains a character that cannot be sent in a request header — checked before any request was constructed.",
  "connectionTest.stage.headerConstruction":
    "The request's headers could not be constructed.",
  "connectionTest.stage.requestConstruction":
    "The request object itself could not be constructed.",
  "connectionTest.stage.fetchInvocation":
    "Calling the fetch implementation failed synchronously, before any promise existed.",
  "connectionTest.stage.offline":
    "The device reported itself offline before any request was sent.",
  "connectionTest.stage.timeout":
    "The request did not receive a response within the routing timeout.",
  "connectionTest.stage.transportResponseUnavailable":
    "The browser did not expose an HTTP response. Possible causes include CORS/preflight rejection, DNS, TLS, timeout, connectivity, or a provider response whose CORS headers were missing.",
  "connectionTest.stage.httpResponse":
    "An HTTP response was received from OpenRouteService.",
  "connectionTest.stage.responseParsing":
    "An HTTP response was received but its body could not be parsed as the expected route format.",
  "connectionTest.stage.routeProcessing":
    "A response was received and parsed, but the route itself could not be used.",
  "connectionTest.stage.success": "A valid cycling route was received.",

  // --- Status: screen chrome and system status ---------------------------
  "status.landmarkLabel": "Status",
  "status.title": "Status",
  "status.systemStatus": "System status",
  "status.appVersion": "App version",
  "status.build": "Build",
  "status.network": "Network",
  "status.online": "Online",
  "status.offline": "Offline",
  "status.serviceWorker": "Service worker",
  "status.sw.unsupported": "Not supported by this browser",
  "status.sw.notRegistered": "Not registered",
  "status.sw.installing": "Installing",
  "status.sw.waiting": "Waiting to activate",
  "status.sw.active": "Active",
  "status.sw.unknown": "Unknown",
  "status.storage": "Storage",
  "status.storage.checking": "Checking…",
  "status.storage.unavailable": "Unavailable",
  "status.storage.ok": "OK (schema version {version})",
  "status.storage.estimateChecking": "Checking storage estimate…",
  "status.storage.estimateUnsupported":
    "Estimated app storage: not supported by this browser",
  "status.storage.estimateUnavailable": "Estimated app storage: unavailable",
  "status.storage.estimate":
    "Estimated app storage: {used} of {quota} used ({percentage})",
  "status.storage.pressure":
    "Storage pressure warning: estimated app storage usage is high.",
  "status.storage.bytes": "{value} B",
  "status.storage.kibibytes": "{value} KiB",
  "status.storage.mebibytes": "{value} MiB",
  "status.storage.gibibytes": "{value} GiB",
  "status.storage.tebibytes": "{value} TiB",
  // translator: a genuinely non-zero fraction below one per cent, shown
  // rather than a misleadingly exact "0%".
  "status.storage.lessThanOnePercent": "<1%",
  "status.storage.percentage": "{percentage}%",
  "status.mapRendering": "Map rendering support",
  "status.mapRendering.supported": "Supported",
  "status.mapRendering.unsupported": "Not supported by this browser",
  "status.geolocationPermission": "Geolocation permission",
  "status.permission.granted": "Granted",
  "status.permission.denied": "Denied",
  "status.permission.prompt": "Not yet requested",
  "status.permission.unsupported": "Not supported by this browser",
  "status.fixAccuracy": "Last known fix accuracy",
  "status.fixAccuracyValue": "±{accuracy} m",
  "status.fixAge": "Last known fix age",
  "status.notApplicableYet": "Not applicable yet",
  "status.fixAge.seconds": "{seconds}s ago",
  "status.fixAge.minutes": "{minutes} min ago",

  // --- Status: active session (backlog item 117) -------------------------
  // translator: each of these is a distinct, load-bearing state and none
  // may be merged with another. "None" means no session at all;
  // "Checking…" means a lookup is still in flight; "Route unavailable"
  // means the session's route has been deleted; "Session unavailable"
  // means the stored session is of a kind this build does not recognise.
  // A route-backed session shows the rider's own route name verbatim and
  // never an internal identifier.
  "status.session": "Active session",
  "status.session.none": "None",
  "status.session.freeRoam": "Free roam",
  "status.session.checking": "Checking…",
  "status.session.routeUnavailable": "Route unavailable",
  "status.session.unavailable": "Session unavailable",

  // --- Status: recent errors ---------------------------------------------
  "status.recentErrors": "Recent errors",
  "status.noErrors": "No errors recorded this session.",

  // --- Status: routing diagnostics ---------------------------------------
  "status.routingDiagnostics": "Routing diagnostics",
  "status.recentRoutingAttempts": "Recent routing attempts",
  "status.noRoutingAttempts": "No routing attempts recorded this session.",
  "status.fetchFailureSummary": "Why a fetch can fail before an HTTP response",
  "status.fetchFailureDetail":
    'Browsers may report a generic fetch failure instead of the real HTTP status (for example 502) when the provider\'s error response is missing CORS headers — an entry reading "Fetch promise rejected before an HTTP response was exposed" can mean a provider outage, a missing CORS header, a DNS or TLS failure, or a local network restriction, and cannot be told apart from this information alone.',
  "status.httpGuideSummary": "What HTTP statuses mean",
  "status.httpGuideIntro":
    "When the routing provider exposes an HTTP response, its status is recorded in Recent routing attempts below. A failed connection test also shows it when the failure carried one; a successful connection test does not repeat it. These are broad categories, not a proven cause:",
  // translator: the parenthesised status ranges and the individual codes
  // are machine values. Keep every digit exactly as it is.
  "status.http.success": "Success (2xx)",
  "status.http.200":
    "— the normal successful response for a routing request. HTTP success is not the whole check: ACN still checks that the response contains usable route data.",
  "status.http.redirects": "Redirects (3xx)",
  "status.http.redirectsDetail":
    "The browser normally follows redirects automatically and records the final response instead, so an intermediate 3xx status is not normally shown here.",
  "status.http.requestProblems": "Request or access problems (4xx)",
  "status.http.400": "— the request was incorrect or could not be processed.",
  "status.http.401or403": "401 or 403",
  "status.http.401or403Detail":
    "— the stored key, authorisation or access may have been rejected. OpenRouteService can also use 403 for an exhausted daily allowance, but the status alone does not prove which cause applies.",
  "status.http.404":
    "— OpenRouteService documents this as either an unavailable endpoint or a request for which no result or route was found. The status alone does not say which.",
  "status.http.405":
    "— the request method was not accepted. This is unexpected during normal ACN use.",
  "status.http.408":
    "— an HTTP server or intermediary returned an exposed timeout response. This is not the same as ACN's own request timeout, or a fetch rejection with no exposed response.",
  "status.http.413": "— the request exceeds a size or capacity limit.",
  "status.http.429":
    "— request-rate or quota limiting. Waiting before retrying, or checking the provider allowance, may help.",
  "status.http.other4xx": "Other 4xx",
  "status.http.other4xxDetail":
    "— the request was rejected, but the exact reason is not established by the status alone.",
  "status.http.serviceProblems": "Service problems (5xx)",
  "status.http.500": "— an unexpected service-side error.",
  "status.http.501":
    "— the service does not support functionality required by the request.",
  "status.http.other5xx": "Other 5xx, including 502 to 504",
  "status.http.other5xxDetail":
    "— a service, gateway or upstream failure. Retrying later may help.",
  "status.http.none": "No HTTP status",
  "status.http.noneDetail":
    'No HTTP response was exposed to the browser, so no status can say anything about the service. See "Why a fetch can fail before an HTTP response" above.',

  // --- Status: connection test -------------------------------------------
  "status.testConnection": "Test routing connection",
  "status.testConnectionHint":
    "This sends one real request to OpenRouteService, using fixed test coordinates rather than any route you've planned, and uses one API request.",
  "status.testConnectionNoKey":
    "No OpenRouteService key configured. Add one in Settings to enable this test.",
  "status.testing": "Testing…",
  "status.testSucceeded": "Succeeded",
  "status.testFailed": "Failed",
  // translator: `outcome` is the localised Succeeded/Failed word, `detail`
  // the provider-facing explanation and `elapsed` a machine number.
  "status.testResult": "{outcome} — {detail} ({elapsed} ms)",
  "status.stage": "Stage",
  "status.stageValue": "{stage} — {description}",
  "status.error": "Error",
  "status.errorValue": "{name}: {message}",
  "status.safeReasonCode": "Safe reason code",
  "status.httpStatus": "HTTP status",
  "status.headersConstructed": "Headers constructed",
  "status.requestConstructed": "Request constructed",
  "status.fetchInvoked": "Fetch invoked",
  "status.fetchReturnedPromise": "Fetch returned a promise",
  "status.responseReceived": "HTTP response received",
  "status.secureContext": "Secure context",
  "status.serviceWorkerControlling": "Service worker controlling this page",
  "status.activeServiceWorkerScript": "Active service worker script",
  "status.standaloneDisplay": "Installed/standalone display",
  "status.yes": "Yes",
  "status.no": "No",
  "status.none": "None",
  "status.copyReport": "Copy diagnostic report",
  "status.copied": "Copied to clipboard.",
  "status.copyFailed":
    "Could not copy automatically — select and copy the report text manually:",

  // --- Status: map imagery -----------------------------------------------
  "status.recentMapAttempts": "Recent map imagery attempts",
  "status.noMapAttempts": "No map imagery attempts recorded this session.",

  // --- Application shell: the ride-switch prompt -------------------------
  // translator: `target` and `existing` below name a session, and `target`
  // may be the rider's own route name in quotation marks. Both are
  // supplied as values and are never re-interpreted.
  "switch.freeRoamTarget": "free roam",
  "switch.quotedRouteName": '"{name}"',
  "switch.title": "Switch to {target}?",
  // translator: the read failed — this is deliberately NOT described as a
  // conflict. A storage read failing is not evidence that another session
  // exists, and presenting it as one would be a misstatement.
  "switch.checkFailedTitle": "Couldn't check for an unfinished ride",
  "switch.checkFailedMessage":
    "Whether you have an unfinished ride could not be checked, so nothing has opened yet.",
  "switch.retry": "Retry",
  "switch.discardAndContinue": "Discard and continue",
  "switch.endAndSwitch": "End and switch",
  "switch.discarding": "Discarding your unfinished ride…",
  "switch.ending": "Ending your current ride…",
  "switch.discardingLabel": "Discarding…",
  "switch.endingLabel": "Ending…",
  "switch.startingFreeRoam": "Starting free roam…",
  "switch.startingLabel": "Starting…",
  "switch.clearFailed":
    "This unfinished ride could not be ended on this device. Try again.",
  "switch.startFreeRoamFailed":
    "Free roam could not be started on this device. Try again.",
  "switch.tryAgain": "Try again",
  "switch.returning": "Opening your paused ride…",
  "switch.returnFailed":
    "This paused ride could not be reopened. Check again to see its current status.",
  "switch.checkAgain": "Check again",
  "switch.existingRoute": "an unfinished ride on another route",
  "switch.existingFreeRoam": "an unfinished free roam session",
  "switch.existingUnsupported":
    "an unfinished ride that can't be recovered by this version of the app",
  "switch.conflict":
    "You have {existing}. It must be ended before this can open — ride progress will be cleared.",
  "switch.conflictKeepsRoute":
    "You have {existing}. It must be ended before this can open — the saved route will remain in your library, but ride progress will be cleared.",
  "switch.inlineRouteConflict":
    '"{existing}" is paused. Return to it, or end it and switch to {target}. Ending it will clear ride progress; the saved route will remain in Routes.',
  "switch.cancel": "Cancel",
  "switch.pausedRideCheckFailed":
    "This paused ride's status could not be checked. Try again.",
  "switch.pausedRideChanged":
    "This paused ride has changed since this screen opened. Check again to see its current status.",
  "switch.pausedRouteCheckFailed":
    "This paused ride's route could not be checked. Try again.",
  "switch.pausedRouteMissing":
    "This route is no longer in your library, so this paused ride can't be reopened.",

  // --- Application shell: the service-worker update prompt ---------------
  // translator: this appears while the rider may be mid-ride. It is
  // announced politely, never as an alert, and neither action is
  // destructive — "Later" simply dismisses the notice.
  "update.ready": "An update is ready.",
  "update.now": "Update now",
  "update.later": "Later",
} as const;

export type MessageKey = keyof typeof en;
export type EnglishCatalogue = typeof en;
