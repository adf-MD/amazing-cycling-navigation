import type { PlannedRoute } from "../domain/types.ts";
import { systemClock, type Clock } from "../platform/clock.ts";
import { buildPlannedRouteFromGpx, type TrustedGpxManoeuvres } from "./normalizeGpx.ts";
import { readAcnNavigationExtension } from "./parseAcnExtension.ts";
import {
  extractRoutePoints,
  parseGpxDocument,
  type GpxImportNotice,
} from "./parseGpx.ts";
import { validateGpxFile } from "./validateGpx.ts";

const ACN_EXTENSION_REJECTED_MESSAGE =
  "This GPX contained turn information, but it did not match the route geometry and was ignored.";

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

  const acnOutcome = selectedTrackElement
    ? await readAcnNavigationExtension(selectedTrackElement, points)
    : ({ kind: "absent" } as const);

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

  const route = buildPlannedRouteFromGpx(
    points,
    {
      name: deriveRouteName(file.name),
      createdAt: new Date(clock.now()).toISOString(),
    },
    trustedManoeuvres,
  );

  return { route, notices: allNotices };
}
