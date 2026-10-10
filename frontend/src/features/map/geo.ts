import { geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import shapesFile from "./shapes.json";

/*
 * The map's borders and its flat plane. The borders come
 * with the app (scripts/map-shapes.mjs, from Natural Earth and geoBoundaries), so the map needs
 * no internet. Places are drawn on a Mercator plane in which Malaysia fills BASE; zooming only
 * scales that plane, so the borders are worked out once.
 */

type Named = Feature<Geometry, { name: string; code?: string }>;
type Shapes = {
  states: Topology;
  region: Topology;
  world: Topology;
  provinces: Topology;
  districts: Topology;
};

const shapes = shapesFile as unknown as Shapes;

function features(topology: Topology, name: string): Named[] {
  const found = feature(topology, topology.objects[name] as GeometryCollection);
  return (found as FeatureCollection<Geometry, Named["properties"]>).features;
}

const STATES = features(shapes.states, "states");
const REGION = features(shapes.region, "region");
const WORLD = features(shapes.world, "world");
const DISTRICTS = features(shapes.districts, "districts");

export const BASE = { width: 1000, height: 600 };
const projection = geoMercator().fitExtent(
  [
    [20, 20],
    [BASE.width - 20, BASE.height - 20],
  ],
  { type: "FeatureCollection", features: STATES },
);
const path = geoPath(projection);

/** Plane pixels per kilometre: Malaysia is close enough to the equator for one number. */
export const PLANE_PER_KM = projection.scale() / 6371;

export type Shape = { name: string; d: string };

const drawn = (list: Named[]): Shape[] =>
  list.flatMap((f) => {
    const d = path(f);
    return d ? [{ name: f.properties.name, d }] : [];
  });

/**
 * The lines between neighbours in a set of shapes, as one path: each line once, and never the
 * coast, which the countries' own shapes draw. A thousand areas as one line keeps a phone quick.
 */
function between(topology: Topology, name: string): string {
  const object = topology.objects[name] as GeometryCollection;
  return path(mesh(topology, object, (a, b) => a !== b)) ?? "";
}

/**
 * Every border, drawn once on the plane: Malaysia's states, the countries around, the rest; and
 * as lines, the nearby countries' states and provinces, and Malaysia's and Indonesia's
 * districts.
 */
export const BORDERS = {
  states: drawn(STATES),
  region: drawn(REGION),
  world: drawn(WORLD),
  provinces: between(shapes.provinces, "provinces"),
  districts: between(shapes.districts, "districts"),
};

/** Each Malaysian state's middle on the plane, by the person form's name. */
export const STATE_MIDDLES = new Map(
  STATES.map((f) => [f.properties.name, path.centroid(f) as [number, number]]),
);

/** An area's name, where it's written on the plane (its middle), and how much room it has. */
export type Area = { name: string; x: number; y: number; width: number; height: number };

/** Each district's name, as the gazetteer gives it, the biggest districts first. */
export const DISTRICT_NAMES: Area[] = DISTRICTS.flatMap((f): Area[] => {
  const [x, y] = path.centroid(f);
  const [[x0, y0], [x1, y1]] = path.bounds(f);
  return Number.isFinite(x) && Number.isFinite(y) && f.properties.name
    ? [{ name: f.properties.name, x, y, width: x1 - x0, height: y1 - y0 }]
    : [];
}).sort((a, b) => b.width * b.height - a.width * a.height);

/** Where a point is on the plane. */
export function onPlane(lat: number, lon: number): [number, number] {
  return projection([lon, lat]) ?? [0, 0];
}

/** The point on the plane at x, y, as latitude and longitude. */
export function fromPlane(x: number, y: number): { lat: number; lon: number } {
  const [lon, lat] = projection.invert?.([x, y]) ?? [0, 0];
  return { lat, lon };
}
