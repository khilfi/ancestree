import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GraphPerson } from "@/api/types";
import { Hint } from "@/components/Hint";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { StoryMark } from "@/features/biography/StoryMark";
import { shortName } from "@/features/tree/words";
import { useEscape } from "@/lib/escape";
import { lifeYears } from "@/lib/people";
import { cn } from "@/lib/utils";
import { DRAWING } from "@/styles/drawing";
import { BundleCard, OpenFan, OpenStack, standing } from "./Bundle";
import {
  bundleName,
  bundlePlace,
  eldestFirst,
  FANNED,
  firstFew,
  opensHere,
  SPOT_KM,
  spotPlace,
} from "./bundles";
import { PLANE_PER_KM, STATE_MIDDLES } from "./geo";
import { type Box, bodyOf, type Named, type NamePlace, placeNames } from "./labels";
import {
  bubbleRadius,
  crowded,
  flowerRadius,
  type Group,
  gather,
  type Level,
  MOST,
  mergeTowns,
  type OneSpot,
  oneSpots,
  PHOTO,
  PIN,
  type Point,
  type Spot,
  separate,
  sunflower,
} from "./levels";

/*
 * The family on the map, as both drawings show it: today's, and
 * MapLibre's from the map packs. A circle for each country or state with how many are
 * there, then each town's people as their photos; people at one spot as one pin, whose people
 * stand in columns above it on a click; and people too close together to show apart as
 * a bundle, named by its eldest, that opens where it is; and the map's own buttons.
 */

const MARGIN = 200; // drawn this far outside the screen, so panning shows no gaps

/** The family gathered for the zoom, and where each group goes on screen: `toScreen` takes a
 *  point of the plane (geo.ts) to the screen, as each drawing places it. At the map's deepest
 *  nothing is merged: each spot is its own pin, however near another. Where the states'
 *  circles have no room to sit near their states, the countries' instead: `level` says
 *  which is shown. */
export function familyGroups(
  spots: readonly Spot[],
  zoom: Level,
  toScreen: (point: Point) => Point,
  withNames: boolean,
  spacing: number,
  deepest = false,
): { level: Level; groups: Group[] } {
  const middle = (state: string) => {
    const found = STATE_MIDDLES.get(state);
    return found ? { x: found[0], y: found[1] } : null;
  };
  const atSpots = oneSpotsOf(spots);
  const gathered = (level: Level) =>
    gather(spots, level, toScreen, middle, (id) => atSpots.get(id));
  const circle = (g: Group) => bubbleRadius(g.members.length);
  if (zoom === "states") {
    const states = gathered("states");
    const apart = separate(states, circle);
    if (!crowded(states, apart, circle)) return { level: "states", groups: apart };
  }
  if (zoom !== "towns") {
    return { level: "countries", groups: separate(gathered("countries"), circle) };
  }
  if (deepest) return { level: "towns", groups: gathered("towns") };
  const shown = (count: number) => (withNames ? count : Math.min(count, MOST));
  const groups = mergeTowns(gathered("towns"), (g) =>
    g.towns > 1
      ? circle(g)
      : pinned(g)
        ? PIN.head.r + 2
        : flowerRadius(shown(g.members.length), spacing),
  );
  return { level: "towns", groups };
}

/** A spot's group, drawn as one pin: its people are where they are, not about there. */
const pinned = (group: Group) => group.towns === 1 && group.about === false && !group.rough;

// People at one spot, for each set of spots: worked out once, not at each view.
const spotsFound = new WeakMap<readonly Spot[], Map<string, OneSpot>>();
function oneSpotsOf(spots: readonly Spot[]): Map<string, OneSpot> {
  let found = spotsFound.get(spots);
  if (!found) {
    found = oneSpots(spots, SPOT_KM * PLANE_PER_KM);
    spotsFound.set(spots, found);
  }
  return found;
}

/** A group's name as it's written on the map, where it's written, and how. */
export type ShownName = NamePlace & {
  text: string;
  widest: number; // cut short past this
  quiet: boolean; // a town found only roughly: faint, in italics
};

