import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphPerson, MapPack } from "@/api/types";
import { useEscape } from "@/lib/escape";
import { typing } from "@/lib/keyboard";
import { DRAWING } from "@/styles/drawing";
import { cameraOf, firstView, into, type Size, type View, viewOf } from "./fit";
import { fromPlane, PLANE_PER_KM } from "./geo";
import { corners } from "./labels";
import {
  type Group,
  type Level,
  levelAt,
  NAMES_FROM,
  PHOTO,
  type Point,
  type Spot,
} from "./levels";
import type { MapTarget, Move } from "./MapCanvas";
import { FamilyPlaces, familyGroups, groupNames, MapButtons, PlacingHint } from "./places";
import { mapStyle, perKmAt, zoomFor } from "./style";

const ONE_PERSON_PER_KM = 3; // a person found alone is shown at the towns, as on today's map
// The regions' packs go to zooms 13 and 14, enlarged past them: on to 19, about 0.15 m a
// pixel, so people a few metres apart stand apart.
const MOST_ZOOM = 19;

// MapLibre's worker, a file of its own beside the app's pages, as the page's policy allows.
maplibregl.setWorkerUrl(workerUrl);

/** The size of the map's box. */
const sized = (element: HTMLElement): Size => ({
  width: element.clientWidth,
  height: element.clientHeight,
});

