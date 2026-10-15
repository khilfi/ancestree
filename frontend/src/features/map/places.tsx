import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { GraphPerson } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { StoryMark } from "@/features/biography/StoryMark";
import { shortName } from "@/features/tree/words";
import { lifeYears } from "@/lib/people";
import { cn } from "@/lib/utils";
import { BundleCard, OpenFan } from "./Bundle";
import {
  bundleName,
  bundlePlace,
  eldestFirst,
  FANNED,
  firstFew,
  HOUSE_KM,
  opensHere,
} from "./bundles";
import { PLANE_PER_KM, STATE_MIDDLES } from "./geo";
import {
  bubbleRadius,
  flowerRadius,
  type Group,
  gather,
  type House,
  houses,
  type Level,
  MOST,
  mergeTowns,
  PHOTO,
  type Point,
  type Spot,
  separate,
  sunflower,
} from "./levels";

/*
 * The family on the map, as both drawings show it: today's, and
 * MapLibre's from the map packs. A circle for each country or state with how many are
 * there, then each town's people as their photos, people at one house as one place, and
 * people too close together to show apart as a bundle, named by its eldest, that opens where
 * it is; and the map's own buttons.
 */

const MARGIN = 200; // drawn this far outside the screen, so panning shows no gaps

/** The family gathered for the zoom, and where each group goes on screen: `toScreen` takes a
 *  point of the plane (geo.ts) to the screen, as each drawing places it. */
export function familyGroups(
  spots: readonly Spot[],
  level: Level,
  toScreen: (point: Point) => Point,
  withNames: boolean,
  spacing: number,
): Group[] {
  const middle = (state: string) => {
    const found = STATE_MIDDLES.get(state);
    return found ? { x: found[0], y: found[1] } : null;
  };
  const atHome = housesOf(spots);
  const gathered = gather(spots, level, toScreen, middle, (id) => atHome.get(id));
  if (level !== "towns") return separate(gathered, (g) => bubbleRadius(g.members.length));
  const shown = (count: number) => (withNames ? count : Math.min(count, MOST));
  return mergeTowns(gathered, (g) =>
    g.towns > 1 ? bubbleRadius(g.members.length) : flowerRadius(shown(g.members.length), spacing),
  );
}

// People at one house, for each set of spots: worked out once, not at each view.
const housesFound = new WeakMap<readonly Spot[], Map<string, House>>();
function housesOf(spots: readonly Spot[]): Map<string, House> {
  let found = housesFound.get(spots);
  if (!found) {
    found = houses(spots, HOUSE_KM * PLANE_PER_KM);
    housesFound.set(spots, found);
  }
  return found;
}

