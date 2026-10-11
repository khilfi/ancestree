import type { Graph } from "@/api/types";
import { type ChildEdgeData, type ChildFlowEdge, childPath } from "./edges";
import {
  cornerEnds,
  midpoint,
  NODE_WIDTH,
  PHOTO,
  pathPoints,
  ROUNDING,
  rim,
  roundedPath,
  SMALL_PHOTO,
} from "./geometry";
import type { PersonFlowNode } from "./PersonNode";
import type { Point } from "./rings";
import type { TreeEdge } from "./toFlow";

/*
 * Links between families, and links of kinds not on the rings, routed through the openings
 *: around every photo, half a photo's width clear of each where there's room, so
 * through the gaps between neighbours on a ring and along the spaces between rings; across
 * other lines only where they must, and beside a link already there rather than on top of it;
 * then pulled taut, its corners rounded as it's drawn (`childPath`). Links inside a family keep
 * their curves.
 *
 * The search (A*) runs over a grid of small cells in the tree's own coordinates. A cell is
 * closed to a link where it's too near a photo not its own, and costs more where it's nearer
 * one than half its width, or where another line runs: near the link's own people, lines that
 * meet them don't count, as they meet it there anyway. A link too long to search for whole,
 * as on a big family's outer rings, keeps to its straight line, and goes around the photos in
 * its way. Few links leave their family, so it's quick.
 */

const CELL = 16;
const HARD = 10; // in a tight gap, a link still keeps this far from a photo's rim
const CLOSE = 2 * CELL; // what a cell nearer a photo than its half-width costs, in pixels of way
const CROSS = 16 * CELL; // what a cell another line runs through costs
const MARGINS = [480, 1600]; // how far a route may stray beyond the box around its ends, in turn
const LIMIT = 40_000; // cells in a search's box, at most: a longer link is routed by stretches
const MOST = 12_000; // cells one search looks at, at most: past it, likewise
const AROUND = 3 * PHOTO; // a long link's way around a photo begins this far before it
const MEET = 1.5 * PHOTO; // how near its people the lines that meet them don't count
const HASTE = 1.2; // the search leans towards its end: a way a little dearer, found much sooner
const BUCKET = 128; // photos are found by the square of this size they're in
const CLOSED = Number.POSITIVE_INFINITY;

// The eight steps from a cell to its neighbours, and how long each is.
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const LENGTH = DX.map((dx, index) => (dx && DY[index] ? CELL * Math.SQRT2 : CELL));

// Math.hypot is careful, and slow: these numbers are never near overflowing.
const hypot = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
const distance = (a: Point, b: Point) => hypot(a.x - b.x, a.y - b.y);
const cellOf = (value: number) => Math.floor(value / CELL);
const middle = (column: number) => (column + 0.5) * CELL;

// A cell near photos counts, in three fields, those that close it, those it's nearer than half
// a photo's width, and those whose clearance it might be within: each up to 15.
const SHUT = 256;
const NEAR = 16;
const ABOUT = 1;
const field = (value: number, unit: number) => Math.floor(value / unit) % 16;

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Cells are kept in squares of 32 × 32, and photos found by squares of BUCKET, each numbered
// from the middle, up to FAR either way: enough for a drawing within WORLD of its middle.
const TILE = 5;
const MASK = (1 << TILE) - 1;
const AREA = 1 << (2 * TILE);
const FAR = 2 ** 14;
const WORLD = 2_000_000;
const squareOf = (column: number, row: number) =>
  ((column >> TILE) + FAR) * 2 * FAR + ((row >> TILE) + FAR);
const inSquare = (column: number, row: number) => ((column & MASK) << TILE) | (row & MASK);

/** A count from 0 to 65,535 for each cell, 0 until it's written: kept in squares of cells,
 *  made as they're first written to, so a big drawing that's mostly empty space costs little;
 *  the square last used is at hand. */
class Counts {
  private readonly squares = new Map<number, Uint16Array>();
  private lastKey = -1;
  private last: Uint16Array | undefined;

  private square(column: number, row: number, make: boolean): Uint16Array | undefined {
    const key = squareOf(column, row);
    if (key === this.lastKey) return this.last;
    let square = this.squares.get(key);
    if (!square && make) {
      square = new Uint16Array(AREA);
      this.squares.set(key, square);
    }
    if (square) {
      this.lastKey = key;
      this.last = square;
    }
    return square;
  }

