/**
 * The family in a copy to edit, as it changes: everyone and every link, and drafts. A
 * change is worked out on a draft and then committed as a whole, or dropped: as a change in
 * the app is one database transaction, so a link the rules refuse means nobody is created.
 */
import type { LinkRecord, PersonRecord } from "./family";

export type State = { people: Map<string, PersonRecord>; links: Map<string, LinkRecord> };

/** Before and after, for Undo: null where the person or link wasn't there. */
export type Images<T> = Map<string, [T | null, T | null]>;

export function stateOf(people: readonly PersonRecord[], links: readonly LinkRecord[]): State {
  return {
    people: new Map(people.map((person) => [person.id, person])),
    links: new Map(links.map((link) => [link.id, link])),
  };
}

/** A new id, time-ordered like the app's (uuid7). */
export function newId(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let index = 0; index < 6; index++) {
    bytes[index] = Math.floor(now / 2 ** (8 * (5 - index))) % 256;
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Now, as the app writes a moment. */
export function stamp(now = new Date()): string {
  return now.toISOString();
}

export class Draft {
  private readonly people = new Map<string, PersonRecord | null>();
  private readonly links = new Map<string, LinkRecord | null>();

  constructor(readonly base: State) {}

  person(id: string): PersonRecord | undefined {
    return this.people.has(id) ? (this.people.get(id) ?? undefined) : this.base.people.get(id);
  }

  link(id: string): LinkRecord | undefined {
    return this.links.has(id) ? (this.links.get(id) ?? undefined) : this.base.links.get(id);
  }

  everyone(): PersonRecord[] {
    const found: PersonRecord[] = [];
    for (const [id, person] of this.base.people) {
      const now = this.people.has(id) ? this.people.get(id) : person;
      if (now) found.push(now);
    }
    for (const [id, person] of this.people)
      if (person && !this.base.people.has(id)) found.push(person);
    return found;
  }

  allLinks(): LinkRecord[] {
    const found: LinkRecord[] = [];
    for (const [id, link] of this.base.links) {
      const now = this.links.has(id) ? this.links.get(id) : link;
      if (now) found.push(now);
    }
    for (const [id, link] of this.links) if (link && !this.base.links.has(id)) found.push(link);
    return found;
  }

  putPerson(person: PersonRecord): void {
    this.people.set(person.id, person);
  }

  dropPerson(id: string): void {
    this.people.set(id, null);
  }

  putLink(link: LinkRecord): void {
    this.links.set(link.id, link);
  }

  dropLink(id: string): void {
    this.links.set(id, null);
  }

  // --- The questions the rules ask (repo/links.py) --------------------------------------------

  linksOf(person: string): LinkRecord[] {
    return this.allLinks().filter((link) => link.source === person || link.target === person);
  }

  linksBetween(a: string, b: string): LinkRecord[] {
    return this.allLinks().filter(
      (link) =>
        (link.source === a && link.target === b) || (link.source === b && link.target === a),
    );
  }

  /** Parent id -> the kind of that parent link. */
  parentIds(person: string): Map<string, string | null> {
    const found = new Map<string, string | null>();
    for (const link of this.allLinks()) {
      if (link.type === "parent" && link.target === person) found.set(link.source, link.kind);
    }
    return found;
  }

  /** Whether `ancestor` is a parent, grandparent… of `descendant`, by links of any kind. */
  isAncestor(ancestor: string, descendant: string): boolean {
    const children = new Map<string, string[]>();
    for (const link of this.allLinks()) {
      if (link.type !== "parent") continue;
      const list = children.get(link.source) ?? [];
      children.set(link.source, list);
      list.push(link.target);
    }
    const seen = new Set<string>();
    const queue = [...(children.get(ancestor) ?? [])];
    while (queue.length) {
      const person = queue.shift() as string;
      if (person === descendant) return true;
      if (seen.has(person)) continue;
      seen.add(person);
      queue.push(...(children.get(person) ?? []));
    }
    return false;
  }

  /** What changed, for Undo. */
  images(): { people: Images<PersonRecord>; links: Images<LinkRecord> } {
    const people: Images<PersonRecord> = new Map();
    for (const [id, after] of this.people) {
      const before = this.base.people.get(id) ?? null;
      if (before !== after) people.set(id, [before, after]);
    }
    const links: Images<LinkRecord> = new Map();
    for (const [id, after] of this.links) {
      const before = this.base.links.get(id) ?? null;
      if (before !== after) links.set(id, [before, after]);
    }
    return { people, links };
  }

  /** Write the draft into the family. */
  commit(): void {
    for (const [id, person] of this.people) {
      if (person) this.base.people.set(id, person);
      else this.base.people.delete(id);
    }
    for (const [id, link] of this.links) {
      if (link) this.base.links.set(id, link);
      else this.base.links.delete(id);
    }
  }
}
