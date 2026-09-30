import { geoMercator, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import shapesFile from "./shapes.json";

/*
 * The map's borders and its flat plane. The borders come with
 * the app (scripts/map-shapes.mjs, from Natural Earth), so the map needs no internet. Places
 * are drawn on a Mercator plane in which Malaysia fills BASE; zooming only scales that plane,
 * so the borders are worked out once.
 */

type Named = Feature<Geometry, { name: string; code?: string }>;
type Shapes = { states: Topology; region: Topology; world: Topology };

const shapes = shapesFile as unknown as Shapes;

function features(topology: Topology, name: string): Named[] {
  const found = feature(topology, topology.objects[name] as GeometryCollection);
  return (found as FeatureCollection<Geometry, Named["properties"]>).features;
}

const STATES = features(shapes.states, "states");
const REGION = features(shapes.region, "region");
const WORLD = features(shapes.world, "world");

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

/** Every border, drawn once on the plane: Malaysia's states, the countries around, the rest. */
export const BORDERS = {
  states: drawn(STATES),
  region: drawn(REGION),
  world: drawn(WORLD),
};

/** Each Malaysian state's middle on the plane, by the person form's name. */
export const STATE_MIDDLES = new Map(
  STATES.map((f) => [f.properties.name, path.centroid(f) as [number, number]]),
);

/** Where a point is on the plane. */
export function onPlane(lat: number, lon: number): [number, number] {
  return projection([lon, lat]) ?? [0, 0];
}

/** The point on the plane at x, y, as latitude and longitude. */
export function fromPlane(x: number, y: number): { lat: number; lon: number } {
  const [lon, lat] = projection.invert?.([x, y]) ?? [0, 0];
  return { lat, lon };
}
