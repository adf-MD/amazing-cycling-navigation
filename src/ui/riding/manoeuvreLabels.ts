import type { ManoeuvreType } from "../../domain/types.ts";
import type { Translator } from "../../i18n/translate.ts";

/** Generic, per-type fallback instruction text, used whenever the provider
 * gave no usable instruction text of its own. A switch with a real
 * `default` branch, not an exhaustive Record lookup — Manoeuvre.type can
 * hold a legacy raw provider-code string for a route saved before this
 * canonical vocabulary existed, and a Record lookup would silently return
 * undefined for it. Shared by RidingNextManoeuvrePanel (the full Map-view
 * panel) and RidingCompactManoeuvreCue (the compact Profile-view cue,
 * backlog item 56), kept in its own module rather than exported from
 * either component so both stay fast-refresh-friendly. */
export function genericManoeuvreLabel(
  translator: Translator,
  type: ManoeuvreType,
): string {
  switch (type) {
    case "start":
      return translator.t("manoeuvre.start");
    case "continue":
      return translator.t("manoeuvre.continue");
    case "slight-left":
      return translator.t("manoeuvre.slightLeft");
    case "left":
      return translator.t("manoeuvre.left");
    case "sharp-left":
      return translator.t("manoeuvre.sharpLeft");
    case "slight-right":
      return translator.t("manoeuvre.slightRight");
    case "right":
      return translator.t("manoeuvre.right");
    case "sharp-right":
      return translator.t("manoeuvre.sharpRight");
    case "u-turn":
      return translator.t("manoeuvre.uTurn");
    case "roundabout":
      return translator.t("manoeuvre.roundabout");
    case "waypoint":
      return translator.t("manoeuvre.waypoint");
    case "finish":
      return translator.t("manoeuvre.finish");
    default:
      return translator.t("manoeuvre.fallback");
  }
}
