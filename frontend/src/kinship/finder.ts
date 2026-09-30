/**
 * Every way two people are related, both ways round, with the path to highlight
 * (backend/src/ancestree/kinship/finder.py). Closest first: a direct marriage, then blood,
 * then in-law and step relations, then a chain; the rest are "Also related as…".
 */
import type { Gender } from "@/api/types";
import { type BloodTie, bloodTies, seniority } from "./blood";
import { minBy } from "./compare";
import { type Explanation, explainBlood, explainRoute } from "./explain";
import type { Family } from "./family";
import { blood, bloodKin, combine, generations, type Kin, pieces, routeKin } from "./kin";
import { compareBirths } from "./order";
import { type Move, type Step, shortestRoutes, shortRoutes } from "./routes";
import type { TermBook } from "./terms";

// The longest in-law and step shapes take 4 steps: enough to find the relations a closer tie hides.
const SHORT_ROUTE = 4;

export type RelationType = "marriage" | "blood" | "in_law" | "step" | "kind" | "chain";

/** A statement in one kinship language; the sentence stays English. */
export type Said = { term: string; sentence: string; english: boolean };

export type Statement = {
  term: string; // "first cousin once removed"
  sentence: string; // "Siti is Ali's first cousin once removed"
  detail: string | null; // "his mother's first cousin; one generation above him"
  kin: Kin; // the relation itself, e.g. to find it in the dictionary
  words: Map<string, Said>; // "en", "ms", "jv"
};

export type Relation = {
  type: RelationType;
  forward: Statement; // B, as seen from A
  reverse: Statement; // A, as seen from B
  generations: number; // how many generations above A that B is; negative for below
  sharedAncestors: readonly string[];
  path: readonly string[];
  links: readonly string[];
  explanation: Explanation;
};

/** How B is related to A, closest first; empty if there's no recorded link. */
export function relate(
  family: Family,
  a: string,
  b: string,
  english: TermBook,
  books: ReadonlyMap<string, TermBook>,
): Relation[] {
  if (a === b || !family.members.has(a) || !family.members.has(b)) return [];
  const found: Relation[] = [];
  const marriage = family.marriage(a, b);
  if (marriage) {
    const step: Step = { move: "=", to: b, link: marriage.id, kind: null };
    found.push(routeRelation(family, a, [step], english, books));
  }
  for (const tie of bloodTies(family, a, b))
    found.push(bloodRelation(family, a, b, tie, english, books));
  if (found.length) {
    // What a closer tie hides: a cousin who is also a sister-in-law, a grandmother who adopted
    // you. Only relations with a name; chains would just be noise.
    for (const route of shortRoutes(family, a, b, SHORT_ROUTE)) {
      const kin = routeKin(family, a, route);
      if (kin.type === "compound" || kin.type === "kindStep" || kin.type === "kindSibling") {
        found.push(routeRelation(family, a, route, english, books));
      }
    }
  } else {
    const routes = shortestRoutes(family, a, b);
    const best = minBy(routes, (route) => routeScore(family, a, route));
    if (best) found.push(routeRelation(family, a, best, english, books));
  }
  const unique = new Map<string, Relation>();
  for (const relation of found) {
    if (!unique.has(relation.forward.sentence)) unique.set(relation.forward.sentence, relation);
  }
  return [...unique.values()];
}

/** Among equally short routes, the one that says it best: the fewest pieces, birth links
 *  before other kinds, unknown parents last, then a stable order. */
function routeScore(family: Family, a: string, route: readonly Step[]) {
  const parts = combine(family, pieces(family, a, route));
  const unusual = route.filter((step) => step.move !== "=" && !family.isBlood(step.kind)).length;
  const unknown = route.filter((step) => family.member(step.to).placeholder).length;
  return [parts.length, unusual, unknown, route.map((step) => family.orderKey(step.to))];
}

// --- Building relations -------------------------------------------------------------------

function bloodRelation(
  family: Family,
  a: string,
  b: string,
  tie: BloodTie,
  english: TermBook,
  books: ReadonlyMap<string, TermBook>,
): Relation {
  const back = tie.reversed();
  return {
    type: "blood",
    forward: statement(
      family,
      a,
      b,
      bloodKin(family, a, b, tie),
      bloodDetail(family, english, a, b, tie),
      english,
      books,
    ),
    reverse: statement(
      family,
      b,
      a,
      bloodKin(family, b, a, back),
      bloodDetail(family, english, b, a, back),
      english,
      books,
    ),
    generations: tie.up - tie.down,
    sharedAncestors: tie.up && tie.down ? tie.ancestors : [],
    path: tie.path,
    links: tie.links,
    explanation: explainBlood(family, english, a, b, tie),
  };
}

function routeRelation(
  family: Family,
  a: string,
  route: readonly Step[],
  english: TermBook,
  books: ReadonlyMap<string, TermBook>,
): Relation {
  const b = (route[route.length - 1] as Step).to;
  const kin = routeKin(family, a, route);
  const back = routeKin(family, b, reversed(a, route));
  return {
    type: typeOf(kin),
    forward: statement(family, a, b, kin, routeDetail(family, english, a, kin), english, books),
    reverse: statement(family, b, a, back, routeDetail(family, english, b, back), english, books),
    generations: generations(kin),
    sharedAncestors: [],
    path: [a, ...route.map((step) => step.to)],
    links: route.map((step) => step.link),
    explanation: explainRoute(family, english, a, route),
  };
}

