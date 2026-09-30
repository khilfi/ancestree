/**
 * The app's rules for changing the family, in a copy to edit: twins of
 * backend/src/ancestree/services/people.py, relationships.py and rules.py, working on a draft
 * of the family (state.ts). The same checks in the same order, with the same messages, as test
 * cases shared with Python prove (edit-cases.json). The app checks every change again when a
 * copy comes back, so a rule missed here can't slip into the family.
 */
import type {
  Gender,
  KindView,
  LinkView,
  Notice,
  PartialDate,
  Place,
  SpouseStatus,
  Suggestion,
} from "@/api/types";
import { casefold, compareText } from "@/kinship/compare";
import { BIOLOGICAL, type DateParts, daysIn, type LinkRecord, type PersonRecord } from "./family";
import { type Draft, newId } from "./state";

export type Kinds = ReadonlyMap<string, KindView>;

/** A change refused, as the API answers it: 409 with a code for a rule, 404 for someone who
 *  isn't there. `detail` goes into the answer beside the code and message. */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** A form field that doesn't validate: the API's 422, which the forms put beside the field. */
export type FieldError = { loc: (string | number)[]; msg: string; type: string };
export class Invalid extends Error {
  constructor(readonly errors: FieldError[]) {
    super(errors.map((error) => error.msg).join(" "));
  }
}

export const notFound = (message: string) => new Refusal(404, "not_found", message);
export const refuse = (code: string, message: string, detail: Record<string, unknown> = {}) =>
  new Refusal(409, code, message, detail);

const NOT_IN_TREE = "That person isn't in the tree.";

// --- Notices (services/rules.py) ----------------------------------------------------------------

export type Facts = { name: string; gender: Gender; birth: number | null; death: number | null };

export function factsOf(person: PersonRecord): Facts {
  return {
    name: person.full_name,
    gender: person.gender || "unknown",
    birth: person.birth_year ?? null,
    death: person.death_year ?? null,
  };
}

export function lifeNotices(person: Facts): Notice[] {
  if (person.birth !== null && person.death !== null && person.death < person.birth) {
    return [{ code: "died_before_born", message: `${person.name} died before being born.` }];
  }
  return [];
}

export function parentChildNotices(parent: Facts, child: Facts, blood: boolean): Notice[] {
  const notices: Notice[] = [];
  if (parent.birth !== null && child.birth !== null) {
    const gap = child.birth - parent.birth;
    if (gap <= 0) {
      notices.push({
        code: "parent_younger",
        message: `${parent.name} is recorded as born after ${child.name}.`,
      });
    } else if (gap < 12) {
      notices.push({
        code: "parent_too_young",
        message: `${parent.name} would have been about ${gap} when ${child.name} was born.`,
      });
    }
  }
  // A father may die before his child is born; a mother cannot.
  const grace = parent.gender === "male" ? 1 : 0;
  if (parent.death !== null && child.birth !== null && child.birth > parent.death + grace) {
    notices.push({
      code: "born_after_parent_died",
      message: `${child.name} is recorded as born after ${parent.name} died.`,
    });
  }
  if (blood && parent.gender === "male")
    notices.push(...patronymicNotices(parent.name, child.name));
  return notices;
}

const PATRONYMIC = /\s(?:bin|binti|bte?\.?|b\.)\s+(.+)$/i;
const TITLES = new Set([
  "haji",
  "hj",
  "hajah",
  "hjh",
  "dato",
  "datuk",
  "datin",
  "tan",
  "sri",
  "tun",
  "dr",
]);

