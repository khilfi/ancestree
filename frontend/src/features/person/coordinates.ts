/*
 * Where a place is, typed or pasted: its latitude and
 * longitude in any common form, read here with no internet. "3.0006, 101.7869"; with N, S, E
 * or W; degrees and minutes, with or without seconds; a phone map's link, from Google Maps,
 * Apple Maps or OpenStreetMap; or a geo: link. A short link (maps.app.goo.gl) only says where
 * once it's opened online, so it's said so instead.
 */

export type Coordinates = { lat: number; lon: number };
export type Read = Coordinates | { problem: string };

const NUMBER = String.raw`[-+]?\d+(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`(${NUMBER})\s*,\s*(${NUMBER})`);
const SHORT = /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i;
const MOST = 4000; // characters read, at most

function within(lat: number, lon: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

/** "3.0006,101.7869" in a link's part, or null. */
function pairIn(text: string | null | undefined): Coordinates | null {
  const found = text ? PAIR.exec(text) : null;
  return found ? within(Number(found[1]), Number(found[2])) : null;
}

/** A map's link: Google Maps', Apple Maps', OpenStreetMap's, or a geo: link. */
function fromLink(text: string): Coordinates | null {
  if (/^geo:/i.test(text)) {
    // geo:3.0006,101.7869?z=17, or geo:0,0?q=3.0006,101.7869(Home)
    const [where, query] = text.slice(4).split("?");
    const asked = new URLSearchParams(query ?? "").get("q");
    const point = pairIn(where);
    return point && (point.lat !== 0 || point.lon !== 0) ? point : pairIn(asked);
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const asked = url.searchParams;
  // Google Maps: a place's own point (!3d…!4d…) before the view's (@…).
  const place = /!3d([-+]?\d+(?:\.\d+)?)!4d([-+]?\d+(?:\.\d+)?)/.exec(text);
  if (place) return within(Number(place[1]), Number(place[2]));
  const marked = asked.get("mlat") !== null && asked.get("mlon") !== null;
  if (marked) return within(Number(asked.get("mlat")), Number(asked.get("mlon")));
  for (const name of ["q", "query", "ll", "coordinate", "sll", "destination", "center"]) {
    const point = pairIn(asked.get(name));
    if (point) return point;
  }
  const view = /@([-+]?\d+(?:\.\d+)?),([-+]?\d+(?:\.\d+)?)/.exec(url.pathname);
  if (view) return within(Number(view[1]), Number(view[2]));
  // OpenStreetMap: #map=17/3.0006/101.7869
  const shown = /map=\d+(?:\.\d+)?\/([-+]?\d+(?:\.\d+)?)\/([-+]?\d+(?:\.\d+)?)/.exec(url.hash);
  if (shown) return within(Number(shown[1]), Number(shown[2]));
  return null;
}

/** One angle: degrees, minutes and seconds as written, signed by its letter or sign. */
function angle(text: string): { value: number; axis: "lat" | "lon" | null } | null {
  const letters = text.match(/[NSEW]/gi) ?? [];
  if (letters.length > 1) return null;
  const letter = letters[0]?.toUpperCase();
  const numbers = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (numbers.length === 0 || numbers.length > 3) return null;
  const [degrees = 0, minutes = 0, seconds = 0] = numbers;
  if (minutes >= 60 || seconds >= 60) return null;
  const negative = /^\s*-/.test(text) || letter === "S" || letter === "W";
  const value = (degrees + minutes / 60 + seconds / 3600) * (negative ? -1 : 1);
  const axis = letter === "N" || letter === "S" ? "lat" : letter ? "lon" : null;
  return { value, axis };
}

// An angle as written: degrees, then minutes and seconds if any, with its letter before or after.
const BODY = String.raw`[-+]?\d+(?:\.\d+)?(?:\s*°)?(?:\s*\d+(?:\.\d+)?\s*['′])?(?:\s*\d+(?:\.\d+)?\s*(?:["″]|''))?`;
const ANGLE = new RegExp(String.raw`[NSEW]\s*${BODY}|${BODY}(?:\s*[NSEW](?![a-z]))?`, "gi");

/** Two angles, each with its N, S, E or W or none, in either order where their letters say;
 *  nothing else but what separates them. */
function fromAngles(text: string): Coordinates | null {
  const parts = [...text.matchAll(ANGLE)].map((found) => found[0]);
  if (parts.length !== 2 || text.replace(ANGLE, "").replace(/[\s,;]/g, "")) return null;
  const [first, second] = parts.map(angle);
  if (!first || !second) return null;
  if (first.axis === "lon" || second.axis === "lat") return within(second.value, first.value);
  return within(first.value, second.value);
}

/** Where a place is, from what was typed or pasted; or why it can't be read. */
export function readCoordinates(written: string): Read {
  const text = written.trim();
  if (!text) return { problem: "Type or paste where it is." };
  // Longer than any map's link: not read, so nothing pasted keeps the window busy (0.8.0).
  if (text.length > MOST) return { problem: "That's longer than a map's link is." };
  if (SHORT.test(text)) {
    return {
      problem:
        "A short link only says where once it's opened online. Open it, then copy the link " +
        "the map shows, or its numbers.",
    };
  }
  const found = /^(https?:|geo:)/i.test(text) ? fromLink(text) : fromAngles(text);
  return (
    found ?? {
      problem: 'That isn\'t a place we can read: try "3.0006, 101.7869", or a link from a map.',
    }
  );
}
