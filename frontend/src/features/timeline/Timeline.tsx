import { ChevronDownIcon, ChevronRightIcon, MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTreeSettings } from "@/api/queries";
import type { Graph, GraphPerson } from "@/api/types";
import { useCanEdit } from "@/app/copy";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClosenessKey } from "@/features/me/ClosenessKey";
import { useMeId } from "@/features/me/useMeId";
import { FilterChips, FilterMenu } from "@/features/tree/FilterMenu";
import { applyFilter, NO_FILTER, type TreeFilter, writeView } from "@/features/tree/filters";
import { colourer } from "@/features/tree/toFlow";
import { shortName } from "@/features/tree/words";
import { typing } from "@/lib/keyboard";
import { useTouch } from "@/lib/media";
import { cn } from "@/lib/utils";
import {
  arrange,
  fitAll,
  GROUP_HEIGHT,
  type Grouping,
  LANE_HEIGHT,
  panBy,
  type Row,
  type Sorting,
  type Span,
  type Standing,
  spans,
  standings,
  type View,
  visibleRows,
  yearNow,
  yearTicks,
  zoomAround,
} from "./lanes";

const GREY = "#a8a29e";
const SOFT = 18; // px: how far an approximate date's bar end fades

/**
 * Everyone on a year axis: a photo at the birth year and a bar across
 * the lifetime, to today for the living. Scroll to zoom, drag to move; only the lanes in
 * view are drawn, so a family of any size stays smooth.
 */