/** What a group's name is, and what its circle, photos or pin take of the screen around it. */
function named(
  group: Group,
  level: Level,
  { withNames, spacing, people, generationOf }: Naming,
): Named & { quiet: boolean } {
  const { key, at } = group;
  const count = group.members.length;
  if (level !== "towns" || group.towns > 1) {
    // A country's, a state's, or a bundle's circle, named by its eldest.
    const r = bubbleRadius(count);
    const bundle = level === "towns";
    const text = bundle
      ? bundleName(eldestFirst(group.members, people, generationOf), people)
      : group.label;
    return {
      key,
      text,
      at,
      reach: { up: r, down: r, left: r, right: r },
      widest: 160,
      quiet: false,
    };
  }
  if (pinned(group)) {
    // A pin stands on its spot, its head above: its name beside the head, or under the tip.
    const eldest = eldestFirst(group.members, people, generationOf);
    const first = people.get(eldest[0] ?? "");
    const text =
      count > 1 ? bundleName(eldest, people) : withNames && first ? shortName(first) : "";
    const { head, tip } = PIN;
    return {
      key,
      text,
      at: { x: at.x, y: at.y - tip.y + head.y },
      reach: { up: head.y, down: tip.y - head.y, left: PIN.width / 2, right: PIN.width / 2 },
      widest: 160,
      quiet: false,
    };
  }
  // A town's photos, each with its name under it once they're shown.
  const reach = flowerRadius(withNames ? count : Math.min(count, MOST), spacing);
  const names = withNames ? 12 : 0;
  return {
    key,
    text: group.label,
    at,
    reach: { up: reach, down: reach + names, left: reach + names * 2, right: reach + names * 2 },
    widest: 176,
    quiet: group.rough,
  };
}

type Naming = {
  withNames: boolean;
  spacing: number;
  people: ReadonlyMap<string, GraphPerson>;
  generationOf: (id: string) => number | undefined;
};

/**
 * The groups' names, none over another, over any circle, photos or pin, or over the map's
 * buttons and credits (`taken`); the biggest groups first. With what they all take of the
 * screen, for the names written after them, the towns' around.
 */
export function groupNames(
  groups: readonly Group[],
  level: Level,
  naming: Naming,
  taken: readonly Box[],
  size: { width: number; height: number },
): { names: Map<string, ShownName>; taken: Box[] } {
  const shapes = groups.map((group) => named(group, level, naming));
  const placed = placeNames(shapes, taken, size);
  const names = new Map<string, ShownName>();
  const all = [...taken, ...shapes.map(bodyOf)];
  for (const shape of shapes) {
    const place = placed.get(shape.key);
    if (!place) continue;
    names.set(shape.key, { ...place, text: shape.text, widest: shape.widest, quiet: shape.quiet });
    all.push(place.box);
  }
  return { names, taken: all };
}

/** The groups on screen, and a little beyond it: a circle for a country, a state or towns too
 *  close together, else a town's people as their photos. A country's or a state's circle
 *  zooms in on a click; a bundle of towns opens where it is when zooming in wouldn't part it,
 *  its people within about 30 m or the map at its deepest, and else zooms in, with Open here
 *  beside it. Their names where `names` puts them, worked out here if not given. */
