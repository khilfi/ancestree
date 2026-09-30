import type { Graph } from "@/api/types";

/*
 * The tree's colours: people by branch or by generation, and the rings and
 * rows behind them. The canvas, the timeline, the families list and the picture export share
 * them, so a colour always means the same thing.
 */

// Distinct at a glance, and never the only signal.
export const PALETTE = [
  "#0284c7",
  "#e11d48",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0d9488",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
];

/** Rings, rows and bands: clearly there, and still quiet behind the people. */
export const RING_LINE = "#d6d3d1"; // stone-300
export const RING_LABEL = "#78716c"; // stone-500, which reads at 4.8:1 on white

/** A generation's colour. Generations before the centre's, which a married-in family can
 *  reach, wrap around the palette like the rest. */
export function generationColour(generation: number): string {
  const count = PALETTE.length;
  return PALETTE[(((generation - 1) % count) + count) % count] ?? RING_LINE;
}

/** A lighter shade of a colour (`#rrggbb`): `amount` of it, the rest white. */
export function tint(hex: string, amount: number): string {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16);
    return Math.round(value * amount + 255 * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** What a ring or a generation's row is drawn in: a light tint of the generation's colour
 *  when the people are coloured by generation, so the generations stand apart. */
export function ringStroke(generation: number | undefined, tinted: boolean): string {
  return tinted && generation !== undefined ? tint(generationColour(generation), 0.4) : RING_LINE;
}

/** Each branch's colour. A branch is a line of descent on a family's own rings; the
 *  colours go round in the order the lines start there. Married-in families have none. */
export function branchColours(graph: Graph): Map<string, string> {
  const starts = Object.entries(graph.layout.seats)
    .filter(([id, seat]) => seat.branch === id && !seat.unit.startsWith("cluster:"))
    .sort(([, a], [, b]) => a.unit.localeCompare(b.unit) || a.order - b.order)
    .map(([id]) => id);
  return new Map(starts.map((id, index) => [id, PALETTE[index % PALETTE.length] ?? RING_LINE]));
}
