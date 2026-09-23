import type { Catalogue } from "./translate.ts";

/**
 * The German catalogue.
 *
 * Backlog item 113 stage 6a. Typed as `Catalogue`, which is derived from
 * the English object, so a missing key, an extra key or a wrongly-shaped
 * entry is a `tsc -b` failure rather than something a rider discovers.
 *
 * **Authored, not yet enabled.** `SUPPORTED_LANGUAGES` in `language.ts`
 * still contains only `"en"`, so neither a German device nor a stored
 * `"de"` preference can resolve to this file. Enabling German is stage
 * 6b's single-constant change, and happens only after human linguistic
 * review of this catalogue.
 *
 * Conventions, all of them deliberate:
 *
 * - **informal `du`** throughout, per the approved decision;
 * - German quotation marks `„…“` wherever the English used `“…”` or `"…"`
 *   as part of authored copy;
 * - numbers, dates, lists and separators are **never** punctuated here —
 *   `src/ui/shared/routeSummary.ts`'s locale-aware formatters own that,
 *   so a message must not try to write `61,5` itself;
 * - placeholder names are identical to English and may be reordered
 *   freely where German word order requires it;
 * - machine tokens interpolated into a message (an HTTP status, a browser
 *   error class, a provider category, a route name, a road name) are
 *   values, never translated;
 * - manoeuvre instructions use the infinitive, which is what German
 *   navigation conventionally uses and which sidesteps the `du`/`Sie`
 *   question entirely for those labels.
 */
