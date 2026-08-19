import type { ManoeuvreType } from "../../domain/types.ts";

/** Generic, per-type fallback instruction text, used whenever the provider
 * gave no usable instruction text of its own. A switch with a real
 * `default` branch, not an exhaustive Record lookup — Manoeuvre.type can
 * hold a legacy raw provider-code string for a route saved before this
 * canonical vocabulary existed, and a Record lookup would silently return
 * undefined for it. Shared by RidingNextManoeuvrePanel (the full Map-view
 * panel) and RidingCompactManoeuvreCue (the compact Profile-view cue,
 * backlog item 56), kept in its own module rather than exported from
 * either component so both stay fast-refresh-friendly. */
export function genericManoeuvreLabel(type: ManoeuvreType): string {
  switch (type) {
    case "start":
      return "Start of route";
    case "continue":
      return "Continue straight ahead";
    case "slight-left":
      return "Bear left";
    case "left":
      return "Turn left";
    case "sharp-left":
      return "Sharp left turn";
    case "slight-right":
      return "Bear right";
    case "right":
      return "Turn right";
    case "sharp-right":
      return "Sharp right turn";
    case "u-turn":
      return "Make a U-turn";
    case "roundabout":
      return "Go through the roundabout";
    case "waypoint":
      return "Waypoint";
    case "finish":
      return "Arrive at the finish";
    default:
      return "Continue on the route";
  }
}
