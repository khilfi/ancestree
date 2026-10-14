import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useRef } from "react";
import type { MapPack } from "@/api/types";
import { mapStyle } from "@/features/map/style";

maplibregl.setWorkerUrl(workerUrl);

// How close the small map opens, by how exactly the pin is known: a house or a pin put
// by hand at a street's scale, a postcode's area at a district's, a town's at the town's.
const ZOOM = { spot: 16, hand: 16, street: 15, postcode: 13, town: 12 } as const;
export type Exactness = keyof typeof ZOOM;

/**
 * The person form's small map: where a place's pin went, on
 * the map's packs, as the map draws them. Drag the pin, or click the right spot, to put it
 * there by hand. With no pin yet, it opens around `around`, the town or the country, and a
 * click puts one.
 */
export default function SmallMap({
  pin,
  around,
  exact,
  regions,
  online,
  label,
  onMove,
}: {
  pin: { lat: number; lon: number } | null;
  around: { lat: number; lon: number; zoom: number };
  exact: Exactness | null;
  regions: MapPack[];
  online: boolean;
  label: string; // "Lives in", for the map's name
  onMove: (point: { lat: number; lon: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const moved = useRef(onMove);
  moved.current = onMove;

  // Made once, around the pin or where it would go.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the pin follows, below
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const made = new maplibregl.Map({
      container: element,
      style: mapStyle(window.location.origin, regions, online),
      center: pin ? [pin.lon, pin.lat] : [around.lon, around.lat],
      zoom: pin ? ZOOM[exact ?? "hand"] : around.zoom,
      maxZoom: 16,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false, // the main map's corner names who made it
      localIdeographFontFamily: "sans-serif",
    });
    made.touchZoomRotate.disableRotation();
    made.on("click", (event) => moved.current({ lat: event.lngLat.lat, lon: event.lngLat.lng }));
    map.current = made;
    const observer = new ResizeObserver(() => made.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      made.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // The pin, where it is now: dragged by hand, or placed from the address.
  // biome-ignore lint/correctness/useExhaustiveDependencies: its numbers stand for the pin
  useEffect(() => {
    const made = map.current;
    if (!made) return;
    if (!pin) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const placed = new maplibregl.Marker({ draggable: true, color: "#0369a1" })
        .setLngLat([pin.lon, pin.lat])
        .addTo(made);
      placed.getElement().setAttribute("aria-label", `${label}: the pin, to drag`);
      placed.on("dragend", () => {
        const where = placed.getLngLat();
        moved.current({ lat: where.lat, lon: where.lng });
      });
      marker.current = placed;
    } else marker.current.setLngLat([pin.lon, pin.lat]);
    if (!made.getBounds().contains([pin.lon, pin.lat])) {
      made.jumpTo({ center: [pin.lon, pin.lat], zoom: ZOOM[exact ?? "hand"] });
    }
  }, [pin?.lat, pin?.lon, exact, label]);

  return (
    <div
      ref={box}
      role="application"
      aria-label={`${label}: a small map, to put the pin where it is`}
      className="h-56 w-full overflow-hidden rounded-lg border border-stone-200"
    />
  );
}