export function FamilyPlaces({
  groups,
  level,
  size,
  withNames,
  spacing,
  people,
  colourOf,
  faded,
  selectedId,
  onSelect,
  onZoomInto,
  spotOf,
  screenOf,
  generationOf,
  deepest,
  names: given,
}: {
  groups: Group[];
  level: Level;
  size: { width: number; height: number };
  withNames: boolean;
  spacing: number;
  people: Map<string, GraphPerson>;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  onZoomInto: (group: Group) => void;
  spotOf: (id: string) => Spot | undefined;
  screenOf: (id: string) => Point | null; // where each really is, on screen
  generationOf: (id: string) => number | undefined; // on the rings, for the eldest
  deepest: boolean; // the map zoomed in as far as it goes
  names?: ReadonlyMap<string, ShownName>; // each group's name, where it's written
}) {
  const visible = (at: Point) =>
    at.x > -MARGIN && at.y > -MARGIN && at.x < size.width + MARGIN && at.y < size.height + MARGIN;
  const names =
    given ??
    groupNames(groups, level, { withNames, spacing, people, generationOf }, [], size).names;
  const nameOf = (id: string) => people.get(id)?.full_name ?? "";
  // The bundle open, by its key: one at a time. Esc, or a click anywhere else, folds it back,
  // and Esc gives the keys back to its circle. Esc only when nothing opened over it, a dialog,
  // is open, through useEscape.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = useRef<HTMLDivElement>(null);
  const open = openKey ? groups.find((group) => group.key === openKey) : undefined;
  useEscape(() => {
    if (!openKey) return;
    setOpenKey(null);
    // Once its circle shows again: hidden, it can't take the keys.
    const circle = `[data-bundle="${CSS.escape(openKey)}"]`;
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(circle)?.focus({ preventScroll: true }),
    );
  }, openKey !== null);
  useEffect(() => {
    if (!openKey) return;
    const onPointer = (event: PointerEvent) => {
      if (!opened.current?.contains(event.target as Node)) setOpenKey(null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    return () => window.removeEventListener("pointerdown", onPointer, true);
  }, [openKey]);
  // A bundle of towns: named by its eldest; pointing at it names the first few and where.
  const bundled = (group: Group) => level === "towns" && group.towns > 1;
  const told = (group: Group) => {
    const eldest = eldestFirst(group.members, people, generationOf);
    return {
      eldest,
      name: bundleName(eldest, people),
      place: bundlePlace(eldest, spotOf),
      few: firstFew(eldest, people),
    };
  };
  // A spot's address, heading its people once opened: "No. 8, Jalan Kenari 2, Kajang".
  const headingOf = (group: Group) => {
    const spot = spotOf(group.members[0] ?? "");
    const where = spot ? spotPlace(spot) : group.label;
    return spot && group.label !== spot.place ? `${group.label}, ${where}` : where;
  };
  const shownOpen = open ? told(open) : null;
  const stands = open && pinned(open) ? standing(open.at, open.members.length, size) : null;
  return (
    // Drags and pinches pass through to the map beneath; only the circles and photos take clicks.
    <div className="pointer-events-none absolute inset-0 animate-in fade-in duration-300">
      {groups
        .filter((group) => visible(group.at))
        .map((group) =>
          level !== "towns" || group.towns > 1 ? (
            <Bubble
              key={group.key}
              group={group}
              told={bundled(group) ? told(group) : undefined}
              opens={bundled(group) && opensHere(group.members, spotOf, deepest)}
              onOpen={() =>
                bundled(group) && opensHere(group.members, spotOf, deepest)
                  ? setOpenKey(group.key)
                  : onZoomInto(group)
              }
              onOpenHere={() => setOpenKey(group.key)}
              nameOf={nameOf}
              hidden={group.key === openKey}
              nameBelow={names.get(group.key)?.side === "below"}
            />
          ) : pinned(group) ? (
            <SpotPin
              key={group.key}
              group={group}
              told={told(group)}
              heading={headingOf(group)}
              people={people}
              colourOf={colourOf}
              faded={faded}
              selectedId={selectedId}
              onOpen={() => setOpenKey(group.key)}
              onSelect={onSelect}
            />
          ) : (
            <Town
              key={group.key}
              group={group}
              people={people}
              spacing={spacing}
              withNames={withNames}
              colourOf={colourOf}
              faded={faded}
              selectedId={selectedId}
              onSelect={onSelect}
              onMore={() => onZoomInto(group)}
            />
          ),
        )}
      {groups
        // An open bundle's circle is hidden, its people shown instead; an open pin stays.
        .filter((group) => !(group.key === openKey && !pinned(group)) && visible(group.at))
        .map((group) => {
          const name = names.get(group.key);
          return name ? <GroupName key={`name:${group.key}`} name={name} /> : null;
        })}
      {open && shownOpen && stands && !stands.card && (
        <OpenStack
          group={open}
          {...shownOpen}
          heading={headingOf(open)}
          people={people}
          colourOf={colourOf}
          faded={faded}
          selectedId={selectedId}
          onSelect={onSelect}
          size={size}
          box={opened}
        />
      )}
      {open &&
        shownOpen &&
        !(stands && !stands.card) &&
        (stands?.card || open.members.length > FANNED ? (
          <BundleCard
            group={open}
            {...shownOpen}
            people={people}
            size={size}
            spotOf={spotOf}
            selectedId={selectedId}
            onSelect={onSelect}
            box={opened}
          />
        ) : (
          <OpenFan
            group={open}
            {...shownOpen}
            people={people}
            colourOf={colourOf}
            faded={faded}
            selectedId={selectedId}
            onSelect={onSelect}
            screenOf={screenOf}
            box={opened}
          />
        ))}
    </div>
  );
}

/** Putting a place on the map by hand: what to do, at the top. */
export function PlacingHint({ placing }: { placing: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
      <div className="rounded-full bg-highlight px-4 py-1.5 text-sm text-highlight-foreground shadow">
        Click where {placing} is · Esc to cancel
      </div>
    </div>
  );
}

/** Zoom in, zoom out and back to everyone, as the first view shows them, as the + − F
 *  keys do. */
export function MapButtons({
  onZoomBy,
  onShowEveryone,
}: {
  onZoomBy: (factor: number) => void;
  onShowEveryone: () => void;
}) {
  return (
    <div className="absolute bottom-3 left-3 flex flex-col gap-1">
      <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => onZoomBy(1.8)}>
        <PlusIcon />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => onZoomBy(1 / 1.8)}
      >
        <MinusIcon />
      </Button>
      <Button variant="outline" size="icon-sm" aria-label="Show everyone" onClick={onShowEveryone}>
        <ScanIcon />
      </Button>
    </div>
  );
}

