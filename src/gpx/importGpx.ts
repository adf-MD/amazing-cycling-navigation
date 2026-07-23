import type { PlannedRoute } from "../domain/types.ts";
import { systemClock, type Clock } from "../platform/clock.ts";
import { buildPlannedRouteFromGpx } from "./normalizeGpx.ts";
import {
  extractRoutePoints,
  parseGpxDocument,
  type GpxImportNotice,
} from "./parseGpx.ts";
import { validateGpxFile } from "./validateGpx.ts";

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
  const { points, notices } = extractRoutePoints(doc);

  const route = buildPlannedRouteFromGpx(points, {
    name: deriveRouteName(file.name),
    createdAt: new Date(clock.now()).toISOString(),
  });

  return { route, notices };
}
