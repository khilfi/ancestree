/**
 * What a relationship is, as a structure any language can put into words
 * (backend/src/ancestree/kinship/kin.py). A route is cut into pieces (a stretch of blood,
 * a marriage, a parent or child of another kind); known combinations become one relation, and
 * anything else is said as a chain.
 */
import type { Gender } from "@/api/types";
import { BloodTie, birthPlace, bloodTies, type Place, type Seniority, seniority } from "./blood";
import { minBy } from "./compare";
import type { Family } from "./family";
import type { Step } from "./routes";

export type Side = "paternal" | "maternal";

/** B is A's blood relative: A climbs `up` generations to the nearest shared ancestor, B is
 *  `down` below it. `parts` say the same in two pieces, for a language without a word. */
export type Blood = {
  type: "blood";
  up: number;
  down: number;
  gender: Gender;
  side: string | null;
  seniority: Seniority | null;
  place: Place | null;
  half: boolean;
  parts: Blood[];
};
export type Spouse = { type: "spouse"; gender: Gender; former: boolean };
/** A parent or child by a kind other than birth: adoptive father, foster daughter… */
export type KindStep = { type: "kindStep"; kind: string; upward: boolean; gender: Gender };
/** A brother or sister through adoption or fostering. */
export type KindSibling = {
  type: "kindSibling";
  kind: string;
  gender: Gender;
  seniority: Seniority | null;
};
/** An in-law or step relation, by the shape of its route: "=u" a spouse's parent. */
export type Compound = {
  type: "compound";
  key: string;
  group: "in_law" | "step";
  gender: Gender;
  former: boolean;
  parts: Kin[];
  seniority: Seniority | null;
  place: Place | null;
};
/** Anything else, said piece by piece: "wife's cousin's son". */
export type Chain = { type: "chain"; parts: Kin[] };
export type Kin = Blood | Spouse | KindStep | KindSibling | Compound | Chain;

export function blood(
  up: number,
  down: number,
  gender: Gender,
  more: Partial<Omit<Blood, "type" | "up" | "down" | "gender">> = {},
): Blood {
  return {
    type: "blood",
    up,
    down,
    gender,
    side: null,
    seniority: null,
    place: null,
    half: false,
    parts: [],
    ...more,
  };
}

type Piece = {
  kin: Kin;
  start: string;
  end: string;
  shape: string; // "m,n" for blood, "=" for a marriage, "" for anything else
  size: number; // how many steps of the route it covers
};

/** The in-law and step relations, by the shapes of their pieces. Longest first. */
const COMPOUNDS: readonly [string, "in_law" | "step", readonly string[]][] = [
  ["=ud=", "in_law", ["=", "1,1", "="]], // spouse's sibling's spouse
  ["d=u", "in_law", ["0,1", "=", "1,0"]], // child's spouse's parent
  ["u=d", "step", ["1,0", "=", "0,1"]], // stepbrother, stepsister
  ["uud=", "in_law", ["2,1", "="]], // uncle or aunt by marriage
  ["dd=", "in_law", ["0,2", "="]], // grandchild's spouse
  ["=ud", "in_law", ["=", "1,1"]], // spouse's sibling
  ["ud=", "in_law", ["1,1", "="]], // sibling's spouse
  ["==", "in_law", ["=", "="]], // a spouse's other spouse: a co-wife
  ["=u", "in_law", ["=", "1,0"]], // parent-in-law
  ["d=", "in_law", ["0,1", "="]], // child-in-law
  ["u=", "step", ["1,0", "="]], // stepparent
  ["=d", "step", ["=", "0,1"]], // stepchild
];

export function sideOf(family: Family, parent: string): Side | null {
  const gender = family.gender(parent);
  if (gender === "male") return "paternal";
  if (gender === "female") return "maternal";
  return null;
}