export function Timeline({
  graph,
  selectedId,
  onSelect,
  focusId = null,
  onFocused,
  filter = NO_FILTER,
  onFilter,
}: {
  graph: Graph;
  selectedId: string | null;
  onSelect?: (id: string) => void; // none for the sample family
  focusId?: string | null; // scroll to this person (after a search)
  onFocused?: () => void;
  filter?: TreeFilter; // shared with the tree, from the address
  onFilter?: (filter: TreeFilter) => void;
}) {
  const settings = useTreeSettings();
  const canEdit = useCanEdit("change");
  const touch = useTouch();
  const colours = settings.data?.colours ?? "branch";
  const [grouping, setGrouping] = useState<Grouping>("generation");
  const [sorting, setSorting] = useState<Sorting>("birth");
  const today = useMemo(() => yearNow(), []);
  // The tree's filter narrows the timeline too: the others go, or stay faded.
  const filterKey = writeView({ layout: "rings", depth: null, filter }).toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: filterKey stands for the filter
  const kept = useMemo(() => applyFilter(graph, filter), [graph, filterKey]);
  const faded = filter.others === "faded" ? kept : null;
  const shownCount = useMemo(
    () => (kept ? graph.people.filter((p) => !p.placeholder && kept.has(p.id)).length : null),
    [graph, kept],
  );
  const { placed, undated } = useMemo(() => {
    const people = kept && !faded ? graph.people.filter((p) => kept.has(p.id)) : graph.people;
    return spans(people, today);
  }, [graph, today, kept, faded]);
  const standing = useMemo(() => standings(graph), [graph]);
  const names = useMemo(() => new Map(graph.people.map((p) => [p.id, shortName(p)])), [graph]);
  // "Me": coloured by closeness to you, as on the tree; not for the made-up sample.
  const meId = useMeId();
  const me = onSelect ? meId : null;
  const colourOf = useMemo(() => colourer(graph, colours, me), [graph, colours, me]);
  const { rows, height } = useMemo(
    () => arrange(placed, standing, names, grouping, sorting),
    [placed, standing, names, grouping, sorting],
  );

  const [view, setView] = useState<View>(() => fitAll(placed, today));
  const current = useRef(view);
  current.current = view;
  const scroller = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [trayOpen, setTrayOpen] = useState(true);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Scroll zooms around the pointer, as on the tree; a sideways swipe moves along; with
  // Shift, scrolling goes down the lanes instead.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.shiftKey) {
        element.scrollTop += (event.deltaY || event.deltaX) * scale;
        return;
      }
      const width = element.clientWidth || 1;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        setView((now) => panBy(now, ((event.deltaX * scale) / width) * (now.end - now.start)));
        return;
      }
      const fraction = (event.clientX - element.getBoundingClientRect().left) / width;
      setView((now) =>
        zoomAround(
          now,
          Math.exp(-event.deltaY * scale * 0.002),
          now.start + fraction * (now.end - now.start),
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  // The buttons and keys glide rather than jump.
  const glide = useCallback((target: View) => {
    const from = current.current;
    const started = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 250);
      const eased = 1 - (1 - t) ** 3;
      setView({
        start: from.start + (target.start - from.start) * eased,
        end: from.end + (target.end - from.end) * eased,
      });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);
  const zoomBy = useCallback(
    (factor: number) => {
      const now = current.current;
      glide(zoomAround(now, factor, (now.start + now.end) / 2));
    },
    [glide],
  );
  const showEveryone = useCallback(() => glide(fitAll(placed, today)), [glide, placed, today]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") zoomBy(1.6);
      else if (event.key === "-") zoomBy(1 / 1.6);
      else if (event.key === "f" || event.key === "F") showEveryone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomBy, showEveryone]);

  // Drag to move: sideways through time, up and down the lanes. A drag isn't a click.
  const drag = useRef<{ x: number; y: number; view: View; top: number; moved: boolean } | null>(
    null,
  );
  const dragged = useRef(false);
  // Two fingers pinch to zoom, around the point between them.
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View; year: number } | null>(null);
  const spread = () => {
    const [a, b] = [...fingers.current.values()];
    return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), middle: (a.x + b.x) / 2 } : null;
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const two = fingers.current.size === 2 ? spread() : null;
    if (two) {
      const element = event.currentTarget;
      const left = element.getBoundingClientRect().left;
      const fraction = (two.middle - left) / (element.clientWidth || 1);
      pinch.current = {
        distance: two.distance || 1,
        view,
        year: view.start + fraction * (view.end - view.start),
      };
      drag.current = null;
      dragged.current = true; // not a click
      return;
    }
    dragged.current = false;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      view,
      top: event.currentTarget.scrollTop,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(event.pointerId)) {
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    const pinching = pinch.current;
    if (pinching) {
      const two = spread();
      if (two) setView(zoomAround(pinching.view, two.distance / pinching.distance, pinching.year));
      return;
    }
    const start = drag.current;
    if (!start) return;
    const [dx, dy] = [event.clientX - start.x, event.clientY - start.y];
    if (!start.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      start.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const width = event.currentTarget.clientWidth || 1;
    setView(panBy(start.view, (-dx / width) * (start.view.end - start.view.start)));
    event.currentTarget.scrollTop = start.top - dy;
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

  // Found by search: bring their lane into view, their birth a third of the way across.
  useEffect(() => {
    if (!focusId) return;
    const row = rows.find((candidate) => candidate.kind === "lane" && candidate.key === focusId);
    if (row?.kind === "lane") {
      scroller.current?.scrollTo({
        top: row.top - (scroller.current.clientHeight - LANE_HEIGHT) / 2,
        behavior: "smooth",
      });
      const at = row.span.start ?? row.span.end;
      const now = current.current;
      const span = now.end - now.start;
      // A third of the way across, but no further into the future than needed.
      const shift = Math.max(0, at + (span * 2) / 3 - Math.max(today + span * 0.05, at + 1));
      glide({ start: at - span / 3 - shift, end: at + (span * 2) / 3 - shift });
    } else if (undated.some((person) => person.id === focusId)) {
      setTrayOpen(true);
      requestAnimationFrame(() =>
        document.getElementById(`undated-${focusId}`)?.scrollIntoView({ block: "nearest" }),
      );
    }
    onFocused?.();
  }, [focusId, rows, undated, glide, onFocused, today]);

  const perYear = size.width / (view.end - view.start);
  const x = (year: number) => (year - view.start) * perYear;
  const ticks = size.width ? yearTicks(view, size.width) : [];
  const shown = visibleRows(rows, scrollTop - 200, scrollTop + size.height + 200);
  const todayShown = today >= view.start && today <= view.end;

  return (
    <div className="flex h-full flex-col bg-stone-50">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-3 py-2 text-sm">
        <span className="flex items-center gap-2 text-stone-600">
          Group by
          <Select value={grouping} onValueChange={(value) => setGrouping(value as Grouping)}>
            <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Group by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="generation">Generation</SelectItem>
              <SelectItem value="branch">Branch</SelectItem>
              <SelectItem value="none">Nothing</SelectItem>
            </SelectContent>
          </Select>
        </span>
        <span className="flex items-center gap-2 text-stone-600">
          Sort by
          <Select value={sorting} onValueChange={(value) => setSorting(value as Sorting)}>
            <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Sort by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="birth">Birth year</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="death">Death year</SelectItem>
            </SelectContent>
          </Select>
        </span>
        {onFilter && (
          <FilterMenu graph={graph} filter={filter} onChange={onFilter} selectedId={selectedId} />
        )}
        <span className="text-xs text-stone-500">
          {touch
            ? "Pinch to zoom · drag to move"
            : "Scroll to zoom · drag to move · Shift+scroll to go down"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Zoom out"
            onClick={() => zoomBy(1 / 1.6)}
          >
            <MinusIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(1.6)}>
            <PlusIcon />
          </Button>
          <Button variant="outline" size="sm" onClick={showEveryone}>
            <MaximizeIcon />
            Fit
          </Button>
        </div>
      </div>

      {onSelect && colours === "closeness" && (
        <div className="shrink-0 border-b border-stone-200 bg-white px-3 py-1.5">
          <ClosenessKey chosen={me !== null} />
        </div>
      )}
      {onFilter && (
        <div className="shrink-0 border-b border-stone-200 bg-white px-3 py-1.5 empty:hidden">
          <FilterChips graph={graph} filter={filter} onChange={onFilter} shown={shownCount} />
        </div>
      )}

      <div
        className="relative h-7 shrink-0 overflow-hidden border-b border-stone-200 bg-white text-[11px] text-stone-500 select-none"
        style={{ width: size.width || undefined }}
        aria-hidden="true"
      >
        {ticks
          .filter((year) => !todayShown || Math.abs(x(year) - x(today) - 16) > 34)
          .map((year) => (
            <span
              key={year}
              className="absolute top-1.5 -translate-x-1/2 tabular-nums"
              style={{ left: x(year) }}
            >
              {year}
            </span>
          ))}
        {todayShown && (
          <span
            className="absolute top-1.5 pl-1 font-medium text-amber-700"
            style={{ left: x(today) }}
          >
            today
          </span>
        )}
      </div>

      <div
        ref={scroller}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-x-hidden overflow-y-auto select-none active:cursor-grabbing"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        <div className="relative" style={{ height: Math.max(height, size.height) }}>
          {ticks.map((year) => (
            <div
              key={year}
              className="pointer-events-none absolute inset-y-0 w-px bg-stone-200/60"
              style={{ left: x(year) }}
            />
          ))}
          {todayShown && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-amber-400/80"
              style={{ left: x(today) }}
            />
          )}
          {shown.map((row) =>
            row.kind === "group" ? (
              <GroupRow key={row.key} row={row} />
            ) : (
              <Lane
                key={row.key}
                lane={row.span}
                top={row.top}
                x={x}
                name={names.get(row.key) ?? row.span.person.full_name}
                colour={colourOf(row.key)}
                selected={row.key === selectedId}
                faded={faded !== null && !faded.has(row.key)}
                onSelect={onSelect}
              />
            ),
          )}
          {rows.length === 0 && (
            <p className="absolute inset-x-0 top-10 text-center text-sm text-stone-500">
              {kept
                ? `No one the filter shows has a birth year yet. ${canEdit ? "Add one in someone's panel, or change the filter." : "Change the filter to see more."}`
                : `No one has a birth year yet.${canEdit ? " Add one in someone's panel and they appear here." : ""}`}
            </p>
          )}
        </div>
      </div>

      <UndatedTray
        people={undated}
        standing={standing.of}
        names={names}
        selectedId={selectedId}
        open={trayOpen}
        onToggle={() => setTrayOpen((open) => !open)}
        onSelect={onSelect}
        faded={faded}
      />
    </div>
  );
}

