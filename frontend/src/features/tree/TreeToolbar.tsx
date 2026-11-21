import { useReactFlow } from "@xyflow/react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  FoldVerticalIcon,
  MaximizeIcon,
  MinusIcon,
  PlusIcon,
  UnfoldVerticalIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  TREE_DEFAULTS,
  useClearPositions,
  useSavePositions,
  useSaveTreeSettings,
  useTreeSettings,
} from "@/api/queries";
import type { Graph, TreeSettings } from "@/api/types";
import { useCanEdit } from "@/app/copy";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TOOL_SELECT, ViewToolbar } from "@/components/ViewToolbar";
import { ClosenessKey } from "@/features/me/ClosenessKey";
import { useMeId } from "@/features/me/useMeId";
import { showError, UNDO_MS } from "@/lib/notify";
import { FamiliesMenu } from "./FamiliesMenu";
import { FilterChips, FilterMenu } from "./FilterMenu";
import { drawnFrom, type TreeView } from "./filters";
import { DepthStepper, LayoutMenu } from "./LayoutMenu";
import { type Tool, ToolsThatFit } from "./ToolsThatFit";
import { shortName } from "./words";

/** Back and Forward through those an hourglass or fan chart was drawn from: whom each
 *  leads to, or null at the end. */
export type Steps = { back: string | null; forward: string | null; onStep: (by: -1 | 1) => void };

/**
 * The tree's own toolbar: the Layout menu (with Tidy up, which was Rearrange),
 * the Filter menu, how people are coloured, folding every married-in family at once (
 * D19), and the families, with who is at the centre; at its end, zooming and Show
 * everyone. Above the canvas, in one line, what doesn't fit in its ⋯ menu. The active
 * filters show as chips underneath, and the key to closeness when people are coloured by it, as
 * the timeline's and the map's do.
 */
