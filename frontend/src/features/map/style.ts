/*
 * The map drawn by MapLibre: Protomaps' light style over the
 * map's packs, which the engine serves, with the fonts and icons that come with the app, so the
 * map asks nothing of the internet. The world's pack draws every zoom, its tiles enlarged past
 * zoom 6; the countries' and states', fetched in Settings → Map, draw over it from zoom 7, all
 * those cut to one depth as one source, so twenty draw as fast as one, each source's tiles
 * enlarged past its depth. With the online extra on, OpenFreeMap's tiles, which the engine
 * fetches, draw from zoom 7 where no pack has them, in the same colours. Plain data, tested
 * without a browser.
 */

import { type Flavor, layers, namedFlavor } from "@protomaps/basemaps";
import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { MapPack } from "@/api/types";

const TILE = 512; // MapLibre's tiles, in pixels
const EQUATOR_M = 40_075_016.686;
const OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const OPENFREEMAP =
  '<a href="https://openfreemap.org/" target="_blank">OpenFreeMap</a> ' +
  '© <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a>';
const LIGHT: Flavor = namedFlavor("light");

/** The online extra's tiles: from zoom 7, below which the world's pack has them all, to
 *  OpenFreeMap's deepest. */
export const ONLINE = { minzoom: 7, maxzoom: 14 } as const;

/** Screen pixels a kilometre takes at this zoom and latitude: what today's map goes by. */
export function perKmAt(zoom: number, lat: number): number {
  const metresPerPixel = (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** zoom);
  return 1000 / metresPerPixel;
}

