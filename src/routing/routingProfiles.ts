import {
  DEFAULT_ROUTING_PROFILE,
  ROUTING_PROFILE_VALUES,
  isRoutingProfile,
} from "../domain/routingProfile.ts";
import type { RoutingProfile } from "../domain/types.ts";
import type { ParameterlessMessageKey, Translator } from "../i18n/translate.ts";

export { DEFAULT_ROUTING_PROFILE, isRoutingProfile };

export interface RoutingProfileMetadata {
  readonly value: RoutingProfile;
  readonly label: string;
  readonly isDefault: boolean;
  readonly description: string;
}

/** Catalogue keys per profile — backlog item 113 stage 3. The copy itself
 * lives in the catalogue; this module keeps only the mapping, so the
 * compile-time exhaustiveness the Record below provides is preserved. */
interface RoutingProfileMessageKeys {
  readonly label: ParameterlessMessageKey;
  readonly description: ParameterlessMessageKey;
}

/** A Record, not a lookup array/switch, so TypeScript refuses to compile
 * if a future RoutingProfile member is added without matching UI metadata
 * here. */
const MESSAGE_KEYS_BY_VALUE: Record<RoutingProfile, RoutingProfileMessageKeys> = {
  "cycling-road": {
    label: "routingProfile.cyclingRoad.label",
    description: "routingProfile.cyclingRoad.description",
  },
  "cycling-regular": {
    label: "routingProfile.cyclingRegular.label",
    description: "routingProfile.cyclingRegular.description",
  },
};

/** The authoritative list driving Planning's cycling-profile selector, in
 * a stable, deliberate order (Road bike first, since it's the default).
 * A function rather than a constant since item 113 stage 3: the labels are
 * language-dependent, so they cannot be frozen at module load. */
export function listRoutingProfiles(
  translator: Translator,
): readonly RoutingProfileMetadata[] {
  return ROUTING_PROFILE_VALUES.map((value) => ({
    value,
    isDefault: value === DEFAULT_ROUTING_PROFILE,
    label: formatRoutingProfileLabel(translator, value),
    description: describeRoutingProfile(translator, value),
  }));
}

export function formatRoutingProfileLabel(
  translator: Translator,
  profile: RoutingProfile,
): string {
  return translator.t(MESSAGE_KEYS_BY_VALUE[profile].label);
}

export function describeRoutingProfile(
  translator: Translator,
  profile: RoutingProfile,
): string {
  return translator.t(MESSAGE_KEYS_BY_VALUE[profile].description);
}
