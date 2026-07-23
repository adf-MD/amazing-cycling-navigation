export interface TileAttribution {
  text: string;
  url: string;
}

export interface TileSourceConfig {
  id: string;
  label: string;
  styleUrl: string;
  attribution: TileAttribution;
}

/**
 * OpenFreeMap requires no API key and is explicitly intended for direct
 * third-party app use, unlike tile.openstreetmap.org's community
 * endpoint, whose usage policy discourages exactly that. Kept as one
 * option among a configurable list rather than a hardcoded constant.
 * Attribution is structured data, not markup, so the UI never needs to
 * inject raw HTML to render it.
 */
export const DEFAULT_TILE_SOURCE: TileSourceConfig = {
  id: "openfreemap-liberty",
  label: "OpenFreeMap Liberty",
  styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  attribution: {
    text: "OpenStreetMap contributors",
    url: "https://www.openstreetmap.org/copyright",
  },
};

export const TILE_SOURCE_OPTIONS: readonly TileSourceConfig[] = [DEFAULT_TILE_SOURCE];
