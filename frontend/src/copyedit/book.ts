/**
 * The family in a copy to edit: what it carries, as it changes,
 * and everything the app would answer about it. The tree, its seats and each person's view are
 * worked out by the twins of the app's Python (graph.ts, seating.ts, detail.ts); changes go
 * through the app's rules (rules.ts), each one Undo step (history.ts), as in the app.
 *
 * Photos and life stories, as in the app, aren't Undo steps. The Trash keeps whoever was moved
 * to it, with their links, story and photo, until the copy is closed or they're brought back.
 */
import { personFiles } from "@/api/addresses";
import type {
  Biography,
  BiographyUpdate,
  FamilyMap,
  FillIn,
  Graph,
  HistoryMove,
  HistoryView,
  KindView,
  Located,
  MapPerson,
  NewRelative,
  Notice,
  PersonDetail,
  PersonPatch,
  PersonSaved,
  PersonSummary,
  PictureAdded,
  Place,
  Position,
  RelationshipCreate,
  RelationshipResult,
  RelationshipUpdate,
  RelativeAdded,
  RestoreResult,
  TrashEntry,
} from "@/api/types";
import { TermBook, type Book as Words } from "@/kinship/terms";
import { KinshipTwin, type TwinInputs } from "@/kinship/twin";
import { type DetailKind, FamilyRows, summary } from "./detail";
import { type CopyFamily, type LinkRecord, type PersonRecord, placeFrom } from "./family";
import { buildGraph, type InLayout } from "./graph";
import { CantUndo, changedKeys, History, type Step, step } from "./history";
import { type Crop, makePhoto, makePicture, PhotoProblem, validCrop } from "./photos";
import {
  addLinked,
  childrenOf,
  connect,
  factsOf,
  Invalid,
  type Kinds,
  type Linked,
  lifeNotices,
  namesakeNotices,
  namesakesOf,
  newPerson,
  notFound,
  nothingLinked,
  orderChildren,
  type PersonFields,
  parentChildNotices,
  Refusal,
  readPerson,
  refuse,
  removeLink,
  takeOut,
  updateLink,
  withProps,
} from "./rules";
import { Draft, newId, type State, stamp, stateOf } from "./state";
import { biographyFrom, joinSources, NO_STORY } from "./stories";

export const TRASH_DAYS = 30;

/** Someone in the copy's Trash: everything they took with them. */
export type TrashItem = {
  entry: string;
  deleted_at: string;
  person: PersonRecord;
  links: LinkRecord[];
  story: Biography | null;
  files: Record<string, string>;
  photo: { display: string; crop: Crop } | null;
};

/** Everything a copy to edit keeps of its family, as saved into a file or the browser. */
export type BookContents = {
  family: CopyFamily;
  stories: Record<string, Biography>;
  files: Record<string, string>;
  photos: Record<string, { display: string; crop: Crop }>;
  trash: TrashItem[];
};

/** What the book reads from the copy it opens, besides what it can change. */
export type BookInputs = {
  kinds: KindView[];
  kinship: TwinInputs;
  map: FamilyMap;
  places: Record<string, Located> | undefined; // states and countries, for new places
  hidden: string[]; // people whose details the copy hides
};

type Language = "en" | "ms" | "jv";

const avatar = personFiles.avatar;
const ownFiles = (id: string) => (address: string) => address.startsWith(personFiles.all(id));

function placeKey(place: Place | null | undefined): string {
  if (!place) return "";
  return [place.town, place.state, place.country]
    .map((part) => (part ?? "").trim().toLowerCase())
    .join("|");
}

export class Book {
  readonly state: State;
  readonly stories: Map<string, Biography>;
  readonly files: Map<string, string>;
  readonly photos: Map<string, { display: string; crop: Crop }>;
  trash: TrashItem[];
  readonly history = new History();
  private start: string; // the family as the file holds it, to count changes against
  private readonly kindList: KindView[];
  private readonly kinds: Kinds;
  private readonly detailKinds: ReadonlyMap<string, DetailKind>;
  private readonly inLayout: InLayout;
  private readonly books: Map<string, TermBook>;
  private readonly hidden: Set<string>;
  private readonly known = new Map<string, Located>();
  private version = 0;
  private cache = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();

