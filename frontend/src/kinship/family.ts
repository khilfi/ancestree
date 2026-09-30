/**
 * The family as the relationship finder sees it: people, parent links and marriages
 * (backend/src/ancestree/kinship/family.py), built from a copy's graph.
 */
import type {
  Gender,
  GraphLink,
  GraphPerson,
  KindView,
  PartialDate,
  SpouseStatus,
} from "@/api/types";
import { casefold, compareText, type Key, sortedBy } from "./compare";
import type { Sibling } from "./order";

export const BIOLOGICAL = "biological";

/** What the finder reads of the graph's people and links, and of the kinds. */
export type TwinPerson = Pick<
  GraphPerson,
  | "id"
  | "full_name"
  | "nickname"
  | "gender"
  | "born"
  | "birth_order"
  | "placeholder"
  | "photo_version"
>;
export type TwinLink = Pick<GraphLink, "id" | "type" | "source" | "target" | "kind" | "status">;
export type TwinKind = Pick<
  KindView,
  "key" | "label" | "blood" | "in_layout" | "parent_label" | "child_label" | "words"
>;

const PATRONYMIC = new Set(["bin", "binti", "bte", "bt"]);

/** How answers name someone: "Tok Ismail" by their nickname, "Hassan" for Hassan bin Ismail. */
export function shortName(fullName: string, nickname?: string | null): string {
  if (nickname) return nickname;
  const words = fullName.split(/\s+/).filter(Boolean);
  const cut = words.findIndex((word, index) => index > 0 && PATRONYMIC.has(casefold(word)));
  return cut > 0 ? words.slice(0, cut).join(" ") : fullName;
}

export type Member = {
  id: string;
  name: string; // as answers say it: "Siti", "Tok Ismail"
  gender: Gender;
  birth: PartialDate | null;
  birthOrder: number | null;
  placeholder: boolean; // an unknown parent
};

export type ParentLink = { id: string; parent: string; child: string; kind: string };
export type Marriage = { id: string; a: string; b: string; status: SpouseStatus };

export function other(marriage: Marriage, person: string): string {
  return person === marriage.a ? marriage.b : marriage.a;
}

export function asSibling(member: Member): Sibling {
  return {
    id: member.id,
    gender: member.gender,
    birth: member.birth,
    birthOrder: member.birthOrder,
    tiebreak: member.name,
  };
}

const NONE: readonly never[] = [];

/** Everyone and every link, indexed both ways. Links to people who aren't here, or of kinds
 *  that don't exist, are ignored rather than trusted. */
export class Family {
  readonly members = new Map<string, Member>();
  readonly kinds: Map<string, TwinKind>;
  private readonly ups = new Map<string, ParentLink[]>();
  private readonly downs = new Map<string, ParentLink[]>();
  private readonly weds = new Map<string, Marriage[]>();
  private readonly keys = new Map<string, Key>();

  constructor(
    members: Iterable<Member>,
    parentLinks: Iterable<ParentLink>,
    marriages: Iterable<Marriage>,
    kinds: Iterable<TwinKind>,
  ) {
    for (const member of members) this.members.set(member.id, member);
    this.kinds = new Map(Array.from(kinds, (kind) => [kind.key, kind]));
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    for (const link of parentLinks) {
      if (
        this.members.has(link.parent) &&
        this.members.has(link.child) &&
        this.kinds.has(link.kind)
      ) {
        add(this.ups, link.child, link);
        add(this.downs, link.parent, link);
      }
    }
    for (const marriage of marriages) {
      if (this.members.has(marriage.a) && this.members.has(marriage.b)) {
        add(this.weds, marriage.a, marriage);
        add(this.weds, marriage.b, marriage);
      }
    }
    // Fathers before mothers, then by name: answers and paths come out the same every time.
    for (const [person, links] of this.ups) {
      this.ups.set(
        person,
        sortedBy(links, (link) => this.orderKey(link.parent)),
      );
    }
    for (const [person, links] of this.downs) {
      this.downs.set(
        person,
        sortedBy(links, (link) => this.orderKey(link.child)),
      );
    }
  }