/** The zoom at which a kilometre takes this many screen pixels, at this latitude. */
export function zoomFor(perKm: number, lat: number): number {
  return Math.log2((perKm * EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (TILE * 1000));
}

const ENGLISH: ExpressionSpecification = ["get", "name:en"];

/**
 * A label: the place's own name, with its English name beneath where OpenStreetMap has one that
 * differs ("Jawa Tengah", then "Central Java"). An own name in a script the map can't draw, such
 * as Thai or Tamil, gives way to the English where there is one.
 */
function label(
  own: ExpressionSpecification,
  drawn: ExpressionSpecification,
  instead: ExpressionSpecification,
): ExpressionSpecification {
  return [
    "case",
    ["!", drawn],
    instead,
    ["all", ["has", "name:en"], ["!=", ENGLISH, own]],
    ["format", own, {}, "\n", {}, ENGLISH, { "font-scale": 0.85 }],
    own,
  ];
}

const OWN: ExpressionSpecification = ["coalesce", ["get", "pgf:name"], ["get", "name"]];
// Scripts the map's own names can be drawn in: Noto Sans has Cyrillic and Greek beside Latin,
// and MapLibre draws Chinese, Japanese and Korean with the computer's own fonts.
const DRAWN = ["Cyrillic", "Greek", "Han", "Hiragana", "Katakana", "Hangul"];

/** A label from the packs: Protomaps marks a name's script where it isn't Latin. */
export const LABEL: ExpressionSpecification = label(
  OWN,
  ["any", ["!", ["has", "script"]], ["in", ["get", "script"], ["literal", DRAWN]]],
  ["coalesce", ENGLISH, OWN],
);

// OpenFreeMap's tiles mark no script, but keep a name's letters that aren't Latin apart. Their
// first says the script: drawn as the packs' are, if it's one of those above.
const ONLINE_OWN: ExpressionSpecification = ["get", "name"];
const NOT_LATIN: ExpressionSpecification = ["slice", ["to-string", ["get", "name:nonlatin"]], 0, 1];
const letters = (first: number, last: number): ExpressionSpecification => [
  "all",
  [">=", NOT_LATIN, String.fromCharCode(first)],
  ["<=", NOT_LATIN, String.fromCharCode(last)],
];

/** A label from OpenFreeMap's tiles: as the packs', and in Latin letters where it can't draw the
 *  own name and there's no English. */
export const ONLINE_LABEL: ExpressionSpecification = label(
  ONLINE_OWN,
  [
    "any",
    ["!", ["has", "name:nonlatin"]],
    letters(0x0370, 0x052f), // Greek and Cyrillic
    letters(0x1100, 0x11ff), // Hangul's letters
    letters(0x2e80, 0x9fff), // Chinese and Japanese, with their kana
    letters(0xac00, 0xd7af), // Hangul
    letters(0xf900, 0xfaff), // Chinese, as fonts once wrote it
  ],
  ["coalesce", ENGLISH, ["get", "name:latin"], ONLINE_OWN],
);

// Protomaps' labels that name places, water, roads and things on the map. A house's number,
// a road's shield and a country's name (in English, as the app says it) stay as they are.
const NAMED = new Set([
  "water_waterway_label",
  "roads_labels_minor",
  "water_label_ocean",
  "earth_label_islands",
  "water_label_lakes",
  "roads_labels_major",
  "pois",
  "places_subplace",
  "places_locality",
]);

/** Protomaps' layers for one pack, labelled as above, each named for its pack. */
function packLayers(source: string): LayerSpecification[] {
  return layers(source, LIGHT, { lang: "en" }).map((layer) => {
    const id = `${source}:${layer.id}`;
    if (layer.type !== "symbol") return { ...layer, id };
    if (NAMED.has(layer.id)) {
      return { ...layer, id, layout: { ...layer.layout, "text-field": LABEL } };
    }
    if (layer.id === "places_region") {
      // Its short form ("Kel.") zoomed out, then its name as the others'.
      const short: ExpressionSpecification = ["coalesce", ["get", "ref:en"], ["get", "ref"]];
      return {
        ...layer,
        id,
        layout: { ...layer.layout, "text-field": ["step", ["zoom"], short, 6, LABEL] },
      };
    }
    return { ...layer, id };
  });
}

/** A layer shown only below `zoom`, or not at all if it starts there. */
function until(layer: LayerSpecification, zoom: number): LayerSpecification | null {
  if ((layer.minzoom ?? 0) >= zoom) return null;
  return { ...layer, maxzoom: Math.min(layer.maxzoom ?? 24, zoom) } as LayerSpecification;
}

const widths = (...stops: number[]): ExpressionSpecification => [
  "interpolate",
  ["exponential", 1.6],
  ["zoom"],
  ...stops,
];
const kind = (...classes: string[]): ExpressionSpecification => [
  "in",
  ["get", "class"],
  ["literal", classes],
];
const notRamp: ExpressionSpecification = ["!=", ["get", "ramp"], 1];
const fadedIn: ExpressionSpecification = ["interpolate", ["linear"], ["zoom"], 6, 0, 11, 1];

/**
 * OpenFreeMap's tiles, in OpenMapTiles' schema, drawn as Protomaps' light style draws the packs:
 * its colours, widths and fonts, and no icons. Land is the map's background there, as these
 * tiles draw only what's on it. (MapLibre's own check of the style is in the tests.)
 */
function onlineLayers(): LayerSpecification[] {
  const c = LIGHT;
  const layer = (
    id: string,
    type: "fill" | "line" | "symbol",
    from: string,
    rest: Record<string, unknown>,
  ) =>
    ({
      id: `online:${id}`,
      type,
      source: "online",
      "source-layer": from,
      ...rest,
    }) as LayerSpecification;
  const names = (colour: string, halo: string, layout: Record<string, unknown>) => ({
    layout: { "text-field": ONLINE_LABEL, "text-font": ["Noto Sans Regular"], ...layout },
    paint: { "text-color": colour, "text-halo-color": halo, "text-halo-width": 1 },
  });
  const byClass = (...pairs: (string | number | string[])[]) => [
    "match",
    ["get", "class"],
    ...pairs,
  ];
  return [
    layer("landcover", "fill", "landcover", {
      filter: kind("wood", "grass", "wetland", "sand", "ice"),
      paint: {
        "fill-color": byClass("wood", c.wood_b, "sand", c.sand, "ice", c.glacier, c.scrub_b),
        "fill-opacity": fadedIn,
      },
    }),
    layer("park", "fill", "park", { paint: { "fill-color": c.park_b, "fill-opacity": fadedIn } }),
    layer("landuse", "fill", "landuse", {
      filter: kind("cemetery", "hospital", "industrial", "military", "zoo", "school", "university"),
      paint: {
        "fill-color": byClass(
          "cemetery",
          c.park_b,
          "hospital",
          c.hospital,
          "industrial",
          c.industrial,
          ["military", "zoo"],
          c.zoo,
          c.school,
        ),
        "fill-opacity": fadedIn,
      },
    }),
    layer("aerodrome", "fill", "aeroway", {
      filter: kind("aerodrome"),
      paint: { "fill-color": c.aerodrome },
    }),
    layer("water", "fill", "water", {
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": c.water },
    }),
    layer("water_river", "line", "waterway", {
      minzoom: 9,
      filter: kind("river", "canal"),
      paint: { "line-color": c.water, "line-width": widths(9, 0, 9.5, 1, 18, 12) },
    }),
    layer("water_stream", "line", "waterway", {
      minzoom: 14,
      filter: kind("stream", "ditch", "drain"),
      paint: { "line-color": c.water, "line-width": 0.5 },
    }),
    layer("roads_runway", "line", "aeroway", {
      filter: kind("runway"),
      paint: { "line-color": c.runway, "line-width": widths(10, 0, 12, 4, 18, 30) },
    }),
    layer("buildings", "fill", "building", {
      paint: { "fill-color": c.buildings, "fill-opacity": 0.5 },
    }),
    layer("roads_other", "line", "transportation", {
      filter: kind("path", "track"),
      paint: { "line-color": c.other, "line-width": widths(14, 0.5, 20, 12) },
    }),
    layer("roads_link", "line", "transportation", {
      filter: ["==", ["get", "ramp"], 1],
      paint: { "line-color": c.link, "line-width": widths(13, 0, 13.5, 1, 18, 11) },
    }),
    layer("roads_minor_service", "line", "transportation", {
      filter: ["all", kind("service"), notRamp],
      paint: { "line-color": c.minor_service, "line-width": widths(13, 0, 18, 8) },
    }),
    layer("roads_minor", "line", "transportation", {
      filter: ["all", kind("minor"), notRamp],
      paint: {
        "line-color": ["interpolate", ["exponential", 1.6], ["zoom"], 11, c.minor_a, 16, c.minor_b],
        "line-width": widths(11, 0, 12.5, 0.5, 15, 2, 18, 11),
      },
    }),
    layer("roads_major", "line", "transportation", {
      filter: ["all", kind("primary", "secondary", "tertiary"), notRamp],
      paint: { "line-color": c.major, "line-width": widths(6, 0, 12, 1.6, 15, 3, 18, 13) },
    }),
    layer("roads_highway", "line", "transportation", {
      filter: ["all", kind("motorway", "trunk"), notRamp],
      paint: {
        "line-color": c.highway,
        "line-width": widths(3, 0, 6, 1.1, 12, 1.6, 15, 5, 18, 15),
      },
    }),
    layer("roads_rail", "line", "transportation", {
      filter: kind("rail", "transit"),
      paint: {
        "line-dasharray": [0.3, 0.75],
        "line-opacity": 0.5,
        "line-color": c.railway,
        "line-width": widths(3, 0, 6, 0.15, 18, 9),
      },
    }),
    // Countries' borders, and states' and provinces', on land.
    layer("boundaries_country", "line", "boundary", {
      filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
      paint: { "line-color": c.boundaries, "line-width": 0.7, "line-dasharray": [2, 1] },
    }),
    layer("boundaries", "line", "boundary", {
      filter: [
        "all",
        ["in", ["get", "admin_level"], ["literal", [3, 4]]],
        ["!=", ["get", "maritime"], 1],
      ],
      paint: { "line-color": c.boundaries, "line-width": 0.4, "line-dasharray": [2, 1] },
    }),
    layer("water_waterway_label", "symbol", "waterway", {
      minzoom: 13,
      filter: kind("river", "stream"),
      ...names(c.ocean_label, c.water, {
        "symbol-placement": "line",
        "text-font": ["Noto Sans Italic"],
        "text-size": 12,
        "text-letter-spacing": 0.2,
      }),
    }),
    layer("roads_labels_minor", "symbol", "transportation_name", {
      minzoom: 15,
      filter: kind("minor", "service", "track", "path"),
      ...names(c.roads_label_minor, c.roads_label_minor_halo, {
        "symbol-placement": "line",
        "text-size": 12,
      }),
    }),
    layer("water_label_ocean", "symbol", "water_name", {
      filter: kind("ocean", "sea", "bay", "strait"),
      ...names(c.ocean_label, c.water, {
        "text-font": ["Noto Sans Italic"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10, 10, 12],
        "text-letter-spacing": 0.1,
        "text-max-width": 9,
        "text-transform": "uppercase",
      }),
    }),
    layer("water_label_lakes", "symbol", "water_name", {
      filter: kind("lake"),
      ...names(c.ocean_label, c.water, {
        "text-font": ["Noto Sans Italic"],
        "text-size": 12,
        "text-letter-spacing": 0.1,
        "text-max-width": 9,
      }),
    }),
    layer("roads_labels_major", "symbol", "transportation_name", {
      minzoom: 11,
      filter: kind("motorway", "trunk", "primary", "secondary", "tertiary"),
      ...names(c.roads_label_major, c.roads_label_major_halo, {
        "symbol-placement": "line",
        "text-size": 12,
      }),
    }),
    layer("places_subplace", "symbol", "place", {
      filter: kind("suburb", "quarter", "neighbourhood", "island"),
      ...names(c.subplace_label, c.subplace_label_halo, {
        "symbol-sort-key": ["get", "rank"],
        "text-max-width": 7,
        "text-letter-spacing": 0.1,
        "text-padding": ["interpolate", ["linear"], ["zoom"], 5, 2, 8, 4, 12, 18, 15, 20],
        "text-size": ["interpolate", ["exponential", 1.2], ["zoom"], 11, 8, 14, 14, 18, 24],
        "text-transform": "uppercase",
      }),
    }),
    layer("places_region", "symbol", "place", {
      filter: kind("state", "province"),
      ...names(c.state_label, c.state_label_halo, {
        "symbol-sort-key": ["get", "rank"],
        "text-size": 16,
        "text-transform": "uppercase",
      }),
    }),
    layer("places_locality", "symbol", "place", {
      filter: kind("city", "town", "village", "hamlet"),
      ...names(c.city_label, c.city_label_halo, {
        "symbol-sort-key": ["get", "rank"],
        "text-font": [
          "case",
          ["==", ["get", "class"], "city"],
          ["literal", ["Noto Sans Medium"]],
          ["literal", ["Noto Sans Regular"]],
        ],
        "text-padding": ["interpolate", ["linear"], ["zoom"], 5, 3, 8, 7, 12, 11],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          // As Protomaps sizes the packs' towns: a city large, the rest at 11 or 12.
          7,
          byClass("city", 13, "town", 11, 10),
          10,
          byClass("city", 18, "town", 12.5, "village", 11.5, 11),
          15,
          byClass("city", 22, "town", 14, "village", 12.5, 12),
        ],
      }),
    }),
    // A country's name in English, as the app says it.
    layer("places_country", "symbol", "place", {
      filter: kind("country"),
      ...names(c.country_label, c.earth, {
        "symbol-sort-key": ["get", "rank"],
        "text-field": ["coalesce", ENGLISH, ONLINE_OWN],
        "text-font": ["Noto Sans Medium"],
        "text-size": 18,
        "text-transform": "uppercase",
      }),
    }),
  ];
}