export function TreeToolbar({
  graph,
  readOnly = false,
  view,
  onView,
  focus,
  steps,
  shown,
  onRearranged,
  families,
  onFoldAll,
  onShowFamily,
  onHighlight,
}: {
  graph: Graph;
  readOnly?: boolean; // the made-up sample: nothing to save
  view: TreeView;
  onView?: (view: TreeView) => void;
  focus: string | null; // whom an hourglass or fan chart is around
  steps?: Steps; // Back and Forward, in an hourglass or fan chart
  shown: Set<string> | null; // who the filter keeps; null: everyone
  onRearranged: () => void;
  families: { all: number; folded: number; big: boolean };
  onFoldAll: (mode: "open" | "folded") => void;
  onShowFamily: (unit: string) => void; // bring a family into view, unfolded
  onHighlight: (people: ReadonlySet<string> | null) => void; // light these up; null: nobody
}) {
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  const me = useMeId();
  // A view-only copy: its viewer's own colours, but no tidying; nor on a computer that
  // only receives the family.
  const canTidy = useCanEdit();
  const clear = useClearPositions();
  const restore = useSavePositions();
  const byId = new Map(graph.people.map((person) => [person.id, person]));
  const centre = (graph.layout.units[0]?.centre ?? [])
    .map((id) => byId.get(id))
    .filter((person) => person && !person.placeholder)
    .map((person) => person && shortName(person))
    .join(" & ");
  const current: TreeSettings = settings.data ?? TREE_DEFAULTS;
  const focused = focus ? byId.get(focus) : undefined;
  const focusName = focused ? shortName(focused) : "someone";
  const nameOf = (id: string | null) => {
    const person = id ? byId.get(id) : undefined;
    return person ? shortName(person) : "";
  };
  const shownReal = shown ? [...shown].filter((id) => !byId.get(id)?.placeholder).length : null;

  function tidyUp() {
    const moved = graph.people.flatMap(({ id, x, y }) =>
      x != null && y != null ? [{ id, x, y }] : [],
    );
    if (!moved.length) {
      toast("Everyone is already in their place on the rings.");
      return;
    }
    clear.mutate(undefined, {
      onSuccess: () => {
        onRearranged();
        toast(`${moved.length} ${moved.length === 1 ? "person" : "people"} back on the rings.`, {
          duration: UNDO_MS,
          action: { label: "Undo", onClick: () => restore.mutate(moved, { onError: showError }) },
        });
      },
      onError: showError,
    });
  }

  // In their order along the line; what doesn't fit goes into ⋯ from the end.
  const tools: Tool[] = [];
  if (onView) {
    tools.push({
      key: "layout",
      tool: (
        <LayoutMenu
          view={view}
          onView={onView}
          focusName={focusName}
          onTidyUp={
            !readOnly && canTidy && view.layout === "rings" && !clear.isPending ? tidyUp : undefined
          }
          married={current.married_in}
          onMarried={
            readOnly
              ? undefined
              : (way) => save.mutate({ ...current, married_in: way }, { onError: showError })
          }
        />
      ),
    });
    if (view.layout === "hourglass" || view.layout === "fan") {
      tools.push({ key: "depth", tool: <DepthStepper view={view} onView={onView} /> });
    }
    if (steps && drawnFrom(view.layout)) {
      tools.push({
        key: "steps",
        tool: (
          <span className="flex items-center gap-1">
            <Hint label={steps.back ? `Back to ${nameOf(steps.back)}` : undefined}>
              <Button
                variant="outline"
                size="sm"
                disabled={!steps.back}
                onClick={() => steps.onStep(-1)}
              >
                <ArrowLeftIcon />
                Back
              </Button>
            </Hint>
            <Hint label={steps.forward ? `Forward to ${nameOf(steps.forward)}` : undefined}>
              <Button
                variant="outline"
                size="sm"
                disabled={!steps.forward}
                onClick={() => steps.onStep(1)}
              >
                Forward
                <ArrowRightIcon />
              </Button>
            </Hint>
          </span>
        ),
      });
    }
    tools.push({
      key: "filter",
      tool: (
        <FilterMenu
          graph={graph}
          filter={view.filter}
          onChange={(filter) => onView({ ...view, filter })}
          selectedId={focus}
        />
      ),
    });
  }
  if (!readOnly) {
    tools.push({
      key: "colours",
      tool: (
        <Select
          value={current.colours}
          onValueChange={(colours) =>
            save.mutate(
              { ...current, colours: colours as TreeSettings["colours"] },
              { onError: showError },
            )
          }
        >
          <SelectTrigger size="sm" className={TOOL_SELECT} aria-label="Colour the people by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="branch">Colour by branch</SelectItem>
            <SelectItem value="generation">Colour by generation</SelectItem>
            <SelectItem value="closeness">Colour by closeness to me</SelectItem>
            <SelectItem value="off">No colours</SelectItem>
          </SelectContent>
        </Select>
      ),
    });
  }
  if (families.all > 0) {
    tools.push({
      key: "fold",
      tool: (
        // It says what it will do: unfold while any family is folded away.
        <Hint
          label={
            families.folded > 0
              ? `${families.big ? "A family this big opens folded, to keep it quick. " : ""}` +
                `Show every married-in family (${families.folded} folded away)`
              : "Fold every married-in family away"
          }
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => onFoldAll(families.folded > 0 ? "open" : "folded")}
          >
            {families.folded > 0 ? <UnfoldVerticalIcon /> : <FoldVerticalIcon />}
            {families.folded > 0 ? "Unfold all" : "Fold all"}
          </Button>
        </Hint>
      ),
    });
  }
  if (!readOnly && centre && view.layout !== "hourglass" && view.layout !== "fan") {
    tools.push({
      key: "centre",
      tool: <FamiliesMenu graph={graph} onShow={onShowFamily} onHighlight={onHighlight} />,
    });
  }

  return (
    <>
      <ViewToolbar label="The tree's tools" className="@container flex-nowrap">
        <ToolsThatFit tools={tools} />
        <Zoom />
      </ViewToolbar>
      {!readOnly && current.colours === "closeness" && (
        <div className="shrink-0 border-b border-border bg-card px-3 py-1.5">
          <ClosenessKey chosen={me !== null} />
        </div>
      )}
      {onView && (
        <div className="shrink-0 border-b border-border bg-card px-3 py-1.5 empty:hidden">
          <FilterChips
            graph={graph}
            filter={view.filter}
            onChange={(filter) => onView({ ...view, filter })}
            shown={shownReal}
          />
        </div>
      )}
    </>
  );
}

/** Zooming, and **Show everyone**, always at the toolbar's end, as the timeline's are. */
function Zoom() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Hint label="Zoom out (−)">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoomOut({ duration: 200 })}
        >
          <MinusIcon />
        </Button>
      </Hint>
      <Hint label="Zoom in (+)">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => zoomIn({ duration: 200 })}
        >
          <PlusIcon />
        </Button>
      </Hint>
      <Hint label="Show the whole tree (F)">
        <Button variant="outline" size="sm" onClick={() => fitView({ duration: 400 })}>
          <MaximizeIcon />
          {/* Its words only where the toolbar has room, so the layout keeps its place at the
              start; its name stays for the keyboard and the hint. */}
          <span className="@max-xl:sr-only">Show everyone</span>
        </Button>
      </Hint>
    </div>
  );
}