  /** A family built from a copy's graph, as the backend builds it from the database's rows. */
  static fromGraph(
    people: Iterable<TwinPerson>,
    links: Iterable<TwinLink>,
    kinds: Iterable<TwinKind>,
  ): Family {
    const everyone = Array.from(people, (person) => ({
      id: person.id,
      name: person.placeholder ? "an unknown parent" : shortName(person.full_name, person.nickname),
      gender: person.gender || "unknown",
      birth: person.born ?? null,
      birthOrder: person.birth_order ?? null,
      placeholder: !!person.placeholder,
    }));
    const all = Array.from(links);
    return new Family(
      everyone,
      all
        .filter((link) => link.type === "parent")
        .map((link) => ({
          id: link.id,
          parent: link.source,
          child: link.target,
          kind: link.kind || BIOLOGICAL,
        })),
      all
        .filter((link) => link.type === "spouse")
        .map((link) => ({
          id: link.id,
          a: link.source,
          b: link.target,
          status: link.status || "married",
        })),
      kinds,
    );
  }

  up(person: string): readonly ParentLink[] {
    return this.ups.get(person) ?? NONE;
  }

  down(person: string): readonly ParentLink[] {
    return this.downs.get(person) ?? NONE;
  }

  wed(person: string): readonly Marriage[] {
    return this.weds.get(person) ?? NONE;
  }

  member(person: string): Member {
    const member = this.members.get(person);
    if (!member) throw new Error(`No one with id ${person} in the family`);
    return member;
  }

  orderKey(person: string): Key {
    let key = this.keys.get(person);
    if (!key) {
      const member = this.member(person);
      const rank = member.gender === "male" ? 0 : member.gender === "female" ? 1 : 2;
      key = [rank, casefold(member.name), member.id];
      this.keys.set(person, key);
    }
    return key;
  }

  gender(person: string): Gender {
    return this.member(person).gender;
  }

  isBlood(kind: string | null | undefined): boolean {
    return this.kinds.get(kind ?? "")?.blood === true;
  }

  /** Kinds placed on the rings (adoptive, foster) make brothers and sisters. */
  makesFamily(kind: string | null | undefined): boolean {
    return this.kinds.get(kind ?? "")?.in_layout === true;
  }

  bloodParents(person: string): string[] {
    return this.up(person)
      .filter((link) => this.isBlood(link.kind))
      .map((link) => link.parent);
  }

  bloodChildren(person: string): string[] {
    return this.down(person)
      .filter((link) => this.isBlood(link.kind))
      .map((link) => link.child);
  }

  /** The id of the birth link from a parent to their child. */
  bloodLink(parent: string, child: string): string {
    const link = this.up(child).find((l) => l.parent === parent && this.isBlood(l.kind));
    if (!link) throw new Error(`No birth link from ${parent} to ${child}`);
    return link.id;
  }

  /** Parents of any kind: birth, adoptive, foster, guardian… */
  parents(person: string): Set<string> {
    return new Set(this.up(person).map((link) => link.parent));
  }

  children(person: string): Set<string> {
    return new Set(this.down(person).map((link) => link.child));
  }

  marriage(a: string, b: string): Marriage | undefined {
    return this.wed(a).find((marriage) => other(marriage, a) === b);
  }

  /** The children of exactly the same birth parents, this person included: the family that
   *  birth order counts within. */
  fullSiblings(person: string): Member[] {
    const mine = new Set(this.bloodParents(person));
    if (!mine.size) return [this.member(person)];
    const candidates = new Set<string>();
    for (const parent of mine)
      for (const child of this.bloodChildren(parent)) candidates.add(child);
    const same = (theirs: Set<string>) =>
      theirs.size === mine.size && [...theirs].every((parent) => mine.has(parent));
    return [...candidates]
      .sort(compareText)
      .filter((child) => same(new Set(this.bloodParents(child))))
      .map((child) => this.member(child));
  }
}
