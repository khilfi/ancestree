import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expression,
  type Formatted,
  latest,
  type StylePropertySpecification,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import type { MapPack } from "@/api/types";
import { depths, LABEL, mapStyle, ONLINE, ONLINE_LABEL, perKmAt, zoomFor } from "./style";

const ORIGIN = "http://127.0.0.1:18090";
const malaysia: MapPack = {
  key: "my",
  title: "Malaysia",
  country: "my",
  size: 157_000_000,
  minzoom: 7,
  maxzoom: 14,
  first: false,
  installed: true,
  fetching: false,
  done: 0,
  error: null,
};
// Cut to zoom 14 and 13: one source for each depth, whatever the packs.
const singapore: MapPack = { ...malaysia, key: "sg", title: "Singapore", country: "sg" };
const germany: MapPack = { ...malaysia, key: "de", title: "Germany", country: "de", maxzoom: 13 };

/** Every address a style's tiles come from. */
function tilesOf(style: StyleSpecification): string[] {
  return Object.values(style.sources).flatMap((source) =>
    "tiles" in source ? (source.tiles ?? []) : [],
  );
}

/** Every font a style's labels ask for. */
function fontsOf(style: StyleSpecification): string[] {
  return [...new Set(JSON.stringify(style.layers).match(/Noto Sans [A-Za-z ]+?(?=")/g))].sort();
}

/** A label as MapLibre writes it, for a feature with these properties: its lines. */
function written(properties: Record<string, string>, field: unknown = LABEL): string[] {
  const parsed = expression.createExpression(
    field as ExpressionSpecification,
    "layers[0].layout.text-field",
    latest.layout_symbol["text-field"] as unknown as StylePropertySpecification,
  );
  if (parsed.result !== "success") throw new Error(JSON.stringify(parsed.value));
  const value = parsed.value.evaluate({ zoom: 10 }, {
    type: 1,
    properties,
    geometry: [],
  } as never) as string | Formatted;
  const text = typeof value === "string" ? value : value.sections.map((part) => part.text).join("");
  return text.split("\n");
}

describe("the zoom, in pixels a kilometre", () => {
  it("is MapLibre's zoom at that latitude, and back", () => {
    expect(perKmAt(6, 0)).toBeCloseTo(0.8177, 3); // 512 × 64 pixels round the equator
    expect(perKmAt(7, 0)).toBeCloseTo(2 * perKmAt(6, 0));
    expect(perKmAt(6, 60)).toBeCloseTo(2 * perKmAt(6, 0)); // nearer the pole, more pixels
    for (const perKm of [0.05, 1.2, 6, 66])
      expect(perKmAt(zoomFor(perKm, 5.3), 5.3)).toBeCloseTo(perKm);
  });
});

describe("a label", () => {
  it("is the place's own name", () => {
    expect(written({ name: "Kampung Laut" })).toEqual(["Kampung Laut"]);
    expect(written({ name: "Kota Bharu", "name:en": "Kota Bharu" })).toEqual(["Kota Bharu"]);
  });

  it("has its English name beneath, where OpenStreetMap has one that differs", () => {
    expect(written({ name: "Jawa Tengah", "name:en": "Central Java" })).toEqual([
      "Jawa Tengah",
      "Central Java",
    ]);
    expect(written({ name: "北京市", script: "Han", "name:en": "Beijing" })).toEqual([
      "北京市",
      "Beijing",
    ]);
  });

  it("gives way to the English where the map can't draw the own name's script", () => {
    expect(written({ name: "กรุงเทพมหานคร", script: "Thai", "name:en": "Bangkok" })).toEqual([
      "Bangkok",
    ]);
    expect(written({ name: "சென்னை", script: "Tamil" })).toEqual(["சென்னை"]); // none to give way to
  });
});

describe("the map's style", () => {
  const style = mapStyle(ORIGIN, [malaysia]);
  const layers = style.layers;

  it("draws the world's pack, and the countries' over it from zoom 7, by depth", () => {
    expect(style.sources).toEqual({
      world: expect.objectContaining({
        type: "vector",
        tiles: [`${ORIGIN}/api/map/depth/6/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 6,
      }),
      packs14: expect.objectContaining({
        tiles: [`${ORIGIN}/api/map/depth/14/{z}/{x}/{y}`],
        minzoom: 7,
        maxzoom: 14,
      }),
    });
    expect(layers[0]).toMatchObject({ id: "world:background", type: "background" });
    expect(layers.filter((layer) => layer.type === "background")).toHaveLength(1); // a country's would hide the world
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
    const first = layers.findIndex((layer) => layer.id.startsWith("packs14:"));
    expect(layers.slice(0, first).every((layer) => layer.id.startsWith("world:"))).toBe(true);
  });

  it("draws all the packs cut to one depth as one source, the deeper over the shallower", () => {
    const many = mapStyle(ORIGIN, [germany, malaysia, singapore]);
    expect(Object.keys(many.sources)).toEqual(["world", "packs13", "packs14"]);
    expect(many.sources.packs13).toEqual(
      expect.objectContaining({ tiles: [`${ORIGIN}/api/map/depth/13/{z}/{x}/{y}`], maxzoom: 13 }),
    );
    const order = many.layers.map((layer) => layer.id.split(":")[0]);
    expect(order.lastIndexOf("packs13")).toBeLessThan(order.indexOf("packs14"));
    // As many layers for twenty packs as for one of each depth.
    expect(many.layers).toHaveLength(mapStyle(ORIGIN, [germany, malaysia]).layers.length);
    expect(depths([singapore, germany, malaysia])).toEqual([13, 14]);
    expect(depths([])).toEqual([]);
    expect(Object.keys(mapStyle(ORIGIN, []).sources)).toEqual(["world"]);
  });

  it("asks nothing of the internet: tiles, fonts and icons all from the engine", () => {
    expect(style.glyphs).toBe(`${ORIGIN}/map/fonts/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`${ORIGIN}/map/sprites/light`);
    for (const tiles of tilesOf(style)) expect(tiles.startsWith(`${ORIGIN}/`)).toBe(true);
    // Every font a label asks for comes with the app.
    expect(fontsOf(style)).toEqual(["Noto Sans Italic", "Noto Sans Medium", "Noto Sans Regular"]);
    for (const font of fontsOf(style)) {
      const there = new URL(`../../../public/map/fonts/${font}/0-255.pbf`, import.meta.url);
      expect(existsSync(fileURLToPath(there)), font).toBe(true);
    }
  });

  it("is one MapLibre takes", () => {
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("names places, water and roads as a label above, a country in English", () => {
    const field = (id: string) =>
      layers.find((layer) => layer.id === id)?.layout as { "text-field"?: unknown } | undefined;
    for (const id of [
      "world:places_locality",
      "packs14:places_subplace",
      "world:water_label_ocean",
    ]) {
      expect(field(id)?.["text-field"], id).toEqual(LABEL);
    }
    expect(
      written(
        { name: "Kelantan", "name:en": "Kelantan", ref: "Kel." },
        field("world:places_region")?.["text-field"],
      ),
    ).toEqual(["Kelantan"]);
    expect(
      written(
        { name: "Malaysia", "name:en": "Malaysia" },
        field("world:places_country")?.["text-field"],
      ),
    ).toEqual(["Malaysia"]);
  });
});

describe("a label from OpenFreeMap's tiles", () => {
  const online = (properties: Record<string, string>) => written(properties, ONLINE_LABEL);

  it("is the own name, with its English beneath where it differs, as the packs' are", () => {
    expect(online({ name: "London", "name:latin": "London", "name:en": "London" })).toEqual([
      "London",
    ]);
    expect(online({ name: "Singapura", "name:en": "Singapore" })).toEqual([
      "Singapura",
      "Singapore",
    ]);
    const drawn: [string, string][] = [
      ["Москва", "Moscow"],
      ["Αθήνα", "Athens"],
      ["東京都", "Tokyo"],
      ["서울", "Seoul"],
    ];
    for (const [own, english] of drawn) {
      expect(online({ name: own, "name:nonlatin": own, "name:en": english })).toEqual([
        own,
        english,
      ]);
    }
  });

  it("gives way to the English where the map can't draw the own name, else to Latin letters", () => {
    expect(
      online({
        name: "หาดใหญ่",
        "name:nonlatin": "หาดใหญ่",
        "name:latin": "Hat Yai",
        "name:en": "Hat Yai",
      }),
    ).toEqual(["Hat Yai"]);
    expect(online({ name: "القاهرة", "name:nonlatin": "القاهرة", "name:en": "Cairo" })).toEqual([
      "Cairo",
    ]);
    expect(online({ name: "சென்னை", "name:nonlatin": "சென்னை", "name:latin": "Cennai" })).toEqual([
      "Cennai",
    ]);
  });
});

describe("the map's style with the online extra", () => {
  const style = mapStyle(ORIGIN, [malaysia, germany], true);
  const layers = style.layers;
  const of = (pack: string) => layers.filter((layer) => layer.id.startsWith(`${pack}:`));

  it("is as before while it's off", () => {
    expect(mapStyle(ORIGIN, [malaysia], false)).toEqual(mapStyle(ORIGIN, [malaysia]));
    expect(Object.keys(mapStyle(ORIGIN, [malaysia]).sources)).toEqual(["world", "packs14"]);
  });

  it("has OpenFreeMap's tiles through the engine, from zoom 7, where no pack has them", () => {
    expect(style.sources.online).toEqual(
      expect.objectContaining({
        type: "vector",
        tiles: [`${ORIGIN}/api/map/online/{z}/{x}/{y}`],
        minzoom: 7,
        maxzoom: 14,
      }),
    );
    // The window still asks only the engine: the engine asks OpenFreeMap.
    for (const tiles of tilesOf(style)) expect(tiles.startsWith(`${ORIGIN}/`)).toBe(true);
    expect(ONLINE.minzoom).toBe(malaysia.minzoom);
  });

  it("draws the world below zoom 7, then OpenFreeMap's, with the countries' over it", () => {
    const order = layers.map((layer) => layer.id.split(":")[0]);
    expect(order.lastIndexOf("world")).toBeLessThan(order.indexOf("online"));
    expect(order.lastIndexOf("online")).toBeLessThan(order.indexOf("packs13"));
    for (const layer of of("world").filter((layer) => layer.type !== "background")) {
      expect(layer.maxzoom, layer.id).toBeLessThanOrEqual(7);
    }
    // Land is the background from zoom 7, where OpenFreeMap's tiles draw only what's on it.
    const background = layers[0] as { paint: { "background-color": unknown } };
    expect(background.paint["background-color"]).toEqual([
      "step",
      ["zoom"],
      "#cccccc",
      7,
      "#e2dfda",
    ]);
  });

  it("keeps the packs where they go as deep as OpenFreeMap, and gives way past them", () => {
    const without = mapStyle(ORIGIN, [malaysia, germany]).layers;
    expect(of("packs14")).toEqual(without.filter((layer) => layer.id.startsWith("packs14:")));
    expect(of("packs13").length).toBeGreaterThan(10);
    for (const layer of of("packs13")) expect(layer.maxzoom, layer.id).toBeLessThanOrEqual(14);
  });

  it("is one MapLibre takes, with only the fonts that come with the app", () => {
    expect(validateStyleMin(style)).toEqual([]);
    expect(fontsOf(style)).toEqual(["Noto Sans Italic", "Noto Sans Medium", "Noto Sans Regular"]);
    expect(of("online").length).toBeGreaterThan(20);
  });
});
