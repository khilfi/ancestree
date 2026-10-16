import { NetworkIcon } from "lucide-react";
import { type KeyboardEvent, type RefObject, useEffect } from "react";
import { useNavigate } from "react-router";
import type { GraphPerson } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { shortName } from "@/features/tree/words";
import { cn } from "@/lib/utils";
import { fanned, spotPlace, stacked } from "./bundles";
import { type Group, PHOTO, PIN, type Point, type Spot } from "./levels";

/*
 * A bundle opened where it is: its people's photos fanned out
 * around its spot, each with a line to where they really are and their name under it; or, past
 * twelve, a card listing them. A spot's people stand in columns above its pin instead.
 * A click on someone opens their panel; Esc, or a click anywhere else, folds it back. The
 * arrow keys move between them.
 */

/** Arrows move between the bundle's people; the first is reached when it opens. */
function useArrows(box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("[data-someone]")?.focus({ preventScroll: true });
  }, [box]);
  return (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step || !box.current) return;
    event.preventDefault();
    const all = [...box.current.querySelectorAll<HTMLElement>("[data-someone]")];
    const now = all.indexOf(document.activeElement as HTMLElement);
    all[(now + step + all.length) % all.length]?.focus({ preventScroll: true });
  };
}

export function OpenFan({
  group,
  eldest,
  name,
  place,
  people,
  colourOf,
  faded,
  selectedId,
  onSelect,
  screenOf,
  box,
}: {
  group: Group;
  eldest: string[];
  name: string; // "Fatimah and 2 more"
  place: string; // "Kajang, Hulu Langat"
  people: Map<string, GraphPerson>;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  screenOf: (id: string) => Point | null; // where each really is, on screen
  box: RefObject<HTMLDivElement | null>;
}) {
  const { at, radius } = fanned(eldest.length, PHOTO + 56);
  const backdrop = radius + PHOTO / 2 + 26;
  const arrows = useArrows(box);
  return (
    <div
      ref={box}
      className="absolute z-20"
      style={{ transform: `translate(${group.at.x}px, ${group.at.y}px)` }}
      role="dialog"
      aria-label={`${name}, ${place}`}
      onKeyDown={arrows}
    >
      <div
        className="pointer-events-auto absolute rounded-full bg-white/85 shadow-md ring-1 ring-stone-200 animate-in fade-in zoom-in-95 duration-200"
        style={{
          width: backdrop * 2,
          height: backdrop * 2,
          transform: `translate(-${backdrop}px, -${backdrop}px)`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <svg className="pointer-events-none absolute overflow-visible" aria-hidden="true">
        {eldest.map((id, index) => {
          const really = screenOf(id);
          const from = at[index] ?? { x: 0, y: 0 };
          if (!really) return null;
          const to = { x: really.x - group.at.x, y: really.y - group.at.y };
          return (
            <g key={id}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className="stroke-stone-400"
                strokeWidth={1}
              />
              <circle cx={to.x} cy={to.y} r={2.5} className="fill-sky-600" />
            </g>
          );
        })}
      </svg>
      <span
        className="absolute left-0 w-max max-w-80 -translate-x-1/2 truncate rounded bg-white px-1.5 text-xs font-medium text-stone-700 shadow-sm"
        style={{ top: -backdrop + 4 }}
      >
        {place}
      </span>
      {eldest.map((id, index) => {
        const person = people.get(id);
        const spot = at[index] ?? { x: 0, y: 0 };
        if (!person) return null;
        const colour = colourOf(id);
        return (
          <button
            key={id}
            type="button"
            data-someone
            className={cn(
              "pointer-events-auto absolute flex w-20 flex-col items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sky-500",
              faded && !faded.has(id) && "opacity-40",
            )}
            style={{ transform: `translate(${spot.x - 40}px, ${spot.y - PHOTO / 2}px)` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(id);
            }}
            title={person.full_name}
          >
            <PersonAvatar
              person={person}
              size="sm"
              className={cn(
                "size-[34px] max-w-none shadow-sm transition-transform hover:scale-110",
                id === selectedId && "ring-2 ring-sky-500 ring-offset-1",
              )}
              style={colour ? { borderColor: colour } : undefined}
            />
            <span className="mt-0.5 w-20 truncate text-center text-[10px] leading-tight text-stone-700">
              {shortName(person)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// An opened spot's columns: each person a small node, one above another.
const ROW = 32; // a node, and the gap above it
const WIDE = 132; // a column
const GAP = 8; // between columns
const HEADING = 26; // the address over the columns
const STEM = 12; // from the columns down to the pin's head

/** Where a spot's opened people stand: columns of `perColumn` rows over its pin, the window's
 *  room permitting, centred over it. */
export function standing(at: Point, count: number, size: { width: number; height: number }) {
  const rows = Math.floor((at.y - PIN.height - STEM - HEADING - 8) / ROW);
  const { perColumn, columns, card } = stacked(count, rows);
  const wide = columns * WIDE + (columns - 1) * GAP;
  const left = Math.min(Math.max(8, at.x - wide / 2), Math.max(8, size.width - wide - 8));
  const tall = Math.min(count, perColumn) * ROW;
  const bottom = at.y - PIN.height - STEM;
  return { perColumn, columns, card, left, top: bottom - tall, wide, bottom };
}

export function OpenStack({
  group,
  eldest,
  name,
  heading,
  people,
  colourOf,
  faded,
  selectedId,
  onSelect,
  size,
  box,
}: {
  group: Group;
  eldest: string[];
  name: string; // "Fatimah and 2 more"
  heading: string; // the address: "No. 8, Jalan Kenari 2, Kajang, Hulu Langat"
  people: Map<string, GraphPerson>;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  size: { width: number; height: number };
  box: RefObject<HTMLDivElement | null>;
}) {
  const arrows = useArrows(box);
  const { perColumn, left, top, wide, bottom } = standing(group.at, eldest.length, size);
  return (
    <div
      ref={box}
      className="absolute inset-0 z-20"
      role="dialog"
      aria-label={`${name}, ${heading}`}
      onKeyDown={arrows}
    >
      <span
        className="absolute w-max max-w-80 -translate-x-1/2 truncate rounded bg-white px-1.5 text-xs font-medium text-stone-700 shadow-sm"
        style={{ left: left + wide / 2, top: top - HEADING + 2 }}
      >
        {heading}
      </span>
      {/* The stem, from the columns down to the pin. */}
      <div
        className="absolute w-px bg-stone-400"
        style={{ left: group.at.x, top: bottom, height: STEM }}
      />
      {eldest.map((id, index) => {
        const person = people.get(id);
        if (!person) return null;
        const column = Math.floor(index / perColumn);
        const row = index % perColumn;
        const colour = colourOf(id);
        return (
          <button
            key={id}
            type="button"
            data-someone
            className={cn(
              "pointer-events-auto absolute flex h-7 items-center gap-1.5 rounded-full bg-white pr-2.5 pl-0.5 text-left shadow-sm ring-1 ring-stone-200 outline-none animate-in fade-in slide-in-from-bottom-2 duration-200 hover:bg-stone-50 focus-visible:ring-2 focus-visible:ring-sky-500",
              id === selectedId && "ring-2 ring-sky-500",
              faded && !faded.has(id) && "opacity-40",
            )}
            style={{ left: left + column * (WIDE + GAP), top: top + row * ROW, width: WIDE }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(id);
            }}
            title={person.full_name}
          >
            <PersonAvatar
              person={person}
              size="sm"
              className="size-6 max-w-none shrink-0 text-[10px]"
              style={colour ? { borderColor: colour } : undefined}
            />
            <span className="truncate text-xs text-stone-700">{shortName(person)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function BundleCard({
  group,
  eldest,
  name,
  place,
  people,
  size,
  spotOf,
  selectedId,
  onSelect,
  box,
}: {
  group: Group;
  eldest: string[];
  name: string;
  place: string;
  people: Map<string, GraphPerson>;
  size: { width: number; height: number };
  spotOf: (id: string) => Spot | undefined;
  selectedId: string | null;
  onSelect?: (id: string) => void;
  box: RefObject<HTMLDivElement | null>;
}) {
  const navigate = useNavigate();
  const arrows = useArrows(box);
  const width = Math.min(320, size.width - 16);
  const tallest = Math.min(440, size.height - 16);
  const left = Math.min(Math.max(8, group.at.x - width / 2), size.width - width - 8);
  const below = group.at.y + 28;
  const top = below + tallest <= size.height - 8 ? below : Math.max(8, group.at.y - tallest - 28);
  return (
    <div
      ref={box}
      className="pointer-events-auto absolute z-20 flex flex-col rounded-lg border border-stone-200 bg-white shadow-lg animate-in fade-in zoom-in-95 duration-200"
      style={{ left, top, width, maxHeight: tallest }}
      role="dialog"
      aria-label={`${name}, ${place}`}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={arrows}
    >
      <div className="border-b border-stone-100 px-3 py-2">
        <p className="truncate text-sm font-medium text-stone-800">{name}</p>
        <p className="truncate text-xs text-stone-500">{place}</p>
        {onSelect && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={() => navigate(`/tree?who=${eldest.join(",")}`)}
          >
            <NetworkIcon />
            Show them on the tree
          </Button>
        )}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {eldest.map((id) => {
          const person = people.get(id);
          const spot = spotOf(id);
          if (!person) return null;
          const where = spot ? spotPlace(spot) : "";
          return (
            <li key={id}>
              <button
                type="button"
                data-someone
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-stone-50 focus-visible:bg-sky-50",
                  id === selectedId && "bg-sky-50",
                )}
                onClick={() => onSelect?.(id)}
              >
                <PersonAvatar person={person} size="sm" className="size-7 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-stone-800">{person.full_name}</span>
                  <span className="block truncate text-xs text-stone-500">
                    {spot?.address ? `${spot.address} · ${where}` : where}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
