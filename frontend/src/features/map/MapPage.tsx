import { ListIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  useFamilyMap,
  useGraph,
  usePutPin,
  useRemovePin,
  useSampleGraph,
  useSampleMap,
  useTreeSettings,
} from "@/api/queries";
import type { GraphPerson, Place } from "@/api/types";
import { useCopy } from "@/app/copy";
import { StartAdvice } from "@/app/StartAdvice";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ClosenessKey } from "@/features/me/ClosenessKey";
import { useMeId } from "@/features/me/useMeId";
import { PersonPanel } from "@/features/person/PersonPanel";
import { useMoveToTrash } from "@/features/person/useMoveToTrash";
import { FilterChips, FilterMenu } from "@/features/tree/FilterMenu";
import { applyFilter, readView, withView, writeView } from "@/features/tree/filters";
import { colourer } from "@/features/tree/toFlow";
import { useNarrow, useTouch } from "@/lib/media";
import { showError } from "@/lib/notify";
import { formatPlace } from "@/lib/people";
import { onPlane } from "./geo";
import type { Spot } from "./levels";
import { MapCanvas, type MapTarget, type Move } from "./MapCanvas";
import { WhereList } from "./WhereList";

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-stone-500">
      <div className="max-w-md space-y-2">{children}</div>
    </div>
  );
}

/**
 * The map: where the family lives, or was born, with the same side
 * panel as the tree. Which places, Moves and the tree's filters are in the address, so Back
 * undoes them. `?sample=2000` shows the made-up family, spread over real towns.
 */