export const de: Catalogue = {
  // --- Primary navigation -------------------------------------------
  // translator: these five labels each render in a fifth of the viewport
  // width. "Einstellungen" is the longest and is kept whole deliberately;
  // stage 6b adds the `:lang(de)` wrapping rule that makes it fit.
  "nav.landmarkLabel": "Hauptbereiche",
  "nav.routes": "Routen",
  "nav.ride": "Fahren",
  "nav.plan": "Planen",
  "nav.status": "Status",
  "nav.settings": "Einstellungen",

  // --- Settings: screen chrome --------------------------------------
  "settings.landmarkLabel": "Einstellungen",
  "settings.title": "Einstellungen",
  "settings.offline":
    "Offline — du kannst deinen gespeicherten Schlüssel weiterhin anzeigen oder bearbeiten, für die Routenberechnung ist jedoch eine Internetverbindung erforderlich.",
  "settings.group.preferences": "Optionen",
  "settings.group.explanations": "Erklärungen",

  // --- Settings: route planning -------------------------------------
  "settings.routePlanning.heading": "Routenplanung",
  "settings.routePlanning.defaultProfile": "Standardprofil",
  "settings.routePlanning.avoidFerries": "Fähren standardmäßig vermeiden",
  "settings.routePlanning.avoidFerriesHint": "Gilt für jeden neuen Entwurf.",
  "settings.routePlanning.saving": "Wird gespeichert…",
  "settings.routePlanning.saveFailed":
    "Diese Einstellung konnte auf diesem Gerät nicht gespeichert werden. Versuch es noch einmal.",
  "settings.routePlanning.recalculationSummary": "So funktioniert die Neuberechnung",
  "settings.routePlanning.recalculationBody":
    "Eine Route wird abschnittsweise zwischen den Wegpunkten berechnet. Die erste Berechnung braucht eine Routing-Anfrage pro Abschnitt; spätere Änderungen berechnen normalerweise nur die geänderten Abschnitte neu.",

  // --- Settings: OpenRouteService -----------------------------------
  "settings.ors.heading": "OpenRouteService",
  "settings.ors.intro": {
    rich: "Für die Routenplanung brauchst du einen eigenen kostenlosen Schlüssel von {link}. Du erhältst ihn im HeiGIT-Konto-Dashboard und fügst ihn unten ein.",
  },
  "settings.ors.signUpLink":
    "HeiGIT — Registriere dich für einen OpenRouteService-Schlüssel",
  "settings.ors.keyInputLabel": "OpenRouteService-API-Schlüssel",
  "settings.ors.hide": "Verbergen",
  "settings.ors.reveal": "Anzeigen",
  "settings.ors.save": "Auf diesem Gerät speichern",
  "settings.ors.cancel": "Abbrechen",
  "settings.ors.saved": "Schlüssel auf diesem Gerät gespeichert: •••• (verborgen)",
  "settings.ors.replace": "Schlüssel ersetzen",
  "settings.ors.delete": "Schlüssel löschen",
  "settings.ors.deleteConfirmTitle": "OpenRouteService-Schlüssel löschen",
  "settings.ors.deleteConfirmMessage":
    "Damit wird dein gespeicherter Schlüssel von diesem Gerät gelöscht. Die Routenplanung steht erst wieder zur Verfügung, wenn du erneut einen Schlüssel eingibst. Alle bereits gespeicherten Routen bleiben auch ohne Schlüssel uneingeschränkt nutzbar.",
  "settings.ors.deleteConfirmLabel": "Löschen",
  "settings.ors.saveFailedInvalidHeader":
    "Dieser Schlüssel enthält ein Zeichen, das nicht in einem Anfrage-Header gesendet werden kann. Überprüfe, ob beim Kopieren versehentlich ein Zeilenumbruch eingefügt wurde.",
  "settings.ors.saveFailed":
    "Der Schlüssel konnte auf diesem Gerät nicht gespeichert werden. Versuch es noch einmal.",
  "settings.ors.usageSummary": "Wie der Schlüssel und die Routendaten verwendet werden",
  "settings.ors.usageBody":
    "Wenn du in der Planung eine Route berechnest, werden dein Schlüssel und die von dir gesetzten Wegpunkte direkt an HeiGIT gesendet, um die Route zu berechnen. Deine GPS-Position während der Fahrt wird niemals an HeiGIT gesendet.",
  "settings.ors.usageStorage": {
    rich: "Der Schlüssel ist {emphasis}. Er wird nur auf diesem Gerät gespeichert, damit er nicht im Quellcode dieser App enthalten ist und nicht versehentlich veröffentlicht wird. JavaScript-Code, der auf dieser Website ausgeführt wird, kann ihn trotzdem lesen. Wenn du in Safari oder deinem Browser die Websitedaten dieser App löschst, wird der Schlüssel entfernt und du musst ihn erneut eingeben.",
  },
  "settings.ors.usageStorageEmphasis": "nicht verschlüsselt",

  // --- Settings: elevation and climbs -------------------------------
  "settings.elevation.heading": "Anstiege und Streckenneigung",
  "settings.elevation.classificationSummary": "Wie Anstiege eingestuft werden",
  "settings.elevation.climbScore":
    "Die Anstiegswertung ist die Länge des Anstiegs in Metern multipliziert mit der durchschnittlichen Steigung in Prozent.",
  "settings.elevation.recognitionThresholds":
    "Ein Anstieg wird als solcher erkannt, sobald er mindestens {length} lang ist, im Mittel eine Steigung von mindestens {gradient} % erreicht und eine Wertung von mindestens {score} hat.",
  "settings.elevation.uncategorised": "Nicht kategorisiert: unter {score}",
  "settings.elevation.categoryRange": "{name}: {from} bis {to}",
  "settings.elevation.categoryOrMore": "{name}: {score} oder mehr",
  "settings.elevation.localColoursSummary": "Farbskala für lokale Steigungen",
  "settings.elevation.localColoursBody":
    "Die detaillierten Farben entlang einer Route zeigen die lokale Steigung, geglättet über etwa 100 m — nicht die Gesamtkategorie eines Anstiegs und nicht die exakte Steigung an einem einzelnen Punkt.",
  "settings.elevation.localColoursFlat":
    "Ein kurzes flaches oder abfallendes Stück innerhalb eines erkannten Anstiegs nutzt das grüne Band unter 3 %.",
  "settings.elevation.localColoursDescent":
    "Eine erkannte Abfahrt nutzt lokal dieselben drei Blautöne; ein örtlich flaches Stück zeigt stattdessen die normale Routenfarbe.",
  "settings.elevation.localColoursCaveat":
    "Die Intensität des Blaus zeigt nur die Steilheit, nicht Belag, Kurven, Verkehr oder andere Bedingungen.",

  // --- Settings: riding ----------------------------------------------
  "settings.riding.heading": "Während der Fahrt",
  "settings.riding.screenOnSummary": "Display an",
  "settings.riding.screenOnBody":
    "Das Display bleibt eingeschaltet, solange die Routenführung oder „Freies Fahren“ geöffnet ist. Das kann den Akkuverbrauch erhöhen.",
  "settings.riding.screenOnCaveat":
    "Das gilt nur, solange die entsprechende Ansicht geöffnet und sichtbar ist. Dein Standort wird dabei nicht im Hintergrund erfasst. Unterstützt dein Browser diese Funktion nicht, kann die App nicht sicherstellen, dass das Display eingeschaltet bleibt.",

  // --- Route Library: screen chrome ---------------------------------
  "routes.landmarkLabel": "Routenbibliothek",
  "routes.title": "Routen",
  "routes.searchLabel": "Routen durchsuchen",
  "routes.clearSearch": "Suche zurücksetzen",
  "routes.sortLabel": "Sortieren nach",
  "routes.sort.mostRecent": "Neueste zuerst",
  "routes.sort.nameAsc": "Name A–Z",
  "routes.sort.longest": "Längste Route",
  "routes.sort.mostAscent": "Meiste Höhenmeter",
  "routes.saving": "Wird gespeichert…",
  "routes.loading": "Routen werden geladen…",
  "routes.emptyLibrary":
    "Noch keine Routen gespeichert. Importiere eine GPX-Datei, um loszulegen.",
  "routes.noMatchQueryAndTags":
    "Für „{query}“ und die ausgewählten Tags wurden keine passenden Routen gefunden.",
  "routes.noMatchTags":
    "Für die ausgewählten Tags wurden keine passenden Routen gefunden.",
  "routes.noMatchQuery": "Keine passenden Routen für „{query}“.",
  "routes.preferenceSaveFailed":
    "Diese Einstellung konnte auf diesem Gerät nicht gespeichert werden. Versuch es noch einmal.",

  // --- Route Library: tag filtering ---------------------------------
  "routes.filterByTags": "Nach Tags filtern",
  "routes.manageTags": "Tags verwalten",
  "routes.clearTagFilters": "Tags zurücksetzen",
  "routes.count": { one: "1 Route", other: "{count} Routen" },
  "routes.filtersActive": { one: "1 Filter aktiv", other: "{count} Filter aktiv" },
  "routes.noneWouldRemain": "Es würde keine Route übrig bleiben",
  "routes.wouldRemain": {
    one: "Es würde 1 Route übrig bleiben",
    other: "Es würden {count} Routen übrig blieben",
  },

  // --- Route Library: busy guards -----------------------------------
  "routes.busy.savingTags":
    "Speichere zuerst die Tags dieser Route. Danach kannst du die Tags verwalten.",
  "routes.busy.deleting":
    "Warte, bis die Route gelöscht wurde. Danach kannst du die Tags verwalten.",
  "routes.busy.switching":
    "Warte, bis der laufende Wechsel abgeschlossen ist. Danach kannst du die Tags verwalten.",
  "routes.busy.tagUpdate":
    "Warte, bis die Tags aktualisiert wurden. Danach kannst du nach Tags filtern.",

  // --- Route Library: failures --------------------------------------
  "routes.error.import": "Diese Datei konnte nicht importiert werden.",
  "routes.error.export": "Diese Route konnte nicht exportiert werden.",
  "routes.error.delete": "Diese Route konnte nicht gelöscht werden.",
  "routes.error.pin": "Diese Route konnte nicht oben fixiert werden. Versuche es erneut.",
  "routes.error.unpin":
    "Die Fixierung dieser Route konnte nicht aufgehoben werden. Versuche es erneut.",
  "routes.error.saveTags":
    "Die Tags dieser Route konnten nicht gespeichert werden. Versuche es erneut.",
  "routes.error.renameTag":
    "Dieser Tag konnte nicht umbenannt werden. Versuche es erneut.",
  "routes.error.deleteTag":
    "Dieser Tag konnte nicht gelöscht werden. Versuche es erneut.",
  "routes.error.tagNameRequired": "Gib einen neuen Namen für diesen Tag ein.",

  // --- Route card ----------------------------------------------------
  "routes.card.nameLabel": "Routenname",
  "routes.card.save": "Speichern",
  "routes.card.cancel": "Abbrechen",
  "routes.card.addTagLabel": "Tag hinzufügen",
  "routes.card.addTag": "Tag hinzufügen",
  "routes.card.tagSuggestions": "Tag-Vorschläge",
  "routes.card.saveTags": "Tags speichern",
  "routes.card.tags": "Tags",
  "routes.card.rename": "Umbenennen",
  "routes.card.editTags": "Tags bearbeiten",
  "routes.card.addTags": "Tags hinzufügen",
  "routes.card.export": "Exportieren",
  "routes.card.delete": "Löschen",
  "routes.card.pin": "{name} oben fixieren",
  "routes.card.unpin": "Fixierung von {name} aufheben",
  "routes.card.deleteConfirmTitle": "„{name}“ löschen?",
  "routes.card.deleteConfirmBody":
    "Diese Route wird dauerhaft von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.",
  "routes.card.deleteConfirm": "Route löschen",
  "routes.card.deleting": "Wird gelöscht…",
  "routes.card.returnToPausedRide": "Zur pausierten Fahrt zurück",

  // --- Manage tags ---------------------------------------------------
  "tags.manage.heading": "Tags verwalten",
  "tags.manage.empty":
    "Keine Tags mehr vorhanden. Füge einer Route Tags hinzu, um sie hier zu verwalten.",
  "tags.manage.close": "Schließen",
  "tags.manage.selectLabel": "Ausgewählter Tag",
  "tags.manage.selectPlaceholder": "Tag auswählen",
  "tags.manage.option": { one: "{tag} (1 Route)", other: "{tag} ({count} Routen)" },
  "tags.manage.newNameLabel": "Neuer Name",
  "tags.manage.hint":
    "Wähle einen Tag aus, um ihn umzubenennen, mit einem anderen Tag zusammenzuführen oder zu löschen. Die Änderung gilt überall, wo der Tag verwendet wird.",
  "tags.manage.applying": "Wird angewendet…",
  "tags.manage.merge": "Tags zusammenführen",
  "tags.manage.rename": "Tag umbenennen",
  "tags.manage.delete": "Tag löschen",
  "tags.manage.cancel": "Abbrechen",

  // --- Tag lifecycle: preview ----------------------------------------
  "tags.preview.rename": {
    one: "„{source}“ auf 1 Route umbenennen.",
    other: "„{source}“ auf {count} Routen umbenennen.",
  },
  "tags.preview.merge": {
    one: "„{source}“ auf 1 Route durch „{target}“ ersetzen.",
    other: "„{source}“ auf {count} Routen durch „{target}“ ersetzen.",
  },
  "tags.preview.renameTo": {
    one: "„{source}“ auf 1 Route in „{target}“ umbenennen.",
    other: "„{source}“ auf {count} Routen in „{target}“ umbenennen.",
  },

  // --- Tag lifecycle: confirmations ----------------------------------
  "tags.confirm.mergeTitle": "„{source}“ durch „{target}“ ersetzen?",
  "tags.confirm.mergeMessage": {
    one: "„{target}“ ist bereits vorhanden, daher werden die beiden Tags auf 1 Route zusammengeführt. „{source}“ ist danach nicht mehr vorhanden. Es wird keine Route gelöscht.",
    other:
      "„{target}“ ist bereits vorhanden, daher werden die beiden Tags auf {count} Routen zusammengeführt. „{source}“ ist danach nicht mehr vorhanden. Es wird keine Route gelöscht.",
  },
  "tags.confirm.deleteTitle": "Den Tag „{tag}“ löschen?",
  "tags.confirm.deleteMessage": {
    one: "„{tag}“ wird von 1 Route entfernt. Die Routen selbst werden nicht gelöscht und bleiben in deiner Bibliothek.",
    other:
      "„{tag}“ wird von {count} Routen entfernt. Die Routen selbst werden nicht gelöscht und bleiben in deiner Bibliothek.",
  },

  // --- Tag lifecycle: outcomes ---------------------------------------
  "tags.success.unused":
    "„{source}“ ist keiner Route mehr zugewiesen. Daher wurde nichts geändert.",
  "tags.success.deleted": {
    one: "„{source}“ von 1 Route entfernt. Die Route selbst bleibt gespeichert.",
    other:
      "„{source}“ von {count} Routen entfernt. Die Routen selbst bleiben gespeichert.",
  },
  "tags.success.merged": {
    one: "„{source}“ wurde auf 1 Route durch „{target}“ ersetzt.",
    other: "„{source}“ wurde auf {count} Routen durch „{target}“ ersetzt.",
  },
  "tags.success.renamed": {
    one: "„{source}“ auf 1 Route in „{target}“ umbenannt.",
    other: "„{source}“ auf {count} Routen in „{target}“ umbenannt.",
  },

  // --- GPX import ----------------------------------------------------
  "gpx.import": "GPX importieren",
  "gpx.importFile": "GPX-Datei importieren",

  // --- Planning: screen chrome --------------------------------------
  "planning.landmarkLabel": "Routenplanung",
  "planning.title": "Route planen",
  "planning.loadingDraft": "Dein Entwurf wird geladen…",
  "planning.draftLoadFailed":
    "Dein gespeicherter Entwurf konnte nicht geladen werden. Gespeicherte Daten wurden nicht verändert.",
  "planning.retry": "Erneut versuchen",

  // --- Planning: map controls ---------------------------------------
  "planning.map.zoomIn": "Vergrößern",
  "planning.map.zoomOut": "Verkleinern",
  "planning.map.northUp": "Nach Norden ausrichten, Draufsicht",
  "planning.map.locateMe": "Meinen Standort finden",
  "planning.map.locating": "Ortung…",
  "planning.map.locateFailed": "Dein Standort konnte nicht bestimmt werden.",
  "planning.map.clearWarningFirst":
    "Eine Warnung ist ausgewählt. Hebe die Auswahl auf, bevor du einen Wegpunkt setzt oder verschiebst.",
  "planning.map.clearFeatureFirst":
    "Ein Streckenmerkmal ist ausgewählt. Hebe die Auswahl auf, bevor du einen Wegpunkt setzt oder verschiebst.",

  // --- Planning: waypoints ------------------------------------------
  "planning.waypoints.heading": "Wegpunkte",
  "planning.waypoints.listLabel": "Wegpunkte",
  "planning.waypoints.empty":
    "Noch keine Wegpunkte. Tippe auf die Karte oder nutze das Fadenkreuz, um einen Wegpunkt zu setzen.",
  "planning.waypoints.start": "Start",
  "planning.waypoints.numbered": "Wegpunkt {number}",
  "planning.waypoints.moveUp": "{waypoint} nach oben verschieben",
  "planning.waypoints.moveDown": "{waypoint} nach unten verschieben",
  "planning.waypoints.deleteNamed": "{waypoint} löschen",
  "planning.waypoints.actionsGroup": "Aktionen für {waypoint}",
  "planning.waypoints.delete": "Löschen",
  "planning.waypoints.move": "Verschieben",
  "planning.waypoints.insertAfter": "Danach einfügen",

  // --- Planning: waypoint actions -----------------------------------
  "planning.actions.group": "Wegpunkt-Aktionen",
  "planning.actions.undo": "Rückgängig",
  "planning.actions.redo": "Wiederholen",
  "planning.actions.returnToStart": "Zurück zum Start",
  "planning.actions.reverse": "Route umkehren",
  "planning.actions.addToEnd": "Wegpunkt abwählen",

  // --- Planning: crosshair placement --------------------------------
  "planning.place.addHere": "Wegpunkt hier setzen",
  "planning.place.moveHere": "{waypoint} hierher verschieben",
  "planning.place.insertAfter": "Nach {waypoint} einfügen",
  "planning.place.theStart": "„Start“",
  "planning.place.numbered": "Wegpunkt {number}",

  // --- Planning: calculation ----------------------------------------
  "planning.calculate": "Route berechnen",
  "planning.calculating": "Wird berechnet…",
  "planning.calculatingSections": "{count} Routenabschnitte werden berechnet…",
  "planning.tryAgain": "Erneut berechnen",
  "planning.calculateFailed":
    "Die Route konnte nicht berechnet werden. Versuche es erneut.",

  // --- Planning: routing options ------------------------------------
  "planning.routing.profileGroup": "Routenprofil für diesen Entwurf",
  "planning.routing.summary": "Routing: {profile} · Fähren {ferries}",
  "planning.routing.ferriesAvoided": "vermieden",
  "planning.routing.ferriesAllowed": "erlaubt",
  "planning.routing.change": "Ändern",
  "planning.routing.avoidFerries": "Fähren für diesen Entwurf vermeiden",

  // --- Planning: stale-route status ---------------------------------
  "planning.stale.recalculatingProfile":
    "Die Route wird für {current} neu berechnet. Währenddessen bleibt das vorherige Ergebnis für {previous} sichtbar.",
  "planning.stale.waitingProfile":
    "Die Neuberechnung für {current} steht noch aus. Währenddessen bleibt das vorherige Ergebnis für {previous} sichtbar.",
  "planning.stale.recalculating":
    "Die Route wird mit deinen neuesten Änderungen neu berechnet. Währenddessen bleibt das vorherige Ergebnis sichtbar.",
  "planning.stale.waiting":
    "Die Neuberechnung der Route mit deinen neuesten Änderungen steht noch aus. Währenddessen bleibt das vorherige Ergebnis sichtbar.",

  // --- Planning: edit-copy notices ----------------------------------
  "planning.editCopy.reversedExact":
    "Du bearbeitest jetzt eine Kopie der Route mit umgekehrter Fahrtrichtung. Berechne sie vor dem Speichern neu, da sie wegen Einbahnregelungen von der ursprünglichen Route abweichen kann. Die gespeicherte Route bleibt unverändert.",
  "planning.editCopy.reversedEstimated":
    "Die Wegpunkte für die umgekehrte Route wurden aus dem bisherigen Routenverlauf geschätzt. Bei der Neuberechnung kann die Route anders verlaufen, insbesondere wegen Einbahnregelungen. Die gespeicherte Route bleibt unverändert.",
  "planning.editCopy.exact":
    "Du bearbeitest jetzt eine Kopie der Route, die auf den ursprünglich gesetzten Wegpunkten basiert. Die gespeicherte Route bleibt unverändert.",
  "planning.editCopy.estimated":
    "Anhand dieser Route wurden editierbare Wegpunkte näherungsweise ermittelt. Bei der Neuberechnung werden möglicherweise andere Straßen gewählt. Die gespeicherte Route bleibt unverändert.",

  // --- Planning: save, export, clear ---------------------------------
  "planning.save.heading": "Speichern oder exportieren",
  "planning.save.nameLabel": "Routenname",
  "planning.save.save": "Route speichern",
  "planning.save.saving": "Wird gespeichert…",
  "planning.save.export": "GPX exportieren",
  "planning.save.hint":
    "Berechne eine vollständige Route, bevor du sie speicherst oder exportierst.",
  "planning.save.failed":
    "Die Route konnte auf diesem Gerät nicht gespeichert werden. Versuch es noch einmal.",
  "planning.export.failed": "Die Route konnte nicht exportiert werden.",
  "planning.clearDraft": "Entwurf verwerfen",
  "planning.clearDraft.clearing": "Wird verworfen…",
  "planning.clearDraft.confirmTitle": "Diesen Entwurf verwerfen?",
  "planning.clearDraft.confirmMessage":
    "Damit werden alle Wegpunkte, die berechnete Route und alle weiteren ungespeicherten Daten dieses Entwurfs gelöscht. Gespeicherte Routen bleiben unverändert.",
  "planning.clearDraft.cancel": "Abbrechen",
  "planning.clearDraft.failed":
    "Der Entwurf konnte auf diesem Gerät nicht gelöscht werden. Versuche es erneut.",

  // --- Planning: no API key -----------------------------------------
  "planning.noKey.message":
    "Für die Routenberechnung brauchst du deinen persönlichen OpenRouteService-Schlüssel.",
  "planning.noKey.openSettings": "Einstellungen öffnen",

  // --- Cycling profiles ----------------------------------------------
  "routingProfile.cyclingRoad.label": "Rennrad",
  "routingProfile.cyclingRoad.description":
    "Bevorzugt Straßen, die für ein Rennrad geeignet sind.",
  "routingProfile.cyclingRegular.label": "Fahrrad",
  "routingProfile.cyclingRegular.description":
    "Nutzt möglicherweise häufiger Radwege und Wirtschaftswege. Die Route kann aber auch Abschnitte mit verdichtetem, geschottertem, unbefestigtem oder anderem Belag enthalten, die für ein Rennrad ungeeignet sein können.",

  // --- Route summary -------------------------------------------------
  "routeSummary.landmarkLabel": "Routenübersicht",
  "routeSummary.heading": "Routenübersicht",
  "routeSummary.descent": "{descent} m Abstieg",
  "routeSummary.waypointCount": { one: "1 Wegpunkt", other: "{count} Wegpunkte" },
  "routeSummary.routedVia": "Berechnet mit {provider}",
  "routeSummary.routedViaProfile": "Berechnet mit {provider} · {profile} ({profileId})",
  "routeSummary.unknownProvider": "unbekanntem Anbieter",
  "routeSummary.surfaceLabel": "Aufschlüsselung der Route nach Belag",
  "routeSummary.surfacePaved": "Befestigt: {distance}",
  "routeSummary.surfaceQuestionable": "Bedingt geeignet: {distance}",
  "routeSummary.surfaceUnsuitable": "Ungeeignet: {distance}",
  "routeSummary.surfaceUnknown": "Unbekannt: {distance}",
  "routeSummary.surfaceCaveat":
    "Die Angaben beruhen ausschließlich auf den verfügbaren Daten. Sie garantieren weder die Qualität der Wege noch, dass ihre Nutzung erlaubt ist oder die Bedingungen vor Ort den Daten entsprechen.",
  "routeSummary.warningsHeading": "Warnungen",
  "routeSummary.clearWarningSelection": "Auswahl der Warnung aufheben",
  "routeSummary.warningSurfaceDetail": "Belag: {surface}",
  "routeSummary.warningPosition": "Position auf der Route: {start}–{end} km",
  "routeSummary.warningRowSurface": "{warning} · {length}",
  "routeSummary.warningRow": "{warning} — {length} ({start}–{end})",
  "routeSummary.warningSelected": "Ausgewählte Warnung: {warning} ({start}–{end}).",

  // --- Route warnings, selected at render time from semantic data -----
  "warning.surfaceKind.unknown": "Unbekannter Belag",
  "warning.surfaceKind.questionable": "Bedingt geeigneter Belag",
  "warning.surfaceKind.unsuitable": "Ungeeigneter Belag",
  "warning.surfaceKind.other": "Belag",
  "warning.surface.unknown":
    "Für diesen Abschnitt sind keine Angaben zum Belag verfügbar.",
  "warning.surface.questionable": "Bedingt geeigneter Belag für ein Rennrad: {surface}.",
  "warning.surface.unsuitable": "Ungeeigneter Belag für ein Rennrad: {surface}.",
  "warning.structural.steps": "Die Route führt über Treppen.",
  "warning.structural.ferry": "Die Route nutzt eine Fähre.",
  "warning.structural.ford": "Die Route führt durch eine Furt.",
  "warning.structural.access":
    "Die Route führt über einen Abschnitt mit Zugangsbeschränkung.",
  "warning.structural.other":
    "Die Route führt über einen Weg, der in den Kartendaten als Baustelle gekennzeichnet ist.",

  // --- Surface names --------------------------------------------------
  "surface.unknown": "Keine auswertbaren Angaben zum Belag",
  "surface.paved": "Befestigt",
  "surface.asphalt": "Asphalt",
  "surface.concrete": "Beton",
  "surface.unpavedUnspecified": "Unbefestigt (nicht näher angegeben)",
  "surface.metal": "Metall",
  "surface.wood": "Holz",
  "surface.compactedGravel": "Verdichteter Schotter",
  "surface.gravel": "Schotter / Feinschotter",
  "surface.pavingStones": "Pflastersteine / Kopfsteinpflaster",
  "surface.grassPaver": "Rasengittersteine",
  "surface.dirt": "Erde",
  "surface.ground": "Naturboden oder Schlamm",
  "surface.ice": "Eis oder Schnee",
  "surface.sand": "Sand",
  "surface.grass": "Gras",

  // --- Routing-provider failures, as the rider sees them --------------
  "routingError.noApiKey":
    "Für die Routenberechnung brauchst du deinen persönlichen OpenRouteService-Schlüssel.",
  "routingError.invalidHeaderValue":
    "Dein OpenRouteService-Schlüssel enthält ein Zeichen, das nicht in einem HTTP-Header übertragen werden kann. Überprüfe den Schlüssel in den Einstellungen.",
  "routingError.requestNotSent":
    "Die Anfrage zur Routenberechnung konnte nicht vorbereitet oder gesendet werden. Versuche es erneut.",
  "routingError.unauthorized":
    "Dein OpenRouteService-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.",
  "routingError.forbidden":
    "Der Zugriff wurde verweigert. Prüfe dein OpenRouteService-Konto, deine Berechtigungen oder dein Tageskontingent. Falls nötig, ersetze den gespeicherten Schlüssel in den Einstellungen.",
  "routingError.rateLimited":
    "In kurzer Zeit wurden zu viele Routenberechnungen angefragt. Warte kurz und versuche es dann erneut.",
  "routingError.offline":
    "Du bist offline. Stelle eine Verbindung her, um eine Route zu berechnen.",
  "routingError.transportFailure":
    "OpenRouteService konnte nicht erreicht werden. Der Dienst ist möglicherweise vorübergehend nicht verfügbar oder die Anfrage wurde vom Browser oder vom Netzwerk blockiert. Versuche es später erneut.",
  "routingError.timeout":
    "Die Anfrage zur Routenberechnung hat zu lange gedauert. Versuche es erneut.",
  "routingError.noRouteFound":
    "Zwischen diesen Wegpunkten konnte keine Fahrradroute gefunden werden. Möglicherweise liegen dazwischen ein Gewässer, ein Hindernis oder eine Lücke im befahrbaren Wegenetz. Dein Schlüssel und die Verbindung zu OpenRouteService funktionieren. Versuche, die Route anzupassen.",
  "routingError.noRoutablePoint":
    "Einer deiner Wegpunkte liegt zu weit vom mit dem Fahrrad befahrbaren Wegenetz entfernt. Verschiebe ihn näher an eine Straße oder einen Radweg. Dein Schlüssel und die Verbindung zu OpenRouteService funktionieren.",
  "routingError.providerUnavailable":
    "OpenRouteService ist vorübergehend nicht verfügbar (HTTP {status}). Deine Wegpunkte bleiben erhalten. Versuche es später erneut.",
  "routingError.providerError":
    "Bei der Routenberechnung ist ein unerwarteter Fehler aufgetreten (HTTP {status}).",
  "routingError.unknownStatus": "Fehler",
  "routingError.providerCodeSuffix": " (Code des Anbieters: {code})",
  "routingError.unusableResponse":
    "Die Antwort von OpenRouteService konnte nicht verarbeitet werden. Versuche es erneut.",
  "routingError.legStitchingFailed":
    "Die Routenabschnitte konnten nicht zu einer durchgehenden Route verbunden werden. Versuche, die Route neu zu berechnen.",

  // --- GPX import and export failures ---------------------------------
  "gpx.error.emptyFile": "Die gewählte Datei ist leer.",
  "gpx.error.tooLarge": "Die gewählte Datei ist größer als das Limit von {limitMb} MB.",
  "gpx.error.unsupportedType": "Es werden nur .gpx-Dateien unterstützt.",
  "gpx.error.malformedXml":
    "Die Datei enthält fehlerhaftes XML und kann nicht als GPX gelesen werden.",
  "gpx.error.invalidCoordinate":
    "Die Koordinaten eines Punkts sind ungültig oder liegen außerhalb des zulässigen Bereichs (lon={longitude}, lat={latitude}).",
  "gpx.error.missingAttribute": "fehlt",
  "gpx.error.invalidElevation":
    "Bei einem Punkt ist der Höhenwert „{elevation}“ keine Zahl.",
  "gpx.error.noUsablePoints":
    "Die Datei enthält keine verwendbaren Track- oder Routenpunkte.",
  "gpx.error.noTrackOrRoute":
    "Die Datei enthält weder einen Track noch eine Route, die importiert werden kann.",
  "gpx.error.cryptoUnavailable":
    "Die Abbiegeinformationen und/oder Planungswegpunkte dieser Route konnten nicht in den GPX-Export übernommen werden, weil diesem Browser die Kryptografiefunktion fehlt, mit der diese Daten an die Routengeometrie gebunden werden. Der Export wurde abgebrochen, damit die Daten nicht unbemerkt verloren gehen.",

  // --- GPX import notices ---------------------------------------------
  "gpx.notice.multipleTracks": {
    one: "Diese Datei enthält 1 Track; er wurde importiert.",
    other: "Diese Datei enthält {count} Tracks; nur der erste wurde importiert.",
  },
  "gpx.notice.multipleRoutes": {
    one: "Diese Datei enthält 1 Route; sie wurde importiert.",
    other: "Diese Datei enthält {count} Routen; nur die erste wurde importiert.",
  },
  "gpx.notice.acnExtensionRejected":
    "Diese GPX-Datei enthielt Abbiegeinformationen, die nicht zur Routengeometrie passten und deshalb ignoriert wurden.",
  "gpx.notice.acnPlanningExtensionRejected":
    "Diese GPX-Datei enthielt Planungswegpunkte, die nicht zur Routengeometrie passten und deshalb ignoriert wurden. Wenn du eine Kopie der Route bearbeitest, werden die Wegpunkte stattdessen aus der Route ermittelt.",

  // --- Distance badges on the route ------------------------------------
  "map.badge.distance": { one: "1 Kilometer", other: "{count} Kilometer" },
  "map.badge.distanceList": "{list} Kilometer",
  "map.badge.fromRouteStart": "{distances} vom Start der Route",

  // --- Map imagery recovery ---------------------------------------------
  // translator: the route-riding and free-roam wordings are deliberately
  // NOT a mechanical substitution — free roam has no route on screen and
  // must never claim one is shown.
  "map.imagery.delayed.route":
    "Das Laden des Kartenmaterials dauert länger als gewöhnlich. Deine Route und Position bleiben sichtbar.",
  "map.imagery.delayed.freeRoam":
    "Das Laden des Kartenmaterials dauert länger als gewöhnlich. Deine Position bleibt sichtbar.",
  "map.imagery.loadError":
    "Die Karte konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.",
  "map.imagery.tileError.route":
    "Kartenmaterial nicht verfügbar. Die Route und deine Position bleiben sichtbar.",
  "map.imagery.tileError.freeRoam":
    "Kartenmaterial nicht verfügbar. Deine Position bleibt sichtbar.",
  "map.imagery.fallback.route":
    "Kartenmaterial nicht verfügbar — deine Route bleibt auf einem schlichten Hintergrund sichtbar.",
  "map.imagery.fallback.freeRoam":
    "Kartenmaterial nicht verfügbar — deine Position bleibt auf einem schlichten Hintergrund sichtbar.",
  "map.retryImagery": "Karte neu laden",
  "map.loading": "Karte wird geladen…",
  "map.loadTimeout": "Das Laden der Karte dauert länger als erwartet.",

  // --- Planning waypoint markers on the map -----------------------------
  "map.marker.waypoint": "Wegpunkt {ordinal}",
  "map.marker.startWaypoint": "Start: Wegpunkt 1",
  "map.marker.startAndFinish": "Start: Wegpunkt 1; Ziel: Wegpunkt {count}",
  "map.marker.finishWaypoint": "Ziel: Wegpunkt {ordinal}",

  // --- Shared ride chrome (Riding and free roam) ------------------------
  "ride.map.zoomIn": "Vergrößern",
  "ride.map.zoomOut": "Verkleinern",
  "ride.map.northUp": "Nach Norden ausrichten, Draufsicht",
  "ride.map.followLocation": "Meinem Standort folgen",
  "ride.map.waiting": "Warten…",
  "ride.map.followPaused": "Folgemodus pausiert.",
  "ride.online": "Online",
  "ride.offline": "Offline",
  "ride.tryAgain": "Erneut versuchen",
  "ride.cancel": "Abbrechen",
  "ride.pause": "Pause",
  "ride.pausing": "Wird pausiert…",
  "ride.endRide": "Fahrt beenden",
  "ride.endingRide": "Fahrt wird beendet…",
  "ride.gpsError": "GPS-Fehler",
  "ride.waitingForFix": "Warten auf GPS-Position…",
  // translator: space-constrained — this sits on one status line beside
  // the accuracy figure.
  "ride.fixAge.seconds": "vor {seconds}s",
  "ride.fixAge.minutes": "vor {minutes} min",
  "ride.gpsStatus": "GPS ±{accuracy} m · {freshness}",
  "ride.gpsFresh": "Live",
  "ride.gpsStale": "Veraltet",
  "ride.gpsStaleWithAge": "Veraltet ({age})",

  // --- Geolocation failures ---------------------------------------------
  "ride.geolocation.deniedRiding":
    "Der Standortzugriff wurde verweigert. Erlaube ihn in den Einstellungen deines Browsers, um den Fahrmodus zu nutzen.",
  "ride.geolocation.deniedFreeRoam":
    "Der Standortzugriff wurde verweigert. Erlaube ihn in den Einstellungen deines Browsers, um „Freies Fahren“ zu nutzen.",
  "ride.geolocation.timeout":
    "Bei der Standortbestimmung ist eine Zeitüberschreitung aufgetreten. Achte auf freie Sicht zum Himmel und versuche es erneut.",
  "ride.geolocation.unsupported": "Dieser Browser unterstützt keine Standortdienste.",
  "ride.geolocation.unavailable": "Dein Standort ist derzeit nicht verfügbar.",

  // --- Riding status card -----------------------------------------------
  "ride.status.onRoute": "Auf Kurs",
  "ride.status.possiblyOffRoute": "Mögliche Kursabweichung",
  "ride.status.offRoute": "Vom Kurs ab",
  "ride.status.ascentUnavailable": "Höhenmeter nicht verfügbar",
  "ride.status.ascent": "{ascent} Hm",
  "ride.status.remainingAnnouncement": "Noch {distance} Kilometer, {ascent}",
  "ride.status.ascentRemainingUnavailable": "verbleibende Höhenmeter nicht verfügbar",
  "ride.status.ascentRemaining": "noch {ascent} Höhenmeter",

  // --- Free roam ---------------------------------------------------------
  "freeRoam.title": "Freies Fahren",
  "freeRoam.endFailed":
    "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
  "freeRoam.pauseFailed":
    "Freies Fahren konnte auf diesem Gerät nicht pausiert werden. Versuche es erneut.",
  "freeRoam.endConfirmTitle": "Diese Fahrt beenden?",
  "freeRoam.endConfirmMessage":
    "Deine gespeicherte Position und Kartenansicht für „Freies Fahren“ werden verworfen.",
  "freeRoam.trackingLost": "Standort — Signal verloren",
  "freeRoam.tracking": "Standort",

  // --- Riding screen -----------------------------------------------------
  "riding.landmarkLabel": "Fahren",
  "riding.endConfirmTitle": "Diese Fahrt beenden?",
  "riding.endConfirmMessage":
    "Der Navigationsfortschritt dieser Fahrt wird verworfen. Die gespeicherte Route bleibt in deiner Routenbibliothek.",
  "riding.endFailed":
    "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
  "riding.finishFailed":
    "Die Fahrt konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
  "riding.pauseFailed":
    "Die Fahrt konnte auf diesem Gerät nicht pausiert werden. Versuche es erneut.",
  "riding.offlineNotice":
    "Offline — Route, Position, Fortschritt und Höhendaten bleiben verfügbar. Das Kartenmaterial wird möglicherweise nicht angezeigt.",
  "riding.restoreFailed":
    "Deine Fahrt konnte auf diesem Gerät nicht wiederhergestellt werden. Versuche es erneut.",
  "riding.retry": "Erneut versuchen",
  "riding.backToRideOptions": "Zurück zur Auswahl",
  "riding.resuming": "Deine Fahrt wird fortgesetzt…",
  "riding.resumePrompt":
    "Setze die Fahrt fort, damit dein Fortschritt weiter erfasst wird.",
  "riding.startPrompt":
    "Um deinen Fortschritt während dieser Fahrt zu erfassen, benötigt die App Zugriff auf deinen Standort.",
  "riding.resumeRide": "Fahrt fortsetzen",
  "riding.startRiding": "Fahrt starten",
  "riding.editCopy": "Kopie bearbeiten",
  "riding.creatingEditCopy": "Kopie zum Bearbeiten wird erstellt…",
  "riding.editCopyTooShort":
    "Der Streckenverlauf enthält nicht genügend unterschiedliche Punkte, um eine Kopie zum Bearbeiten zu erstellen.",
  "riding.editCopyFailed":
    "Es konnte auf diesem Gerät keine Kopie zum Bearbeiten erstellt werden. Versuche es erneut.",
  "riding.editCopyDraftCheckFailed":
    "Dein vorhandener Entwurf konnte nicht überprüft werden. Versuche es erneut.",
  "riding.editCopyConfirmTitle": "Aktuellen Entwurf ersetzen?",
  "riding.editCopyConfirmMessage":
    "Wenn du diese Route bearbeitest, wird dein nicht gespeicherter Entwurf im Bereich „Planung“ ersetzt. Die Route selbst bleibt unverändert.",
  "riding.editCopyConfirmLabel": "Ersetzen und bearbeiten",
  "riding.elevationViewLabel": "Ansicht des Höhenprofils",
  "riding.elevationFull": "Gesamt",
  "riding.elevationWindow": "{km} km",
  "riding.climb": "Anstieg",
  "riding.routeProfile": "Höhenprofil",
  "riding.viewLabel": "Ansicht während der Fahrt",
  "riding.viewMap": "Karte",
  "riding.viewProfile": "Profil",
  "riding.climbChartLabel": "Höhenprofil für Anstieg {number}",
  "riding.descentChartLabel": "Höhenprofil der ausgewählten Abfahrt",

  // --- Ride launcher ------------------------------------------------------
  "launcher.landmarkLabel": "Fahren",
  "launcher.title": "Fahren",
  "launcher.checking": "Fahrtstatus wird geprüft…",
  "launcher.checkFailed":
    "Der Fahrtstatus konnte nicht geprüft werden. Es wurde nichts geändert.",
  "launcher.retry": "Erneut versuchen",
  "launcher.noRoute":
    "Noch keine Route ausgewählt. Wähle unter „Routen“ eine aus, um loszufahren.",
  "launcher.chooseRoute": "Route wählen",
  "launcher.startFreeRoam": "Freies Fahren starten",
  "launcher.startingFreeRoam": "Wird gestartet…",
  "launcher.unfinishedRide": "Du hast auf dieser Route eine unbeendete Fahrt.",
  "launcher.resumeRide": "Fahrt fortsetzen",
  "launcher.freeRoamHeading": "Freies Fahren",
  "launcher.unfinishedFreeRoam": "Du hast eine unbeendete „Freies Fahren“-Session.",
  "launcher.resumeFreeRoam": "Freies Fahren fortsetzen",
  "launcher.resumingFreeRoam": "Wird fortgesetzt…",
  "launcher.endFreeRoamFailed":
    "Freies Fahren konnte auf diesem Gerät nicht beendet werden. Versuche es erneut.",
  "launcher.discardTitle": "Nicht beendete Fahrt verwerfen?",
  "launcher.discardMessage":
    "Es wird nur der gespeicherte Fortschritt dieser noch nicht beendeten Fahrt verworfen  —  gespeicherte Routen bleiben unverändert.",
  "launcher.discardConfirm": "Unbeendete Fahrt verwerfen",
  "launcher.discarding": "Wird verworfen…",
  "launcher.discardFailed":
    "Diese unbeendete Fahrt konnte auf diesem Gerät nicht verworfen werden. Versuche es erneut.",
  "launcher.routeMissing":
    "Diese Fahrt wurde noch nicht beendet, aber die zugehörige Route ist nicht mehr in deiner Routenbibliothek gespeichert. Deshalb kann die Fahrt nicht fortgesetzt werden.",
  "launcher.unsupportedKind":
    "Diese App-Version kann die noch nicht beendete Fahrt nicht wiederherstellen.",

  // --- Climbs -------------------------------------------------------------
  "climb.selectorLabel": "Erkannte Anstiege",
  "climb.empty":
    "Keine erkannten Anstiege. Ein Anstieg wird erkannt, wenn er mindestens 500 m lang ist und eine durchschnittliche Steigung von mindestens 3% aufweist.",
  "climb.allRoute": "Gesamte Route",
  "climb.option": "Anstieg {number} · {category} · beginnt bei {start} km",
  "climb.count": {
    one: "1 erkannter Anstieg auf dieser Route",
    other: "{count} erkannte Anstiege auf dieser Route",
  },
  "climb.heading": "Anstieg {number} · {category}",
  "climb.previewLabel": "Vorschau des Anstiegs",
  "climb.progressLabel": "Fortschritt im Anstieg",
  "climb.startsIn": "Beginnt in {distance}",
  "climb.distanceToSummit": "Bis zum Ende",
  "climb.elevationRemaining": "Verbleibende Höhenmeter",
  "climb.currentGradient": "Aktuelle Steigung: {gradient}",
  "climb.currentElevation": "Aktuelle Höhe: {elevation}",
  "climb.summitElevation": "Höhe am Ende: {elevation}",
  "climb.distanceCompleted": "Zurückgelegte Strecke: {distance}",
  "climb.cueActive": "Im Anstieg",
  "climb.cueRemaining": "noch {distance}",
  "climb.viewClimb": "Anstieg ansehen",
  "climb.selectedFeatureLabel": "Übersicht des gewählten Abschnitts",
  "climb.recognisedDescent": "Erkannte Abfahrt",
  "climb.remaining": "noch {distance}",
  "climb.passedAgo": "vor {distance} passiert",
  "climb.average": "{gradient} im Mittel",
  "climb.routePosition": "Position auf der Route: {start}–{end} km",

  // --- Manoeuvres: locally authored fallbacks only ------------------------
  // translator: ACN's own generic labels, used only when the routing
  // provider supplied no instruction at all. A provider's own instruction
  // — which carries road names — is never translated. The infinitive is
  // the German navigation convention.
  "manoeuvre.start": "Start der Route",
  "manoeuvre.continue": "Geradeaus weiter",
  "manoeuvre.slightLeft": "Leicht links halten",
  "manoeuvre.left": "Links abbiegen",
  "manoeuvre.sharpLeft": "Scharf links abbiegen",
  "manoeuvre.slightRight": "Leicht rechts halten",
  "manoeuvre.right": "Rechts abbiegen",
  "manoeuvre.sharpRight": "Scharf rechts abbiegen",
  "manoeuvre.uTurn": "Wenden",
  "manoeuvre.roundabout": "Durch den Kreisverkehr fahren",
  "manoeuvre.waypoint": "Wegpunkt",
  "manoeuvre.finish": "Am Ziel",
  "manoeuvre.fallback": "Der Route weiter folgen",
  "manoeuvre.unavailable": "Für diese Route sind keine Abbiegeinformationen verfügbar.",
  // translator: appended to an instruction; the leading space is part of
  // the message and must be preserved.
  "manoeuvre.frozenFull": " — basierend auf deiner letzten bekannten Position",
  "manoeuvre.frozenCompact": " — letzte bekannte Position",

  // --- Route completion, wake lock, untrusted GPX -------------------------
  "riding.routeComplete": "Route abgeschlossen",
  "riding.finishRide": "Fahrt abschließen",
  "riding.finishingRide": "Fahrt wird abgeschlossen…",
  "riding.keepRiding": "Weiterfahren",
  "wakeLock.label": "Display an",
  "wakeLock.on": "An",
  "wakeLock.off": "Aus",
  "wakeLock.active": "Das Display bleibt an.",
  "wakeLock.failed": "Das Display konnte nicht an bleiben.",
  "wakeLock.retry": "Tippe, um es erneut zu versuchen",
  "riding.untrustedGpx":
    "Diese importierte GPX-Datei enthält keine verlässlichen Abbiegeinformationen. Folge der Routenlinie auf der Karte.",
  "riding.noTurnCues": "Keine Abbiegehinweise",

  // --- Shared unit and figure formatters ---------------------------------
  // translator: the numeric value arrives already formatted with an
  // explicit locale, so these must not re-punctuate it.
  "format.distanceKm": "{distance} km",
  "format.metres": "{metres} m",
  "format.gradientPercent": "{gradient}%",
  "format.ascent": "{metres} Höhenmeter",
  "format.ascentUnavailable": "Höhenmeter nicht verfügbar",
  "format.descentLoss": "{metres} m Höhenverlust",

  // --- Recognised climbs and descents: presentation ----------------------
  "feature.colour.green": "grün",
  "feature.colour.yellow": "gelb",
  "feature.colour.orange": "orange",
  "feature.colour.red": "rot",
  "feature.colour.darkRed": "dunkelrot",
  "feature.colour.lightBlue": "hellblau",
  "feature.colour.blue": "blau",
  "feature.colour.darkBlue": "dunkelblau",

  "feature.category.uncategorised": "Nicht kategorisiert",
  "feature.category.category4": "Kategorie 4",
  "feature.category.category3": "Kategorie 3",
  "feature.category.category2": "Kategorie 2",
  "feature.category.category1": "Kategorie 1",
  "feature.category.hc": "HC",

  "feature.label.uncategorised": "Nicht kategorisierter Anstieg",
  "feature.label.category4": "Anstieg der 4. Kategorie",
  "feature.label.category3": "Anstieg der 3. Kategorie",
  "feature.label.category2": "Anstieg der 2. Kategorie",
  "feature.label.category1": "Anstieg der 1. Kategorie",
  "feature.label.hc": "HC-Anstieg",
  "feature.label.moderate": "Erkannte Abfahrt (mäßig steil, 3% bis knapp unter 6%)",
  "feature.label.steep": "Erkannte Abfahrt (steil, 6% bis knapp unter 9%)",
  "feature.label.verySteep": "Erkannte Abfahrt (sehr steil, ab 9%)",
  "feature.label.uncategorisedOrCategory4":
    "Nicht kategorisierter Anstieg oder Anstieg der 4. Kategorie",

  // translator: short codes for space-constrained map labels. The hollow
  // down-arrows are deliberate and must stay exactly as they are.
  "feature.shortLabel.uncategorised": "NK",
  "feature.shortLabel.category4": "K4",
  "feature.shortLabel.category3": "K3",
  "feature.shortLabel.category2": "K2",
  "feature.shortLabel.category1": "K1",
  "feature.shortLabel.hc": "HC",
  "feature.shortLabel.moderate": "▽",
  "feature.shortLabel.steep": "▽▽",
  "feature.shortLabel.verySteep": "▽▽▽",
  "feature.shortLabel.uncategorisedOrCategory4": "NK/K4",

  "feature.ordinaryRoute":
    "Normale Route (einschließlich Abschnitten ohne ausreichende Höhendaten sowie weniger steilen Teilstücken innerhalb einer ausgewählten Abfahrt) · grün",
  "feature.recognisedDescent": "Erkannte Abfahrt",

  "feature.band.gentleOrDescending": "Leicht ansteigend, eben oder kurz abfallend",
  "feature.band.moderateClimb": "Mäßig steiler Anstieg",
  "feature.band.hardClimb": "Schwerer Anstieg",
  "feature.band.veryHardClimb": "Sehr schwerer Anstieg",
  "feature.band.extremelySteepClimb": "Extrem steiler Anstieg",
  "feature.bandRange.gentleOrDescending": "Unter 3%",
  "feature.bandRange.moderateClimb": "3% bis unter 6%",
  "feature.bandRange.hardClimb": "6% bis unter 9%",
  "feature.bandRange.veryHardClimb": "9% bis unter 12%",
  "feature.bandRange.extremelySteepClimb": "Ab 12%",

  "feature.descentLocal.moderate": "Mäßig steile Abfahrt",
  "feature.descentLocal.steep": "Steile Abfahrt",
  "feature.descentLocal.verySteep": "Sehr steile Abfahrt",
  "feature.descentLocal.neutral": "Gefälle unterhalb der Erkennungsschwelle",
  "feature.descentLocalRange.neutral": "Unter 3%",
  "feature.descentLocalRange.moderate": "3% bis unter 6%",
  "feature.descentLocalRange.steep": "6% bis unter 9%",
  "feature.descentLocalRange.verySteep": "Ab 9%",

  // --- Shared legends, disclosures and detail panels ---------------------
  "legend.climbCategories": "Anstiegskategorien",
  "legend.climbGradient": "Detaillierte Legende zu den Steigungsbereichen der Anstiege",
  "legend.descentGradient": "Detaillierte Legende zu den Gefällebereichen der Abfahrten",
  "legend.routeFeatures": "Legende der erkannten Routenabschnitte",
  "legend.localClimbColours": "Farben für die Steigung der einzelnen Abschnitte",
  "legend.localDescentColours": "Farben für das Gefälle der einzelnen Abschnitte",
  "legend.gradientColours": "Farben nach Streckenneigung",
  "legend.recognisedRouteFeatures": "Erkannte Routenabschnitte",
  "legend.detailedLocalGradient": "Detaillierte lokale Streckenneigung",
  "legend.macroExplanation":
    "Die Farbe des gesamten Anstiegs richtet sich nach seiner Länge und seiner durchschnittlichen Steigung. Erkannte Abfahrten werden je nach durchschnittlichem Gefälle in einem von drei Blautönen dargestellt. Diese Farbzuordnung wurde eigens für diese App festgelegt.",
  "legend.localExplanation":
    "Die Detailfarben zeigen die lokale Steigung in Abschnitten von jeweils etwa 100 m innerhalb des ausgewählten oder gerade aktiven Anstiegs. Kurze ebene oder abfallende Abschnitte innerhalb eines Anstiegs werden grün dargestellt. Bei einer ausgewählten oder gerade aktiven Abfahrt werden dieselben drei oben gezeigten Blautöne auf die einzelnen Abschnitte statt auf die gesamte Abfahrt angewendet. Abschnitte, deren Gefälle unterhalb der Schwelle liegt, erscheinen stattdessen in der normalen Routenfarbe.",
  "legend.clearSelection": "Auswahl aufheben",

  "featureDetails.landmarkLabel": "Details zum Routenabschnitt",
  "featureDetails.heading": "Anstieg {number} · {category}",
  "featureDetails.routePosition": "Position auf der Route: {start}–{end} km",
  "featureDetails.length": "Länge: {distance}",
  "featureDetails.elevationGain": "Höhengewinn: {elevation}",
  "featureDetails.elevationLoss": "Höhenverlust: {elevation}",
  "featureDetails.averageGradient": "Durchschnittliche Steigung: {gradient}",
  "featureDetails.maximumLocalGradient": "Maximale lokale Steigung: {gradient}",
  "featureDetails.steepestLocalGradient": "Stärkste lokale Neigung: {gradient}",
  "featureDetails.climbScore": "Anstiegswertung: {score}",

  "segmentDetails.landmarkLabel": "Details zur Neigung des Streckenabschnitts",
  "segmentDetails.heading": "{band} · {gradient}",
  "segmentDetails.elevation": "Höhe: {start} m bis {end} m",

  // --- Elevation chart ---------------------------------------------------
  "elevation.noRoute": "Keine Route geladen.",
  "elevation.noData": "Für diese Route sind keine Höhendaten verfügbar.",
  "elevation.landmarkLabel": "Höhenprofil",
  "elevation.chartLabel": "Höhenprofildiagramm",
  "elevation.range": "{min}–{max} m",
  "elevation.rangeWithGaps": "{min}–{max} m (für einige Abschnitte fehlen Höhendaten)",
  "elevation.markerCurrent": "Aktuelle Position: {position} von {total}.",
  "elevation.markerStale": "Letzte bekannte Position: {position} von {total}.",
  "elevation.distanceGuides": {
    one: "Eine Entfernungsmarke liegt {distances} Kilometer voraus",
    other: "Entfernungsmarken liegen {distances} Kilometer voraus",
  },

  // --- Stored routing key: status ----------------------------------------
  // translator: every one of these is deliberately a historical statement,
  // never a live assertion about the provider's current state — a reload
  // re-checks nothing. `checkedAt` is always a UTC timestamp.
  "providerKey.none": "Kein Schlüssel eingerichtet",
  "providerKey.unverified":
    "Schlüssel auf diesem Gerät gespeichert, aber noch nicht geprüft",
  "providerKey.verified": "Schlüssel zuletzt bestätigt: {checkedAt}",
  "providerKey.rejected": "Schlüssel zuletzt abgelehnt: {checkedAt}",
  "providerKey.quotaRetryAfter": "Kontingent ausgeschöpft, erneuter Versuch ab {resetAt}",
  "providerKey.quotaReached":
    "Kontingent bei letzter Prüfung ausgeschöpft: {checkedAt}. Du kannst es erneut versuchen.",
  "providerKey.unavailable": "Anbieter bei letzter Prüfung nicht verfügbar: {checkedAt}",
  "providerKey.utcTimestamp": "{timestamp} UTC",

  // --- Status: on-screen diagnostic log lines ----------------------------
  // translator: everything these interpolate — an HTTP status, a browser
  // error class such as TypeError, a provider category, a transport reason
  // code — is a machine token supplied verbatim and is never translated.
  "routingLog.responseReceived": "HTTP-Antwort erhalten: {status}",
  "routingLog.responseReceivedWithCategory":
    "HTTP-Antwort erhalten: {status} ({category})",
  "routingLog.offline": "Gerät meldete „offline“",
  "routingLog.timeout": "Zeitüberschreitung bei der Anfrage",
  "routingLog.invalidHeaderValue":
    "Der gespeicherte Schlüssel konnte nicht in einem HTTP-Anfrageheader verwendet werden",
  "routingLog.headerConstructionFailure":
    "Die Anfrageheader konnten nicht erstellt werden",
  "routingLog.invalidRequestConstruction": "Die Anfrage konnte nicht erstellt werden",
  "routingLog.fetchInvocationFailure":
    "Die Netzwerkanfrage konnte nicht gestartet werden",
  "routingLog.noResponseExposed":
    "Die Netzwerkanfrage schlug fehl, bevor der Browser eine HTTP-Antwort bereitstellte",
  "routingLog.withDetail": "{base} ({detail})",
  "routingLog.unknownStatus": "unbekannt",

  "mapLog.styleRequestOrParseFailure":
    "Der Kartenstil konnte nicht geladen oder verarbeitet werden",
  "mapLog.tileRequestFailure": "Eine Kartenkachel konnte nicht geladen werden",
  "mapLog.spriteFailure": "Die Kartensymbole konnten nicht geladen werden",
  "mapLog.workerFailure":
    "Der Hintergrundprozess der Karte hat nicht rechtzeitig reagiert",
  "mapLog.webglInitFailure":
    "Die Kartendarstellung (WebGL) konnte auf diesem Gerät oder in diesem Browser nicht initialisiert werden",
  "mapLog.initialLoadTimeout": "Der Kartenstil war nicht rechtzeitig verfügbar",
  "mapLog.fallbackActivated": "Zum einfachen Hintergrund gewechselt",
  "mapLog.manualRetry": "Erneutes Laden des Kartenmaterials angefordert",
  "mapLog.autoRetry":
    "Nach der Rückkehr zur App oder dem Wiederherstellen der Verbindung wurde automatisch versucht, das Kartenmaterial neu zu laden",
  "mapLog.imageryRecovered": "Kartenmaterial erfolgreich geladen",

  // --- Status: routing connection test -----------------------------------
  // translator: these describe observed facts, never an assumed root
  // cause. "transportResponseUnavailable" in particular stays hedged —
  // page JavaScript cannot establish WHY the browser withheld a response,
  // so this must never present CORS as confirmed.
  "connectionTest.stage.notAttemptedNoKey":
    "Da kein OpenRouteService-Schlüssel eingerichtet ist, wurde keine Anfrage gesendet.",
  "connectionTest.stage.invalidKeySyntax":
    "Der gespeicherte Schlüssel selbst enthält ein Zeichen, das nicht in einem HTTP-Header übermittelt werden kann. Das wurde festgestellt, bevor überhaupt eine Anfrage erstellt wurde.",
  "connectionTest.stage.headerConstruction":
    "Die HTTP-Header der Anfrage konnten nicht erstellt werden.",
  "connectionTest.stage.requestConstruction":
    "Das Anfrageobjekt selbst konnte nicht erstellt werden.",
  "connectionTest.stage.fetchInvocation":
    "Der Aufruf der Fetch-Funktion schlug synchron fehl, bevor überhaupt ein Promise erstellt wurde.",
  "connectionTest.stage.offline":
    "Das Gerät meldete „offline“, bevor überhaupt eine Anfrage gesendet wurde.",
  "connectionTest.stage.timeout":
    "Die Anfrage erhielt innerhalb des Routing-Zeitlimits keine Antwort.",
  "connectionTest.stage.transportResponseUnavailable":
    "Der Browser stellte der App keine HTTP-Antwort zur Verfügung. Mögliche Ursachen sind eine CORS- oder Preflight-Blockierung, DNS- oder TLS-Probleme, eine Zeitüberschreitung, Verbindungsprobleme oder eine Antwort des Anbieters ohne die erforderlichen CORS-Header.",
  "connectionTest.stage.httpResponse":
    "Eine HTTP-Antwort von OpenRouteService ist eingegangen.",
  "connectionTest.stage.responseParsing":
    "Eine HTTP-Antwort ist eingegangen, ihr Inhalt ließ sich jedoch nicht im erwarteten Routenformat verarbeiten.",
  "connectionTest.stage.routeProcessing":
    "Eine Antwort ist eingegangen und wurde verarbeitet, die Route selbst konnte jedoch nicht verwendet werden.",
  "connectionTest.stage.success": "Eine gültige Fahrradroute wurde empfangen.",

  // --- Status: screen chrome and system status ---------------------------
  "status.landmarkLabel": "Status",
  "status.title": "Status",
  "status.systemStatus": "Systemstatus",
  "status.appVersion": "App-Version",
  "status.build": "Build",
  "status.network": "Netzwerk",
  "status.online": "Online",
  "status.offline": "Offline",
  "status.serviceWorker": "Service Worker",
  "status.sw.unsupported": "Von diesem Browser nicht unterstützt",
  "status.sw.notRegistered": "Nicht registriert",
  "status.sw.installing": "Wird installiert",
  "status.sw.waiting": "Wartet auf Aktivierung",
  "status.sw.active": "Aktiv",
  "status.sw.unknown": "Unbekannt",
  "status.storage": "Speicher",
  "status.storage.checking": "Wird geprüft…",
  "status.storage.unavailable": "Nicht verfügbar",
  "status.storage.ok": "OK (Schemaversion {version})",
  "status.storage.estimateChecking": "Speichernutzung wird ermittelt…",
  "status.storage.estimateUnsupported":
    "Geschätzte App-Speichernutzung: vom Browser nicht unterstützt",
  "status.storage.estimateUnavailable": "Geschätzte App-Speichernutzung: nicht verfügbar",
  "status.storage.estimate":
    "Geschätzte App-Speichernutzung: {used} von {quota} belegt ({percentage})",
  "status.storage.pressure":
    "Speicherwarnung: Die geschätzte App-Speichernutzung ist hoch.",
  "status.storage.bytes": "{value} B",
  "status.storage.kibibytes": "{value} KiB",
  "status.storage.mebibytes": "{value} MiB",
  "status.storage.gibibytes": "{value} GiB",
  "status.storage.tebibytes": "{value} TiB",
  "status.storage.lessThanOnePercent": "<1%",
  "status.storage.percentage": "{percentage}%",
  "status.mapRendering": "Unterstützung für die Kartendarstellung",
  "status.mapRendering.supported": "Unterstützt",
  "status.mapRendering.unsupported": "Von diesem Browser nicht unterstützt",
  "status.geolocationPermission": "Standortberechtigung",
  "status.permission.granted": "Erteilt",
  "status.permission.denied": "Verweigert",
  "status.permission.prompt": "Noch nicht angefordert",
  "status.permission.unsupported": "Von diesem Browser nicht unterstützt",
  "status.fixAccuracy": "Genauigkeit der letzten Standortbestimmung",
  "status.fixAccuracyValue": "±{accuracy} m",
  "status.fixAge": "Zeit seit der letzten Standortbestimmung",
  "status.notApplicableYet": "Noch keine Standortbestimmung",
  "status.fixAge.seconds": "vor {seconds}s",
  "status.fixAge.minutes": "vor {minutes} min",

  // --- Status: active session (backlog item 117) -------------------------
  // translator: each of these is a distinct, load-bearing state and none
  // may be merged with another. A route-backed session shows the rider's
  // own route name verbatim and never an internal identifier.
  "status.session": "Aktuelle Fahrt",
  "status.session.none": "Keine",
  "status.session.freeRoam": "Freies Fahren",
  "status.session.checking": "Wird geprüft…",
  "status.session.routeUnavailable": "Route nicht verfügbar",
  "status.session.unavailable": "Fahrt nicht verfügbar",

  // --- Status: recent errors ---------------------------------------------
  "status.recentErrors": "Kürzlich aufgetretene Fehler",
  "status.noErrors": "In der aktuellen Sitzung wurden keine Fehler erfasst.",

  // --- Status: routing diagnostics ---------------------------------------
  "status.routingDiagnostics": "Routing-Diagnose",
  "status.recentRoutingAttempts": "Letzte Routing-Versuche",
  "status.noRoutingAttempts":
    "In der aktuellen Sitzung wurden keine Routing-Versuche erfasst.",
  "status.fetchFailureSummary":
    "Warum eine Netzwerkanfrage scheitern kann, bevor eine HTTP-Antwort vorliegt",
  "status.fetchFailureDetail":
    "Browser zeigen möglicherweise einen allgemeinen Netzwerkfehler statt des tatsächlichen HTTP-Statuscodes an, wenn in der Fehlerantwort des Anbieters die erforderlichen CORS-Header fehlen. Der Eintrag „Die Netzwerkanfrage schlug fehl, bevor der Browser eine HTTP-Antwort bereitstellte“ kann daher auf eine Störung beim Anbieter, fehlende CORS-Header, einen DNS- oder TLS-Fehler oder eine lokale Netzwerkbeschränkung zurückgehen. Allein anhand dieses Eintrags lassen sich diese Ursachen nicht unterscheiden.",
  "status.httpGuideSummary": "Was HTTP-Statuscodes bedeuten",
  "status.httpGuideIntro":
    "Wenn die App auf eine HTTP-Antwort des Routing-Anbieters zugreifen kann, wird deren Statuscode unter „Letzte Routing-Versuche“ erfasst. Bei einem fehlgeschlagenen Verbindungstest wird der Statuscode ebenfalls angezeigt, sofern einer vorliegt. Bei einem erfolgreichen Verbindungstest wird er nicht erneut angezeigt. Die folgenden Angaben sind grobe Kategorien und belegen keine bestimmte Ursache:",
  "status.http.success": "Erfolgreiche Antworten (2xx)",
  "status.http.200":
    "— die übliche erfolgreiche Antwort auf eine Routing-Anfrage. Das allein genügt jedoch nicht: ACN prüft zusätzlich, ob die Antwort verwendbare Routendaten enthält.",
  "status.http.redirects": "Umleitungsmeldungen (3xx)",
  "status.http.redirectsDetail":
    "Der Browser folgt Weiterleitungen normalerweise automatisch, sodass ACN die abschließende Antwort erhält und deren Statuscode erfasst. Zwischenzeitliche 3xx-Statuscodes werden hier daher in der Regel nicht angezeigt.",
  "status.http.requestProblems": "Client-Fehlerantworten (4xx)",
  "status.http.400": "— die Anfrage war fehlerhaft oder konnte nicht verarbeitet werden.",
  "status.http.401or403": "401 oder 403",
  "status.http.401or403Detail":
    "— möglicherweise wurden der gespeicherte Schlüssel, die Autorisierung oder der Zugriff abgelehnt. OpenRouteService kann den Statuscode 403 auch bei ausgeschöpftem Tageskontingent verwenden. Aus dem Statuscode allein lässt sich die Ursache nicht bestimmen.",
  "status.http.404":
    "— OpenRouteService dokumentiert dafür zwei mögliche Ursachen: einen nicht verfügbaren Endpunkt oder eine Anfrage, für die kein Ergebnis beziehungsweise keine Route gefunden wurde. Aus dem Statuscode allein lässt sich nicht erkennen, welche Ursache zutrifft.",
  "status.http.405":
    "— die Anfragemethode wurde nicht zugelassen. Bei normaler Nutzung von ACN ist dieser Statuscode unerwartet.",
  "status.http.408":
    "— ein HTTP-Server oder ein zwischengeschalteter Netzwerkdienst hat eine für die App verfügbare HTTP-Antwort mit Status 408 zurückgegeben. Das ist nicht dasselbe wie das Überschreiten des ACN-eigenen Anfragezeitlimits oder das Scheitern einer Netzwerkanfrage ohne verfügbare HTTP-Antwort.",
  "status.http.413": "— die Anfrage überschreitet eine Größen- oder Kapazitätsgrenze.",
  "status.http.429":
    "— möglicherweise wurde die Anfragerate begrenzt oder das Kontingent ausgeschöpft. Es kann helfen, vor einem erneuten Versuch zu warten oder das verfügbare Kontingent beim Anbieter zu prüfen.",
  "status.http.other4xx": "Sonstige 4xx-Statuscodes",
  "status.http.other4xxDetail":
    "— die Anfrage wurde abgelehnt, der genaue Grund lässt sich aus dem Statuscode allein jedoch nicht bestimmen.",
  "status.http.serviceProblems": "Server-Fehlerantworten (5xx)",
  "status.http.500": "— ein unerwarteter Fehler auf Seiten des Dienstes.",
  "status.http.501":
    "— der Dienst unterstützt eine für die Anfrage benötigte Funktion nicht.",
  "status.http.other5xx": "Sonstige 5xx-Statuscodes, einschließlich 502 bis 504",
  "status.http.other5xxDetail":
    "— ein Fehler des Dienstes, eines Gateways oder eines vorgelagerten Systems. Ein erneuter Versuch zu einem späteren Zeitpunkt kann helfen.",
  "status.http.none": "Kein HTTP-Statuscode",
  "status.http.noneDetail":
    "Der Browser stellte der App keine HTTP-Antwort bereit. Daher liegt kein HTTP-Statuscode vor, aus dem sich Rückschlüsse auf den Dienst ziehen lassen. Siehe „Warum eine Netzwerkanfrage scheitern kann, bevor eine HTTP-Antwort vorliegt“.",

  // --- Status: connection test -------------------------------------------
  "status.testConnection": "Routing-Verbindung testen",
  "status.testConnectionHint":
    "Dafür wird eine echte Anfrage mit festen Testkoordinaten an OpenRouteService gesendet. Daten aus deinen geplanten Routen werden nicht verwendet. Der Test zählt als eine API-Anfrage.",
  "status.testConnectionNoKey":
    "Kein OpenRouteService-Schlüssel eingerichtet. Richte in den Einstellungen einen ein, um diesen Test zu aktivieren.",
  "status.testing": "Wird getestet…",
  "status.testSucceeded": "Erfolgreich",
  "status.testFailed": "Fehlgeschlagen",
  "status.testResult": "{outcome} — {detail} ({elapsed} ms)",
  "status.stage": "Phase",
  "status.stageValue": "{stage} — {description}",
  "status.error": "Fehler",
  "status.errorValue": "{name}: {message}",
  "status.safeReasonCode": "Sicherer Diagnosecode",
  "status.httpStatus": "HTTP-Status",
  "status.headersConstructed": "HTTP-Header der Anfrage erstellt",
  "status.requestConstructed": "Anfrage erstellt",
  "status.fetchInvoked": "Fetch aufgerufen",
  "status.fetchReturnedPromise": "Fetch hat ein Promise zurückgegeben",
  "status.responseReceived": "HTTP-Antwort erhalten",
  "status.secureContext": "Sicherer Kontext",
  "status.serviceWorkerControlling": "Service Worker steuert diese Seite",
  "status.activeServiceWorkerScript": "Aktives Service-Worker-Skript",
  "status.standaloneDisplay": "Anzeige als installierte App",
  "status.yes": "Ja",
  "status.no": "Nein",
  "status.none": "Nicht vorhanden",
  "status.copyReport": "Diagnosebericht kopieren",
  "status.copied": "In die Zwischenablage kopiert.",
  "status.copyFailed":
    "Automatisches Kopieren nicht möglich — markiere und kopiere den Berichtstext stattdessen manuell:",

  // --- Status: map imagery -----------------------------------------------
  "status.recentMapAttempts": "Letzte Versuche, Kartenmaterial zu laden",
  "status.noMapAttempts":
    "In der aktuellen Sitzung wurden keine Versuche zum Laden des Kartenmaterials erfasst.",

  // --- Application shell: the ride-switch prompt -------------------------
  // translator: `target` names a session and may be the rider's own route
  // name in quotation marks. Both `target` and `existing` are supplied as
  // values and are never re-interpreted. Both call sites put `target`
  // after "zu", so the free-roam label is in the dative.
  "switch.freeRoamTarget": "Freiem Fahren",
  "switch.quotedRouteName": "„{name}“",
  "switch.title": "Zu {target} wechseln?",
  // translator: the read failed — this is deliberately NOT described as a
  // conflict. A failed storage read is not evidence that another session
  // exists, and presenting it as one would be a misstatement.
  "switch.checkFailedTitle": "Fahrtstatus konnte nicht geprüft werden",
  "switch.checkFailedMessage":
    "Es konnte nicht geprüft werden, ob du eine noch nicht beendete Fahrt hast. Daher wurde vorerst nichts geöffnet.",
  "switch.retry": "Erneut versuchen",
  "switch.discardAndContinue": "Verwerfen und fortfahren",
  "switch.endAndSwitch": "Beenden und wechseln",
  "switch.discarding": "Deine noch nicht beendete Fahrt wird verworfen…",
  "switch.ending": "Deine aktuelle Fahrt wird beendet…",
  "switch.discardingLabel": "Wird verworfen…",
  "switch.endingLabel": "Wird beendet…",
  "switch.startingFreeRoam": "Freies Fahren wird gestartet…",
  "switch.startingLabel": "Wird gestartet…",
  "switch.clearFailed":
    "Diese Fahrt konnte auf diesem Gerät nicht beendet werden. Versuch es noch einmal.",
  "switch.startFreeRoamFailed":
    "Freies Fahren konnte auf diesem Gerät nicht gestartet werden. Versuch es noch einmal.",
  "switch.tryAgain": "Erneut versuchen",
  "switch.returning": "Deine pausierte Fahrt wird geöffnet…",
  "switch.returnFailed":
    "Diese pausierte Fahrt konnte nicht wieder geöffnet werden. Prüfe ihren aktuellen Status erneut.",
  "switch.checkAgain": "Erneut prüfen",
  "switch.existingRoute": "eine noch nicht beendete Fahrt auf einer anderen Route",
  "switch.existingFreeRoam": "eine noch nicht beendete Fahrt im Modus „Freies Fahren“",
  "switch.existingUnsupported":
    "eine noch nicht beendete Fahrt, die diese App-Version nicht wiederherstellen kann",
  // translator: deliberately not "Sie muss beendet werden" — a
  // sentence-initial "Sie" reads as the formal address until the referent
  // lands, which is exactly the register this catalogue avoids.
  "switch.conflict":
    "Du hast {existing}. Bevor du wechseln kannst, musst du diese Fahrt erst beenden — der Fahrtfortschritt wird dabei verworfen.",
  "switch.conflictKeepsRoute":
    "Du hast {existing}. Bevor du wechseln kannst, musst du diese Fahrt erst beenden. Die gespeicherte Route bleibt in deiner Bibliothek; nur der Fahrtfortschritt wird verworfen.",
  "switch.inlineRouteConflict":
    "„{existing}“ ist pausiert. Kehre zu dieser Fahrt zurück oder beende sie und wechsle zu {target}. Beim Beenden wird der Fahrtfortschritt verworfen; die Route selbst bleibt unter „Routen“ gespeichert.",
  "switch.cancel": "Abbrechen",
  "switch.pausedRideCheckFailed":
    "Der Status dieser pausierten Fahrt konnte nicht geprüft werden. Versuch es noch einmal.",
  "switch.pausedRideChanged":
    "Der Status dieser pausierten Fahrt hat sich geändert, seit diese Ansicht geöffnet wurde. Prüfe ihn erneut.",
  "switch.pausedRouteCheckFailed":
    "Die Route dieser pausierten Fahrt konnte nicht geprüft werden. Versuch es noch einmal.",
  "switch.pausedRouteMissing":
    "Diese Route ist nicht mehr in deiner Bibliothek. Die pausierte Fahrt kann deshalb nicht wieder geöffnet werden.",

  // --- Application shell: the service-worker update prompt ---------------
  // translator: this appears while the rider may be mid-ride. It is
  // announced politely, never as an alert, and neither action is
  // destructive — "Später" simply dismisses the notice.
  "update.ready": "Ein Update steht bereit.",
  "update.now": "Jetzt aktualisieren",
  "update.later": "Später",
};
