/** Static capability check: does this browser support the WebGL context MapLibre GL needs to render at all. */
export function isMapRenderingSupported(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