function GroupRow({ row }: { row: Extract<Row, { kind: "group" }> }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 flex items-end gap-2 px-4 pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase"
      style={{ top: row.top, height: GROUP_HEIGHT }}
    >
      {row.label}
      <span className="font-normal tracking-normal normal-case">
        {row.count} {row.count === 1 ? "person" : "people"}
      </span>
    </div>
  );
}

/** A soft start or end for an approximate date; a long fade when the death wasn't recorded. */
function barPaint(lane: Span, colour: string): string {
  const from = lane.roughStart ? `transparent 0, ${colour} ${SOFT}px` : `${colour} 0`;
  const to =
    lane.ending === "unknown"
      ? `${colour} 25%, transparent 100%`
      : lane.roughEnd
        ? `${colour} calc(100% - ${SOFT}px), transparent 100%`
        : `${colour} 100%`;
  return `linear-gradient(to right, ${from}, ${to})`;
}

function Lane({
  lane,
  top,
  x,
  name,
  colour,
  selected,
  faded = false,
  onSelect,
}: {
  lane: Span;
  top: number;
  x: (year: number) => number;
  name: string;
  colour: string | null;
  selected: boolean;
  faded?: boolean; // left out by the filter, which fades the others
  onSelect?: (id: string) => void;
}) {
  const photoAt = x(lane.start ?? lane.end);
  const endAt = x(lane.end);
  const paint = colour ?? GREY;
  // Above the bar beside the photo; held at the left edge once the photo has scrolled away,
  // for as long as the bar is still in view.
  const labelAt = Math.min(Math.max(photoAt + 22, 8), Math.max(endAt - 40, photoAt + 22));
  const arrow: CSSProperties = {
    left: endAt,
    borderTop: "5px solid transparent",
    borderBottom: "5px solid transparent",
    borderLeft: `8px solid ${paint}`,
  };
  return (
    <button
      type="button"
      disabled={!onSelect}
      onClick={() => onSelect?.(lane.person.id)}
      aria-label={`${name}, ${lane.years}`}
      className={cn(
        "group absolute inset-x-0 text-left",
        onSelect ? "cursor-pointer hover:bg-white/80" : "cursor-default",
        selected && "bg-sky-50 hover:bg-sky-50",
        faded && "opacity-25",
      )}
      style={{ top, height: LANE_HEIGHT }}
    >
      {lane.start !== null && (
        <span
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{
            left: photoAt,
            width: Math.max(0, endAt - photoAt),
            background: barPaint(lane, paint),
          }}
        />
      )}
      {lane.ending === "today" && (
        <span className="absolute top-1/2 h-0 w-0 -translate-y-1/2" style={arrow} />
      )}
      <span
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform duration-150 group-hover:scale-125"
        style={{ left: photoAt }}
      >
        <PersonAvatar
          person={lane.person}
          size="sm"
          className={cn(
            "border-2",
            lane.start === null && "border-dashed",
            selected && "!border-sky-500 ring-2 ring-sky-200",
          )}
          style={colour && !selected ? { borderColor: colour } : undefined}
        />
      </span>
      <span
        className="pointer-events-none absolute top-0.5 text-xs leading-4 whitespace-nowrap"
        style={{ left: labelAt }}
      >
        <span className="font-medium text-stone-800">{name}</span>{" "}
        <span className="text-stone-500">{lane.years}</span>
        {lane.age && (
          <span className="ml-1 hidden text-stone-700 group-hover:inline">· {lane.age}</span>
        )}
      </span>
    </button>
  );
}