/** A country's or a state's people as a number; or a bundle, towns too close together to show
 *  apart, named by its eldest: "Fatimah and 2 more". */
export function Bubble({
  group,
  told,
  opens,
  onOpen,
  onOpenHere,
  nameOf,
  hidden,
  nameBelow = false,
}: {
  group: Group;
  told?: { name: string; place: string; few: string }; // a bundle's, else a place's circle
  opens?: boolean; // a bundle that opens where it is, rather than zooming in
  onOpen: () => void;
  onOpenHere: () => void;
  nameOf: (id: string) => string;
  hidden?: boolean; // open, its people shown instead
  nameBelow?: boolean; // its name written under it, so Open here goes under that
}) {
  const radius = bubbleRadius(group.members.length);
  const count = group.members.length;
  const what = told?.name ?? group.label;
  const who = count === 1 ? nameOf(group.members[0] ?? "") : `${count} people`;
  const pointed = told ? `${told.few} · ${told.place}` : `${what}: ${who}`;
  return (
    // Its name is written apart, where there's room for it (GroupName).
    <div
      className={cn("group absolute", hidden && "invisible")}
      style={{
        width: radius * 2,
        transform: `translate(${group.at.x - radius}px, ${group.at.y - radius}px)`,
      }}
    >
      <Hint label={pointed}>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className={cn(
            "pointer-events-auto flex items-center justify-center rounded-full border-2 font-semibold shadow-sm transition-transform hover:scale-105",
            group.rough
              ? "border-dashed border-input bg-card/90 text-muted-foreground"
              : "border-card bg-map-circle/85 text-map-circle-foreground",
          )}
          style={{ width: radius * 2, height: radius * 2, fontSize: Math.min(18, 12 + radius / 5) }}
          data-bundle={told ? group.key : undefined}
          aria-label={`${told ? pointed : `${what}: ${who}`}. ${opens ? "Open" : "Zoom in"}`}
        >
          {count}
        </button>
      </Hint>
      {/* A bundle that zooms in can open where it is too: shown when pointed at or reached. */}
      {told && !opens && (
        <button
          type="button"
          className="pointer-events-auto absolute left-1/2 -translate-x-1/2 rounded bg-card/90 px-1 text-xs whitespace-nowrap text-link underline-offset-2 opacity-0 shadow-sm group-hover:opacity-100 hover:underline focus-visible:opacity-100"
          style={{ top: radius * 2 + 2 + (nameBelow ? 18 : 0) }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onOpenHere();
          }}
        >
          Open here
        </button>
      )}
    </div>
  );
}