function nameWords(name: string): string[] {
  const words = casefold(name).match(/[\p{L}\p{N}_']+/gu) ?? [];
  return words
    .filter((word) => !TITLES.has(word.replace(/['.]+$/, "")))
    .map((word) => word.replace(/'+$/, ""));
}

/** Malay names carry the father's name: "Aminah binti Hassan" is Hassan's daughter. */
function patronymicNotices(father: string, child: string): Notice[] {
  const match = PATRONYMIC.exec(child);
  if (!match) return [];
  const own = PATRONYMIC.exec(father);
  const fathersPart = own ? father.slice(0, own.index) : father;
  const said = match[1] as string;
  if (JSON.stringify(nameWords(said)) === JSON.stringify(nameWords(fathersPart))) return [];
  return [
    {
      code: "patronymic_mismatch",
      message: `${child}'s name says the father is ${said.trim()}, but ${father} is being linked as the father.`,
    },
  ];
}

/** Someone with the same name and no birth years that tell them apart (people.py). */
export function namesakeNotices(
  birth: PartialDate | null,
  namesakes: readonly PersonRecord[],
): Notice[] {
  const year = birth?.year ?? null;
  for (const other of namesakes) {
    const otherYear = other.birth_year ?? null;
    if (year === null || otherYear === null || year === otherYear) {
      const born = otherYear ? ` (born ${otherYear})` : "";
      return [
        {
          code: "possible_duplicate",
          message: `There's already a ${other.full_name}${born} in the tree.`,
        },
      ];
    }
  }
  return [];
}

/** People with this name, capitals aside, not counting unknown parents (find_by_name). */
export function namesakesOf(draft: Draft, fullName: string): PersonRecord[] {
  const wanted = fullName.toLowerCase();
  return draft.everyone().filter((p) => !p.placeholder && p.full_name.toLowerCase() === wanted);
}

// --- The person form (domain/requests.py PersonInput) ---------------------------------------------

type DateInput = Partial<PartialDate> | string | null | undefined;
type PlaceInput = Partial<Place> | null | undefined;

export type PersonFields = {
  full_name?: string;
  nickname?: string | null;
  title?: string | null;
  name_jawi?: string | null;
  gender?: Gender | null;
  birth_date?: DateInput;
  birth_place?: PlaceInput;
  death_date?: DateInput;
  death_place?: PlaceInput;
  burial_place?: string | null;
  residence?: PlaceInput;
  living?: boolean | null;
  occupation?: string | null;
  notes?: string | null;
};

/** What the person form edits, as stored: null removes a property (repo/mapping.py). */
export type Editable = Omit<
  PersonRecord,
  | "id"
  | "placeholder"
  | "has_photo"
  | "photo_version"
  | "birth_order"
  | "layout_x"
  | "layout_y"
  | "created_at"
  | "updated_at"
>;

const LIMITS: Record<string, number> = {
  nickname: 100,
  title: 100,
  name_jawi: 200,
  burial_place: 200,
  occupation: 200,
  notes: 5000,
};
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

const within = (value: number | null, low: number, high: number) =>
  value === null || (Number.isInteger(value) && value >= low && value <= high);

/** Why a date's parts aren't a date, in the PartialDate model's words. */
function dateProblem(date: DateParts): string | null {
  const { year, month, day, qualifier, year_to } = date;
  if (!within(year, 1, 9999) || !within(year_to, 1, 9999)) return "a year runs from 1 to 9999";
  if (!within(month, 1, 12)) return "a month runs from 1 to 12";
  if (!within(day, 1, 31)) return "a day runs from 1 to 31";
  if (day !== null && month === null) return "a day needs a month";
  if (month !== null && year === null) return "a month needs a year";
  if (year !== null && month !== null && day !== null && day > daysIn(month, year)) {
    return `${MONTHS[month - 1]} ${year} has no day ${day}`;
  }
  if (qualifier === "between") {
    if (year === null || year_to === null) return "'between' needs both year and year_to";
    if (year_to < year) return "year_to must not be before year";
  } else if (year_to !== null) {
    return "year_to is only used with 'between'";
  }
  if (year === null && qualifier !== "exact") return "a qualifier needs a year";
  return null;
}

function readDate(value: DateInput, field: string, errors: FieldError[]): DateParts | null {
  if (value == null) return null;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    errors.push({
      loc: ["body", field],
      msg: "Pick the date in the date picker.",
      type: "value_error",
    });
    return null;
  }
  const date: DateParts = {
    year: value.year ?? null,
    month: value.month ?? null,
    day: value.day ?? null,
    qualifier: value.qualifier ?? "exact",
    year_to: value.year_to ?? null,
    original_text: value.original_text ?? null,
  };
  const problem = dateProblem(date);
  if (problem)
    errors.push({ loc: ["body", field], msg: `Value error, ${problem}`, type: "value_error" });
  return date;
}

function readPlace(value: PlaceInput, field: string, errors: FieldError[]): Place | null {
  if (value == null) return null;
  const town = text(value.town);
  const state = text(value.state);
  const country = typeof value.country === "string" ? value.country : "Malaysia";
  for (const [part, given] of [
    ["town", town],
    ["state", state],
    ["country", country],
  ] as const) {
    if (given && given.length > 100) {
      errors.push({
        loc: ["body", field, part],
        msg: "String should have at most 100 characters",
        type: "string_too_long",
      });
    }
  }
  if (town === null && state === null && country === "Malaysia") return null;
  return { town, state, country };
}

function dateProps(prefix: "birth" | "death", date: DateParts | null): Partial<PersonRecord> {
  return {
    [`${prefix}_year`]: date?.year ?? null,
    [`${prefix}_month`]: date?.month ?? null,
    [`${prefix}_day`]: date?.day ?? null,
    [`${prefix}_qualifier`]: date ? date.qualifier : null,
    [`${prefix}_year_to`]: date?.year_to ?? null,
    [`${prefix}_original_text`]: date?.original_text ?? null,
  };
}

function placeProps(
  prefix: "birth" | "death" | "residence",
  place: Place | null,
): Partial<PersonRecord> {
  return {
    [`${prefix}_town`]: place?.town ?? null,
    [`${prefix}_state`]: place?.state ?? null,
    [`${prefix}_country`]: place ? place.country : null,
  };
}

/** The person form's fields as stored properties, or the reasons they can't be. */
export function readPerson(input: PersonFields): { props: Editable; birth: DateParts | null } {
  const errors: FieldError[] = [];
  const fullName =
    typeof input.full_name === "string"
      ? input.full_name.split(/\s+/).filter(Boolean).join(" ")
      : "";
  if (!fullName) {
    errors.push({
      loc: ["body", "full_name"],
      msg: "String should have at least 1 character",
      type: "string_too_short",
    });
  } else if (fullName.length > 200) {
    errors.push({
      loc: ["body", "full_name"],
      msg: "String should have at most 200 characters",
      type: "string_too_long",
    });
  }
  const texts: Record<string, string | null> = {};
  for (const [field, most] of Object.entries(LIMITS)) {
    const value = text(input[field as keyof PersonFields]);
    if (value && value.length > most) {
      errors.push({
        loc: ["body", field],
        msg: `String should have at most ${most} characters`,
        type: "string_too_long",
      });
    }
    texts[field] = value;
  }
  const birth = readDate(input.birth_date, "birth_date", errors);
  const death = readDate(input.death_date, "death_date", errors);
  const birthPlace = readPlace(input.birth_place, "birth_place", errors);
  const deathPlace = readPlace(input.death_place, "death_place", errors);
  const residence = readPlace(input.residence, "residence", errors);
  if (errors.length) throw new Invalid(errors);
  const gender: Gender =
    input.gender === "male" || input.gender === "female" ? input.gender : "unknown";
  const props = {
    full_name: fullName,
    nickname: texts.nickname ?? null,
    title: texts.title ?? null,
    name_jawi: texts.name_jawi ?? null,
    gender,
    burial_place: texts.burial_place ?? null,
    living: typeof input.living === "boolean" ? input.living : null,
    occupation: texts.occupation ?? null,
    notes: texts.notes ?? null,
    ...dateProps("birth", birth),
    ...placeProps("birth", birthPlace),
    ...dateProps("death", death),
    ...placeProps("death", deathPlace),
    ...placeProps("residence", residence),
  } as Editable;
  return { props, birth };
}

/** A person's stored properties with some set anew: null takes one away (SET p += props). */
export function withProps(person: PersonRecord, props: Partial<PersonRecord>): PersonRecord {
  const next: Record<string, unknown> = { ...person };
  for (const [name, value] of Object.entries(props)) {
    if (value === null || value === undefined) delete next[name];
    else next[name] = value;
  }
  return next as PersonRecord;
}

/** Someone new, as the person form creates them (people.py _new_person_props). */
export function newPerson(props: Editable, now: string, id = newId()): PersonRecord {
  return withProps(
    { id, full_name: props.full_name, gender: props.gender, placeholder: false, has_photo: false },
    { ...props, photo_version: 0, created_at: now, updated_at: now },
  );
}

// --- Links (services/relationships.py) ------------------------------------------------------------

export type Linked = { links: LinkView[]; notices: Notice[]; suggestions: Suggestion[] };

export const nothingLinked = (): Linked => ({ links: [], notices: [], suggestions: [] });

export function addLinked(into: Linked, other: Linked): void {
  into.links.push(...other.links);
  into.notices.push(...other.notices);
  for (const suggestion of other.suggestions) {
    if (!into.suggestions.some((s) => JSON.stringify(s) === JSON.stringify(suggestion))) {
      into.suggestions.push(suggestion);
    }
  }
}

function person(draft: Draft, id: string): PersonRecord {
  const found = draft.person(id);
  if (!found) throw notFound(NOT_IN_TREE);
  return found;
}

const isBlood = (kinds: Kinds, kind: string | null) => kinds.get(kind || "")?.blood === true;

/** Only the birth parents, from parent id -> kind (families.py by_blood). */
function byBlood(parents: Map<string, string | null>, kinds: Kinds): Map<string, string> {
  const found = new Map<string, string>();
  for (const [id, kind] of parents) if (kind !== null && isBlood(kinds, kind)) found.set(id, kind);
  return found;
}

/** Store "a is b's `aIs`" as parent or spouse links, or refuse with the reason. */
export function connect(
  draft: Draft,
  kinds: Kinds,
  now: string,
  a: string,
  b: string,
  aIs: "parent" | "child" | "spouse" | "sibling",
  kind: string = BIOLOGICAL,
  status: SpouseStatus = "married",
  shared: string[] | null = null,
): Linked {
  if (a === b) throw refuse("self_link", "Someone can't be linked to themselves.");
  for (const id of [a, b]) {
    if (person(draft, id).placeholder) {
      throw refuse(
        "placeholder",
        "An unknown parent only stands in for a missing parent; it can't be linked to anyone else.",
      );
    }
  }
  switch (aIs) {
    case "parent":
      return addParent(draft, kinds, a, b, kind);
    case "child":
      return addParent(draft, kinds, b, a, kind);
    case "spouse":
      return addSpouse(draft, a, b, status);
    case "sibling":
      return addSibling(draft, kinds, now, a, b, shared);
  }
}

export function addParent(
  draft: Draft,
  kinds: Kinds,
  parent: string,
  child: string,
  kind: string,
  { linkId = null, allowHidden = false }: { linkId?: string | null; allowHidden?: boolean } = {},
): Linked {
  const definition = kinds.get(kind);
  if (!definition) throw refuse("unknown_kind", `There's no relationship kind called '${kind}'.`);
  if (!definition.active && !allowHidden) {
    throw refuse(
      "hidden_kind",
      `'${definition.label}' is hidden. Show it again in Settings to use it.`,
    );
  }
  const parentName = person(draft, parent).full_name;
  const childName = person(draft, child).full_name;
  const existing = draft.linksBetween(parent, child)[0];
  if (existing) {
    if (existing.type === "parent") {
      throw refuse(
        "already_linked",
        `${parentName} and ${childName} are already parent and child.`,
      );
    }
    throw refuse(
      "parent_and_spouse",
      `${parentName} and ${childName} are married, so one can't be the other's parent.`,
    );
  }
  if (draft.isAncestor(child, parent)) {
    throw refuse(
      "cycle",
      `${childName} is already an ancestor of ${parentName}. This would make ${childName} their own ancestor.`,
    );
  }
  if (definition.blood) {
    const bloodParents = [...draft.parentIds(child)]
      .filter(([, kindOf]) => isBlood(kinds, kindOf))
      .map(([id]) => person(draft, id).full_name);
    if (bloodParents.length >= 2) {
      throw refuse(
        "third_parent",
        `${childName} already has two biological parents: ${bloodParents.join(" and ")}. Choose another kind, such as adoptive.`,
      );
    }
  }
  const id = linkId ?? newId();
  draft.putLink({
    id,
    type: "parent",
    source: parent,
    target: child,
    kind,
    status: null,
    order: null,
  });
  const view: LinkView = { id, type: "parent", source: parent, target: child, kind, status: null };
  const notices = parentChildNotices(
    factsOf(person(draft, parent)),
    factsOf(person(draft, child)),
    definition.blood,
  );
  return { links: [view], notices, suggestions: marriageSuggestions(draft, kinds, child) };
}

export function addSpouse(draft: Draft, a: string, b: string, status: SpouseStatus): Linked {
  const aName = person(draft, a).full_name;
  const bName = person(draft, b).full_name;
  const existing = draft.linksBetween(a, b)[0];
  if (existing) {
    if (existing.type === "spouse")
      throw refuse("already_spouses", `${aName} and ${bName} are already spouses.`);
    throw refuse(
      "parent_and_spouse",
      `One of ${aName} and ${bName} is the other's parent, so they can't be married.`,
    );
  }
  const id = newId();
  draft.putLink({ id, type: "spouse", source: a, target: b, kind: null, status, order: null });
  return {
    links: [{ id, type: "spouse", source: a, target: b, kind: null, status }],
    notices: [],
    suggestions: [],
  };
}

/** Siblings are stored as shared birth parents, so every blood relation stays computable. */
export function addSibling(
  draft: Draft,
  kinds: Kinds,
  now: string,
  a: string,
  b: string,
  shared: string[] | null,
): Linked {
  const parentsA = byBlood(draft.parentIds(a), kinds);
  const parentsB = byBlood(draft.parentIds(b), kinds);
  const aName = person(draft, a).full_name;
  const bName = person(draft, b).full_name;
  if (shared === null) {
    if ([...parentsA.keys()].some((parent) => parentsB.has(parent))) {
      throw refuse("already_siblings", `${aName} and ${bName} already share a parent.`);
    }
    if (!parentsA.size && !parentsB.size) return joinUnderUnknownParent(draft, now, a, b);
    const ids = [...new Set([...parentsA.keys(), ...parentsB.keys()])].sort(compareText);
    throw refuse("choose_shared_parents", `Which parents do ${aName} and ${bName} share?`, {
      candidates: ids.map((id) => ({
        id,
        full_name: person(draft, id).full_name,
        parent_of: parentsA.has(id) ? a : b,
      })),
    });
  }
  if (!shared.length) throw refuse("no_shared_parents", "Pick at least one parent they share.");
  const linked = nothingLinked();
  for (const parent of shared) {
    let child: string;
    let kind: string;
    if (parentsA.has(parent) && parentsB.has(parent)) continue;
    if (parentsA.has(parent)) {
      child = b;
      kind = parentsA.get(parent) as string;
    } else if (parentsB.has(parent)) {
      child = a;
      kind = parentsB.get(parent) as string;
    } else {
      const name = draft.person(parent)?.full_name ?? "That person";
      throw refuse("not_a_parent", `${name} isn't a parent of ${aName} or ${bName}.`);
    }
    addLinked(linked, addParent(draft, kinds, parent, child, kind, { allowHidden: true }));
  }
  return linked;
}

function joinUnderUnknownParent(draft: Draft, now: string, a: string, b: string): Linked {
  const placeholder = newId();
  draft.putPerson({
    id: placeholder,
    full_name: "Unknown parent",
    gender: "unknown",
    placeholder: true,
    has_photo: false,
    photo_version: 0,
    created_at: now,
    updated_at: now,
  });
  const linked = nothingLinked();
  for (const child of [a, b]) {
    const id = newId();
    draft.putLink({
      id,
      type: "parent",
      source: placeholder,
      target: child,
      kind: BIOLOGICAL,
      status: null,
      order: null,
    });
    linked.links.push({
      id,
      type: "parent",
      source: placeholder,
      target: child,
      kind: BIOLOGICAL,
      status: null,
    });
  }
  return linked;
}

/** A child with two birth parents who aren't recorded as married: ask whether they were. */
function marriageSuggestions(draft: Draft, kinds: Kinds, child: string): Suggestion[] {
  const parents = [...byBlood(draft.parentIds(child), kinds).keys()].sort(compareText);
  if (parents.length !== 2) return [];
  const [first, second] = parents.map((id) => person(draft, id)) as [PersonRecord, PersonRecord];
  if (first.placeholder || second.placeholder) return [];
  if (draft.linksBetween(first.id, second.id).some((link) => link.type === "spouse")) return [];
  return [
    {
      type: "marry",
      person_a: first.id,
      person_b: second.id,
      message: `Are ${first.full_name} and ${second.full_name} married?`,
    },
  ];
}

export function updateLink(
  draft: Draft,
  kinds: Kinds,
  linkId: string,
  request: { kind?: string | null; status?: SpouseStatus | null; swap?: boolean },
): Linked {
  const link = draft.link(linkId);
  if (!link) throw notFound("That link isn't in the tree.");
  if (link.type === "spouse") {
    if (request.kind != null || request.swap) {
      throw refuse("not_parent_link", "Only parent links have a kind or a direction.");
    }
    const status: SpouseStatus = request.status || link.status || "married";
    draft.putLink({ ...link, status });
    return {
      links: [
        {
          id: link.id,
          type: "spouse",
          source: link.source,
          target: link.target,
          kind: null,
          status,
        },
      ],
      notices: [],
      suggestions: [],
    };
  }
  if (request.status != null) throw refuse("not_a_marriage", "Only marriages have a status.");
  let [parent, child] = [link.source, link.target];
  if (request.swap) [parent, child] = [child, parent];
  const current = link.kind || BIOLOGICAL;
  const kind = request.kind || current;
  // Remove, then add back through the same checks, so the rules see the change.
  draft.dropLink(linkId);
  return addParent(draft, kinds, parent, child, kind, { linkId, allowHidden: kind === current });
}

export function removeLink(draft: Draft, linkId: string): void {
  const link = draft.link(linkId);
  if (!link) throw notFound("That link isn't in the tree.");
  draft.dropLink(linkId);
  // An unknown parent with no one left to stand in for has no reason to exist.
  if (draft.person(link.source)?.placeholder && !draft.linksOf(link.source).length) {
    draft.dropPerson(link.source);
  }
}

// --- Birth order (people.py set_children_order) ----------------------------------------------------

/** Which of `anchor`'s families a child belongs to (families.py family_key). */
function familyKey(draft: Draft, kinds: Kinds, link: LinkRecord, anchor: string): string {
  const kind = link.kind || BIOLOGICAL;
  const parents = [...draft.parentIds(link.target)];
  const others = isBlood(kinds, kind)
    ? parents.filter(([, k]) => isBlood(kinds, k)).map(([id]) => id)
    : parents.filter(([, k]) => (k || BIOLOGICAL) === kind).map(([id]) => id);
  const rest = others.filter((id) => id !== anchor).sort();
  return JSON.stringify([isBlood(kinds, kind) ? null : kind, rest]);
}

export function orderChildren(
  draft: Draft,
  kinds: Kinds,
  personId: string,
  childIds: readonly string[],
): void {
  const children = new Map(
    draft
      .allLinks()
      .filter((link) => link.type === "parent" && link.source === personId)
      .map((link) => [link.target, link]),
  );
  if (new Set(childIds).size !== childIds.length || childIds.some((id) => !children.has(id))) {
    throw refuse("not_children", "Those aren't all this person's children.");
  }
  const families = new Set(
    childIds.map((id) => familyKey(draft, kinds, children.get(id) as LinkRecord, personId)),
  );
  if (families.size !== 1) {
    throw refuse("mixed_families", "Only children of the same parents are ordered together.");
  }
  const family = [...families][0] as string;
  if (JSON.parse(family)[0] !== null) {
    throw refuse(
      "not_by_birth",
      "Birth order is set among children by birth. Other children follow their birth dates.",
    );
  }
  const whole = [...children].filter(
    ([, link]) => familyKey(draft, kinds, link, personId) === family,
  );
  if (whole.length !== childIds.length) {
    throw refuse("incomplete_order", "Put every child of these parents in the order.");
  }
  childIds.forEach((id, index) => {
    draft.putPerson({ ...person(draft, id), birth_order: index + 1 });
  });
}

/** The people an unknown parent stands in for (fill_in). */
export function childrenOf(draft: Draft, parent: string): string[] {
  return draft
    .allLinks()
    .filter((link) => link.type === "parent" && link.source === parent)
    .map((link) => link.target);
}

/** Take someone out of the family, and every link they have (DETACH DELETE). */
export function takeOut(draft: Draft, id: string): LinkRecord[] {
  const links = draft.linksOf(id);
  for (const link of links) draft.dropLink(link.id);
  draft.dropPerson(id);
  return links;
}

export function sortedIds(ids: Iterable<string>): string[] {
  return [...ids].sort(compareText);
}
