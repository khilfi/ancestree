import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import {
  type MouseEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GraphPerson } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { shortName } from "@/features/tree/words";
import { typing } from "@/lib/keyboard";
import { lifeYears } from "@/lib/people";
import { cn } from "@/lib/utils";
import { BASE, BORDERS, fromPlane, PLANE_PER_KM, STATE_MIDDLES } from "./geo";
import {
  bubbleRadius,
  flowerRadius,
  type Group,
  gather,
  levelAt,
  MOST,
  mergeTowns,
  NAMES_FROM,
  PHOTO,
  type Point,
  type Spot,
  separate,
  sunflower,
} from "./levels";

/** Someone who moved: from where they were born to where they live, on the plane. */
export type Move = { id: string; from: Point; to: Point };
/** Bring these people into view; a new `nonce` asks again. */
export type MapTarget = { ids: string[]; nonce: number };
type View = { k: number; x: number; y: number }; // screen = plane × k + (x, y)

const MIN_K = 0.04; // the whole world
const MAX_K = 90; // a kampung's houses would be apart, if the map had them
const SEA = "#eef4f7";
const LAND = "#f5f5f4";
const MARGIN = 200; // drawn this far outside the screen, so panning shows no gaps

function framed(
  box: { x0: number; y0: number; x1: number; y1: number },
  size: { width: number; height: number },
  padding: number,
  most = MAX_K,
): View {
  const width = Math.max(box.x1 - box.x0, 1e-6);
  const height = Math.max(box.y1 - box.y0, 1e-6);
  const k = Math.min(
    most,
    Math.max(
      MIN_K,
      Math.min((size.width - 2 * padding) / width, (size.height - 2 * padding) / height),
    ),
  );
  return {
    k,
    x: size.width / 2 - k * (box.x0 + width / 2),
    y: size.height / 2 - k * (box.y0 + height / 2),
  };
}

const MALAYSIA = { x0: 20, y0: 20, x1: BASE.width - 20, y1: BASE.height - 20 };
// A person found alone is shown at the towns: about three screen pixels a kilometre.
const ONE_PERSON_K = 3 / PLANE_PER_KM;

/**
 * The map: the borders, drawn once and scaled, and over them the
 * people for the zoom: a circle for each country or state with how many are there, then each
 * town's people as their photos, as on the tree and the timeline. Scroll or pinch to zoom,
 * drag to move; +, − and F as on the tree.
 */