/** The groups on screen, and a little beyond it: a circle for a country, a state or towns too
 *  close together, else a town's people as their photos. A country's or a state's circle
 *  zooms in on a click; a bundle of towns opens where it is when zooming in wouldn't part it,
 *  its people within about 30 m or the map at its deepest, and else zooms in, with Open here
 *  beside it. */
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
}) {
  const visible = (at: Point) =>
    at.x > -MARGIN && at.y > -MARGIN && at.x < size.width + MARGIN && at.y < size.height + MARGIN;
  const nameOf = (id: string) => people.get(id)?.full_name ?? "";
  // The bundle open, by its key: one at a time. Esc, or a click anywhere else, folds it back,
  // and Esc gives the keys back to its circle.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const opened = useRef<HTMLDivElement>(null);
  const open = openKey ? groups.find((group) => group.key === openKey) : undefined;
  useEffect(() => {
    if (!openKey) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenKey(null);
      // Once its circle shows again: hidden, it can't take the keys.
      const circle = `[data-bundle="${CSS.escape(openKey)}"]`;
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(circle)?.focus({ preventScroll: true }),
      );
    };
    const onPointer = (event: PointerEvent) => {
      if (!opened.current?.contains(event.target as Node)) setOpenKey(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
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
  const shownOpen = open ? told(open) : null;
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
      {open &&
        shownOpen &&
        (open.members.length > FANNED ? (
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
      <div className="rounded-full bg-sky-700 px-4 py-1.5 text-sm text-white shadow">
        Click where {placing} is · Esc to cancel
      </div>
    </div>
  );
}

/** Zoom in, zoom out and back to Malaysia, as the + − F keys do. */
export function MapButtons({
  onZoomBy,
  onShowMalaysia,
}: {
  onZoomBy: (factor: number) => void;
  onShowMalaysia: () => void;
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
      <Button variant="outline" size="icon-sm" aria-label="Show Malaysia" onClick={onShowMalaysia}>
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
}: {
  group: Group;
  told?: { name: string; place: string; few: string }; // a bundle's, else a place's circle
  opens?: boolean; // a bundle that opens where it is, rather than zooming in
  onOpen: () => void;
  onOpenHere: () => void;
  nameOf: (id: string) => string;
  hidden?: boolean; // open, its people shown instead
}) {
  const radius = bubbleRadius(group.members.length);
  const count = group.members.length;
  const what = told?.name ?? group.label;
  const who = count === 1 ? nameOf(group.members[0] ?? "") : `${count} people`;
  const pointed = told ? `${told.few} · ${told.place}` : `${what}: ${who}`;
  return (
    <div
      className={cn("group absolute flex flex-col items-center", hidden && "invisible")}
      style={{
        transform: `translate(${group.at.x}px, ${group.at.y}px) translate(-50%, -${radius}px)`,
      }}
    >
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
            ? "border-dashed border-stone-400 bg-white/90 text-stone-600"
            : "border-white bg-sky-600/85 text-white",
        )}
        style={{ width: radius * 2, height: radius * 2, fontSize: Math.min(18, 10 + radius / 5) }}
        data-bundle={told ? group.key : undefined}
        aria-label={`${told ? pointed : `${what}: ${who}`}. ${opens ? "Open" : "Zoom in"}`}
        title={pointed}
      >
        {count}
      </button>
      <span className="mt-0.5 max-w-40 truncate rounded bg-white/80 px-1 text-xs font-medium text-stone-700">
        {what}
      </span>
      {/* A bundle that zooms in can open where it is too: shown when pointed at or reached. */}
      {told && !opens && (
        <button
          type="button"
          className="pointer-events-auto mt-0.5 rounded bg-white/90 px-1 text-[11px] text-sky-700 underline-offset-2 opacity-0 shadow-sm group-hover:opacity-100 hover:underline focus-visible:opacity-100"
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
        <div
          className="absolute rounded-full border border-sky-500/30 bg-sky-300/15"
          style={{
            width: (reach + 10) * 2,
            height: (reach + 10) * 2,
            transform: `translate(-${reach + 10}px, -${reach + 10}px)`,
          }}
          title={`${group.label}: about here`}
        />
      )}
      {shown.map((id, index) => {
        const person = people.get(id);
        const at = spots[index] ?? { x: 0, y: 0 };
        if (!person) return null;
        const colour = colourOf(id);
        const years = lifeYears(person);
        return (
          <button
            key={id}
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
            title={[person.full_name, years, group.label, where].filter(Boolean).join(" · ")}
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
                id === selectedId && "ring-2 ring-sky-500 ring-offset-1",
              )}
              style={colour ? { borderColor: colour } : undefined}
            />
            <StoryMark person={person} inside className="top-[20px] left-[20px]" />
            {withNames && (
              <span className="mt-0.5 w-20 truncate text-center text-[10px] leading-tight text-stone-700">
                {shortName(person)}
              </span>
            )}
          </button>
        );
      })}
      {cut && (
        <button
          type="button"
          className="pointer-events-auto absolute flex items-center justify-center rounded-full border-2 border-white bg-stone-700 text-xs font-semibold text-white shadow-sm"
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
      <span
        className={cn(
          "absolute left-0 w-max max-w-44 -translate-x-1/2 truncate rounded bg-white/80 px-1 text-xs font-medium",
          group.rough ? "text-stone-500 italic" : "text-stone-700",
        )}
        style={{ top: reach + (withNames ? 14 : 2) }}
      >
        {group.label}
      </span>
    </div>
  );
}
