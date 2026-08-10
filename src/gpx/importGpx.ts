import type { PlannedRoute } from "../domain/types.ts";
import { systemClock, type Clock } from "../platform/clock.ts";
import {
  buildPlannedRouteFromGpx,
  type TrustedGpxManoeuvres,
  type TrustedGpxPlanningWaypoints,
} from "./normalizeGpx.ts";
import {
  readAcnNavigationExtension,
  readAcnPlanningExtension,
  readAcnSourceProfile,
} from "./parseAcnExtension.ts";
import {
  extractRoutePoints,
  parseGpxDocument,
  type GpxImportNotice,
} from "./parseGpx.ts";
import { validateGpxFile } from "./validateGpx.ts";

const ACN_EXTENSION_REJECTED_MESSAGE =
  "This GPX contained turn information, but it did not match the route geometry and was ignored.";

const ACN_PLANNING_EXTENSION_REJECTED_MESSAGE =
  "This GPX contained planning waypoints, but they did not match the route geometry and were ignored. Editing this route as a copy will use estimated waypoints instead.";

export interface GpxImportResult {
  route: PlannedRoute;
  notices: GpxImportNotice[];
}

function deriveRouteName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.gpx$/i, "");
  return withoutExtension.trim() || "Imported route";
}

export async function importGpxFile(
  file: File,
  clock: Clock = systemClock,
): Promise<GpxImportResult> {
  validateGpxFile(file);

  const xmlText = await file.text();
  const doc = parseGpxDocument(xmlText);
  const { points, notices, selectedTrackElement } = extractRoutePoints(doc);

  const [acnOutcome, acnPlanningOutcome] = selectedTrackElement
    ? await Promise.all([
        readAcnNavigationExtension(selectedTrackElement, points),
        readAcnPlanningExtension(selectedTrackElement, points),
      ])
    : ([{ kind: "absent" }, { kind: "absent" }] as const);
  // Independent of acnOutcome/acnPlanningOutcome above: <acn:source> carries
  // no geometry digest of its own, so it is read regardless of whether
  // either sibling envelope validated.
  const sourceProfile = selectedTrackElement
    ? readAcnSourceProfile(selectedTrackElement)
    : undefined;

  const allNotices = [...notices];
  let trustedManoeuvres: TrustedGpxManoeuvres | undefined;
  if (acnOutcome.kind === "accepted") {
    trustedManoeuvres = {
      manoeuvres: acnOutcome.manoeuvres,
      provenance: { kind: "acn-gpx-extension", version: 1 },
    };
  } else if (acnOutcome.kind === "rejected") {
    allNotices.push({
      kind: "acn-extension-rejected",
      message: ACN_EXTENSION_REJECTED_MESSAGE,
    });
  }

  let trustedPlanningWaypoints: TrustedGpxPlanningWaypoints | undefined;
  if (acnPlanningOutcome.kind === "accepted") {
    trustedPlanningWaypoints = {
      waypoints: acnPlanningOutcome.waypoints,
      profile: acnPlanningOutcome.profile,
      avoidFerries: acnPlanningOutcome.avoidFerries,
    };
  } else if (acnPlanningOutcome.kind === "rejected") {
    allNotices.push({
      kind: "acn-planning-extension-rejected",
      message: ACN_PLANNING_EXTENSION_REJECTED_MESSAGE,
    });
  }

  const route = buildPlannedRouteFromGpx(
    points,
    {
      name: deriveRouteName(file.name),
      createdAt: new Date(clock.now()).toISOString(),
    },
    trustedManoeuvres,
    sourceProfile,
    trustedPlanningWaypoints,
  );

  return { route, notices: allNotices };
}