// A pin's outline: its head a circle, tapering to its tip, which is on the spot.
const { head, tip } = PIN;
const SIDE = Math.sqrt(head.r ** 2 - 3.5 ** 2); // where the head meets the taper
// The outline ends half a stroke above the tip, its join round, so the stroke's edge is the
// tip: a sharp join would reach past it, and the pin would point a little below its spot.
const END = tip.y - PIN.stroke / 2;
const TEARDROP =
  `M${tip.x} ${END} C${tip.x - 3} ${END - 8}, ${head.x - SIDE + 1} ${head.y + 14}, ` +
  `${head.x - SIDE} ${head.y + 3.5} A${head.r} ${head.r} 0 1 1 ${head.x + SIDE} ${head.y + 3.5} ` +
  `C${head.x + SIDE - 1} ${head.y + 14}, ${tip.x + 3} ${END - 8}, ${tip.x} ${END} Z`;

/** People at one confirmed spot: one pin like Google Maps', its tip exactly on
 *  the spot, its head the eldest's photo or initials in their colour, with how many are there,
 *  named as a bundle is, "Fatimah and 2 more", the address said when pointed at. A click on
 *  one person opens their panel; on several, stands them in columns above it. */
export function SpotPin({
  group,
  told,
  heading,
  people,
  colourOf,
  faded,
  selectedId,
  onOpen,
  onSelect,
}: {
  group: Group;
  told: { eldest: string[]; name: string; few: string };
  heading: string;
  people: Map<string, GraphPerson>;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null;
  selectedId: string | null;
  onOpen: () => void;
  onSelect?: (id: string) => void;
}) {
  const count = group.members.length;
  const first = told.eldest[0] ?? "";
  const person = people.get(first);
  if (!person) return null;
  const colour = colourOf(first);
  const chosen = selectedId !== null && group.members.includes(selectedId);
  const who = count > 1 ? told.few : person.full_name;
  return (
    // Its box stands on the spot: the tip exactly there, at every zoom. Open, it stays: its
    // people stand on it.
    <div
      className="absolute"
      style={{ left: group.at.x - tip.x, top: group.at.y - tip.y, width: PIN.width }}
    >
      <Hint label={`${who} · ${heading}`}>
        <button
          type="button"
          data-bundle={group.key}
          data-pin
          className={cn(
            "pointer-events-auto relative block origin-bottom transition-transform hover:z-10 hover:scale-110",
            chosen && "z-10 scale-115",
            faded && group.members.every((id) => !faded.has(id)) && "opacity-30",
          )}
          style={{ width: PIN.width, height: PIN.height }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (count > 1) onOpen();
            else onSelect?.(first);
          }}
          aria-label={count > 1 ? `${who} · ${heading}. Open` : `${who}, ${heading}, exactly here`}
        >
          <svg
            className="absolute inset-0 overflow-visible drop-shadow-sm"
            width={PIN.width}
            height={PIN.height}
            aria-hidden="true"
          >
            <ellipse cx={tip.x} cy={tip.y} rx={6} ry={2.5} className="fill-foreground/20" />
            <path
              d={TEARDROP}
              fill={DRAWING.paper}
              stroke={chosen ? DRAWING.chosen : (colour ?? DRAWING.uncoloured)}
              strokeWidth={PIN.stroke}
              strokeLinejoin="round"
            />
          </svg>
          <PersonAvatar
            person={person}
            size="sm"
            className="absolute size-[28px] max-w-none border-0 text-xs"
            style={{ left: head.x - 14, top: head.y - 14 }}
          />
          {count > 1 && (
            <span
              className="absolute min-w-4 rounded-full bg-map-circle px-1 text-center text-xs leading-4 font-semibold text-map-circle-foreground ring-2 ring-card"
              style={{ left: head.x + 9, top: head.y - head.r - 2 }}
            >
              {count}
            </span>
          )}
        </button>
      </Hint>
    </div>
  );
}