/** How B is related to A by blood through `tie`, with everything a term may depend on. */
export function bloodKin(family: Family, a: string, b: string, tie: BloodTie): Blood {
  const { up, down } = tie;
  let side: string | null = up >= 2 && down === 0 ? sideOf(family, tie.path[1] as string) : null;
  let older: Seniority | null = null;
  const viaA = tie.viaA;
  const viaB = tie.viaB;
  if (up && down && viaA && viaB) {
    // Whose line is the elder: the siblings just below the shared ancestors.
    older = seniority(family, viaB, viaA);
  }
  const place = down === 1 && up >= 1 ? birthPlace(family, b) : null;
  // Half only when both have two recorded parents and share exactly one.
  const half =
    up === 1 &&
    down === 1 &&
    tie.ancestors.length === 1 &&
    family.bloodParents(a).length === 2 &&
    family.bloodParents(b).length === 2;
  if (half) side = sideOf(family, tie.ancestors[0] as string);
  return blood(up, down, family.gender(b), {
    side,
    seniority: older,
    place,
    half,
    parts: inTwo(family, a, b, tie),
  });
}

/** The relation in two pieces, where languages often have no single word: a parent's
 *  cousin, a cousin's child, a grandparent's brother, a brother's grandchild's child. */
function inTwo(family: Family, a: string, b: string, tie: BloodTie): Blood[] {
  const { up, down, path } = tie;
  let cut: number;
  if (up >= 2 && down >= 2 && up !== down) cut = up > down ? up - down : 2 * up;
  else if (down === 1 && up >= 3)
    cut = up - 1; // A's ancestor, whose brother or sister B is
  else if (up === 1 && down >= 3)
    cut = 2; // A's brother or sister, whose descendant B is
  else return [];
  const middle = path[cut] as string;
  const first = subTie(tie, 0, cut, cut <= up ? [middle] : tie.ancestors);
  const second = subTie(tie, cut, path.length - 1, cut >= up ? [middle] : tie.ancestors);
  return [bloodKin(family, a, middle, first), bloodKin(family, middle, b, second)];
}

/** The stretch of a tie from path[start] to path[end]. */
function subTie(tie: BloodTie, start: number, end: number, ancestors: readonly string[]): BloodTie {
  const top = tie.up; // the index of the shared ancestor on the path
  const up = Math.max(0, Math.min(end, top) - start);
  const down = Math.max(0, end - Math.max(start, top));
  return new BloodTie(
    up,
    down,
    ancestors,
    tie.path.slice(start, end + 1),
    tie.links.slice(start, end),
  );
}

/** Cut a route into pieces: blood stretches, marriages, and other kinds of link. */
export function pieces(family: Family, a: string, route: readonly Step[]): Piece[] {
  const found: Piece[] = [];
  let here = a;
  let i = 0;
  while (i < route.length) {
    const step = route[i] as Step;
    const following = route[i + 1];
    if (
      step.move === "u" &&
      following?.move === "d" &&
      !(family.isBlood(step.kind) && family.isBlood(following.kind)) &&
      family.makesFamily(step.kind) &&
      family.makesFamily(following.kind)
    ) {
      // Up to a parent and down to another of their children, one of them adopted or
      // fostered: an adoptive or foster brother or sister.
      const kind = family.isBlood(step.kind) ? following.kind : step.kind;
      const end = following.to;
      found.push({
        kin: {
          type: "kindSibling",
          kind: kind || "",
          gender: family.gender(end),
          seniority: seniority(family, end, here),
        },
        start: here,
        end,
        shape: "",
        size: 2,
      });
      here = end;
      i += 2;
    } else if (step.move === "=") {
      const marriage = family.marriage(here, step.to);
      const former = marriage?.status === "divorced";
      found.push({
        kin: { type: "spouse", gender: family.gender(step.to), former },
        start: here,
        end: step.to,
        shape: "=",
        size: 1,
      });
      here = step.to;
      i += 1;
    } else if (!family.isBlood(step.kind)) {
      found.push({
        kin: {
          type: "kindStep",
          kind: step.kind || "",
          upward: step.move === "u",
          gender: family.gender(step.to),
        },
        start: here,
        end: step.to,
        shape: "",
        size: 1,
      });
      here = step.to;
      i += 1;
    } else {
      // A blood stretch: up as far as it goes, then down.
      let j = i;
      while (j < route.length && route[j]?.move === "u" && family.isBlood(route[j]?.kind)) j++;
      while (j < route.length && route[j]?.move === "d" && family.isBlood(route[j]?.kind)) j++;
      const end = (route[j - 1] as Step).to;
      const ties = bloodTies(family, here, end);
      let kin: Blood;
      if (ties.length) {
        kin = bloodKin(family, here, end, ties[0] as BloodTie);
      } else {
        // Can't happen for a blood stretch, but never guess.
        const ups = route.slice(i, j).filter((s) => s.move === "u").length;
        kin = blood(ups, j - i - ups, family.gender(end));
      }
      found.push({ kin, start: here, end, shape: `${kin.up},${kin.down}`, size: j - i });
      here = end;
      i = j;
    }
  }
  return found;
}

