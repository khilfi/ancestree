/**
 * What the pages may reach while the journeys run: nothing outside this computer, and
 * nothing that would have the engine fetch from the internet or open a window on the desktop.
 * The map's world pack, asked for the first time the map opens, is refused here, so the map is
 * seen as on a computer it hasn't reached yet.
 */

/** Why a request is refused, in a few words; null if it may go. */
export function refused(address: string, method: string): string | null {
  const url = new URL(address);
  if (url.protocol === "data:" || url.protocol === "blob:") return null;
  if (url.hostname !== "127.0.0.1") return "outside this computer";
  if (method === "GET" || method === "HEAD") return null;
  const path = url.pathname;
  if (/^\/api\/map\/(packs|countries)\//.test(path)) return "a download of the map's";
  if (path === "/api/map/online") return "the map's online extra";
  if (path === "/api/places/lookup") return "an address looked up online";
  if (path.startsWith("/api/family-folder/")) return "Google Drive";
  if (path.startsWith("/api/desktop/update/")) return "the app's updates";
  if (path === "/api/downloads/show") return "a window on the desktop";
  return null;
}
