/** Whether the map is drawn by MapLibre from the packs, else today's map: in the app, never
 *  a copy, which keeps its own light drawing; once the world's pack is here; and where the
 *  web view draws WebGL 2 and hasn't failed to. */
export function drawnFromPacks(state: {
  inCopy: boolean;
  worldHere: boolean;
  webgl2: boolean;
  failed: boolean;
}): boolean {
  return !state.inCopy && state.worldHere && state.webgl2 && !state.failed;
}

/** Whether this computer's web view can draw MapLibre's map: it needs WebGL 2. On its
 *  own, so the map's page asks it without carrying MapLibre's style along. */
export function drawsWebGL2(): boolean {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}
