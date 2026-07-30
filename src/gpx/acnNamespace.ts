/** Project-owned GPX extension namespace, shared by exportGpx.ts (writer)
 * and parseAcnExtension.ts (reader). Never yet consumed by anything but
 * this app, so its "v1" segment is a stable format epoch rather than a
 * version currently in active rotation — the acn:navigation element's own
 * `version` attribute (below) is the finer-grained structural version that
 * is actually expected to evolve. */
export const ACN_NAMESPACE =
  "https://adf-md.github.io/amazing-cycling-navigation/gpx-extensions/v1";

/** The only <acn:navigation> envelope version this app currently writes or
 * accepts. An unrecognised future version must be ignored (geometry/
 * elevation import still succeeds), never treated as a parse failure. */
export const ACN_NAVIGATION_EXTENSION_VERSION = "1";
