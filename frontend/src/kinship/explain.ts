/**
 * What an answer means, with the actual people (backend/src/ancestree/kinship/explain.py):
 * who shares which ancestors and what "removed" means, with where the two lines
 * meet for the ladder; for in-laws and chains, whose relative each one is, by name. English.
 */
import type { Gender } from "@/api/types";
import type { BloodTie } from "./blood";
import type { Family } from "./family";
import { blood, pieces } from "./kin";
import type { Step } from "./routes";
import type { TermBook } from "./terms";

export const COUSIN_RULE =
  "Cousins are counted by the ancestors they share: grandparents for first cousins, " +
  'great-grandparents for second cousins. "Removed" counts the generations between them.';

const NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

export type Explanation = {
  sentences: string[];
  // Blood relatives: where on the path the two lines meet, the two at the same generation
  // ("second cousins"), and what the rest is called.
  top: number | null;
  pair: string | null;
  removed: string | null;
  rule: string | null;
};

function explanation(sentences: string[], more: Partial<Explanation> = {}): Explanation {
  return { sentences, top: null, pair: null, removed: null, rule: null, ...more };
}

const number = (count: number) =>
  count >= 1 && count <= NUMBERS.length ? (NUMBERS[count - 1] as string) : String(count);
const ordinal = (count: number) =>
  count >= 1 && count <= ORDINALS.length ? (ORDINALS[count - 1] as string) : `${count}th`;

/** "one generation", "three generations". */
export function generationsApart(count: number): string {
  return `${number(count)} generation${count === 1 ? "" : "s"}`;
}

/** "once removed", "twice removed", "three times removed". */
export function timesRemoved(count: number): string {
  const times = count === 1 ? "once" : count === 2 ? "twice" : `${number(count)} times`;
  return `${times} removed`;
}

/** "parents", "grandparent", "great-great-grandparents". */
function ancestorWord(generations: number, plural: boolean): string {
  if (generations > 6) return `ancestor${plural ? "s" : ""} ${generations} generations up`;
  const word =
    generations === 1 ? "parent" : `${"great-".repeat(Math.max(0, generations - 2))}grandparent`;
  return plural ? `${word}s` : word;
}

const withArticle = (word: string) => `${"aeiou".includes(word.slice(0, 1)) ? "an" : "a"} ${word}`;