export function MapPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const touch = useTouch();
  const editable = useCopy() === null; // pins are the app's own, never a copy's
  const sample = Math.min(5000, Math.max(0, Number(params.get("sample")) || 0));
  const realGraph = useGraph(sample === 0);
  const madeGraph = useSampleGraph(sample || 10, sample > 0);
  const realMap = useFamilyMap(sample === 0);
  const madeMap = useSampleMap(sample || 10, sample > 0);
  const graph = sample ? madeGraph : realGraph;
  const map = sample ? madeMap : realMap;
  const selectedId = sample ? null : params.get("person");
  const view = readView(params);
  const field = params.get("by") === "born" ? "birth_place" : "residence";
  const showMoves = params.get("moves") === "1";
  const own = useMemo(
    () => ({
      ...(field === "birth_place" ? { by: "born" } : {}),
      ...(showMoves ? { moves: "1" } : {}),
      ...(sample ? { sample: String(sample) } : {}),
    }),
    [field, showMoves, sample],
  );
  // The map's own choices go along with every change of address; an empty one is dropped.
  const go = (next: Record<string, string>) =>
    setParams(
      withView(
        params,
        Object.fromEntries(Object.entries({ ...own, ...next }).filter(([, value]) => value)),
      ),
    );
  const select = (id: string) => go({ person: id });
  const close = () => go({});
  const moveToTrash = useMoveToTrash(close, select);
  const [listOpen, setListOpen] = useState(!narrow);

  const settings = useTreeSettings();
  const colours = sample ? "branch" : (settings.data?.colours ?? "branch");
  const meId = useMeId();
  const me = sample ? null : meId;
  const viewKey = writeView(view).toString();
  const family = graph.data;
  // biome-ignore lint/correctness/useExhaustiveDependencies: viewKey stands for the view
  const kept = useMemo(() => (family ? applyFilter(family, view.filter) : null), [family, viewKey]);
  const hideOthers = view.filter.others === "hidden";
  const colourOf = useMemo(
    () => (family ? colourer(family, colours, me) : () => null),
    [family, colours, me],
  );
  const people = useMemo(
    () => new Map((family?.people ?? []).map((person) => [person.id, person])),
    [family],
  );

  // Everyone the filter shows, where their place is, and those it can't place.
  const found = useMemo(() => {
    const spots: Spot[] = [];
    const moves: Move[] = [];
    const rough: { person: GraphPerson; place: Place }[] = [];
    const missing: GraphPerson[] = [];
    const unfound: { person: GraphPerson; place: Place }[] = [];
    for (const entry of map.data?.people ?? []) {
      const person = people.get(entry.id);
      if (!person || (hideOthers && kept && !kept.has(entry.id))) continue;
      const located = field === "residence" ? entry.lives : entry.born;
      if (!located) {
        missing.push(person);
        continue;
      }
      if (located.lat == null || located.lon == null) {
        unfound.push({ person, place: located.place });
        continue;
      }
      const [x, y] = onPlane(located.lat, located.lon);
      const isRough = located.found === "state" || located.found === "country";
      spots.push({
        id: entry.id,
        x,
        y,
        place: located.name ?? located.place.town ?? located.country,
        state: located.state ?? null,
        country: located.country,
        rough: isRough,
      });
      if (isRough) rough.push({ person, place: located.place });
      const { lives, born } = entry;
      if (lives?.lat != null && lives.lon != null && born?.lat != null && born.lon != null) {
        const [fx, fy] = onPlane(born.lat, born.lon);
        const [tx, ty] = onPlane(lives.lat, lives.lon);
        if (Math.hypot(tx - fx, ty - fy) > 0.5) {
          moves.push({ id: entry.id, from: { x: fx, y: fy }, to: { x: tx, y: ty } });
        }
      }
    }
    missing.sort((a, b) => a.full_name.localeCompare(b.full_name));
    return { spots, moves, rough, missing, unfound };
  }, [map.data, people, field, hideOthers, kept]);

  // Brought into view: a state or town chosen in the list, or someone found by search.
  const [target, setTarget] = useState<MapTarget | null>(null);
  const show = useCallback((ids: string[]) => setTarget({ ids, nonce: Date.now() }), []);
  const focusId = params.has("focus") ? selectedId : null;
  useEffect(() => {
    if (!focusId || !map.data) return;
    show([focusId]);
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
  }, [focusId, map.data, show, setParams]);

  // Putting a place on the map by hand: click where it is.
  const [placing, setPlacing] = useState<Place | null>(null);
  const putPin = usePutPin();
  const removePin = useRemovePin();
  const place = (point: { lat: number; lon: number }) => {
    if (!placing) return;
    putPin.mutate({ ...placing, ...point }, { onError: showError });
    setPlacing(null);
  };

  let content: ReactNode;
  if (graph.isPending || map.isPending) {
    content = <Message>Loading the map…</Message>;
  } else if (graph.isError || map.isError) {
    content = (
      <Message>
        <p className="font-medium text-stone-700">Could not load the map.</p>
        <p className="text-sm">
          <StartAdvice />
        </p>
      </Message>
    );
  } else {
    const list = (
      <WhereList
        field={field}
        spots={found.spots}
        people={people}
        rough={found.rough}
        missing={found.missing}
        unfound={found.unfound}
        pins={map.data?.pins ?? []}
        editable={editable && !sample}
        onShow={show}
        onSelect={sample ? () => {} : select}
        onPlace={setPlacing}
        onRemovePin={(pin) => removePin.mutate(pin, { onError: showError })}
      />
    );
    content = (
      <div className="flex h-full flex-col bg-stone-50">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-stone-600">
            Show
            <Select
              value={field}
              onValueChange={(value) =>
                go({
                  ...(selectedId ? { person: selectedId } : {}),
                  by: value === "birth_place" ? "born" : "",
                })
              }
            >
              <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Which places">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="residence">Where they live</SelectItem>
                <SelectItem value="birth_place">Where they were born</SelectItem>
              </SelectContent>
            </Select>
          </span>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control */}
          <label className="flex items-center gap-2 text-stone-600">
            <Switch
              checked={showMoves}
              onCheckedChange={(on) =>
                go({ ...(selectedId ? { person: selectedId } : {}), moves: on ? "1" : "" })
              }
            />
            Moves
          </label>
          {family && (
            <FilterMenu
              graph={family}
              filter={view.filter}
              onChange={(filter) => setParams((now) => writeView({ ...view, filter }, now))}
              selectedId={selectedId}
            />
          )}
          <span className="text-xs text-stone-500">
            {touch ? "Pinch to zoom · drag to move" : "Scroll to zoom · drag to move"}
          </span>
          <Button
            variant={listOpen ? "secondary" : "outline"}
            size="sm"
            className="ml-auto"
            onClick={() => setListOpen((now) => !now)}
            aria-pressed={listOpen}
          >
            <ListIcon />
            {found.spots.length} placed
          </Button>
        </div>
        {!sample && colours === "closeness" && (
          <div className="shrink-0 border-b border-stone-200 bg-white px-3 py-1.5">
            <ClosenessKey chosen={me !== null} />
          </div>
        )}
        {family && (
          <div className="shrink-0 border-b border-stone-200 bg-white px-3 py-1.5 empty:hidden">
            <FilterChips
              graph={family}
              filter={view.filter}
              onChange={(filter) => setParams((now) => writeView({ ...view, filter }, now))}
              shown={kept ? [...kept].filter((id) => !people.get(id)?.placeholder).length : null}
            />
          </div>
        )}
        <div className="relative flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1">
            <MapCanvas
              spots={found.spots}
              moves={showMoves ? found.moves : null}
              people={people}
              colourOf={colourOf}
              faded={hideOthers ? null : kept}
              selectedId={selectedId}
              onSelect={sample ? undefined : select}
              target={target}
              placing={placing ? formatPlace(placing) || placing.country : null}
              onPlace={place}
              onCancelPlace={() => setPlacing(null)}
            />
          </div>
          {listOpen &&
            (narrow ? (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-white">{list}</div>
            ) : (
              <div className="w-72 shrink-0 overflow-y-auto border-l border-stone-200 bg-white">
                {list}
              </div>
            ))}
        </div>
      </div>
    );
  }

  const panel = selectedId && (
    <PersonPanel
      key={selectedId}
      personId={selectedId}
      onSelect={select}
      onClose={close}
      onDelete={moveToTrash}
      onFindRelationship={(id) =>
        navigate(`/tree?${withView(params, { person: id, relate: "pick" })}`)
      }
    />
  );

  if (narrow) {
    // A phone: the panel takes the whole screen.
    return (
      <div className="relative h-full">
        {content}
        {panel && <div className="absolute inset-0 z-20 bg-white">{panel}</div>}
      </div>
    );
  }
  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel id="map" minSize="30">
        {content}
      </ResizablePanel>
      {panel && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="person" defaultSize={440} minSize={340} maxSize="60">
            {panel}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
