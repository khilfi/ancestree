import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphPerson, MapPack } from "@/api/types";
import { typing } from "@/lib/keyboard";
import { fromPlane } from "./geo";
import { type Group, levelAt, NAMES_FROM, PHOTO, type Point, type Spot } from "./levels";
import type { MapTarget, Move } from "./MapCanvas";
import { FamilyPlaces, familyGroups, MapButtons, PlacingHint } from "./places";
import { mapStyle, perKmAt, zoomFor } from "./style";

// Malaysia, as the map opens and as F shows it: west, south, east, north.
const MALAYSIA: [number, number, number, number] = [99.6, 0.85, 119.3, 7.4];
const ONE_PERSON_PER_KM = 3; // a person found alone is shown at the towns, as on today's map
const MOST_ZOOM = 16; // the regions' packs go to zooms 13 and 14, enlarged past them

// MapLibre's worker, a file of its own beside the app's pages, as the page's policy allows.
maplibregl.setWorkerUrl(workerUrl);

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
 * it, worked out again for each view. Drag, scroll and pinch as on any map; +, − and F as on the
 * tree. A copy, and a computer without WebGL 2 or the world's pack, keep today's map. With the
 * online extra on, OpenFreeMap's tiles where the packs end, until it can't be reached.
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

  // Made once; it opens on Malaysia.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the style follows the regions below
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let made: maplibregl.Map;
    try {
      made = new maplibregl.Map({
        container: element,
        style: mapStyle(window.location.origin, regions, drawOnline),
        bounds: MALAYSIA,
        fitBoundsOptions: { padding: 24 },
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

  // A point of the plane (geo.ts), where MapLibre shows it.
  const toScreen = useCallback((point: Point): Point => {
    const shown = map.current;
    if (!shown) return { x: -1e6, y: -1e6 };
    const { lat, lon } = fromPlane(point.x, point.y);
    const at = shown.project([lon, lat]);
    return { x: at.x, y: at.y };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame stands for the view
  const groups = useMemo(
    (): Group[] => (view ? familyGroups(spots, level, toScreen, withNames, spacing) : []),
    [spots, level, withNames, spacing, frame, view, toScreen],
  );

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
  const showMalaysia = useCallback(
    () => map.current?.fitBounds(MALAYSIA, { padding: 24, duration: 350 }),
    [],
  );
  // A click on a circle zooms in on it, bringing it to the middle.
  const zoomInto = (group: Group) => {
    const shown = map.current;
    if (!shown) return;
    const more = Math.log2(level === "towns" ? 2.5 : 3);
    glideTo({
      center: shown.unproject([group.at.x, group.at.y]),
      zoom: Math.min(MOST_ZOOM, shown.getZoom() + more),
    });
  };

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
            const colour = colourOf(move.id) ?? "#78716c";
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
          key={`${level}${withNames ? ":names" : ""}`}
          groups={groups}
          level={level}
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
          deepest={view.getZoom() >= MOST_ZOOM - 0.05}
        />
      )}

      {placing && <PlacingHint placing={placing} />}

      <MapButtons onZoomBy={zoomBy} onShowMalaysia={showMalaysia} />
      {/* OpenStreetMap's first, and always shown, as its licence asks. */}
      <div className="absolute right-0 bottom-0 max-w-full rounded-tl bg-white/70 px-1.5 text-right text-[10px] text-stone-600">
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
