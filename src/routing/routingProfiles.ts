import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILE_VALUES,
  isRoutingProfile,
} from "../domain/routingProfile.ts";
import type { RoutingProfile } from "../domain/types.ts";

export { DEFAULT_ROUTING_PROFILE, isRoutingProfile };

export interface RoutingProfileMetadata {
  readonly value: RoutingProfile;
  readonly label: string;
  readonly isDefault: boolean;
  readonly description: string;
}

/** A Record, not a lookup array/switch, so TypeScript refuses to compile
 * if a future RoutingProfile member is added without matching UI metadata
 * here. */
const METADATA_BY_VALUE: Record<
  RoutingProfile,
  Omit<RoutingProfileMetadata, "value" | "isDefault">
> = {
  "cycling-road": {
    label: "Road bike",
    description:
      "Prefers roads suitable for a road bike. The default profile for every new plan.",
  },
  "cycling-regular": {
    label: "General cycling",
    description:
      "May use more cycling infrastructure, such as cycle paths and tracks, but can also " +
      "include compacted, gravel, unpaved or other surfaces that may not suit a road bike.",
  },
};

/** The authoritative list driving Planning's cycling-profile selector, in
 * a stable, deliberate order (Road bike first, since it's the default). */
export const ROUTING_PROFILES: readonly RoutingProfileMetadata[] =
  ROUTING_PROFILE_VALUES.map((value) => ({
    value,
    isDefault: value === DEFAULT_ROUTING_PROFILE,
    ...METADATA_BY_VALUE[value],
  }));

export function formatRoutingProfileLabel(profile: RoutingProfile): string {
  return METADATA_BY_VALUE[profile].label;
}

export function describeRoutingProfile(profile: RoutingProfile): string {
  return METADATA_BY_VALUE[profile].description;
}