export function MapCanvas({
  spots,
  moves,
  people,
  colourOf,
  faded,
  selectedId,
  onSelect,
  target,
  placing,
  onPlace,
  onCancelPlace,
}: {
  spots: Spot[];
  moves: Move[] | null; // null: not shown
  people: Map<string, GraphPerson>;
  colourOf: (id: string) => string | null;
  faded: ReadonlySet<string> | null; // a filter's others, shown faded
  selectedId: string | null;
  onSelect?: (id: string) => void;
  target: MapTarget | null;
  placing: string | null; // the place being put on the map by hand
  onPlace: (point: { lat: number; lon: number }) => void;
  onCancelPlace: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  const current = useRef<View | null>(null);
  current.current = view;

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((before) => {
        // A new size keeps the middle of the view where it was.
        setView((now) =>
          now && before.width
            ? {
                ...now,
                x: now.x + (next.width - before.width) / 2,
                y: now.y + (next.height - before.height) / 2,
              }
            : now,
        );
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // It opens on Malaysia.
  useEffect(() => {
    if (!view && size.width > 0) setView(framed(MALAYSIA, size, 24));
  }, [view, size]);

  const glide = useCallback((to: View) => {
    const from = current.current;
    if (!from) {
      setView(to);
      return;
    }
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 350);
      const eased = 1 - (1 - t) ** 3;
      // Zoom glides evenly on a log scale, so it doesn't rush the last part.
      const k = from.k * (to.k / from.k) ** eased;
      setView({ k, x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const zoomAround = useCallback((now: View, factor: number, at: Point): View => {
    const k = Math.min(MAX_K, Math.max(MIN_K, now.k * factor));
    const real = k / now.k;
    return { k, x: at.x - (at.x - now.x) * real, y: at.y - (at.y - now.y) * real };
  }, []);

  const showMalaysia = useCallback(() => glide(framed(MALAYSIA, size, 24)), [glide, size]);
  const zoomBy = useCallback(
    (factor: number) => {
      const now = current.current;
      if (now) glide(zoomAround(now, factor, { x: size.width / 2, y: size.height / 2 }));
    },
    [glide, zoomAround, size],
  );

  // Bring people into view: those in a state or town chosen in the list, or someone found.
  const byId = useMemo(() => new Map(spots.map((spot) => [spot.id, spot])), [spots]);
  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    if (!target || !size.width || lastTarget.current === target.nonce) return;
    const found = target.ids.map((id) => byId.get(id)).filter((spot): spot is Spot => !!spot);
    if (!found.length) return;
    lastTarget.current = target.nonce;
    const xs = found.map((spot) => spot.x);
    const ys = found.map((spot) => spot.y);
    const bounds = {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    };
    const alone = bounds.x1 - bounds.x0 < 1 && bounds.y1 - bounds.y0 < 1;
    glide(
      alone
        ? framed(
            { x0: bounds.x0 - 1, y0: bounds.y0 - 1, x1: bounds.x0 + 1, y1: bounds.y0 + 1 },
            size,
            0,
            ONE_PERSON_K,
          )
        : framed(bounds, size, 90),
    );
  }, [target, byId, size, glide]);

  // Scroll zooms around the pointer, as on the tree.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const rect = element.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((now) => (now ? zoomAround(now, Math.exp(-event.deltaY * scale * 0.002), at) : now));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && placing) {
        onCancelPlace();
        return;
      }
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") zoomBy(1.8);
      else if (event.key === "-") zoomBy(1 / 1.8);
      else if (event.key === "f" || event.key === "F") showMalaysia();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, showMalaysia, placing, onCancelPlace]);

  // Drag to move, pinch to zoom around the point between the fingers (as on the timeline).
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const fingers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; view: View; at: Point } | null>(null);
  const dragged = useRef(false);
  const local = (event: MouseEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !view) return;
    fingers.current.set(event.pointerId, local(event));
    if (fingers.current.size === 2) {
      const [a, b] = [...fingers.current.values()] as [Point, Point];
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        view,
        at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      drag.current = null;
      dragged.current = true;
      return;
    }
    dragged.current = false;
    drag.current = { ...local(event), view, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, local(event));
    const pinching = pinch.current;
    if (pinching) {
      const [a, b] = [...fingers.current.values()];
      if (a && b) {
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        setView(zoomAround(pinching.view, distance / pinching.distance, pinching.at));
      }
      return;
    }
    const start = drag.current;
    if (!start) return;
    const here = local(event);
    const [dx, dy] = [here.x - start.x, here.y - start.y];
    if (!start.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setView({ ...start.view, x: start.view.x + dx, y: start.view.y + dy });
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    fingers.current.delete(event.pointerId);
    if (pinch.current) {
      if (fingers.current.size < 2) pinch.current = null;
      return;
    }
    dragged.current = drag.current?.moved ?? false;
    drag.current = null;
  };
  // Putting a place on the map by hand: a click, not a drag, says where it is.
  const onBackground = (event: MouseEvent<HTMLDivElement>) => {
    if (!placing || dragged.current || !view) return;
    const at = local(event);
    onPlace(fromPlane((at.x - view.x) / view.k, (at.y - view.y) / view.k));
  };

  const perKm = (view?.k ?? 1) * PLANE_PER_KM;
  const level = levelAt(perKm);
  const withNames = perKm >= NAMES_FROM;
  const spacing = withNames ? PHOTO + 30 : PHOTO + 4;

  const groups = useMemo((): Group[] => {
    if (!view) return [];
    const toScreen = (p: Point) => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });
    const middle = (state: string) => {
      const found = STATE_MIDDLES.get(state);
      return found ? { x: found[0], y: found[1] } : null;
    };
    const gathered = gather(spots, level, toScreen, middle);
    if (level !== "towns") return separate(gathered, (g) => bubbleRadius(g.members.length));
    const shown = (count: number) => (withNames ? count : Math.min(count, MOST));
    return mergeTowns(gathered, (g) =>
      g.towns > 1 ? bubbleRadius(g.members.length) : flowerRadius(shown(g.members.length), spacing),
    );
  }, [spots, level, view, withNames, spacing]);

  const visible = (at: Point) =>
    at.x > -MARGIN && at.y > -MARGIN && at.x < size.width + MARGIN && at.y < size.height + MARGIN;
  // A click on a circle zooms in on it, bringing it to the middle.
  const zoomInto = (group: Group) => {
    const now = current.current;
    if (!now) return;
    const k = Math.min(MAX_K, now.k * (level === "towns" ? 2.5 : 3));
    const [px, py] = [(group.at.x - now.x) / now.k, (group.at.y - now.y) / now.k];
    glide({ k, x: size.width / 2 - k * px, y: size.height / 2 - k * py });
  };
  const nameOf = (id: string) => people.get(id)?.full_name ?? "";

  // Drawn once, on the plane: zooming only moves and scales the layer they're in. Lines and
  // dots keep their width on screen whatever the zoom (non-scaling strokes).
  const borders = useMemo(
    () => (
      <>
        {[...BORDERS.world, ...BORDERS.region].map((shape) => (
          <path
            key={shape.name}
            d={shape.d}
            fill={LAND}
            stroke="#ffffff"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {BORDERS.states.map((shape) => (
          <path
            key={shape.name}
            d={shape.d}
            fill="#ffffff"
            stroke="#d6d3d1"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </>
    ),
    [],
  );
  const lines = useMemo(
    () =>
      moves?.map((move) => {
        const [dx, dy] = [move.to.x - move.from.x, move.to.y - move.from.y];
        const bend = {
          x: (move.from.x + move.to.x) / 2 - dy * 0.2,
          y: (move.from.y + move.to.y) / 2 + dx * 0.2,
        };
        const colour = colourOf(move.id) ?? "#78716c";
        return (
          <g key={move.id} opacity={faded && !faded.has(move.id) ? 0.15 : 0.55}>
            <path
              d={`M ${move.from.x} ${move.from.y} Q ${bend.x} ${bend.y} ${move.to.x} ${move.to.y}`}
              fill="none"
              stroke={colour}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
            {/* Where they were born: a dot, as a line of no length with round ends. */}
            <path
              d={`M ${move.from.x} ${move.from.y} h 0`}
              stroke={colour}
              strokeWidth={6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      }) ?? null,
    [moves, colourOf, faded],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click only says where a place is, when putting it on the map by hand, which needs a pointer. The keys (+, −, F, Esc) are the window's, and the list beside the map does everything else.
    <div
      ref={box}
      className={cn(
        "relative h-full touch-none overflow-hidden select-none",
        placing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
      )}
      style={{ background: SEA }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onBackground}
      role="application"
      aria-label="Map of where the family lives"
    >
      {view && (
        <svg className="absolute inset-0 size-full" aria-hidden="true">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {borders}
            {lines}
          </g>
        </svg>
      )}

      <div
        key={`${level}${withNames ? ":names" : ""}`}
        className="absolute inset-0 animate-in fade-in duration-300"
      >
        {groups
          .filter((group) => visible(group.at))
          .map((group) =>
            level !== "towns" || group.towns > 1 ? (
              <Bubble
                key={group.key}
                group={group}
                onOpen={() => zoomInto(group)}
                nameOf={nameOf}
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
                onMore={() => zoomInto(group)}
              />
            ),
          )}
      </div>

      {placing && (
        <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center">
          <div className="rounded-full bg-sky-700 px-4 py-1.5 text-sm text-white shadow">
            Click where {placing} is · Esc to cancel
          </div>
        </div>
      )}

      <div className="absolute bottom-3 left-3 flex flex-col gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(1.8)}>
          <PlusIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.8)}
        >
          <MinusIcon />
        </Button>
        <Button variant="outline" size="icon-sm" aria-label="Show Malaysia" onClick={showMalaysia}>
          <ScanIcon />
        </Button>
      </div>
      <div className="absolute right-2 bottom-1 text-[10px] text-stone-500">
        Places ©{" "}
        <a
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          GeoNames
        </a>{" "}
        · borders: Natural Earth
      </div>
    </div>
  );
}

/** A country's or a state's people as a number, or towns too close together to show apart. */
function Bubble({
  group,
  onOpen,
  nameOf,
}: {
  group: Group;
  onOpen: () => void;
  nameOf: (id: string) => string;
}) {
  const radius = bubbleRadius(group.members.length);
  const count = group.members.length;
  const what = group.towns > 1 ? `${group.label} and ${group.towns - 1} more` : group.label;
  const who = count === 1 ? nameOf(group.members[0] ?? "") : `${count} people`;
  return (
    <div
      className="absolute flex flex-col items-center"
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
          "flex items-center justify-center rounded-full border-2 font-semibold shadow-sm transition-transform hover:scale-105",
          group.rough
            ? "border-dashed border-stone-400 bg-white/90 text-stone-600"
            : "border-white bg-sky-600/85 text-white",
        )}
        style={{ width: radius * 2, height: radius * 2, fontSize: Math.min(18, 10 + radius / 5) }}
        aria-label={`${what}: ${who}. Zoom in`}
        title={`${what}: ${who}`}
      >
        {count}
      </button>
      <span className="mt-0.5 max-w-40 truncate rounded bg-white/80 px-1 text-xs font-medium text-stone-700">
        {what}
      </span>
    </div>
  );
}

/** A town's people, as their photos around its point, and its name. */
function Town({
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
  return (
    <div className="absolute" style={{ transform: `translate(${group.at.x}px, ${group.at.y}px)` }}>
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
              "absolute flex flex-col items-center rounded-full transition-transform hover:z-10 hover:scale-110",
              faded && !faded.has(id) && "opacity-30",
            )}
            style={{ transform: `translate(${at.x - PHOTO / 2}px, ${at.y - PHOTO / 2}px)` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(id);
            }}
            title={[person.full_name, years, group.label].filter(Boolean).join(" · ")}
            aria-label={`${person.full_name}, ${group.label}`}
          >
            <PersonAvatar
              person={person}
              size="sm"
              className={cn(
                "size-[34px] shadow-sm",
                group.rough && "border-dashed",
                id === selectedId && "ring-2 ring-sky-500 ring-offset-1",
              )}
              style={colour ? { borderColor: colour } : undefined}
            />
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
          className="absolute flex items-center justify-center rounded-full border-2 border-white bg-stone-700 text-xs font-semibold text-white shadow-sm"
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