  get(column: number, row: number): number {
    const square = this.square(column, row, false);
    return square ? (square[inSquare(column, row)] ?? 0) : 0;
  }

  set(column: number, row: number, value: number): void {
    const square = this.square(column, row, true);
    if (square) square[inSquare(column, row)] = value;
  }

  /** One more, up to the most there can be. */
  add(column: number, row: number): void {
    const square = this.square(column, row, true);
    const at = inSquare(column, row);
    if (square && (square[at] ?? 0) < 65_535) square[at] = (square[at] ?? 0) + 1;
  }
}

type Photo = { id: string; centre: Point; radius: number };

/** A photo's centre and radius, from its node: where links meet it. */
function photoOf(node: PersonFlowNode): Photo {
  const radius = (node.type === "unknown" ? SMALL_PHOTO : PHOTO) / 2;
  return {
    id: node.id,
    centre: { x: node.position.x + NODE_WIDTH / 2, y: node.position.y + radius },
    radius,
  };
}

/** How near a point comes to a segment. */
function toSegment(point: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Each cell (or square of `size`) a straight line from `a` to `b` passes through, in order,
 *  as a line is drawn on a screen; stops, false, as soon as `visit` says no. */
function walk(
  a: Point,
  b: Point,
  visit: (column: number, row: number) => boolean,
  size = CELL,
): boolean {
  let [column, row] = [Math.floor(a.x / size), Math.floor(a.y / size)];
  const [lastColumn, lastRow] = [Math.floor(b.x / size), Math.floor(b.y / size)];
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const [stepX, stepY] = [Math.sign(dx), Math.sign(dy)];
  // How far along the line the next border across and down are, and from one to the next.
  const [everyX, everyY] = [
    dx ? size / Math.abs(dx) : Number.POSITIVE_INFINITY,
    dy ? size / Math.abs(dy) : Number.POSITIVE_INFINITY,
  ];
  let nextX = dx
    ? (stepX > 0 ? (column + 1) * size - a.x : a.x - column * size) / Math.abs(dx)
    : Number.POSITIVE_INFINITY;
  let nextY = dy
    ? (stepY > 0 ? (row + 1) * size - a.y : a.y - row * size) / Math.abs(dy)
    : Number.POSITIVE_INFINITY;
  if (!visit(column, row)) return false;
  for (let left = Math.abs(lastColumn - column) + Math.abs(lastRow - row); left > 0; left--) {
    if (nextX < nextY) {
      column += stepX;
      nextX += everyX;
    } else {
      row += stepY;
      nextY += everyY;
    }
    if (!visit(column, row)) return false;
  }
  return true;
}

/** The part of a line from `a` to `b` inside a box, if any (Liang and Barsky's way). */
function clip(
  a: Point,
  b: Point,
  [left, top, right, bottom]: [number, number, number, number],
): [Point, Point] | null {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [enter, leave] = [0, 1];
  for (const [towards, room] of [
    [-dx, a.x - left],
    [dx, right - a.x],
    [-dy, a.y - top],
    [dy, bottom - a.y],
  ] as const) {
    if (towards === 0) {
      if (room < 0) return null;
      continue;
    }
    const at = room / towards;
    if (towards < 0) {
      if (at > leave) return null;
      enter = Math.max(enter, at);
    } else {
      if (at < enter) return null;
      leave = Math.min(leave, at);
    }
  }
  return [
    { x: a.x + enter * dx, y: a.y + enter * dy },
    { x: a.x + leave * dx, y: a.y + leave * dy },
  ];
}

/** A queue that gives back the cell with the least cost first: a heap, in arrays that grow. */
class Queue {
  private cells = new Int32Array(1024);
  private costs = new Float64Array(1024);
  size = 0;

  push(cell: number, cost: number): void {
    if (this.size === this.cells.length) {
      const cells = new Int32Array(this.size * 2);
      const costs = new Float64Array(this.size * 2);
      cells.set(this.cells);
      costs.set(this.costs);
      this.cells = cells;
      this.costs = costs;
    }
    const { cells, costs } = this;
    let at = this.size++;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const above = costs[parent] ?? 0;
      if (above <= cost) break;
      cells[at] = cells[parent] ?? 0;
      costs[at] = above;
      at = parent;
    }
    cells[at] = cell;
    costs[at] = cost;
  }

  pop(): number {
    const { cells, costs } = this;
    const top = cells[0] ?? 0;
    const size = --this.size;
    if (size === 0) return top;
    const cell = cells[size] ?? 0;
    const cost = costs[size] ?? 0;
    let at = 0;
    for (;;) {
      let least = 2 * at + 1;
      if (least >= size) break;
      if (least + 1 < size && (costs[least + 1] ?? 0) < (costs[least] ?? 0)) least += 1;
      if ((costs[least] ?? 0) >= cost) break;
      cells[at] = cells[least] ?? 0;
      costs[at] = costs[least] ?? 0;
      at = least;
    }
    cells[at] = cell;
    costs[at] = cost;
    return top;
  }
}

