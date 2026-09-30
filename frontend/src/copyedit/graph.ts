/**
 * The tree's view of the family, as backend/src/ancestree/services/graph.py builds GET
 * /api/graph: everyone, every link, and each person's seat on the rings. A copy to
 * edit builds it from the family it carries, again after every change.
 */
import type { Graph, GraphLayout, GraphLink, GraphPerson, Seat } from "@/api/types";
import { compareKeys, type Key, sortedBy } from "@/kinship/compare";
import {
  BIOLOGICAL,
  type CopyFamily,
  type DateParts,
  dateFromRow,
  type LinkRecord,
  livingFrom,
  type PersonRecord,
} from "./family";
import { type Member, type Seat as SeatAt, seatFamily } from "./seating";

/** Whether each relationship kind places a child on the rings, by its key. */
export type InLayout = ReadonlyMap<string, boolean>;

/** read_family's order (repo/graph.py): people by birth year, then name, then id. */
export function inTreeOrder(people: readonly PersonRecord[]): PersonRecord[] {
  return sortedBy(
    people,
    (person): Key => [
      person.birth_year == null,
      person.birth_year ?? 0,
      person.full_name,
      person.id,
    ],
  );
}

/** Links by type, then id: the order the tree reads them in, which seating follows. */
export function inLinkOrder(links: readonly LinkRecord[]): LinkRecord[] {
  return [...links].sort((a, b) => compareKeys([a.type, a.id], [b.type, b.id]));
}

const placed = (inLayout: InLayout, link: LinkRecord) =>
  inLayout.get(link.kind || BIOLOGICAL) ?? true;

/** Where someone was born, as the filters and Family facts group it: the state; the country,
 *  if abroad; else the town. */
export function birthRegion(person: PersonRecord): string | null {
  const country = person.birth_country;
  const abroad = country && country !== "Malaysia" ? country : null;
  return person.birth_state || abroad || person.birth_town || null;
}

function graphPerson(person: PersonRecord, thisYear: number): GraphPerson {
  const country = person.birth_country;
  const parts = [person.birth_town, person.birth_state];
  if (country && country !== "Malaysia") parts.push(country);
  const born = dateFromRow(person, "birth");
  const died = dateFromRow(person, "death");
  return {
    id: person.id,
    full_name: person.full_name,
    nickname: person.nickname ?? null,
    gender: person.gender || "unknown",
    birth_year: person.birth_year ?? null,
    death_year: person.death_year ?? null,
    birth_order: person.birth_order ?? null,
    placeholder: person.placeholder,
    photo_version: person.has_photo ? (person.photo_version ?? null) : null,
    birthplace: parts.filter(Boolean).join(", ") || null,
    born_in: birthRegion(person),
    x: person.layout_x ?? null,
    y: person.layout_y ?? null,
    born,
    died,
    is_living: livingFrom(person.living, born, died, thisYear),
    birth_text: born === null ? (person.birth_original_text ?? null) : null,
  };
}

function seatOf(seat: SeatAt): Seat {
  return {
    unit: seat.unit,
    generation: seat.generation,
    parent: seat.parent,
    order: seat.order,
    partner_of: seat.partnerOf,
    branch: seat.branch,
  };
}

/** Who sits where around `centre` (null: the oldest ancestor). */
export function buildLayout(
  family: CopyFamily,
  inLayout: InLayout,
  centre: string | null,
): GraphLayout {
  const members: Member[] = inTreeOrder(family.people).map((person) => ({
    id: person.id,
    name: person.full_name,
    gender: person.gender || "unknown",
    birth: dateFromRow(person, "birth") as DateParts | null,
    birthOrder: person.birth_order ?? null,
  }));
  const links = inLinkOrder(family.links);
  const seating = seatFamily(
    members,
    links
      .filter((link) => link.type === "parent")
      .map((link) => ({
        parent: link.source,
        child: link.target,
        inLayout: placed(inLayout, link),
      })),
    links
      .filter((link) => link.type === "spouse")
      .map((link) => ({ a: link.source, b: link.target, order: link.order })),
    centre,
  );
  return {
    units: seating.units.map((unit) => ({
      id: unit.id,
      centre: unit.centre,
      anchor: unit.anchor,
      anchor_seat: unit.anchorSeat ? seatOf(unit.anchorSeat) : null,
      size: unit.size,
    })),
    seats: Object.fromEntries([...seating.seats].map(([person, seat]) => [person, seatOf(seat)])),
    unlinked: seating.unlinked,
    centre_chosen: seating.units.some((unit) => unit.anchor === null && unit.centre[0] === centre),
  };
}

/** What GET /api/graph answers for this family. */
export function buildGraph(
  family: CopyFamily,
  inLayout: InLayout,
  centre: string | null,
  thisYear: number,
): Graph {
  const links: GraphLink[] = inLinkOrder(family.links).map((link) => ({
    id: link.id,
    type: link.type,
    source: link.source,
    target: link.target,
    kind: link.kind,
    status: link.status,
    in_layout: placed(inLayout, link),
  }));
  return {
    people: inTreeOrder(family.people).map((person) => graphPerson(person, thisYear)),
    links,
    layout: buildLayout(family, inLayout, centre),
  };
}