/** People with no dates yet: a to-do list, like "Not linked yet" on the tree. */
function UndatedTray({
  people,
  standing,
  names,
  selectedId,
  open,
  onToggle,
  onSelect,
  faded = null,
}: {
  people: GraphPerson[];
  standing: Map<string, Standing>;
  names: Map<string, string>;
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect?: (id: string) => void;
  faded?: ReadonlySet<string> | null; // whom the filter keeps; the others are faded
}) {
  const canEdit = useCanEdit("change");
  if (!people.length) return null;
  const rank = (person: GraphPerson) => {
    const where = standing.get(person.id);
    return where ? where.family * 1000 + where.generation : 1e9;
  };
  const sorted = [...people].sort(
    (a, b) => rank(a) - rank(b) || (names.get(a.id) ?? "").localeCompare(names.get(b.id) ?? ""),
  );
  return (
    <section className="shrink-0 border-t border-stone-200 bg-white" aria-label="Undated">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-stone-50"
        aria-expanded={open}
      >
        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        <span className="font-medium">Undated ({people.length})</span>
        <span className="text-stone-500">
          {canEdit ? "Add a birth year to place them on the timeline" : "No birth year recorded"}
        </span>
      </button>
      {open && (
        <ul className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto px-4 pb-3">
          {sorted.map((person) => {
            const where = standing.get(person.id);
            return (
              <li key={person.id}>
                <button
                  id={`undated-${person.id}`}
                  type="button"
                  disabled={!onSelect}
                  onClick={() => onSelect?.(person.id)}
                  title={where ? `Generation ${where.generation}` : "Not linked yet"}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border border-stone-200 bg-white py-0.5 pr-2.5 pl-0.5 text-xs hover:bg-stone-100",
                    person.id === selectedId && "border-sky-500 bg-sky-50 ring-2 ring-sky-200",
                    faded && !faded.has(person.id) && "opacity-25",
                  )}
                >
                  <PersonAvatar person={person} size="sm" className="size-6 text-[10px]" />
                  {names.get(person.id)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