/** What each search works in, kept from one to the next: the box's arrays, and the queue. */
class Scratch {
  known = new Float32Array(0); // what entering each cell costs, once worked out
  spent = new Float32Array(0); // the cheapest way to each cell found so far
  came = new Uint8Array(0); // the step taken to it, plus one
  done = new Uint8Array(0);
  readonly queue = new Queue();

  ready(size: number): void {
    if (this.known.length < size) {
      const room = Math.min(LIMIT, Math.max(size, 2 * this.known.length));
      this.known = new Float32Array(room);
      this.spent = new Float32Array(room);
      this.came = new Uint8Array(room);
      this.done = new Uint8Array(room);
    }
    this.known.fill(Number.NaN, 0, size);
    this.spent.fill(Number.POSITIVE_INFINITY, 0, size);
    this.came.fill(0, 0, size);
    this.done.fill(0, 0, size);
    this.queue.size = 0;
  }
}

/** Whether the box around two points, `margin` beyond them, is small enough to search. */
function fits(a: Point, b: Point, margin: number): boolean {
  const stray = 2 * Math.ceil(margin / CELL) + 1;
  const width = Math.abs(cellOf(a.x) - cellOf(b.x)) + stray;
  return width * (Math.abs(cellOf(a.y) - cellOf(b.y)) + stray) <= LIMIT;
}

/** The cheapest way from one point to another through cells that aren't closed, as the
 *  columns and rows of its cells in turn, within `margin` of the box around the two: null if
 *  there's none, or the box is too big; undefined if it's too far to find. `entering` is what
 *  a cell costs on top of its length: CLOSED where it's closed. */
function search(
  scratch: Scratch,
  from: Point,
  to: Point,
  margin: number,
  entering: (column: number, row: number) => number,
): number[] | null | undefined {
  const [fromX, fromY, toX, toY] = [cellOf(from.x), cellOf(from.y), cellOf(to.x), cellOf(to.y)];
  const stray = Math.ceil(margin / CELL);
  const left = Math.min(fromX, toX) - stray;
  const top = Math.min(fromY, toY) - stray;
  const width = Math.abs(fromX - toX) + 2 * stray + 1;
  const height = Math.abs(fromY - toY) + 2 * stray + 1;
  if (width * height > LIMIT) return null;
  scratch.ready(width * height);
  const { known, spent, came, done, queue } = scratch;
  // Each cell of the box by its place in the arrays, column by column: a step across is
  // `height` places, a step down one.
  const start = (fromX - left) * height + (fromY - top);
  const end = (toX - left) * height + (toY - top);
  // What's left to go, at the least: straight, or diagonally where it can.
  const ahead = (column: number, row: number) => {
    const across = Math.abs(column + left - toX);
    const down = Math.abs(row + top - toY);
    const most = across > down ? across : down;
    return (most + (Math.SQRT2 - 1) * (across + down - most)) * CELL * HASTE;
  };
  const cost = (cell: number) => {
    let value = known[cell] ?? 0;
    if (Number.isNaN(value)) {
      const column = Math.floor(cell / height);
      value = cell === end ? 0 : entering(column + left, cell - column * height + top);
      known[cell] = value;
    }
    return value;
  };
  spent[start] = 0;
  queue.push(start, ahead(fromX - left, fromY - top));
  let looked = 0;
  while (queue.size) {
    const cell = queue.pop();
    if (cell === end) {
      // Back from the end, row and column, the other way round to come out right.
      const way: number[] = [];
      for (let at = end; ; ) {
        const column = Math.floor(at / height);
        way.push(at - column * height + top, column + left);
        const step = (came[at] ?? 0) - 1;
        if (at === start || step < 0) break;
        at -= (DX[step] ?? 0) * height + (DY[step] ?? 0);
      }
      return way.reverse();
    }
    if (done[cell]) continue;
    done[cell] = 1;
    if (++looked > MOST) return undefined;
    const column = Math.floor(cell / height);
    const row = cell - column * height;
    const sofar = spent[cell] ?? 0;
    for (let step = 0; step < 8; step++) {
      const dx = DX[step] ?? 0;
      const dy = DY[step] ?? 0;
      const nextColumn = column + dx;
      const nextRow = row + dy;
      if (nextColumn < 0 || nextRow < 0 || nextColumn >= width || nextRow >= height) continue;
      const next = cell + dx * height + dy;
      if (done[next]) continue;
      const extra = cost(next);
      if (extra === CLOSED) continue;
      // A diagonal step never cuts the corner of a closed cell.
      if (dx !== 0 && dy !== 0) {
        if (cost(cell + dx * height) === CLOSED || cost(cell + dy) === CLOSED) continue;
      }
      const total = sofar + (LENGTH[step] ?? CELL) + extra;
      if (total < (spent[next] ?? Number.POSITIVE_INFINITY)) {
        spent[next] = total;
        came[next] = step + 1;
        queue.push(next, total + ahead(nextColumn, nextRow));
      }
    }
  }
  return null;
}

