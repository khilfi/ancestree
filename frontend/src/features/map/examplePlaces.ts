/*
 * The example family's places, for the map's tests: where each of its 64 people
 * lives and was born, as the engine's map answers them (`GET /api/map`, 19 Nov 2026), with the
 * map's page's sums on them. Made-up people at made-up addresses, in real towns.
 */

import rows from "./example-places.json";
import { onPlane } from "./geo";
import { type Spot, stateOf } from "./levels";

/** Everyone where they live, as the map's page places them (MapPage). */
export const EXAMPLE_SPOTS: Spot[] = rows.flatMap((row) => {
  const lives = row.lives;
  if (!lives) return [];
  const [x, y] = onPlane(lives.lat, lives.lon);
  const rough = !lives.exact && (lives.found === "state" || lives.found === "country");
  return [
    {
      id: row.id,
      x,
      y,
      place: lives.name ?? lives.country,
      district: lives.district,
      state: stateOf(lives.country, lives.state),
      country: lives.country,
      rough,
      exact: lives.exact as Spot["exact"],
      address: lives.address,
    },
  ];
});

/** Each person's full name, by their id. */
export const EXAMPLE_NAMES = new Map(rows.map((row) => [row.id, row.full_name]));

/** The map's own size in the journeys' windows, with the place list beside it: 1366 × 768
 *  and 800 × 600. */
export const JOURNEY_MAPS = {
  wide: { width: 1078, height: 625 },
  small: { width: 512, height: 434 },
} as const;