/** A town's people, as their photos around its point, and its name. */
export function Town({
  group,
  people,
  spacing,
  withNames,
  colourOf,
  faded,
  selectedId,
  onSelect,
  onMore,
}: {
  group: Group;
  people: Map<string, GraphPerson>;
  spacing: number;
  withNames: boolean;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  onMore: () => void;
}) {
  const all = group.members;
  const cut = !withNames && all.length > MOST;
  const shown = cut ? all.slice(0, MOST - 1) : all;
  const spots = sunflower(shown.length + (cut ? 1 : 0), spacing);
  const reach = flowerRadius(spots.length, spacing);
  // About there, at their postcode's area or their town, a soft ring says so; to the house or
  // by hand, their photos are the pin.
  const about = group.about && !group.rough;
  const where = about ? "about here" : group.about === false ? "exactly here" : "";
  return (
    <div className="absolute" style={{ transform: `translate(${group.at.x}px, ${group.at.y}px)` }}>
      {about && (
        <Hint label={`${group.label}: about here`}>
          <div
            className="absolute rounded-full border border-map-circle/30 bg-map-circle/10"
            style={{
              width: (reach + 10) * 2,
              height: (reach + 10) * 2,
              transform: `translate(-${reach + 10}px, -${reach + 10}px)`,
            }}
          />
        </Hint>
      )}
      {shown.map((id, index) => {
        const person = people.get(id);
        const at = spots[index] ?? { x: 0, y: 0 };
        if (!person) return null;
        const colour = colourOf(id);
        const years = lifeYears(person);
        return (
          <Hint
            key={id}
            label={[person.full_name, years, group.label, where].filter(Boolean).join(" · ")}
          >
            <button
              type="button"
              className={cn(
                "pointer-events-auto absolute flex flex-col items-center rounded-full transition-transform hover:z-10 hover:scale-110",
                faded && !faded.has(id) && "opacity-30",
              )}
              style={{ transform: `translate(${at.x - PHOTO / 2}px, ${at.y - PHOTO / 2}px)` }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelect?.(id);
              }}
              aria-label={[person.full_name, group.label, where].filter(Boolean).join(", ")}
            >
              <PersonAvatar
                person={person}
                size="sm"
                className={cn(
                  // Never narrowed: a photo is an image, which may be no wider than its button,
                  // and a button with no name under it has no width of its own.
                  "size-[34px] max-w-none shadow-sm",
                  group.rough && "border-dashed",
                  id === selectedId && "ring-2 ring-highlight ring-offset-1",
                )}
                style={colour ? { borderColor: colour } : undefined}
              />
              <StoryMark person={person} inside className="top-[20px] left-[20px]" />
              {withNames && (
                <span className="mt-0.5 w-20 truncate text-center text-xs leading-tight text-foreground">
                  {shortName(person)}
                </span>
              )}
            </button>
          </Hint>
        );
      })}
      {cut && (
        <button
          type="button"
          className="pointer-events-auto absolute flex items-center justify-center rounded-full border-2 border-card bg-primary text-xs font-semibold text-primary-foreground shadow-sm"
          style={{
            width: PHOTO,
            height: PHOTO,
            transform: `translate(${(spots[shown.length]?.x ?? 0) - PHOTO / 2}px, ${(spots[shown.length]?.y ?? 0) - PHOTO / 2}px)`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onMore();
          }}
          aria-label={`${all.length - shown.length} more in ${group.label}. Zoom in`}
        >
          +{all.length - shown.length}
        </button>
      )}
    </div>
  );
}

/** A group's name, on the side of it `placeNames` found room on: centred under or over
 *  it, or beside it. Its box is as wide as the name could be, so the name itself is held to the
 *  side nearest its group. */
export function GroupName({ name }: { name: ShownName }) {
  const { box, side } = name;
  const middle = (box.x0 + box.x1) / 2;
  const left = side === "right" ? box.x0 : side === "left" ? box.x1 : middle;
  const shift = side === "right" ? "0" : side === "left" ? "-100%" : "-50%";
  return (
    <span
      className={cn(
        "absolute truncate rounded bg-card/80 px-1 text-xs leading-4 font-medium whitespace-nowrap",
        name.quiet ? "text-faint italic" : "text-foreground",
      )}
      style={{ left, top: box.y0, maxWidth: name.widest, transform: `translateX(${shift})` }}
      data-map-name // the journeys measure that no two overlap
    >
      {name.text}
    </span>
  );
}
