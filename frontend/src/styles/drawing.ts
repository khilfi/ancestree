/*
 * The drawing colours: what the tree, the timeline and the map draw, by what each
 * means. Everything else on screen takes the theme's tokens (`index.css`); these are the colours
 * the code itself needs as values: the generations' and branches' hues, tinted and passed to
 * the page as they're worked out; MapLibre's layers and markers; and the tree's picture, an SVG
 * drawn outside the page. The tree's lines, which `index.css` draws, have the same values there
 * (`--tree-line` and the rest), and a test holds the two together (`look.test.ts`).
 *
 * Nothing else writes a colour by hand: `look.test.ts` fails on one.
 */

export const DRAWING = {
  /** A line between parent and child, and what's drawn as quiet as one: an unplaced person's
   *  timeline bar, a photo's empty ring, a person with no colour of their own. */
  line: "#a8a29e",
  /** A line pointed at. */
  lineStrong: "#44403c",
  /** A marriage's line, and where a couple's children's lines meet. */
  marriage: "#78716c",
  /** The line between a couple drawn side by side, and a photo's rim. */
  pair: "#d6d3d1",
  /** A ring, a generation's row or band: there, and quiet behind the people. */
  ring: "#d6d3d1",
  /** A ring's label: 4.8:1 on white. */
  ringLabel: "#78716c",
  /** Finding a relationship: the person it starts from, and the path. */
  kin: "#f59e0b",
  /** Someone with no colour of their own, on the map: their pin, and the line of their move. */
  uncoloured: "#78716c",
  /** A link being dragged from one person to another. */
  dragging: "#0ea5e9",
  /** The overview map's window onto the tree. */
  view: "#0ea5e9",
  /** The dots of the tree's canvas. */
  canvasDots: "#e7e5e4",
  /** What's chosen on the map, and a pin on the form's small map. */
  chosen: "#0284c7",
  pin: "#0369a1",
  /** The map drawn from the app's own shapes: sea, land, and the lines between them. */
  sea: "#eef4f7",
  land: "#f5f5f4",
  coast: "#d6d3d1",
  /** White, under a drawing: a country's border over land, a photo's backing, the picture's
   *  page, a circle's halo. */
  paper: "#ffffff",
  /** The family leaf, the app's icon. */
  leaf: "#059669",
} as const;

/** The tree's picture: its names and years, initials where there's no photo, and the
 *  tray of the unplaced, amber as on screen. */
export const PICTURE = {
  name: "#292524",
  years: "#78716c",
  initials: "#57534e",
  initialsBackground: "#f5f5f4",
  labelBackground: "#fafaf9",
  tray: "#fcd34d",
  trayText: "#92400e",
  trayBackground: "#fffbeb",
} as const;

/** The generations' and branches' hues: distinct at a glance, and never the only signal.
 *  The tree, the timeline, the families list, the map and the picture share them, so a colour
 *  always means the same thing. */
export const GENERATIONS = [
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
] as const;

/** Kinship's closeness to you: warm for the closest, cooler further out; violet for those
 *  linked otherwise. */
export const CLOSENESS = {
  you: "#9a3412",
  degrees: ["#dc2626", "#f97316", "#eab308", "#65a30d", "#0d9488", "#0284c7"], // 1 … 6 and more
  linked: "#a78bfa",
} as const;
