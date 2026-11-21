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
import type { GraphPerson, MapTown } from "@/api/types";
import { useEscape } from "@/lib/escape";
import { typing } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { DRAWING } from "@/styles/drawing";
import { AROUND_FEW, firstView, fitted, into, MAX_K, MIN_K, type View } from "./fit";
import { BORDERS, DISTRICT_NAMES, fromPlane, onPlane, PLANE_PER_KM } from "./geo";
import { BIG_TOWN, corners, type Label, type Placed, placeLabels, roomFor } from "./labels";
import {
  type Group,
  type Level,
  levelAt,
  NAMES_FROM,
  PHOTO,
  type Point,
  type Spot,
} from "./levels";
import { FamilyPlaces, familyGroups, groupNames, MapButtons, PlacingHint } from "./places";

/** Where a point of the plane is on screen, in a view. */
const toScreenAt = (view: View) => (p: Point) => ({
  x: p.x * view.k + view.x,
  y: p.y * view.k + view.y,
});

/** Someone who moved: from where they were born to where they live, on the plane. */
export type Move = { id: string; from: Point; to: Point };
/** Bring these people into view; a new `nonce` asks again. */
export type MapTarget = { ids: string[]; nonce: number };

const SEA = DRAWING.sea;
const LAND = DRAWING.land;
// The map's credits, in the corner no name on the map covers: their words at 12 px.
const CREDITS = { width: 350, height: 24 };

/**
 * The map: the borders, drawn once and scaled, and over them the
 * people for the zoom: a circle for each country or state with how many are there, then each
 * town's people as their photos, as on the tree and the timeline. From a state's zoom, the
 * districts and the towns around the family's places are named too. It opens on every
 * place the family is at. Scroll or pinch to zoom, drag to move; +, − and F as on the
 * tree.
 */
