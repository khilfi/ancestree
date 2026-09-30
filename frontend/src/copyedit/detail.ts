/**
 * Each person's view, as backend/src/ancestree/services/detail.py builds GET /api/persons/{id}
 * (FamilyRows and build_detail): relatives labelled in the kinship language, families of
 * children, brothers and sisters in birth order, and where someone stands among them. A copy to
 * edit works it out from the family it carries, and golden files written by Python prove
 * it does so exactly as Python does (golden.test.ts).
 */
import type {
  ChildGroup,
  DateView,
  Gender,
  PersonDetail,
  PersonSummary,
  Relative,
  SpouseStatus,
} from "@/api/types";
import { type Key, sortedBy } from "@/kinship/compare";
import type { TwinKind } from "@/kinship/family";
import { blood, type Kin, type Side } from "@/kinship/kin";
import { compareBirths, compareSiblings, orderSiblings, type Sibling } from "@/kinship/order";
import type { TermBook } from "@/kinship/terms";
import { describeDate, formatDate } from "@/lib/dates";
import {
  BIOLOGICAL,
  type DateParts,
  dateFromProps,
  type LinkRecord,
  livingFrom,
  type PersonRecord,
  placeFrom,
} from "./family";

/** What a person's view needs of each relationship kind. */
export type DetailKind = TwinKind & { sort_order: number };
export type Kinds = ReadonlyMap<string, DetailKind>;

type LinkProps = {
  id: string;
  kind: string | null;
  status: SpouseStatus | null;
  order: number | null;
};
type Of = { id: string; kind: string };
type PersonRow = { person: PersonRecord; link: LinkProps };
type ChildRow = PersonRow & { parents: Of[] };
type Shared = { id: string; mine: string; theirs: string };
type SiblingRow = { person: PersonRecord; shared: Shared[]; parents: Of[] };

const GENDER_ORDER: Record<Gender, number> = { male: 0, female: 1, unknown: 2 };

const isBlood = (kinds: Kinds, kind: string) => kinds.get(kind)?.blood === true;
const makesFamily = (kinds: Kinds, kind: string) => kinds.get(kind)?.in_layout === true;
const kindOf = (link: { kind: string | null }) => link.kind || BIOLOGICAL;
const genderOf = (person: PersonRecord): Gender => person.gender || "unknown";
const cap = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1);