function Credit({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/**
 * The map drawn by MapLibre from the map's packs: OpenStreetMap's
 * land, water, roads and names as you zoom in, and over them the family as today's map shows
 * it, worked out again for each view, opening on every place the family is at. Drag,
 * scroll and pinch as on any map; +, − and F as on the tree. A copy, and a computer without
 * WebGL 2 or the world's pack, keep today's map. With the online extra on, OpenFreeMap's
 * tiles where the packs end, until it can't be reached.
 */
export default function MapLibreCanvas({
  spots,
  regions,
  online,
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
  onCannotDraw,
  generationOf,
}: {
  spots: Spot[];
  regions: MapPack[]; // the regions' packs on this computer
  online: boolean; // the online extra, chosen in Settings → Map
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
  onCannotDraw: () => void; // WebGL failed after all: today's map then
  generationOf: (id: string) => number | undefined; // on the rings, for a bundle's eldest
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [frame, setFrame] = useState(0); // each new view, so the family is worked out again
  const [size, setSize] = useState({ width: 0, height: 0 });
  const regionsKey = regions.map((pack) => pack.key).join(",");
  // OpenFreeMap out of reach, or the internet: the packs alone, until the map opens again.
  const [unreachable, setUnreachable] = useState(false);
  const drawOnline = online && !unreachable;
  // Everyone's places, on the plane: the first view, and F's, shows them all.
  const points = useMemo(() => spots.map((spot) => ({ x: spot.x, y: spot.y })), [spots]);
  const pointsNow = useRef(points);
  pointsNow.current = points;

  // Made once; it opens on everyone, wherever they are.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the style follows the regions below
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let made: maplibregl.Map;
    const first = cameraOf(firstView(pointsNow.current, sized(element)), sized(element));
    try {
      made = new maplibregl.Map({
        container: element,
        style: mapStyle(window.location.origin, regions, drawOnline),
        center: first.center,
        zoom: first.zoom,
        maxZoom: MOST_ZOOM,
        minZoom: 1,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        keyboard: false, // + − F are the window's, as on the tree
        attributionControl: false, // the map's own credits, below, in the order they're owed
        localIdeographFontFamily: "sans-serif", // Chinese, Japanese and Korean names
      });
    } catch {
      onCannotDraw();
      return;
    }
    made.touchZoomRotate.disableRotation();
    const moved = () => setFrame((count) => count + 1);
    made.on("move", moved);
    made.on("resize", () => setSize({ width: element.clientWidth, height: element.clientHeight }));
    made.on("webglcontextlost", onCannotDraw);
    // Said where it can be found: a tile, font or icon that couldn't be read. A tile the engine
    // couldn't fetch from OpenFreeMap leaves the map to the packs.
    made.on("error", (event) => {
      if ((event as { sourceId?: string }).sourceId === "online") setUnreachable(true);
      console.warn("The map:", event.error?.message ?? event);
    });
    setSize({ width: element.clientWidth, height: element.clientHeight });
    map.current = made;
    const observer = new ResizeObserver(() => made.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      made.remove();
      map.current = null;
    };
  }, []);

  // A region fetched or removed in Settings → Map is drawn, or not, at once, and so is the
  // online extra: the map was made with the regions there were. The style is replaced whole:
  // MapLibre's diff can give a layer a highest zoom, but never take one away.
  const styleKey = `${regionsKey}${drawOnline ? "+online" : ""}`;
  const styled = useRef(styleKey);
  // biome-ignore lint/correctness/useExhaustiveDependencies: styleKey stands for the regions
  useEffect(() => {
    if (styled.current === styleKey) return;
    styled.current = styleKey;
    map.current?.setStyle(mapStyle(window.location.origin, regions, drawOnline), { diff: false });
  }, [styleKey]);

  const view = map.current;
  const center = view?.getCenter();
  const perKm = view && center ? perKmAt(view.getZoom(), center.lat) : 1;
  const level = levelAt(perKm);
  const withNames = perKm >= NAMES_FROM;
  const spacing = withNames ? PHOTO + 30 : PHOTO + 4;
  const deepest = view ? view.getZoom() >= MOST_ZOOM - 0.05 : false;

  // A point of the plane (geo.ts), where MapLibre shows it.
  const toScreen = useCallback((point: Point): Point => {
    const shown = map.current;
    if (!shown) return { x: -1e6, y: -1e6 };
    const { lat, lon } = fromPlane(point.x, point.y);
    const at = shown.project([lon, lat]);
    return { x: at.x, y: at.y };
  }, []);

  // The family for the zoom: the countries' circles where the states' have no room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: frame stands for the view
  const shown = useMemo(
    (): { level: Level; groups: Group[] } =>
      view
        ? familyGroups(spots, level, toScreen, withNames, spacing, deepest)
        : { level, groups: [] },
    [spots, level, withNames, spacing, frame, view, toScreen, deepest],
  );
  const groups = shown.groups;
  // Their names, none over another, nor over the map's buttons and credits.
  const [credits, setCredits] = useState({ width: 0, height: 0 });
  const creditsBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = creditsBox.current;
    if (!element) return;
    const measure = () => setCredits({ width: element.offsetWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const naming = useMemo(
    () =>
      groupNames(
        groups,
        shown.level,
        { withNames, spacing, people, generationOf },
        corners(size, credits),
        size,
      ),
    [groups, shown.level, withNames, spacing, people, generationOf, size, credits],
  );

  // A click on a circle zooms in on it. A country's or a state's: to its people, deep enough
  // that it parts, worked out on the plane as today's map does. Towns too close together:
  // a little closer, bringing them to the middle.
  const zoomInto = (group: Group) => {
    const made = map.current;
    const element = box.current;
    if (!made || !element) return;
    if (shown.level !== "towns") {
      const screen = sized(element);
      const middle = made.getCenter();
      const now = viewOf({ lat: middle.lat, lon: middle.lng }, made.getZoom(), screen);
      const members = group.members.flatMap((id) => byId.get(id) ?? []);
      const parted = (then: View) =>
        !familyGroups(
          spots,
          levelAt(then.k * PLANE_PER_KM),
          (p) => ({ x: p.x * then.k + then.x, y: p.y * then.k + then.y }),
          false,
          PHOTO + 4,
        ).groups.some((other) => other.key === group.key);
      const camera = cameraOf(into(members, now, screen, parted), screen);
      glideTo({ ...camera, zoom: Math.min(MOST_ZOOM, camera.zoom) });
      return;
    }
    glideTo({
      center: made.unproject([group.at.x, group.at.y]),
      zoom: Math.min(MOST_ZOOM, made.getZoom() + Math.log2(2.5)),
    });
  };

  const glideTo = useCallback((options: maplibregl.EaseToOptions) => {
    map.current?.easeTo({ ...options, duration: 350 });
  }, []);
  const zoomBy = useCallback(
    (factor: number) => {
      const shown = map.current;
      if (shown) glideTo({ zoom: Math.min(MOST_ZOOM, shown.getZoom() + Math.log2(factor)) });
    },
    [glideTo],
  );
  const showEveryone = useCallback(() => {
    const element = box.current;
    if (element) glideTo(cameraOf(firstView(pointsNow.current, sized(element)), sized(element)));
  }, [glideTo]);

  // Bring people into view: those in a state or town chosen in the list, or someone found.
  const byId = useMemo(() => new Map(spots.map((spot) => [spot.id, spot])), [spots]);
  // Where each really is, for a bundle opened where it is.
  const screenOf = (id: string) => {
    const spot = byId.get(id);
    return spot ? toScreen(spot) : null;
  };
  const lastTarget = useRef<number | null>(null);
  useEffect(() => {
    const shown = map.current;
    if (!shown || !target || lastTarget.current === target.nonce) return;
    const found = target.ids
      .map((id) => byId.get(id))
      .filter((spot): spot is Spot => !!spot)
      .map((spot) => fromPlane(spot.x, spot.y));
    if (!found.length) return;
    lastTarget.current = target.nonce;
    const lons = found.map((point) => point.lon);
    const lats = found.map((point) => point.lat);
    const bounds: [number, number, number, number] = [
      Math.min(...lons),
      Math.min(...lats),
      Math.max(...lons),
      Math.max(...lats),
    ];
    const alone = bounds[2] - bounds[0] < 0.01 && bounds[3] - bounds[1] < 0.01;
    if (alone) {
      const [lon, lat] = [bounds[0], bounds[1]];
      glideTo({ center: [lon, lat], zoom: zoomFor(ONE_PERSON_PER_KM, lat) });
    } else {
      shown.fitBounds(bounds, { padding: 90, maxZoom: MOST_ZOOM, duration: 350 });
    }
  }, [target, byId, glideTo]);

  // Putting a place on the map by hand: a click, not a drag, says where it is.
  const placingNow = useRef<{ placing: string | null; onPlace: typeof onPlace }>({
    placing,
    onPlace,
  });
  placingNow.current = { placing, onPlace };
  useEffect(() => {
    const shown = map.current;
    if (!shown) return;
    const clicked = (event: maplibregl.MapMouseEvent) => {
      const now = placingNow.current;
      if (now.placing) now.onPlace({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    };
    shown.on("click", clicked);
    return () => {
      shown.off("click", clicked);
    };
  }, []);
  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = placing ? "crosshair" : "";
  }, [placing]);

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

  return (
    <div
      className="relative h-full overflow-hidden select-none"
      role="application"
      aria-label="Map of where the family lives"
    >
      {/* Sized whole: MapLibre's own styles make its container "position: relative". */}
      <div ref={box} className="size-full" />

      {view && moves && (
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {moves.map((move) => {
            const [from, to] = [toScreen(move.from), toScreen(move.to)];
            const [dx, dy] = [to.x - from.x, to.y - from.y];
            const bend = { x: (from.x + to.x) / 2 - dy * 0.2, y: (from.y + to.y) / 2 + dx * 0.2 };
            const colour = colourOf(move.id) ?? DRAWING.uncoloured;
            return (
              <g key={move.id} opacity={faded && !faded.has(move.id) ? 0.15 : 0.55}>
                <path
                  d={`M ${from.x} ${from.y} Q ${bend.x} ${bend.y} ${to.x} ${to.y}`}
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.5}
                />
                <circle cx={from.x} cy={from.y} r={3} fill={colour} />
              </g>
            );
          })}
        </svg>
      )}

      {view && (
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
          screenOf={screenOf}
          generationOf={generationOf}
          deepest={deepest}
          names={naming.names}
        />
      )}

      {placing && <PlacingHint placing={placing} />}

      <MapButtons onZoomBy={zoomBy} onShowEveryone={showEveryone} />
      {/* OpenStreetMap's first, and always shown, as its licence asks. */}
      <div
        ref={creditsBox}
        className="absolute right-0 bottom-0 max-w-full rounded-tl bg-card/70 px-1.5 text-right text-xs text-muted-foreground"
      >
        © <Credit href="https://www.openstreetmap.org/copyright">OpenStreetMap</Credit> ·{" "}
        <Credit href="https://protomaps.com/">Protomaps</Credit> · Places ©{" "}
        <Credit href="https://www.geonames.org/">GeoNames</Credit> · borders:{" "}
        <Credit href="https://www.geoboundaries.org/">geoBoundaries</Credit>, Natural Earth
        {drawOnline && (
          <>
            {" "}
            · <Credit href="https://openfreemap.org/">OpenFreeMap</Credit> ©{" "}
            <Credit href="https://www.openmaptiles.org/">OpenMapTiles</Credit>
          </>
        )}
        {online && unreachable && <> · OpenFreeMap can't be reached</>}
      </div>
    </div>
  );
}
