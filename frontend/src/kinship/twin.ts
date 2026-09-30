/**
 * The relationship finder of a view-only copy: a twin of the
 * Python engine (backend/src/ancestree/kinship), for copies, which can't ask Python. It gives
 * the same answers word for word, as golden files written by the Python engine prove
 * (golden.test.ts). The app itself asks Python; this runs only in copies.
 *
 * One rule for changes: the Python engine changes first, its golden files are written again
 * (backend: uv run python -m tests.kinship_golden), and the twin follows until they agree.
 */
import type { KinPerson, KinRelation, KinStatement, KinshipAnswer } from "@/api/types";
import { DictionaryRows } from "./dictionary";
import { Family, shortName, type TwinKind, type TwinLink, type TwinPerson } from "./family";
import { type Relation, relate, type Statement } from "./finder";
import { type Book, TermBook } from "./terms";

export type { TwinKind, TwinLink, TwinPerson } from "./family";

/** What a copy carries for its finder besides the family and its kinds: the word lists, the
 *  Malay titles applied, and the dictionary rows (backend services/kinship.py twin_inputs). */
export type TwinInputs = {
  books: Record<string, Book>;
  rows: [string, Record<string, unknown>][];
};

const LANGUAGES = ["en", "ms", "jv"] as const;
const UNKNOWN_PARENT = "Unknown parent";

/** Asked about someone the family doesn't have (the API answers 404). */
export class NotInFamily extends Error {}

export class KinshipTwin {
  private readonly people: Map<string, TwinPerson>;
  private readonly family: Family;
  private readonly books: Map<string, TermBook>;
  private readonly english: TermBook;
  private readonly rows: DictionaryRows;

  constructor(
    people: readonly TwinPerson[],
    links: readonly TwinLink[],
    kinds: readonly TwinKind[],
    inputs: TwinInputs,
  ) {
    this.people = new Map(people.map((person) => [person.id, person]));
    this.family = Family.fromGraph(people, links, kinds);
    this.books = new Map(
      LANGUAGES.filter((code) => inputs.books[code]).map((code) => [
        code,
        new TermBook(inputs.books[code] as Book),
      ]),
    );
    this.english = this.books.get("en") as TermBook;
    this.rows = new DictionaryRows(inputs.rows);
  }

  /** How `b` is related to `a`, as GET /api/kinship answers it. */
  answer(from: string, to: string): KinshipAnswer {
    const a = from.toLowerCase();
    const b = to.toLowerCase();
    const first = this.people.get(a);
    const second = this.people.get(b);
    if (!first || !second) throw new NotInFamily("That person isn't in the tree.");

    let message: string | null = null;
    let relations: Relation[] = [];
    if (a === b) {
      message = `That's ${name(first)} again: pick someone else.`;
    } else if (first.placeholder || second.placeholder) {
      message = "An unknown parent can't be compared. Fill them in first.";
    } else {
      relations = relate(this.family, a, b, this.english, this.books);
      if (!relations.length) {
        message = `No recorded link between ${name(first)} and ${name(second)} yet.`;
      }
    }

    const mentioned = new Set([a, b]);
    for (const relation of relations) {
      for (const person of [...relation.path, ...relation.sharedAncestors]) mentioned.add(person);
    }
    return {
      a,
      b,
      relations: relations.map((relation) => this.relation(relation)),
      people: [...mentioned].map((id) => person(this.people.get(id) as TwinPerson)),
      message,
    };
  }

  private relation(relation: Relation): KinRelation {
    const explained = relation.explanation;
    return {
      type: relation.type,
      forward: this.statement(relation.forward),
      reverse: this.statement(relation.reverse),
      generations: relation.generations,
      shared_ancestors: [...relation.sharedAncestors],
      path: [...relation.path],
      links: [...relation.links],
      explanation: {
        sentences: [...explained.sentences],
        top: explained.top,
        pair: explained.pair,
        removed: explained.removed,
        rule: explained.rule,
      },
    };
  }

  private statement(statement: Statement): KinStatement {
    const words: KinStatement["words"] = {};
    for (const code of LANGUAGES) {
      const said = statement.words.get(code);
      if (said) words[code] = { term: said.term, sentence: said.sentence, english: said.english };
    }
    return {
      term: statement.term,
      sentence: statement.sentence,
      detail: statement.detail,
      words,
      entry: this.rows.rowFor(statement.kin),
    };
  }
}

function name(person: TwinPerson): string {
  return shortName(person.full_name, person.nickname);
}

function person(row: TwinPerson): KinPerson {
  return {
    id: row.id,
    name: row.placeholder ? UNKNOWN_PARENT : name(row),
    full_name: row.full_name,
    gender: row.gender || "unknown",
    photo_version: row.photo_version ?? null,
    placeholder: !!row.placeholder,
  };
}