  constructor(
    contents: BookContents,
    private readonly inputs: BookInputs,
    private readonly language: () => Language,
    started: BookContents = contents,
  ) {
    this.state = stateOf(contents.family.people, contents.family.links);
    this.stories = new Map(Object.entries(contents.stories));
    this.files = new Map(Object.entries(contents.files));
    this.photos = new Map(Object.entries(contents.photos));
    this.trash = [...contents.trash];
    this.start = JSON.stringify(Book.fingerprints(started));
    this.kindList = inputs.kinds;
    this.kinds = new Map(inputs.kinds.map((kind) => [kind.key, kind]));
    this.detailKinds = new Map(inputs.kinds.map((kind) => [kind.key, kind as DetailKind]));
    this.inLayout = new Map(inputs.kinds.map((kind) => [kind.key, kind.in_layout]));
    this.books = new Map(
      Object.entries(inputs.kinship.books).map(([code, book]) => [
        code,
        new TermBook(book as Words),
      ]),
    );
    this.hidden = new Set(inputs.hidden);
    for (const person of inputs.map.people) {
      for (const located of [person.lives, person.born]) {
        if (located) this.known.set(placeKey(located.place), located);
      }
    }
  }

  // --- Keeping track --------------------------------------------------------------------------

  /** Called after every change: to keep it in the browser and show the count. */
  listen(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    this.version += 1;
    this.cache = new Map();
    for (const listener of this.listeners) listener();
  }