function bloodParents(parents: readonly Of[], kinds: Kinds): Set<string> {
  return new Set(parents.filter((parent) => isBlood(kinds, parent.kind)).map((p) => p.id));
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Which of `anchor`'s families a child belongs to (services/families.py family_key). */
function familyKey(child: ChildRow, anchor: string, kinds: Kinds): [string | null, Set<string>] {
  const kind = kindOf(child.link);
  if (isBlood(kinds, kind)) {
    const others = bloodParents(child.parents, kinds);
    others.delete(anchor);
    return [null, others];
  }
  const same = new Set(child.parents.filter((p) => p.kind === kind).map((p) => p.id));
  same.delete(anchor);
  return [kind, same];
}

export function summary(person: PersonRecord): PersonSummary {
  return {
    id: person.id,
    full_name: person.full_name,
    nickname: person.nickname ?? null,
    gender: genderOf(person),
    birth_year: person.birth_year ?? null,
    death_year: person.death_year ?? null,
    photo_version: person.has_photo ? (person.photo_version ?? null) : null,
    placeholder: !!person.placeholder,
  };
}

export function displayName(person: PersonRecord): string {
  if (person.placeholder) return "an unknown parent";
  return person.nickname || person.full_name;
}

function dateView(value: DateParts | null): DateView | null {
  if (value === null) return null;
  return { value, text: formatDate(value), description: describeDate(value) };
}

function siblingOf(person: PersonRecord): Sibling {
  return {
    id: person.id,
    gender: genderOf(person),
    birth: dateFromProps(person, "birth"),
    birthOrder: person.birth_order ?? null,
    tiebreak: person.created_at || person.full_name,
  };
}

/** "eldest son", "younger daughter", "only child" (lineage/birth_order.py position_label). */
export function positionLabel(ordered: readonly Sibling[], personId: string): string {
  const me = ordered.find((sibling) => sibling.id === personId) as Sibling;
  if (ordered.length === 1) return "only child";
  const unsure = ordered.some((s) => s.gender === "unknown" && s.id !== personId);
  let noun: string;
  let same: string[];
  if (me.gender === "unknown" || unsure) {
    noun = "child";
    same = ordered.map((s) => s.id);
  } else {
    noun = me.gender === "male" ? "son" : "daughter";
    same = ordered.filter((s) => s.gender === me.gender).map((s) => s.id);
  }
  const index = same.indexOf(personId);
  const count = same.length;
  if (count === 1) return `only ${noun}`;
  if (count === 2) return `${index === 0 ? "elder" : "younger"} ${noun}`;
  if (index === 0) return `eldest ${noun}`;
  if (index === count - 1) return `youngest ${noun}`;
  return `${ordinal(index + 1)} ${noun}`;
}

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

function ordinal(number: number): string {
  if (number <= ORDINALS.length) return ORDINALS[number - 1] as string;
  const teens = number % 100 >= 10 && number % 100 <= 20;
  const suffix = teens ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th");
  return `${number}${suffix}`;
}

/** A relative's label in the kinship language: the finder's own words, English where the
 *  language has none (services/detail.py _Words). */
class Words {
  constructor(
    private readonly book: TermBook,
    private readonly english: TermBook,
    readonly kinds: Kinds,
  ) {}

  say(kin: Kin, fallback: string): string {
    return cap(this.book.term(kin, this.kinds) || this.english.term(kin, this.kinds) || fallback);
  }

  byKind(key: string, gender: Gender, upward: boolean): Kin {
    if (isBlood(this.kinds, key)) return upward ? blood(1, 0, gender) : blood(0, 1, gender);
    return { type: "kindStep", kind: key, upward, gender };
  }
}

/**
 * The whole family in memory, read the way the person view's database queries read it
 * (services/detail.py FamilyRows): rows come in the order of the links, by type, then id.
 */
export class FamilyRows {
  private readonly people = new Map<string, PersonRecord>();
  private readonly up = new Map<string, LinkRecord[]>();
  private readonly down = new Map<string, LinkRecord[]>();
  private readonly married = new Map<string, LinkRecord[]>();

  constructor(people: readonly PersonRecord[], links: readonly LinkRecord[]) {
    for (const person of people) this.people.set(person.id, person);
    const ordered = sortedBy(links, (link): Key => [link.type, link.id]);
    const add = (map: Map<string, LinkRecord[]>, key: string, link: LinkRecord) => {
      const list = map.get(key) ?? [];
      map.set(key, list);
      list.push(link);
    };
    for (const link of ordered) {
      if (link.type === "parent") {
        add(this.up, link.target, link);
        add(this.down, link.source, link);
      } else {
        add(this.married, link.source, link);
        add(this.married, link.target, link);
      }
    }
  }

  person(id: string): PersonRecord | undefined {
    return this.people.get(id);
  }

  private props(link: LinkRecord): LinkProps {
    return link.type === "parent"
      ? { id: link.id, kind: link.kind, status: null, order: null }
      : { id: link.id, kind: null, status: link.status, order: link.order };
  }

  private parentsOf(id: string): Of[] {
    return (this.up.get(id) ?? []).map((link) => ({ id: link.source, kind: kindOf(link) }));
  }

  parents(id: string): PersonRow[] {
    return (this.up.get(id) ?? []).map((link) => ({
      person: this.people.get(link.source) as PersonRecord,
      link: this.props(link),
    }));
  }

  spouses(id: string): PersonRow[] {
    return (this.married.get(id) ?? []).map((link) => ({
      person: this.people.get(link.source === id ? link.target : link.source) as PersonRecord,
      link: this.props(link),
    }));
  }

  children(id: string): ChildRow[] {
    return (this.down.get(id) ?? []).map((link) => ({
      person: this.people.get(link.target) as PersonRecord,
      link: this.props(link),
      parents: this.parentsOf(link.target),
    }));
  }

  siblings(id: string): SiblingRow[] {
    const shared = new Map<string, Shared[]>();
    for (const mine of this.up.get(id) ?? []) {
      for (const theirs of this.down.get(mine.source) ?? []) {
        if (theirs.target === id) continue;
        const rows = shared.get(theirs.target) ?? [];
        shared.set(theirs.target, rows);
        rows.push({ id: mine.source, mine: kindOf(mine), theirs: kindOf(theirs) });
      }
    }
    return [...shared].map(([sibling, rows]) => ({
      person: this.people.get(sibling) as PersonRecord,
      shared: rows,
      parents: this.parentsOf(sibling),
    }));
  }

  /** What GET /api/persons/{id} answers, in the language of `book`. */
  detail(
    id: string,
    kinds: Kinds,
    book: TermBook,
    english: TermBook,
    thisYear: number,
  ): PersonDetail {
    const props = this.people.get(id) as PersonRecord;
    const words = new Words(book, english, kinds);
    // Father and mother first, then adoptive, foster and other parents; two of one gender
    // in the order of their links, as the app's own view has them.
    const parents = sortedBy(
      this.parents(id),
      (row): Key => [
        !isBlood(kinds, kindOf(row.link)),
        GENDER_ORDER[genderOf(row.person)],
        row.link.id,
      ],
    );
    const birthParents = parents.filter((row) => isBlood(kinds, kindOf(row.link)));
    const spouses = this.spouses(id);
    const children = this.children(id);
    const siblings = this.siblings(id);
    const born = dateFromProps(props, "birth");
    const died = dateFromProps(props, "death");
    return {
      id: props.id,
      full_name: props.full_name,
      nickname: props.nickname ?? null,
      title: props.title ?? null,
      name_jawi: props.name_jawi ?? null,
      gender: genderOf(props),
      birth_date: dateView(born),
      birth_place: placeFrom(props, "birth"),
      death_date: dateView(died),
      death_place: placeFrom(props, "death"),
      burial_place: props.burial_place ?? null,
      residence: placeFrom(props, "residence"),
      living: props.living ?? null,
      is_living: livingFrom(props.living, born, died, thisYear),
      occupation: props.occupation ?? null,
      notes: props.notes ?? null,
      placeholder: !!props.placeholder,
      // As the Person model reads it: a version of 0 when none is stored.
      photo_version: props.has_photo ? (props.photo_version ?? 0) : null,
      sibling_position: siblingPosition(props, birthParents, siblings, kinds),
      parents: parents.map((row) => parentView(row, words)),
      spouses: sortedBy(spouses, spouseSort).map((row) => spouseView(row, words)),
      siblings: siblingViews(props, siblings, birthParents, words),
      child_groups: childGroups(id, children, (pid) => this.people.get(pid), words),
      link_count: parents.length + spouses.length + children.length,
      created_at: props.created_at ?? null,
      updated_at: props.updated_at ?? null,
    };
  }
}

function relative(
  person: PersonRecord,
  rest: Pick<Relative, "label" | "link_id"> & Partial<Relative>,
): Relative {
  return { ...summary(person), kind: null, status: null, ...rest };
}

function parentView(row: PersonRow, words: Words): Relative {
  const { person, link } = row;
  const label = person.placeholder
    ? `${words.say(blood(1, 0, "unknown"), "parent")} (unknown)`
    : words.say(words.byKind(kindOf(link), genderOf(person), true), "parent");
  return relative(person, { label, link_id: link.id, kind: link.kind });
}

function spouseSort(row: PersonRow): Key {
  const divorced = row.link.status === "divorced";
  return [divorced ? 1 : 0, row.link.order || 99, row.person.full_name];
}

function spouseView(row: PersonRow, words: Words): Relative {
  const { person, link } = row;
  const status: SpouseStatus = link.status || "married";
  const label = words.say(
    { type: "spouse", gender: genderOf(person), former: status === "divorced" },
    "spouse",
  );
  return relative(person, { label, link_id: link.id, status });
}

/** The parents a sibling row shares with this person by birth, on both sides. */
function sharesBlood(row: SiblingRow, kinds: Kinds): Shared[] {
  return row.shared.filter((s) => isBlood(kinds, s.mine) && isBlood(kinds, s.theirs));
}

/** "Eldest son of Tok Ismail & Nenek Fatimah": birth order among the same parents. */
function siblingPosition(
  props: PersonRecord,
  birthParents: readonly PersonRow[],
  siblings: readonly SiblingRow[],
  kinds: Kinds,
): string | null {
  const mine = new Set(birthParents.map((row) => row.person.id));
  if (!mine.size) return null;
  const byBirth = siblings.filter((row) => sharesBlood(row, kinds).length);
  const family = [
    siblingOf(props),
    ...byBirth
      .filter((row) => sameSet(bloodParents(row.parents, kinds), mine))
      .map((row) => siblingOf(row.person)),
  ];
  const [ordered, decided] = orderSiblings(family);
  const gender = genderOf(props);
  // With one parent recorded, "only child of Rahman" would be wrong if Rahman has children
  // with someone else: then the position waits until the other parent is known.
  const othersChildren = byBirth.length > family.length - 1;
  const position =
    decided && !(mine.size < 2 && othersChildren)
      ? positionLabel(ordered, props.id)
      : (({ male: "son", female: "daughter" } as Record<string, string>)[gender] ?? "child");
  const names = birthParents.map((row) => displayName(row.person)).join(" & ");
  return `${cap(position)} of ${names}`;
}

const SIDES: Partial<Record<Gender, Side>> = { male: "paternal", female: "maternal" };

/** Brothers and sisters by birth in birth order, then half-siblings and siblings through
 *  adoption or fostering by birth year. A guardian's children aren't siblings. */
function siblingViews(
  props: PersonRecord,
  siblings: readonly SiblingRow[],
  birthParents: readonly PersonRow[],
  words: Words,
): Relative[] {
  const kinds = words.kinds;
  const mine = new Set(birthParents.map((row) => row.person.id));
  const parentGender = new Map(birthParents.map((row) => [row.person.id, genderOf(row.person)]));
  const me = siblingOf(props);
  const family = [
    me,
    ...siblings
      .filter((row) => mine.size && sameSet(bloodParents(row.parents, kinds), mine))
      .map((row) => siblingOf(row.person)),
  ];
  const [ordered] = orderSiblings(family);
  const rank = new Map(ordered.map((sibling, n) => [sibling.id, n]));

  const ranked: [Key, Relative][] = [];
  for (const row of siblings) {
    const person = row.person;
    const them = siblingOf(person);
    let order: number | null;
    let key: Key;
    if (rank.has(them.id)) {
      order = compareSiblings(me, them, family);
      key = [0, rank.get(them.id) as number, ""];
    } else {
      order = compareBirths(me.birth, them.birth);
      key = [1, person.birth_year || 9999, person.full_name];
    }
    const seniority = !order ? null : order < 0 ? "younger" : "elder";
    let kin: Kin;
    const shared = sharesBlood(row, kinds);
    if (shared.length) {
      const theirs = bloodParents(row.parents, kinds);
      // Half only when both have two recorded parents and share exactly one.
      const half = mine.size === 2 && theirs.size === 2 && shared.length === 1;
      const side = half
        ? (SIDES[parentGender.get((shared[0] as Shared).id) ?? "unknown"] ?? null)
        : null;
      kin = blood(1, 1, them.gender, { side, seniority, half });
    } else {
      const through = row.shared.find(
        (s) => makesFamily(kinds, s.mine) && makesFamily(kinds, s.theirs),
      );
      if (!through) continue; // e.g. the children of someone's guardian
      const kind = isBlood(kinds, through.mine) ? through.theirs : through.mine;
      kin = { type: "kindSibling", kind, gender: them.gender, seniority };
    }
    ranked.push([key, relative(person, { label: words.say(kin, "sibling"), link_id: null })]);
  }
  return sortedBy(ranked, ([key]) => key).map(([, view]) => view);
}

/** Children by birth, one group per other parent; then adopted, fostered and other
 *  children, one group per kind and co-parent. */
function childGroups(
  personId: string,
  children: readonly ChildRow[],
  personOf: (id: string) => PersonRecord | undefined,
  words: Words,
): ChildGroup[] {
  const kinds = words.kinds;
  const families = new Map<
    string,
    { kind: string | null; others: Set<string>; rows: ChildRow[] }
  >();
  for (const row of children) {
    const [kind, others] = familyKey(row, personId, kinds);
    const name = JSON.stringify([kind, [...others].sort()]);
    const family = families.get(name) ?? { kind, others, rows: [] };
    families.set(name, family);
    family.rows.push(row);
  }

  const groups: ChildGroup[] = [];
  for (const { kind: groupKind, others, rows } of families.values()) {
    const byId = new Map(rows.map((row) => [row.person.id, row]));
    const [ordered, decided] = orderSiblings(rows.map((row) => siblingOf(row.person)));
    const views = ordered.map((sibling) => {
      const { person, link } = byId.get(sibling.id) as ChildRow;
      const label = words.say(words.byKind(kindOf(link), sibling.gender, false), "child");
      return relative(person, { label, link_id: link.id, kind: kindOf(link) });
    });
    const otherParents = sortedBy(
      [...others]
        .sort()
        .map(personOf)
        .filter((person): person is PersonRecord => person !== undefined),
      (person) => GENDER_ORDER[genderOf(person)],
    );
    groups.push({
      kind: groupKind,
      other_parents: otherParents.map(summary),
      order_decided: decided,
      children: views,
    });
  }

  return sortedBy(groups, (group): Key => {
    const eldest = Math.min(9999, ...group.children.map((child) => child.birth_year || 9999));
    if (group.kind == null) return [0, 0, eldest];
    return [1, kinds.get(group.kind)?.sort_order ?? 0, eldest];
  });
}