/** The depths the countries' and states' packs on this computer are cut to, the shallowest
 *  first: each one source, drawn in that order, so the deeper lies over the shallower where two
 *  packs meet. */
export function depths(regions: readonly Pick<MapPack, "maxzoom">[]): number[] {
  return [...new Set(regions.map((pack) => pack.maxzoom))].sort((a, b) => a - b);
}

/**
 * The map's style: the world's pack, then the countries' and states' on this computer over it,
 * one source for each depth they're cut to; tiles, fonts and icons all from `origin`, the
 * engine. With the online extra, OpenFreeMap's tiles from zoom 7 where no pack has them,
 * through the engine too: the world's then stops at zoom 7, and a depth's past its deepest
 * zoom where OpenFreeMap goes deeper.
 */
export function mapStyle(
  origin: string,
  regions: readonly MapPack[],
  online = false,
): StyleSpecification {
  const source = (depth: number, minzoom: number): SourceSpecification => ({
    type: "vector",
    tiles: [`${origin}/api/map/depth/${depth}/{z}/{x}/{y}`],
    minzoom,
    maxzoom: depth,
    attribution: OSM,
  });
  const shallowest = (depth: number) =>
    Math.min(...regions.filter((pack) => pack.maxzoom === depth).map((pack) => pack.minzoom));
  const world = packLayers("world").flatMap((layer) => {
    if (!online) return [layer];
    if (layer.type === "background") {
      // Land, where OpenFreeMap's tiles draw only what's on it.
      const colour = ["step", ["zoom"], LIGHT.background, ONLINE.minzoom, LIGHT.earth];
      return [{ ...layer, paint: { "background-color": colour } } as LayerSpecification];
    }
    return until(layer, ONLINE.minzoom) ?? [];
  });
  const openfreemap: SourceSpecification = {
    type: "vector",
    tiles: [`${origin}/api/map/online/{z}/{x}/{y}`],
    ...ONLINE,
    attribution: `${OPENFREEMAP} ${OSM}`,
  };
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/light`,
    sources: Object.fromEntries([
      ["world", source(6, 0)],
      ...depths(regions).map((depth) => [`packs${depth}`, source(depth, shallowest(depth))]),
      ...(online ? [["online", openfreemap]] : []),
    ]),
    layers: [
      ...world,
      ...(online ? onlineLayers() : []),
      // A country's land and water cover the world's enlarged tiles, and OpenFreeMap's, where it
      // has its own; its background would cover everything.
      ...depths(regions).flatMap((depth) =>
        packLayers(`packs${depth}`)
          .filter((layer) => layer.type !== "background")
          .flatMap((layer) =>
            online && depth < ONLINE.maxzoom ? (until(layer, depth + 1) ?? []) : [layer],
          ),
      ),
    ],
  };
}
