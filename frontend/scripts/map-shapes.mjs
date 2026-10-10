/**
 * Makes the map's borders: src/features/map/shapes.json,
 * from Natural Earth, which is in the public domain, and geoBoundaries, which asks to be
 * credited. Run it only when the borders should change:
 *
 *   node scripts/map-shapes.mjs <folder>
 *
 * where <folder> holds, from github.com/nvkelso/natural-earth-vector (geojson/):
 *   ne_10m_admin_1_states_provinces.geojson  saved as ne_10m_admin_1.geojson
 *   ne_10m_admin_0_countries.geojson         saved as ne_10m_admin_0.geojson
 *   ne_110m_admin_0_countries.geojson        saved as ne_110m_admin_0.geojson
 * and, from github.com/wmgeolab/geoBoundaries (releaseData/gbOpen/), as they're named there:
 *   MYS/ADM2/geoBoundaries-MYS-ADM2_simplified.geojson  Malaysia's districts, CC BY 3.0
 *   IDN/ADM2/geoBoundaries-IDN-ADM2_simplified.geojson  Indonesia's, CC BY 3.0 IGO
 *
 * It keeps Malaysia's states and federal territories, under the names the app uses; the
 * countries around Malaysia, in detail, with their states and provinces; Malaysia's and
 * Indonesia's districts, under the names the gazetteer gives them; and the rest of the
 * world, coarsely.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea } from "d3-geo";
import { quantize } from "topojson-client";
import { topology } from "topojson-server";
import { filter, filterWeight, presimplify, quantile, simplify } from "topojson-simplify";

const from = process.argv[2];
if (!from) {
  console.error(
    "Usage: node scripts/map-shapes.mjs <folder with the Natural Earth and geoBoundaries files>",
  );
  process.exit(1);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/features/map/shapes.json");
const read = (name) => JSON.parse(readFileSync(join(from, name), "utf8"));

// Natural Earth's names where the person form's differ (lib/people.ts, MALAYSIAN_STATES).
const STATE_NAMES = {
  "Kuala Lumpur": "W.P. Kuala Lumpur",
  Labuan: "W.P. Labuan",
  Putrajaya: "W.P. Putrajaya",
};
// Drawn in detail: the countries the map shows around Malaysia as it opens.
const NEAR = new Set(["ID", "SG", "BN", "TH", "PH", "VN", "KH", "LA", "MM", "TL"]);

const collection = (features) => ({ type: "FeatureCollection", features });
const code = (properties) =>
  properties.ISO_A2_EH && properties.ISO_A2_EH !== "-99" ? properties.ISO_A2_EH : properties.ISO_A2;

const states = read("ne_10m_admin_1.geojson")
  .features.filter((f) => f.properties.adm0_a3 === "MYS")
  .map((f) => ({
    type: "Feature",
    properties: { name: STATE_NAMES[f.properties.name] ?? f.properties.name },
    geometry: f.geometry,
  }));
const region = read("ne_10m_admin_0.geojson")
  .features.filter((f) => NEAR.has(code(f.properties)))
  .map((f) => ({
    type: "Feature",
    properties: { name: f.properties.NAME, code: code(f.properties) },
    geometry: f.geometry,
  }));
// Not Malaysia, drawn from its states, nor Antarctica, which Mercator stretches without end.
const world = read("ne_110m_admin_0.geojson")
  .features.filter(
    (f) => !NEAR.has(code(f.properties)) && !["MY", "AQ"].includes(code(f.properties)),
  )
  .map((f) => ({
    type: "Feature",
    properties: { name: f.properties.NAME, code: code(f.properties) },
    geometry: f.geometry,
  }));
// The nearby countries' states and provinces: lines inside each country, so unnamed.
const provinces = read("ne_10m_admin_1.geojson")
  .features.filter((f) => NEAR.has(f.properties.iso_a2))
  .map((f) => ({ type: "Feature", properties: {}, geometry: f.geometry }));

/**
 * geoBoundaries goes round each outline the other way from Natural Earth, which d3 takes for
 * everything outside it: each polygon is turned round where it would cover more than half
 * the globe.
 */
function rounded(geometry) {
  const turned = (rings) =>
    geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI
      ? rings.map((ring) => [...ring].reverse())
      : rings;
  return geometry.type === "Polygon"
    ? { ...geometry, coordinates: turned(geometry.coordinates) }
    : { ...geometry, coordinates: geometry.coordinates.map(turned) };
}
// Malaysia's and Indonesia's districts, named as the gazetteer names them: Indonesia's
// with "Kabupaten", as its kota already have "Kota".
const district = (country) => (f) => {
  const name = f.properties.shapeName;
  return {
    type: "Feature",
    properties: {
      name: country === "ID" && !name.startsWith("Kota ") ? `Kabupaten ${name}` : name,
    },
    geometry: rounded(f.geometry),
  };
};
const districts = [
  ...read("geoBoundaries-MYS-ADM2_simplified.geojson").features.map(district("MY")),
  ...read("geoBoundaries-IDN-ADM2_simplified.geojson").features.map(district("ID")),
];

/**
 * Simplified first, then rounded to a grid (simplifying needs the true coordinates): `keep`
 * of the points, and no island smaller than `island` square degrees (0.001 is about 12 km²).
 */
function shapes(objects, keep, island, grid) {
  let made = presimplify(topology(objects));
  // quantile() counts from the heaviest point: `keep` of them weigh at least this much.
  made = simplify(made, quantile(made, keep));
  return quantize(filter(made, filterWeight(made, island)), grid);
}

// Malaysia in detail, down to small islands such as Labuan; the countries around it, detailed
// enough for a town's surroundings, with their states and provinces; the districts, enough to
// tell one from the next; the rest of the world, coarsely. Small enough for every view-only
// copy to carry: the provinces and districts add under 1.5 MB to a copy's app.
const parts = {
  states: shapes(
    { states: collection(states) },
    Number(process.env.KEEP_STATES ?? 0.35),
    1e-5,
    1e5,
  ),
  region: shapes(
    { region: collection(region) },
    Number(process.env.KEEP ?? 0.15),
    Number(process.env.ISLAND ?? 2e-3),
    1e5,
  ),
  world: quantize(topology({ world: collection(world) }), 1e4),
  provinces: shapes(
    { provinces: collection(provinces) },
    Number(process.env.KEEP_PROVINCES ?? 0.1),
    Number(process.env.ISLAND ?? 2e-3),
    1e5,
  ),
  districts: shapes(
    { districts: collection(districts) },
    Number(process.env.KEEP_DISTRICTS ?? 0.2),
    Number(process.env.ISLAND_DISTRICTS ?? 2e-4),
    1e5,
  ),
};
const text = JSON.stringify(parts);
writeFileSync(out, `${text}\n`);
const size = (value) => `${(JSON.stringify(value).length / 1024).toFixed(0)} KB`;
console.log(
  `${states.length} states (${size(parts.states)}), ${region.length} countries near (${size(parts.region)}), ` +
    `${world.length} far (${size(parts.world)}), ${provinces.length} provinces near ` +
    `(${size(parts.provinces)}), ${districts.length} districts (${size(parts.districts)}): ` +
    `${size(parts)} in all`,
);