/** A parent's spouse is only a step-parent if they aren't your parent too. */
function fits(family: Family, key: string, start: string, end: string): boolean {
  if (key === "u=") return !family.parents(start).has(end);
  if (key === "=d") return !family.children(start).has(end);
  if (key === "u=d") {
    const theirs = family.parents(end);
    return ![...family.parents(start)].some((parent) => theirs.has(parent));
  }
  return true;
}

/** Known combinations become one relation. Of all the ways to group the pieces, the fewest
 *  parts win, then the one whose longest part is shortest. */
export function combine(family: Family, found: readonly Piece[]): Kin[] {
  type Best = { score: [number, number]; kins: Kin[] };
  const best = new Map<number, Best>([[found.length, { score: [0, 0], kins: [] }]]);
  for (let i = found.length - 1; i >= 0; i--) {
    const options: [number, Kin, number][] = []; // (next piece, the relation, steps it covers)
    for (const [key, group, shapes] of COMPOUNDS) {
      const chunk = found.slice(i, i + shapes.length);
      if (chunk.length !== shapes.length || chunk.some((p, n) => p.shape !== shapes[n])) continue;
      const first = chunk[0] as Piece;
      const last = chunk[chunk.length - 1] as Piece;
      if (!fits(family, key, first.start, last.end)) continue;
      const former = chunk.some((p) => p.kin.type === "spouse" && p.kin.former);
      // Words that follow the blood relative inside: the sibling or uncle in between.
      const inside = chunk
        .map((p) => p.kin)
        .find((kin): kin is Blood => kin.type === "blood" && !!kin.up && !!kin.down);
      let older = inside ? inside.seniority : null;
      if (key === "u=d") older = seniority(family, last.end, first.start); // by age
      const compound: Compound = {
        type: "compound",
        key,
        group,
        gender: family.gender(last.end),
        former,
        parts: chunk.map((p) => p.kin),
        seniority: older,
        place: inside ? inside.place : null,
      };
      options.push([i + shapes.length, compound, chunk.reduce((sum, p) => sum + p.size, 0)]);
    }
    const piece = found[i] as Piece;
    options.push([i + 1, piece.kin, piece.size]);
    const scored = options.map(([after, kin, size]): Best => {
      const rest = best.get(after) as Best;
      return {
        score: [rest.score[0] + 1, Math.max(rest.score[1], size)],
        kins: [kin, ...rest.kins],
      };
    });
    best.set(i, minBy(scored, (option) => option.score) as Best);
  }
  return (best.get(0) as Best).kins;
}

export function routeKin(family: Family, a: string, route: readonly Step[]): Kin {
  const parts = combine(family, pieces(family, a, route));
  return parts.length === 1 ? (parts[0] as Kin) : { type: "chain", parts };
}

/** How many generations above A the relative is; negative for below. */
export function generations(kin: Kin): number {
  switch (kin.type) {
    case "blood":
      return kin.up - kin.down;
    case "kindStep":
      return kin.upward ? 1 : -1;
    case "compound":
    case "chain":
      return kin.parts.reduce((sum, part) => sum + generations(part), 0);
    default:
      return 0;
  }
}