const FLIP: Record<Move, Move> = { u: "d", d: "u", "=": "=" };

/** The same route walked from the other end. */
function reversed(a: string, route: readonly Step[]): Step[] {
  const people = [a, ...route.map((step) => step.to)];
  return route
    .map((step, index) => ({ ...step, move: FLIP[step.move], to: people[index] as string }))
    .toReversed();
}

function typeOf(kin: Kin): RelationType {
  switch (kin.type) {
    case "blood":
      return "blood";
    case "spouse":
      return "marriage";
    case "compound":
      return kin.group;
    case "kindStep":
    case "kindSibling":
      return "kind";
    case "chain":
      return "chain";
  }
}

/** "Siti is Ali's aunt", and the same in each language: "Siti is Ali's mak su". A
 *  language with no word for it shows the English one, marked as such. */
function statement(
  family: Family,
  a: string,
  b: string,
  kin: Kin,
  detail: string | null,
  english: TermBook,
  books: ReadonlyMap<string, TermBook>,
): Statement {
  const nameA = family.member(a).name;
  const nameB = family.member(b).name;
  const sentence = (term: string) =>
    english.sentence(nameB, nameA, term) || `${nameB} is ${nameA}'s ${term}`;
  const term = english.term(kin, family.kinds) || "relative";
  const words = new Map<string, Said>();
  for (const [code, book] of books) {
    const word = book.term(kin, family.kinds);
    words.set(
      code,
      word
        ? { term: word, sentence: sentence(word), english: false }
        : { term, sentence: sentence(term), english: true },
    );
  }
  return { term, sentence: sentence(term), detail, kin, words };
}

// --- Details, in English ------------------------------------------------------------------

const his = (gender: Gender) => (gender === "male" ? "his" : gender === "female" ? "her" : "their");
const him = (gender: Gender) => (gender === "male" ? "him" : gender === "female" ? "her" : "them");

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function generationsApart(gap: number, gender: Gender): string {
  const count = Math.abs(gap);
  // As Python indexes the list: from its end for a count of 0.
  const number = count <= NUMBERS.length ? (NUMBERS.at(count - 1) as string) : String(count);
  const noun = count === 1 ? "generation" : "generations";
  return `${number} ${noun} ${gap > 0 ? "above" : "below"} ${him(gender)}`;
}

/** Who they are to each other, through the people in between: "her father's elder brother",
 *  "his mother's first cousin; one generation above him". */
function bloodDetail(
  family: Family,
  english: TermBook,
  a: string,
  b: string,
  tie: BloodTie,
): string | null {
  const { up, down, path } = tie;
  const hisA = his(family.gender(a));
  const say = (
    up: number,
    down: number,
    person: string,
    older: "elder" | "younger" | null = null,
  ) => english.blood(blood(up, down, family.gender(person), { seniority: older })) || "relative";

  const parts: string[] = [];
  if (down === 1 && up >= 2) {
    // An uncle or aunt: a sibling of A's parent (or grandparent).
    const parent = path[up - 1] as string;
    const older = seniority(family, b, parent);
    parts.push(`${hisA} ${say(up - 1, 0, parent)}'s ${say(1, 1, b, older)}`);
  } else if (up === 1 && down >= 2) {
    // A nephew or niece: descended from A's brother or sister.
    const sibling = path[2] as string;
    const older = seniority(family, sibling, a);
    parts.push(`${hisA} ${say(1, 1, sibling, older)}'s ${say(0, down - 1, b)}`);
  } else if (up === 2 && down === 2) {
    const parent = path[1] as string;
    const aunt = path[3] as string;
    parts.push(`${hisA} ${say(1, 0, parent)}'s ${say(1, 1, aunt)}'s ${say(0, 1, b)}`);
  } else if (up > down && down >= 2) {
    // A cousin of A's parent (or grandparent).
    const ancestor = path[up - down] as string;
    parts.push(`${hisA} ${say(up - down, 0, ancestor)}'s ${say(down, down, b)}`);
  } else if (down > up && up >= 2) {
    // A child (or grandchild) of A's cousin.
    const cousin = path[2 * up] as string;
    parts.push(`${hisA} ${say(up, up, cousin)}'s ${say(0, down - up, b)}`);
  }

  const gap = up - down;
  if (gap && up && down) {
    const age = ageAgainstLineage(family, a, b, gap);
    if (Math.min(up, down) >= 2 || age) {
      parts.push(generationsApart(gap, family.gender(a)) + (age ? `, ${age}` : ""));
    }
  }
  return parts.join("; ") || null;
}

/** Lineage decides, never age: say so when the two disagree, like an uncle born after
 *  his nephew. */
function ageAgainstLineage(family: Family, a: string, b: string, gap: number): string | null {
  const order = compareBirths(family.member(b).birth, family.member(a).birth);
  if (gap > 0 && order && order > 0) return `though born after ${him(family.gender(a))}`;
  if (gap < 0 && order && order < 0) return `though born before ${him(family.gender(a))}`;
  return null;
}

/** For in-laws and step-family, whose: "his wife's brother", "her father's wife". */
function routeDetail(family: Family, english: TermBook, a: string, kin: Kin): string | null {
  if (kin.type !== "compound") return null;
  const term = english.term(kin, family.kinds);
  const piecesSaid = english.chain(kin.parts, family.kinds);
  if (!piecesSaid || piecesSaid === term) return null;
  return `${his(family.gender(a))} ${piecesSaid}`;
}