/** The way through `cells` (columns and rows in turn) from one point to another: the points
 *  where it turns. */
function turns(cells: number[], from: Point, to: Point): Point[] {
  const points = [from];
  for (let index = 2; index + 2 < cells.length; index += 2) {
    const [x, y] = [cells[index] ?? 0, cells[index + 1] ?? 0];
    const [backX, backY] = [x - (cells[index - 2] ?? 0), y - (cells[index - 1] ?? 0)];
    const [onX, onY] = [(cells[index + 2] ?? 0) - x, (cells[index + 3] ?? 0) - y];
    if (backX !== onX || backY !== onY) points.push({ x: middle(x), y: middle(y) });
  }
  points.push(to);
  return points;
}

/** The way pulled taut: from each point, straight on to the furthest later one that `clear`
 *  allows, looking further and further ahead, then back. */
function taut(way: Point[], clear: (from: Point, to: Point) => boolean): Point[] {
  const [first] = way;
  if (!first) return [];
  const pulled = [first];
  let at = 0;
  while (at < way.length - 1) {
    const from = way[at] ?? first;
    const reaches = (index: number) => clear(from, way[index] ?? from);
    let [good, step] = [at + 1, 1];
    while (good + step < way.length && reaches(good + step)) {
      good += step;
      step *= 2;
    }
    let bad = Math.min(good + step, way.length);
    while (bad - good > 1) {
      const half = (good + bad) >> 1;
      if (reaches(half)) good = half;
      else bad = half;
    }
    pulled.push(way[good] ?? from);
    at = good;
  }
  return pulled;
}

/** A point `length` from `from`, towards `to`. */
function towards(from: Point, to: Point, length: number): Point {
  const away = distance(from, to) || 1;
  return {
    x: from.x + ((to.x - from.x) / away) * length,
    y: from.y + ((to.y - from.y) / away) * length,
  };
}

/** The routes of links that have them, by link. */
export function routesOf(edges: TreeEdge[]): Map<string, Point[]> {
  return new Map(
    edges.flatMap((edge) => {
      const route = edge.type === "child" ? (edge.data as ChildEdgeData).route : undefined;
      return route ? [[edge.id, route] as const] : [];
    }),
  );
}

/** Whether a link is routed: a child's that leaves their family, or of a kind not on the rings. */
export function routable(graph: Graph, edge: TreeEdge): boolean {
  if (edge.type !== "child") return false;
  const data = edge.data as ChildEdgeData;
  if (data.look === "loose") return true;
  const unitOf = (id: string) => graph.layout.seats[id]?.unit;
  const family = unitOf(edge.target);
  return unitOf(edge.source) !== family || (!!data.partner && unitOf(data.partner) !== family);
}

/** The links of `edges` that leave their family, or are of a kind not on the rings, routed
 *  through the openings among everyone in `nodes`; the rest as they were. */