export function MapCanvas({
  spots,
  towns,
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
  generationOf,
}: {
  spots: Spot[];
  towns: MapTown[]; // around the family's places, the most worth naming first
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
  generationOf: (id: string) => number | undefined; // on the rings, for a bundle's eldest
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

  // It opens on everyone, wherever they are; on Malaysia while no one is placed.
  const points = useMemo(() => spots.map((spot) => ({ x: spot.x, y: spot.y })), [spots]);
  useEffect(() => {
    if (!view && size.width > 0) setView(firstView(points, size));
  }, [view, size, points]);

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

  const showEveryone = useCallback(() => glide(firstView(points, size)), [glide, points, size]);
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
    glide(fitted(found, size, AROUND_FEW));
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

  // Esc puts away a place being put on the map by hand, when nothing over it, a dialog, is
  // open, through useEscape.
  useEscape(onCancelPlace, placing !== null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") zoomBy(1.8);
      else if (event.key === "-") zoomBy(1 / 1.8);
      else if (event.key === "f" || event.key === "F") showEveryone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, showEveryone]);

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
  const deepest = (view?.k ?? 0) >= MAX_K * 0.99;

  // The family for the zoom: the countries' circles where the states' have no room.
  const shown = useMemo((): { level: Level; groups: Group[] } => {
    if (!view) return { level, groups: [] };
    return familyGroups(spots, level, toScreenAt(view), withNames, spacing, deepest);
  }, [spots, level, view, withNames, spacing, deepest]);
  const groups = shown.groups;
  // Their names, none over another, nor over the map's buttons and credits.
  const naming = useMemo(
    () =>
      groupNames(
        groups,
        shown.level,
        { withNames, spacing, people, generationOf },
        corners(size, CREDITS),
        size,
      ),
    [groups, shown.level, withNames, spacing, people, generationOf, size],
  );

  // The towns around the family's places, on the plane once.
  const named = useMemo(
    () =>
      towns.map((town, index) => {
        const [x, y] = onPlane(town.lat, town.lon);
        return { key: `town:${index}`, text: town.name, x, y, big: town.people >= BIG_TOWN };
      }),
    [towns],
  );
  // The names besides the family's, from a state's zoom: each district with room for its
  // name, first, as there are few and they give the land its shape; then the bigger towns
  // around the family's places; closer, the kampungs too. None covers another, nor the
  // family's photos, circles and their names.
  const labels = useMemo((): Placed[] => {
    if (!view || level !== "towns") return [];
    const toScreen = (x: number, y: number) => ({ x: x * view.k + view.x, y: y * view.k + view.y });
    const close = perKm >= NAMES_FROM;
    const wanted: Label[] = [
      ...DISTRICT_NAMES.flatMap((area, index): Label[] =>
        roomFor(area, view.k, area.name)
          ? [
              {
                key: `district:${index}`,
                text: area.name,
                at: toScreen(area.x, area.y),
                kind: "district",
              },
            ]
          : [],
      ),
      ...named.flatMap((town): Label[] =>
        town.big
          ? [{ key: town.key, text: town.text, at: toScreen(town.x, town.y), kind: "town" }]
          : [],
      ),
      ...named.flatMap((town): Label[] =>
        close && !town.big
          ? [{ key: town.key, text: town.text, at: toScreen(town.x, town.y), kind: "place" }]
          : [],
      ),
    ];
    return placeLabels(wanted, naming.taken, size);
  }, [named, view, level, perKm, naming, size]);

  // A click on a circle zooms in on it. A country's or a state's: to its people, deep enough
  // that it parts into its states or towns, at any size of window. Towns too close
  // together, or a town's "+8": a little closer, bringing it to the middle.
  const zoomInto = (group: Group) => {
    const now = current.current;
    if (!now) return;
    if (shown.level !== "towns") {
      const members = group.members.flatMap((id) => byId.get(id) ?? []);
      const parted = (then: View) =>
        !familyGroups(
          spots,
          levelAt(then.k * PLANE_PER_KM),
          toScreenAt(then),
          false,
          PHOTO + 4,
        ).groups.some((other) => other.key === group.key);
      glide(into(members, now, size, parted));
      return;
    }
    const k = Math.min(MAX_K, now.k * 2.5);
    const [px, py] = [(group.at.x - now.x) / now.k, (group.at.y - now.y) / now.k];
    glide({ k, x: size.width / 2 - k * px, y: size.height / 2 - k * py });
  };
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
            stroke={DRAWING.paper}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {BORDERS.states.map((shape) => (
          <path
            key={shape.name}
            d={shape.d}
            fill={DRAWING.paper}
            stroke={DRAWING.coast}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* The nearby countries' states and provinces, drawn as Malaysia's are. */}
        <path
          d={BORDERS.provinces}
          fill="none"
          stroke={DRAWING.coast}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </>
    ),
    [],
  );
  // Malaysia's and Indonesia's districts, lighter than a state's border, from a state's
  // zoom.
  const districts = useMemo(
    () => (
      <path
        d={BORDERS.districts}
        fill="none"
        stroke={DRAWING.coast}
        strokeWidth={0.75}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
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
        const colour = colourOf(move.id) ?? DRAWING.uncoloured;
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
            {level === "towns" && districts}
            {lines}
          </g>
        </svg>
      )}

      {labels.length > 0 && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {labels.map((label) =>
            label.kind === "district" ? (
              <span
                key={label.key}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-xs whitespace-nowrap text-faint italic"
                style={{ left: label.at.x, top: label.at.y }}
              >
                {label.text}
              </span>
            ) : (
              <span
                key={label.key}
                className={cn(
                  "absolute flex -translate-y-1/2 items-center gap-1 whitespace-nowrap [text-shadow:0_0_2px_var(--card),0_0_2px_var(--card)]",
                  label.kind === "town" ? "text-xs text-muted-foreground" : "text-xs text-faint",
                )}
                style={{ left: label.at.x - 2.5, top: label.at.y }}
              >
                <span className="size-[5px] shrink-0 rounded-full bg-faint" />
                {label.text}
              </span>
            ),
          )}
        </div>
      )}

      <FamilyPlaces
        key={`${shown.level}${withNames ? ":names" : ""}`}
        groups={groups}
        level={shown.level}
        size={size}
        withNames={withNames}
        spacing={spacing}
        people={people}
        colourOf={colourOf}
        faded={faded}
        selectedId={selectedId}
        onSelect={onSelect}
        onZoomInto={zoomInto}
        spotOf={(id) => byId.get(id)}
        screenOf={(id) => {
          const spot = byId.get(id);
          return spot && view ? { x: spot.x * view.k + view.x, y: spot.y * view.k + view.y } : null;
        }}
        generationOf={generationOf}
        deepest={deepest}
        names={naming.names}
      />

      {placing && <PlacingHint placing={placing} />}

      <MapButtons onZoomBy={zoomBy} onShowEveryone={showEveryone} />
      <div className="absolute right-0 bottom-0 rounded-tl bg-card/80 px-1.5 text-xs text-faint">
        Places ©{" "}
        <a
          href="https://www.geonames.org/"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          GeoNames
        </a>{" "}
        · borders: Natural Earth,{" "}
        <a
          href="https://www.geoboundaries.org/"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          geoBoundaries
        </a>
      </div>
    </div>
  );
}