  private cached<T>(key: string, make: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key) as T;
  }

  contents(): BookContents {
    return {
      family: { people: [...this.state.people.values()], links: [...this.state.links.values()] },
      stories: Object.fromEntries(this.stories),
      files: Object.fromEntries(this.files),
      photos: Object.fromEntries(this.photos),
      trash: this.trash,
    };
  }

  /** Whether two contents hold the same family: the same people, links and stories. */
  static same(one: BookContents, other: BookContents): boolean {
    const [a, b] = [Book.fingerprints(one), Book.fingerprints(other)];
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
  }

  /** What each person, link, story and photo is: for counting changes. Positions and the
   *  time of each change aside: they aren't the family. */
  private static fingerprints(contents: BookContents): Record<string, string> {
    const found: Record<string, string> = {};
    for (const person of contents.family.people) {
      const { updated_at: _updated, layout_x: _x, layout_y: _y, ...rest } = person;
      found[`person:${person.id}`] = JSON.stringify(rest);
    }
    for (const link of contents.family.links) found[`link:${link.id}`] = JSON.stringify(link);
    for (const [id, story] of Object.entries(contents.stories)) {
      found[`story:${id}`] = joinSources(story.story, story.sources);
    }
    return found;
  }

  /** How many people, links and stories differ from the file as it was opened or last saved. */
  changes(): number {
    return this.cached("changes", () => {
      const then = JSON.parse(this.start) as Record<string, string>;
      const now = Book.fingerprints(this.contents());
      let count = 0;
      for (const key of new Set([...Object.keys(then), ...Object.keys(now)])) {
        if (then[key] !== now[key]) count += 1;
      }
      return count;
    });
  }

  /** From now on, count changes against what's just been saved. */
  saved(contents: BookContents): void {
    this.start = JSON.stringify(Book.fingerprints(contents));
    this.changed();
  }

  // --- Reading ------------------------------------------------------------------------------

  private thisYear(): number {
    return new Date().getFullYear();
  }

  private rows(): FamilyRows {
    return this.cached(
      "rows",
      () => new FamilyRows([...this.state.people.values()], [...this.state.links.values()]),
    );
  }

  private family(): CopyFamily {
    return { people: [...this.state.people.values()], links: [...this.state.links.values()] };
  }

  graph(centre: string | null): Graph {
    return this.cached(`graph:${centre ?? ""}`, () =>
      buildGraph(this.family(), this.inLayout, centre, this.thisYear()),
    );
  }

  has(id: string): boolean {
    return this.state.people.has(id);
  }

  person(id: string): PersonRecord | undefined {
    return this.state.people.get(id);
  }

  detail(id: string, language: Language = this.language()): PersonDetail | null {
    if (!this.state.people.has(id)) return null;
    return this.cached(`detail:${id}:${language}`, () => {
      const english = this.books.get("en") as TermBook;
      const book = this.books.get(language) ?? english;
      return this.rows().detail(id, this.detailKinds, book, english, this.thisYear());
    });
  }

  private mustDetail(id: string): PersonDetail {
    const found = this.detail(id);
    if (!found) throw notFound("That person isn't in the tree.");
    return found;
  }

  search(): PersonSummary[] {
    return this.cached("search", () =>
      [...this.state.people.values()].filter((person) => !person.placeholder).map(summary),
    );
  }

  twin(): KinshipTwin {
    return this.cached("twin", () => {
      const { people, links } = this.graph(null);
      return new KinshipTwin(people, links, this.kindList, this.inputs.kinship);
    });
  }

  story(id: string): Biography {
    return this.stories.get(id) ?? NO_STORY;
  }

  /** Where everyone lives and was born: as found when the copy was made, and a new place by
   *  its state or country until the copy is back in the app, which finds its town. */
  map(): FamilyMap {
    return this.cached("map", () => {
      const people: MapPerson[] = [];
      for (const person of this.state.people.values()) {
        if (person.placeholder) continue;
        people.push({
          id: person.id,
          lives: this.locate(placeFrom(person, "residence")),
          born: this.locate(placeFrom(person, "birth")),
        });
      }
      return { people, pins: [] };
    });
  }

  private locate(place: Place | null): Located | null {
    if (!place) return null;
    const known = this.known.get(placeKey(place));
    if (known) return { ...known, place };
    // As the app reads a state's or country's name (places/names.py): spaces and case aside.
    const places = this.inputs.places ?? {};
    const named = (text: string) => text.trim().split(/\s+/).join(" ").toLowerCase();
    const rough =
      (place.state ? places[`state:${named(place.state)}`] : undefined) ??
      places[`country:${named(place.country || "Malaysia")}`];
    if (rough) return { ...rough, place };
    return {
      place,
      lat: null,
      lon: null,
      found: null,
      name: null,
      state: place.state ?? null,
      country: place.country,
    };
  }

  trashList(): TrashEntry[] {
    return this.trash.map((item) => ({
      entry: item.entry,
      person_id: item.person.id,
      full_name: item.person.full_name,
      deleted_at: item.deleted_at,
      restore_until: new Date(Date.parse(item.deleted_at) + TRASH_DAYS * 86_400_000).toISOString(),
      link_count: item.links.length,
    }));
  }

  historyView(): HistoryView {
    return this.history.view();
  }

  // --- Changing the family: each one Undo step ------------------------------------------------

  /** Work out a change on a draft; commit it as one step, or drop it if refused. */
  private change<T>(
    label: (draft: Draft, result: T) => string,
    work: (draft: Draft, now: string) => T,
  ): T {
    const draft = new Draft(this.state);
    const result = work(draft, stamp());
    const images = draft.images();
    const name = label(draft, result);
    draft.commit();
    this.history.push(step(name, images.people, images.links));
    this.changed();
    return result;
  }

  private mustPerson(draft: Draft, id: string): PersonRecord {
    const found = draft.person(id);
    if (!found) throw notFound("That person isn't in the tree.");
    return found;
  }

  private notHidden(person: PersonRecord): void {
    if (this.hidden.has(person.id)) {
      throw refuse(
        "hidden",
        `${person.full_name}'s details are hidden in this copy, so they can't be changed here.`,
      );
    }
  }

  /** "Saved" notices (people.py _save): an unlikely age, gap or name, from the view. */
  private savedNotices(detail: PersonDetail): Notice[] {
    const me = {
      name: detail.full_name,
      gender: detail.gender,
      birth: detail.birth_date?.value.year ?? null,
      death: detail.death_date?.value.year ?? null,
    };
    const notices = lifeNotices(me);
    const blood = (kind: string | null | undefined) => this.kinds.get(kind ?? "")?.blood === true;
    const facts = (someone: PersonSummary) => ({
      name: someone.full_name,
      gender: someone.gender,
      birth: someone.birth_year,
      death: someone.death_year,
    });
    for (const parent of detail.parents) {
      if (!parent.placeholder)
        notices.push(...parentChildNotices(facts(parent), me, blood(parent.kind)));
    }
    for (const group of detail.child_groups) {
      for (const child of group.children)
        notices.push(...parentChildNotices(me, facts(child), blood(child.kind)));
    }
    return notices;
  }

  createPerson(input: PersonFields): PersonSaved {
    const { props, birth } = readPerson(input);
    const found = this.change(
      () => `Add ${props.full_name}`,
      (draft, now) => {
        const namesakes = namesakesOf(draft, props.full_name);
        const person = newPerson(props, now);
        draft.putPerson(person);
        return { id: person.id, namesakes };
      },
    );
    const detail = this.mustDetail(found.id);
    return {
      person: detail,
      notices: [
        ...lifeNotices(factsOf(this.person(found.id) as PersonRecord)),
        ...namesakeNotices(birth, found.namesakes),
      ],
    };
  }

  updatePerson(id: string, input: PersonFields): PersonSaved {
    const { props } = readPerson(input);
    this.change(
      () => `Edit ${props.full_name}`,
      (draft, now) => {
        const person = this.mustPerson(draft, id);
        this.notHidden(person);
        draft.putPerson(withProps(person, { ...props, updated_at: now }));
      },
    );
    const detail = this.mustDetail(id);
    return { person: detail, notices: this.savedNotices(detail) };
  }

  patchPerson(id: string, patch: PersonPatch): PersonSaved {
    const given = Object.keys(patch).filter(
      (key) => key !== "gender" || (patch as Record<string, unknown>).gender != null,
    ) as (keyof PersonPatch)[];
    if (!given.length) {
      throw refuse("nothing_to_change", "Give a gender, a date of birth or a place to change.");
    }
    const what: Record<string, string> = {
      gender: "gender",
      birth_date: "date of birth",
      residence: "place they live",
      birth_place: "birthplace",
    };
    this.change(
      (draft) => {
        const name = this.mustPerson(draft, id).full_name;
        return `Set ${name}'s ${given.length === 1 ? what[given[0] as string] : "details"}`;
      },
      (draft, now) => {
        const person = this.mustPerson(draft, id);
        this.notHidden(person);
        const fields: PersonFields = { full_name: person.full_name };
        if (given.includes("birth_date"))
          fields.birth_date = patch.birth_date as PersonFields["birth_date"];
        if (given.includes("residence")) fields.residence = patch.residence;
        if (given.includes("birth_place")) fields.birth_place = patch.birth_place;
        const { props } = readPerson(fields);
        const changes: Partial<PersonRecord> = { updated_at: now };
        if (patch.gender != null) changes.gender = patch.gender;
        const all = props as unknown as Record<string, unknown>;
        const pick = (prefix: string) => {
          for (const [key, value] of Object.entries(all)) {
            if (key.startsWith(prefix)) (changes as Record<string, unknown>)[key] = value;
          }
        };
        if (given.includes("birth_date")) {
          for (const part of ["year", "month", "day", "qualifier", "year_to", "original_text"]) {
            (changes as Record<string, unknown>)[`birth_${part}`] = all[`birth_${part}`];
          }
        }
        if (given.includes("residence")) pick("residence_");
        if (given.includes("birth_place")) {
          for (const part of ["town", "state", "country"]) {
            (changes as Record<string, unknown>)[`birth_${part}`] = all[`birth_${part}`];
          }
        }
        draft.putPerson(withProps(person, changes));
      },
    );
    const detail = this.mustDetail(id);
    return { person: detail, notices: this.savedNotices(detail) };
  }

  addRelative(id: string, request: NewRelative): RelativeAdded {
    const { props, birth } = readPerson(request.person as PersonFields);
    const made = this.change(
      () => `Add ${props.full_name}`,
      (draft, now) => {
        this.mustPerson(draft, id);
        const namesakes = namesakesOf(draft, props.full_name);
        const person = newPerson(props, now);
        draft.putPerson(person);
        let shared: string[] | null = null;
        if (request.relation === "sibling") {
          const parents = [...draft.parentIds(id)].filter(
            ([, kind]) => this.kinds.get(kind ?? "")?.blood,
          );
          shared = parents.length ? parents.map(([parent]) => parent) : null;
        }
        const kind = request.kind ?? "biological";
        const linked = connect(
          draft,
          this.kinds,
          now,
          person.id,
          id,
          request.relation,
          kind,
          "married",
          shared,
        );
        if (request.relation === "child" && request.other_parent) {
          addLinked(
            linked,
            connect(draft, this.kinds, now, person.id, request.other_parent, "child", kind),
          );
        }
        return { id: person.id, namesakes, linked };
      },
    );
    return {
      person: this.mustDetail(made.id),
      notices: [...namesakeNotices(birth, made.namesakes), ...made.linked.notices],
      suggestions: made.linked.suggestions,
    };
  }

  fillIn(id: string, request: FillIn): RelativeAdded {
    const newcomer = request.person ? readPerson(request.person as PersonFields) : null;
    type Filled = { parent: string; namesakes: PersonRecord[]; linked: Linked };
    const made = this.change<Filled>(
      (draft, result) => `Fill in ${this.mustPerson(draft, result.parent).full_name} as a parent`,
      (draft, now) => {
        const unknown = this.mustPerson(draft, id);
        if (!unknown.placeholder) {
          throw refuse("not_unknown", "Only an unknown parent can be filled in.");
        }
        const children = childrenOf(draft, id);
        let namesakes: PersonRecord[] = [];
        let parent: string;
        if (newcomer) {
          namesakes = namesakesOf(draft, newcomer.props.full_name);
          const person = newPerson(newcomer.props, now);
          draft.putPerson(person);
          parent = person.id;
        } else {
          parent = String(request.existing);
          this.mustPerson(draft, parent);
        }
        takeOut(draft, id); // its links go with it
        const linked = nothingLinked();
        for (const child of children) {
          addLinked(linked, connect(draft, this.kinds, now, parent, child, "parent"));
        }
        return { parent, namesakes, linked };
      },
    );
    const notices = newcomer ? namesakeNotices(newcomer.birth, made.namesakes) : [];
    return {
      person: this.mustDetail(made.parent),
      notices: [...notices, ...made.linked.notices],
      suggestions: made.linked.suggestions,
    };
  }

  orderChildren(id: string, childIds: string[]): PersonDetail {
    this.change(
      (draft) => `Order ${this.mustPerson(draft, id).full_name}'s children`,
      (draft) => orderChildren(draft, this.kinds, id, childIds),
    );
    return this.mustDetail(id);
  }

  link(request: RelationshipCreate): RelationshipResult {
    const [a, b] = [request.person_a, request.person_b];
    const names = [a, b].map((someone) => this.person(someone)?.full_name ?? "someone");
    return this.change(
      () => `Link ${names[0]} and ${names[1]}`,
      (draft, now) =>
        connect(
          draft,
          this.kinds,
          now,
          a,
          b,
          request.a_is,
          request.kind ?? "biological",
          request.status ?? "married",
          request.shared_parents ?? null,
        ),
    );
  }

  private between(linkId: string): string {
    const link = this.state.links.get(linkId);
    const name = (someone: string | undefined) =>
      (someone && this.person(someone)?.full_name) || "someone";
    return `${name(link?.source)} and ${name(link?.target)}`;
  }

  updateLink(linkId: string, request: RelationshipUpdate): RelationshipResult {
    const between = this.between(linkId);
    return this.change(
      () => `Change the link between ${between}`,
      (draft) => updateLink(draft, this.kinds, linkId, request),
    );
  }

  unlink(linkId: string): void {
    const between = this.between(linkId);
    this.change(
      () => `Remove the link between ${between}`,
      (draft) => removeLink(draft, linkId),
    );
  }

  savePositions(positions: Position[]): void {
    const first = positions[0] ? (this.person(positions[0].id)?.full_name ?? "someone") : "";
    this.change(
      () => (positions.length === 1 ? `Move ${first}` : `Move ${positions.length} people`),
      (draft) => {
        for (const position of positions) {
          const person = draft.person(position.id);
          if (person)
            draft.putPerson(withProps(person, { layout_x: position.x, layout_y: position.y }));
        }
      },
    );
  }

  clearPositions(): void {
    this.change(
      () => "Rearrange",
      (draft) => {
        for (const person of draft.everyone()) {
          if (person.layout_x != null || person.layout_y != null) {
            draft.putPerson(withProps(person, { layout_x: null, layout_y: null }));
          }
        }
      },
    );
  }

  // --- The Trash ------------------------------------------------------------------------------

  private moveToTrash(id: string): TrashItem {
    const draft = new Draft(this.state);
    const person = this.mustPerson(draft, id);
    const links = takeOut(draft, id);
    const files: Record<string, string> = {};
    for (const [address, data] of this.files) {
      if (ownFiles(id)(address)) {
        files[address] = data;
        this.files.delete(address);
      }
    }
    const item: TrashItem = {
      entry: `${stamp().slice(0, 19).replaceAll(":", "-")}_${id}`,
      deleted_at: stamp(),
      person,
      links,
      story: this.stories.get(id) ?? null,
      files,
      photo: this.photos.get(id) ?? null,
    };
    this.stories.delete(id);
    this.photos.delete(id);
    draft.commit();
    this.trash.unshift(item);
    return item;
  }

  private bringBack(entry: string): { item: TrashItem; restored: number; skipped: number } {
    const item = this.trash.find((someone) => someone.entry === entry);
    if (!item) throw notFound("That isn't in the Trash.");
    if (this.state.people.has(item.person.id)) {
      throw refuse("already_restored", `${item.person.full_name} is already in the tree.`);
    }
    const draft = new Draft(this.state);
    draft.putPerson(withProps(item.person, { updated_at: stamp() }));
    let restored = 0;
    let skipped = 0;
    for (const link of item.links) {
      const other = link.source === item.person.id ? link.target : link.source;
      const gone = !draft.person(other);
      if (gone || (link.type === "parent" && !this.kinds.has(link.kind ?? ""))) skipped += 1;
      else {
        draft.putLink(link);
        restored += 1;
      }
    }
    draft.commit();
    for (const [address, data] of Object.entries(item.files)) this.files.set(address, data);
    if (item.story) this.stories.set(item.person.id, item.story);
    if (item.photo) this.photos.set(item.person.id, item.photo);
    this.trash = this.trash.filter((someone) => someone !== item);
    return { item, restored, skipped };
  }

  private entryEntryFor(id: string): TrashEntry {
    return this.trashList().find((entry) => entry.person_id === id) as TrashEntry;
  }

  deletePerson(id: string): TrashEntry {
    const item = this.moveToTrash(id);
    this.history.push(
      step(`Move ${item.person.full_name} to the Trash`, new Map(), new Map(), {
        direction: "out",
        person: id,
      }),
    );
    this.changed();
    return this.entryEntryFor(id);
  }

  restore(entry: string): RestoreResult {
    const { item, restored, skipped } = this.bringBack(entry);
    this.history.push(
      step(`Restore ${item.person.full_name}`, new Map(), new Map(), {
        direction: "in",
        person: item.person.id,
      }),
    );
    this.changed();
    return {
      person: this.mustDetail(item.person.id),
      restored_links: restored,
      skipped_links: skipped,
    };
  }

  // --- Undo and Redo ----------------------------------------------------------------------------

  move(forward: boolean, expect: string | null): HistoryMove {
    const next = this.history.next(forward, expect);
    try {
      this.apply(next, forward);
    } catch (error) {
      if (error instanceof CantUndo) this.history.clear();
      this.changed();
      throw error;
    }
    const done = this.history.moved(forward);
    this.changed();
    return { done: { id: done.id, label: done.label, at: done.at }, history: this.history.view() };
  }

  private apply(taken: Step, forward: boolean): void {
    if (taken.trash) {
      const { direction, person } = taken.trash;
      if ((direction === "out") !== forward) {
        const item = this.trash.find((someone) => someone.person.id === person);
        if (!item) throw new CantUndo("they're no longer in the Trash");
        try {
          this.bringBack(item.entry);
        } catch (error) {
          if (error instanceof Refusal) throw new CantUndo("the Trash has changed since");
          throw error;
        }
      } else {
        if (!this.state.people.has(person)) throw new CantUndo("they have changed since");
        this.moveToTrash(person);
      }
      return;
    }
    // Everything the step touched must still be as it left it.
    const draft = new Draft(this.state);
    for (const [id, [before, after]] of taken.people) {
      const [now, wanted] = forward ? [before, after] : [after, before];
      const current = draft.person(id) ?? null;
      const keys = changedKeys(before, after);
      const same =
        (now === null) === (current === null) &&
        (!now ||
          !current ||
          keys.every(
            (key) =>
              JSON.stringify(current[key as keyof PersonRecord]) ===
              JSON.stringify(now[key as keyof PersonRecord]),
          ));
      if (!same)
        throw new CantUndo(`${(after ?? before)?.full_name ?? "someone"} has changed since`);
      if (wanted === null && current) {
        if (current.has_photo || this.stories.has(id)) {
          throw new CantUndo(`${current.full_name} has a photo or a story now`);
        }
      }
    }
    for (const [id, [before, after]] of taken.links) {
      const [now] = forward ? [before, after] : [after, before];
      const current = draft.link(id) ?? null;
      if (JSON.stringify(current) !== JSON.stringify(now)) {
        throw new CantUndo("a link it changed has been changed again since");
      }
    }
    const going = [...taken.people]
      .filter(([, images]) => (forward ? images[1] : images[0]) === null)
      .map(([id]) => id);
    for (const id of going) {
      const others = draft.linksOf(id).filter((link) => !taken.links.has(link.id));
      if (others.length) throw new CantUndo("someone it added has been linked to others since");
    }
    for (const [id, [before, after]] of taken.links) {
      const wanted = forward ? after : before;
      if (wanted) draft.putLink(wanted);
      else draft.dropLink(id);
    }
    for (const [id, [before, after]] of taken.people) {
      const wanted = forward ? after : before;
      const current = draft.person(id);
      if (!wanted) draft.dropPerson(id);
      else if (!current) draft.putPerson(wanted);
      else {
        // Only what the step changed goes back: a photo added since stays.
        const next: Record<string, unknown> = { ...current };
        for (const key of changedKeys(before, after)) {
          const value = wanted[key as keyof PersonRecord];
          if (value === undefined || value === null) delete next[key];
          else next[key] = value;
        }
        draft.putPerson(next as PersonRecord);
      }
    }
    draft.commit();
  }

  // --- Photos and stories: not Undo steps, as in the app -----------------------------------------

  private withPhoto(id: string): PersonRecord {
    const person = this.person(id);
    if (!person) throw notFound("That person isn't in the tree.");
    if (person.placeholder) throw refuse("placeholder", "An unknown parent can't have a photo.");
    return person;
  }

  private setPhoto(id: string, has: boolean): void {
    const person = this.person(id) as PersonRecord;
    this.state.people.set(
      id,
      withProps(person, {
        has_photo: has,
        photo_version: (person.photo_version ?? 0) + 1,
        updated_at: stamp(),
      }),
    );
  }

  async uploadPhoto(id: string, file: Blob, crop: unknown): Promise<PersonDetail> {
    this.withPhoto(id);
    if (crop !== null && crop !== undefined && !validCrop(crop)) {
      throw new Refusal(422, "bad_crop", "The crop couldn't be read.");
    }
    if (file.size > 20 * 1024 * 1024)
      throw new Refusal(413, "too_large", "That file is larger than 20 MB.");
    let made: Awaited<ReturnType<typeof makePhoto>>;
    try {
      made = await makePhoto(file, (crop as Crop | null) ?? null);
    } catch (error) {
      if (error instanceof PhotoProblem) throw new Refusal(422, "bad_photo", error.message);
      throw error;
    }
    this.withPhoto(id);
    for (const [size, data] of Object.entries(made.avatars))
      this.files.set(avatar(id, Number(size)), data);
    this.files.set(personFiles.display(id), made.display);
    this.photos.set(id, { display: made.display, crop: made.crop });
    this.setPhoto(id, true);
    this.changed();
    return this.mustDetail(id);
  }

  photoCrop(id: string): Crop | null {
    return this.person(id)?.has_photo ? (this.photos.get(id)?.crop ?? null) : null;
  }

  async recrop(id: string, crop: Crop): Promise<PersonDetail> {
    this.withPhoto(id);
    const photo = this.photos.get(id);
    if (!photo || !this.person(id)?.has_photo) {
      throw notFound("There's no photo to crop: a photo from the app is cropped in the app.");
    }
    if (!validCrop(crop)) throw new Refusal(422, "bad_crop", "The crop couldn't be read.");
    const response = await fetch(photo.display);
    const made = await makePhoto(await response.blob(), crop);
    for (const [size, data] of Object.entries(made.avatars))
      this.files.set(avatar(id, Number(size)), data);
    this.photos.set(id, { display: photo.display, crop: made.crop });
    this.setPhoto(id, true);
    this.changed();
    return this.mustDetail(id);
  }

  removePhoto(id: string): PersonDetail {
    this.withPhoto(id);
    for (const address of [...this.files.keys()]) {
      if (address.startsWith(personFiles.photo(id))) this.files.delete(address);
    }
    this.photos.delete(id);
    this.setPhoto(id, false);
    this.changed();
    return this.mustDetail(id);
  }

  saveStory(id: string, update: BiographyUpdate): Biography {
    const person = this.person(id);
    if (!person) throw notFound("That person isn't in the tree.");
    if (person.placeholder) {
      throw refuse("placeholder", "An unknown parent has no story yet. Fill them in first.");
    }
    if (this.hidden.has(id)) {
      throw refuse(
        "hidden",
        "Living people's stories aren't in this copy, so they can't be written here.",
      );
    }
    const current = this.story(id);
    if (update.base_version !== current.version) {
      throw refuse("changed_outside", "This story was changed since you opened it.", {
        ...current,
      });
    }
    if (update.story.length > 2_000_000)
      throw new Refusal(422, "too_long", "That story is too long.");
    // Written as the app writes biography.md, and read back as it reads it.
    const saved = biographyFrom(joinSources(update.story, update.sources ?? []));
    if (saved.version === NO_STORY.version) this.stories.delete(id);
    else this.stories.set(id, saved);
    this.changed();
    return saved;
  }

  async addPicture(id: string, file: Blob): Promise<PictureAdded> {
    const person = this.person(id);
    if (!person) throw notFound("That person isn't in the tree.");
    if (person.placeholder)
      throw refuse("placeholder", "An unknown parent has no story yet. Fill them in first.");
    let data: string;
    try {
      data = await makePicture(file);
    } catch (error) {
      if (error instanceof PhotoProblem) throw new Refusal(422, "bad_photo", error.message);
      throw error;
    }
    const day = stamp().slice(0, 10);
    const token = newId().slice(-6);
    const name = `${day}-${token}.webp`;
    this.files.set(personFiles.picture(id, name), data);
    this.changed();
    return { src: `media/${name}` };
  }
}

export { Invalid, Refusal };