export function routeLinks(graph: Graph, nodes: PersonFlowNode[], edges: TreeEdge[]): TreeEdge[] {
  const routed = (edge: TreeEdge) => routable(graph, edge);
  if (!edges.some(routed)) return edges;
  const photos = nodes.map(photoOf);
  // A drawing too big to number its squares keeps its links as they were.
  if (photos.some(({ centre }) => Math.abs(centre.x) > WORLD || Math.abs(centre.y) > WORLD)) {
    return edges;
  }

  // The photos by the small square they're in; and the cells near each, counted a square of
  // cells at a time, when a route first looks there.
  const photoById = new Map(photos.map((photo) => [photo.id, photo]));
  const buckets = new Map<number, number[]>();
  const bucketOf = (x: number, y: number) =>
    (Math.floor(x / BUCKET) + FAR) * 2 * FAR + Math.floor(y / BUCKET) + FAR;
  for (const [index, { centre }] of photos.entries()) {
    append(buckets, bucketOf(centre.x, centre.y), index);
  }
  /** Each photo within a small square's width of a point, by number, until `visit` says no. */
  const photosNear = (point: Point, visit: (index: number) => boolean): boolean => {
    const [bx, by] = [Math.floor(point.x / BUCKET) + FAR, Math.floor(point.y / BUCKET) + FAR];
    for (let x = bx - 1; x <= bx + 1; x++) {
      for (let y = by - 1; y <= by + 1; y++) {
        for (const index of buckets.get(x * 2 * FAR + y) ?? []) if (!visit(index)) return false;
      }
    }
    return true;
  };
  const near = new Counts();
  const counted = new Set<number>();
  // A cell might be within a photo's clearance when its middle is within the clearance and
  // half a cell's diagonal.
  const slack = (CELL * Math.SQRT2) / 2;
  const farthest = PHOTO + slack;
  let lastNear = -1;
  /** What's near a cell: the photos that close it, that it's nearer than half their width,
   *  and whose clearance it might be within, in their fields. */
  const nearAt = (x: number, y: number) => {
    const square = squareOf(x, y);
    if (square !== lastNear && !counted.has(square)) {
      counted.add(square);
      const [across, down] = [x >> TILE, y >> TILE];
      const [left, top] = [across << TILE, down << TILE];
      const [right, bottom] = [left + MASK, top + MASK];
      const side = (MASK + 1) * CELL;
      for (
        let bx = Math.floor((across * side - farthest) / BUCKET);
        bx <= Math.floor(((across + 1) * side + farthest) / BUCKET);
        bx++
      ) {
        for (
          let by = Math.floor((down * side - farthest) / BUCKET);
          by <= Math.floor(((down + 1) * side + farthest) / BUCKET);
          by++
        ) {
          for (const index of buckets.get((bx + FAR) * 2 * FAR + by + FAR) ?? []) {
            const { centre, radius } = photos[index] ?? { centre: { x: 0, y: 0 }, radius: 0 };
            const about = 2 * radius + slack;
            const [fromX, toX] = [cellOf(centre.x - about), cellOf(centre.x + about)];
            const [fromY, toY] = [cellOf(centre.y - about), cellOf(centre.y + about)];
            for (let cx = Math.max(fromX, left); cx <= Math.min(toX, right); cx++) {
              for (let cy = Math.max(fromY, top); cy <= Math.min(toY, bottom); cy++) {
                const away = hypot(middle(cx) - centre.x, middle(cy) - centre.y);
                if (away > about) continue;
                const now = near.get(cx, cy);
                let add = field(now, ABOUT) < 15 ? ABOUT : 0;
                if (away <= 2 * radius && field(now, NEAR) < 15) add += NEAR;
                if (away < radius + HARD && field(now, SHUT) < 15) add += SHUT;
                near.set(cx, cy, now + add);
              }
            }
          }
        }
      }
    }
    lastNear = square;
    return near.get(x, y);
  };

  // Where the other lines run, and whose they are: the links that keep their curves, and each
  // route once it's made. A square of cells has its lines drawn into it when a route first
  // looks there: most of a big drawing, no route goes near.
  const SQUARE = (MASK + 1) * CELL;
  const lineCells = new Counts();
  const lines: Point[][] = [];
  const linesOf = new Map<string, number[]>();
  const waiting = new Map<number, number[]>(); // each square's lines, until it's drawn
  const drawn = new Set<number>();
  /** A line's cells within one square into `cells`: each once, as one stretch of it ends in
   *  the cell the next begins in. */
  const drawInto = (cells: Counts, line: number, square: number) => {
    const [across, down] = [Math.floor(square / (2 * FAR)) - FAR, (square % (2 * FAR)) - FAR];
    const box: [number, number, number, number] = [
      across * SQUARE,
      down * SQUARE,
      (across + 1) * SQUARE,
      (down + 1) * SQUARE,
    ];
    const points = lines[line] ?? [];
    let [lastX, lastY] = [Number.NaN, Number.NaN];
    for (let index = 0; index + 1 < points.length; index++) {
      const [a, b] = [points[index], points[index + 1]];
      const inside = a && b ? clip(a, b, box) : null;
      if (!inside) continue;
      walk(inside[0], inside[1], (x, y) => {
        if ((x === lastX && y === lastY) || x >> TILE !== across || y >> TILE !== down) return true;
        [lastX, lastY] = [x, y];
        cells.add(x, y);
        return true;
      });
    }
  };
  /** The squares a line passes through. */
  const squaresOf = (points: Point[]) => {
    const squares = new Set<number>();
    for (let index = 0; index + 1 < points.length; index++) {
      const [a, b] = [points[index], points[index + 1]];
      if (!a || !b) continue;
      walk(a, b, (x, y) => !!squares.add((x + FAR) * 2 * FAR + y + FAR), SQUARE);
    }
    return squares;
  };
  const squaresOfLine: Set<number>[] = [];
  const draw = (points: Point[], people: string[]) => {
    const line = lines.push(points) - 1;
    for (const id of people) append(linesOf, id, line);
    squaresOfLine.push(squaresOf(points));
    for (const square of squaresOfLine[line] ?? []) {
      if (drawn.has(square)) drawInto(lineCells, line, square);
      else append(waiting, square, line);
    }
  };
  /** How many lines run through a cell. */
  let lastSquare = -1;
  const linesAt = (x: number, y: number) => {
    const square = squareOf(x, y);
    if (square !== lastSquare && !drawn.has(square)) {
      drawn.add(square);
      for (const line of waiting.get(square) ?? []) drawInto(lineCells, line, square);
      waiting.delete(square);
    }
    lastSquare = square;
    return lineCells.get(x, y);
  };
  const ends = (edge: TreeEdge) => {
    const partner = edge.type === "child" ? (edge.data as ChildEdgeData).partner : null;
    return {
      parent: photoById.get(edge.source),
      other: partner ? photoById.get(partner) : undefined,
      child: photoById.get(edge.target),
      people: [...new Set([edge.source, edge.target, ...(partner ? [partner] : [])])],
    };
  };
  for (const edge of edges) {
    if (routed(edge)) continue;
    const { parent, other, child, people } = ends(edge);
    if (!parent || !child) continue;
    draw(
      edge.type === "child"
        ? pathPoints(childPath(parent, other?.centre ?? null, child, edge.data as ChildEdgeData))
        : [parent.centre, child.centre],
      people,
    );
  }

  // The shortest first: a longer link finds the way the shorter took, and runs beside it.
  const routes = new Map<string, Point[]>();
  const scratch = new Scratch();
  const lengthOf = (edge: TreeEdge) => {
    const { parent, child } = ends(edge);
    return parent && child ? distance(parent.centre, child.centre) : 0;
  };
  for (const edge of edges.filter(routed).toSorted((a, b) => lengthOf(a) - lengthOf(b))) {
    const { parent, other, child, people } = ends(edge);
    if (!parent || !child) continue;
    const own = new Set(people);
    const mine = people.flatMap((id) => photoById.get(id) ?? []);
    const from = other ? midpoint(parent.centre, other.centre) : parent.centre;
    // The lines that meet this link's people don't count near them, where they all meet; further
    // on, they do, so that two links from one couple run side by side.
    const meeting = [from, ...mine.map((photo) => photo.centre)];
    const meetingSquares = new Set<number>();
    for (const { x, y } of meeting) {
      for (const column of [cellOf(x - MEET), cellOf(x + MEET)]) {
        for (const row of [cellOf(y - MEET), cellOf(y + MEET)]) {
          meetingSquares.add(squareOf(column, row));
        }
      }
    }
    const ownLines = new Counts();
    for (const line of new Set(people.flatMap((id) => linesOf.get(id) ?? []))) {
      for (const square of squaresOfLine[line] ?? []) {
        if (meetingSquares.has(square)) drawInto(ownLines, line, square);
      }
    }
    const foreign = (x: number, y: number) => {
      const count = linesAt(x, y);
      if (!count) return false;
      const meets = meeting.some((point) => hypot(middle(x) - point.x, middle(y) - point.y) < MEET);
      return count > (meets ? ownLines.get(x, y) : 0);
    };
    const entering = (x: number, y: number) => {
      const packed = nearAt(x, y);
      let cost = 0;
      if (packed) {
        let [shut, close] = [field(packed, SHUT), field(packed, NEAR)];
        for (const { centre, radius } of mine) {
          const away = hypot(middle(x) - centre.x, middle(y) - centre.y);
          if (away > 2 * radius) continue;
          close -= 1;
          if (away < radius + HARD) shut -= 1;
        }
        if (shut > 0) return CLOSED;
        if (close > 0) cost = CLOSE;
      }
      return foreign(x, y) ? cost + CROSS : cost;
    };
    /** A way pulled taut: each straight stretch half a photo's width clear of every photo not
     *  its own (or no nearer than the way itself went, in a tight gap), and across no line the
     *  way didn't cross already. */
    const pull = (way: Point[]): Point[] => {
      const onWay = new Counts();
      const kept = new Map<number, number>();
      for (let index = 0; index + 1 < way.length; index++) {
        const [a, b] = [way[index], way[index + 1]];
        if (!a || !b) continue;
        walk(a, b, (x, y) => {
          onWay.set(x, y, 1);
          if (!field(nearAt(x, y), NEAR)) return true;
          const point = { x: middle(x), y: middle(y) };
          return photosNear(point, (photo) => {
            const { id, centre } = photos[photo] ?? { id: "", centre: point };
            if (!own.has(id)) {
              const away = distance(point, centre);
              kept.set(photo, Math.min(kept.get(photo) ?? Number.POSITIVE_INFINITY, away));
            }
            return true;
          });
        });
      }
      const allowed = (index: number, photo: Photo) =>
        Math.min(2 * photo.radius - 1, (kept.get(index) ?? Number.POSITIVE_INFINITY) - 2);
      const clear = (a: Point, b: Point) => {
        const measured = new Set<number>();
        return walk(a, b, (x, y) => {
          if (!onWay.get(x, y) && foreign(x, y)) return false;
          if (!field(nearAt(x, y), ABOUT)) return true;
          return photosNear({ x: middle(x), y: middle(y) }, (index) => {
            const photo = photos[index];
            if (!photo || measured.has(index) || own.has(photo.id)) return true;
            measured.add(index);
            return toSegment(photo.centre, a, b) >= allowed(index, photo);
          });
        });
      };
      return taut(way, clear);
    };
    /** The way from one point to another, searched for in the box around them and pulled
     *  taut: the points where it turns; null if there's none, or the box is too big. */
    const searched = (a: Point, b: Point): Point[] | null => {
      for (const margin of MARGINS) {
        if (!fits(a, b, margin)) break;
        const cells = search(scratch, a, b, margin, entering);
        if (cells) return pull(turns(cells, a, b));
        if (cells === undefined) break; // a bigger box would take longer still
      }
      return null;
    };
    /** A link too long to search for whole keeps to its straight line, and goes around the
     *  photos in its way: searched for from a little before each to a little after, in parts
     *  where that's long. */
    const stretched = (a: Point, b: Point): Point[] | null => {
      const span = distance(a, b);
      const along = (t: number) => towards(a, b, Math.max(0, Math.min(span, t)));
      const blocked: [number, number][] = [];
      const seen = new Set<number>();
      for (let t = 0; t <= span + BUCKET / 2; t += BUCKET / 2) {
        photosNear(along(t), (index) => {
          const photo = photos[index];
          if (!photo || seen.has(index) || own.has(photo.id)) return true;
          seen.add(index);
          if (toSegment(photo.centre, a, b) >= 2 * photo.radius) return true;
          // How far along the line it's passed.
          const on =
            ((photo.centre.x - a.x) * (b.x - a.x) + (photo.centre.y - a.y) * (b.y - a.y)) / span;
          blocked.push([on - 2 * photo.radius - AROUND, on + 2 * photo.radius + AROUND]);
          return true;
        });
      }
      // A place to break a way in two, near halfway between two points but not by a photo:
      // along the line first, then a little to either side of it.
      const breakNear = (from: Point, to: Point): Point | null => {
        const length = distance(from, to);
        const [acrossX, acrossY] = [(from.y - to.y) / length, (to.x - from.x) / length];
        for (let along = 0; along < length / 2; along += CELL) {
          for (const side of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
            for (const way of along ? [along, -along] : [0]) {
              const halfway = towards(from, to, length / 2 + way);
              const point = {
                x: halfway.x + acrossX * side * CELL * 2,
                y: halfway.y + acrossY * side * CELL * 2,
              };
              if (entering(cellOf(point.x), cellOf(point.y)) !== CLOSED) return point;
            }
          }
        }
        return null;
      };
      const part = (from: Point, to: Point, depth: number): Point[] | null => {
        const found = searched(from, to);
        if (found || depth === 0) return found;
        // Too long to search at once: in two.
        const split = breakNear(from, to);
        const one = split && part(from, split, depth - 1);
        const two = split && one && part(split, to, depth - 1);
        return one && two ? [...one, ...two.slice(1)] : null;
      };
      // Stretches that overlap are one, so that each begins and ends well clear of every photo.
      const stretches: [number, number][] = [];
      for (const [enter, leave] of blocked.toSorted((x, y) => x[0] - y[0])) {
        const last = stretches.at(-1);
        if (last && enter <= last[1]) last[1] = Math.max(last[1], leave);
        else stretches.push([enter, leave]);
      }
      const points = [a];
      for (const [enter, leave] of stretches) {
        const around = part(along(enter), along(leave), 3);
        if (!around) return null;
        points.push(...around);
      }
      points.push(b);
      return points;
    };
    const found = searched(from, child.centre) ?? stretched(from, child.centre);
    if (!found) continue;
    // Each point once, where one way's end is the next one's start.
    const pulled = found.filter((point, index) => {
      const before = found[index - 1];
      return !before || distance(before, point) > 0.5;
    });

    // Its corners rounded as it's drawn: where a rounding would come too near a photo, it's
    // held tighter to its corner by a point either side.
    const route = pulled.length > 2 ? pulled.slice(1, -1) : [midpoint(from, child.centre)];
    const [first] = route;
    const start = other || !first ? from : rim(parent.centre, parent.radius, first);
    const end = rim(child.centre, child.radius + 3, route.at(-1) ?? from);
    const points = [start, ...route, end];
    const tight = (before: Point, at: Point, after: Point, reach: number) => {
      const curve = cornerEnds(before, at, after, reach);
      return photosNear(at, (index) => {
        const photo = photos[index];
        if (!photo || own.has(photo.id)) return true;
        for (let step = 1; step < 8; step++) {
          const t = step / 8;
          const [a, b, c] = [(1 - t) ** 2, 2 * (1 - t) * t, t ** 2];
          const point = {
            x: a * curve.start.x + b * at.x + c * curve.end.x,
            y: a * curve.start.y + b * at.y + c * curve.end.y,
          };
          if (distance(point, photo.centre) < photo.radius + HARD) return false;
        }
        return true;
      });
    };
    const held: Point[] = [start];
    for (let index = 1; index + 1 < points.length; index++) {
      const [before, at, after] = [held.at(-1) ?? start, points[index], points[index + 1]];
      if (!at || !after) continue;
      const most = Math.min(ROUNDING, distance(before, at) / 2, distance(at, after) / 2);
      let reach = most;
      while (reach > 2 && !tight(before, at, after, reach)) reach /= 2;
      if (reach < most) {
        held.push(towards(at, before, 2 * reach), at, towards(at, after, 2 * reach));
      } else held.push(at);
    }
    held.push(end);
    routes.set(edge.id, held.slice(1, -1));
    draw(pathPoints(roundedPath(held)), people);
  }

  return edges.map((edge) => {
    const route = routes.get(edge.id);
    return route && edge.type === "child"
      ? ({ ...edge, data: { ...edge.data, route } } as ChildFlowEdge)
      : edge;
  });
}