function joined(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Names and words for one family. */
class Say {
  constructor(
    readonly family: Family,
    readonly english: TermBook,
  ) {}

  name(person: string): string {
    return this.family.member(person).name;
  }

  gender(person: string): Gender {
    return this.family.gender(person);
  }

  /** The English word for someone `up` and `down` from another: "son", "grandmother". */
  blood(up: number, down: number, person: string): string {
    const fallback = down === 0 ? "parent" : up === 0 ? "child" : "relative";
    return this.english.blood(blood(up, down, this.gender(person))) || fallback;
  }

  /** "great-grandparents, Tok Ismail & Nenek Fatimah"; "a grandparent, Tok Ismail". */
  shared(generations: number, ancestors: readonly string[]): string {
    const one = ancestors.length === 1;
    const word = ancestorWord(generations, !one);
    const known = ancestors
      .filter((p) => !this.family.member(p).placeholder)
      .map((p) => this.name(p));
    if (!known.length) {
      return one ? `${withArticle(word)} who isn't recorded yet` : `${word} who aren't recorded`;
    }
    return `${one ? withArticle(word) : word}, ${known.join(" & ")}`;
  }

  /** "brothers", "sisters", "half-siblings": the two of them together. */
  siblings(a: string, b: string, half: boolean): string {
    const genders = new Set([this.gender(a), this.gender(b)]);
    const only = (gender: Gender) => genders.size === 1 && genders.has(gender);
    let word = only("male") ? "brothers" : "sisters";
    if (!only("male") && !only("female")) word = "siblings";
    return half ? `half-${word}` : word;
  }
}

/** How B is related to A by blood, told with the people on the path. */
export function explainBlood(
  family: Family,
  english: TermBook,
  a: string,
  b: string,
  tie: BloodTie,
): Explanation {
  const say = new Say(family, english);
  const { up, down, path } = tie;
  if (!up || !down) return explanation([directLine(say, a, b, tie)]);

  const nearest = Math.min(up, down); // the generations from the shared ancestors
  if (nearest === 1) return close(say, a, b, tie);

  // Cousins: the two at the same generation share ancestors `nearest` generations up; the
  // rest of the longer line is how many times "removed".
  const removed = Math.abs(up - down);
  const [left, right] = down >= up ? [a, path[2 * up] as string] : [path[up - down] as string, b];
  const cousins = `${ordinal(nearest - 1)} cousins`;
  const sentences = [
    `${say.name(left)} and ${say.name(right)} are ${cousins}: they share ` +
      `${say.shared(nearest, tie.ancestors)}.`,
  ];
  if (removed) {
    const [lower, above, other] = down > up ? [b, right, a] : [a, left, b];
    sentences.push(
      `${say.name(lower)} is ${say.name(above)}'s ${say.blood(0, removed, lower)}, ` +
        `${generationsApart(removed)} below ${say.name(other)}: that's what ` +
        `"${timesRemoved(removed)}" means.`,
    );
  }
  return explanation(sentences, {
    top: up,
    pair: cousins,
    removed: removed ? timesRemoved(removed) : null,
    rule: COUSIN_RULE,
  });
}

/** Brothers and sisters, and the lines just below them: uncles, aunts, nephews, nieces. */
function close(say: Say, a: string, b: string, tie: BloodTie): Explanation {
  const { up, down, path } = tie;
  const half = tie.ancestors.length === 1;
  if (up === 1 && down === 1) {
    const parents = tie.ancestors
      .filter((p) => !say.family.member(p).placeholder)
      .map((p) => say.name(p));
    let shared: string;
    if (half) {
      shared = parents.length ? `one parent, ${parents[0]}` : "one parent who isn't recorded";
    } else {
      shared = parents.length ? `their parents, ${parents.join(" & ")}` : "their parents";
    }
    return explanation([`${say.name(a)} and ${say.name(b)} share ${shared}.`], {
      top: up,
      pair: say.siblings(a, b, half),
    });
  }
  if (up === 1) {
    // B descends from A's brother or sister.
    const sibling = path[2] as string;
    const sentence =
      `${say.name(b)} is ${say.name(sibling)}'s ${say.blood(0, down - 1, b)}, and ` +
      `${say.name(sibling)} is ${say.name(a)}'s ${say.blood(1, 1, sibling)}: ` +
      `${generationsApart(down - 1)} below ${say.name(a)}.`;
    return explanation([sentence], { top: up, pair: say.siblings(a, sibling, half) });
  }
  const ancestor = path[up - 1] as string; // B is a sibling of A's parent (or grandparent)
  const sentence =
    `${say.name(b)} is the ${say.blood(1, 1, b)} of ${say.name(a)}'s ` +
    `${say.blood(up - 1, 0, ancestor)}, ${say.name(ancestor)}: ` +
    `${generationsApart(up - 1)} above ${say.name(a)}.`;
  return explanation([sentence], { top: up, pair: say.siblings(ancestor, b, half) });
}

/** "Mariam is Siti's mother's mother, through Aminah: two generations above Siti". */
function directLine(say: Say, a: string, b: string, tie: BloodTie): string {
  const upward = tie.up > 0;
  const steps = tie.up || tie.down;
  const words = tie.path.slice(1).map((p) => (upward ? say.blood(1, 0, p) : say.blood(0, 1, p)));
  const through = tie.path.slice(1, -1).map((p) => say.name(p));
  const via = through.length ? `, through ${joined(through)}` : "";
  return (
    `${say.name(b)} is ${say.name(a)}'s ${words.join("'s ")}${via}: ` +
    `${generationsApart(steps)} ${upward ? "above" : "below"} ${say.name(a)}.`
  );
}

/** In-laws, step-family, adoption and longer chains: whose relative each one is, by name. */
export function explainRoute(
  family: Family,
  english: TermBook,
  a: string,
  route: readonly Step[],
): Explanation {
  const say = new Say(family, english);
  const found = pieces(family, a, route);
  const words = found.map((piece) => english.term(piece.kin, family.kinds) || "relative");
  if (found.length === 1) {
    const [only] = found;
    return explanation([`${say.name(only?.end ?? a)} is ${say.name(a)}'s ${words[0]}.`]);
  }
  if (found.length === 2) {
    const [first, second] = found;
    return explanation([
      `${say.name(second?.end ?? a)} is the ${words[1]} of ${say.name(a)}'s ${words[0]}, ` +
        `${say.name(first?.end ?? a)}.`,
    ]);
  }
  const walk = found.map(
    (piece, index) => `${say.name(piece.start)}'s ${words[index]} is ${say.name(piece.end)}`,
  );
  return explanation([`${walk.slice(0, -1).join("; ")}; and ${walk[walk.length - 1]}.`]);
}
