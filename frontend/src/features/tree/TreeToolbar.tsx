import { FoldVerticalIcon, UnfoldVerticalIcon } from "lucide-react";
import { toast } from "sonner";
import {
  useClearPositions,
  useSavePositions,
  useSaveTreeSettings,
  useTreeSettings,
} from "@/api/queries";
import type { Graph, TreeSettings } from "@/api/types";
import { useCanEdit } from "@/app/copy";
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
import { showError, UNDO_MS } from "@/lib/notify";
import { FamiliesMenu } from "./FamiliesMenu";
import { FilterChips, FilterMenu } from "./FilterMenu";
import type { TreeView } from "./filters";
import { DepthStepper, LayoutMenu } from "./LayoutMenu";
import { shortName } from "./words";

/**
 * The tree's own toolbar: the Layout menu (with Tidy up, which was Rearrange),
 * the Filter menu, how people are coloured, folding every married-in family at once (
 * D19), and the families, with who is at the centre. The active filters show as chips
 * underneath.
 */
export function TreeToolbar({
  graph,
  readOnly = false,
  view,
  onView,
  focus,
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
  // A view-only copy: its viewer's own colours, but no tidying. A copy to edit tidies
  // up when it allows changes.
  const canTidy = useCanEdit();
  const clear = useClearPositions();
  const restore = useSavePositions();
  const byId = new Map(graph.people.map((person) => [person.id, person]));
  const centre = (graph.layout.units[0]?.centre ?? [])
    .map((id) => byId.get(id))
    .filter((person) => person && !person.placeholder)
    .map((person) => person && shortName(person))
    .join(" & ");
  const current: TreeSettings = settings.data ?? { centre: null, colours: "branch" };
  const focused = focus ? byId.get(focus) : undefined;
  const focusName = focused ? shortName(focused) : "someone";
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

  return (
    <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-1.5">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-stone-200 bg-white/95 px-2 py-1.5 text-xs text-stone-600 shadow-sm">
        {onView && (
          <>
            <LayoutMenu
              view={view}
              onView={onView}
              focusName={focusName}
              onTidyUp={
                !readOnly && canTidy && view.layout === "rings" && !clear.isPending
                  ? tidyUp
                  : undefined
              }
            />
            <DepthStepper view={view} onView={onView} />
            <FilterMenu
              graph={graph}
              filter={view.filter}
              onChange={(filter) => onView({ ...view, filter })}
              selectedId={focus}
            />
          </>
        )}
        {!readOnly && (
          <Select
            value={current.colours}
            onValueChange={(colours) =>
              save.mutate(
                { ...current, colours: colours as TreeSettings["colours"] },
                { onError: showError },
              )
            }
          >
            <SelectTrigger size="sm" className="h-6 text-xs" aria-label="Colour the people by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="branch">Colour by branch</SelectItem>
              <SelectItem value="generation">Colour by generation</SelectItem>
              <SelectItem value="closeness">Colour by closeness to me</SelectItem>
              <SelectItem value="off">No colours</SelectItem>
            </SelectContent>
          </Select>
        )}
        {families.all > 0 && (
          // It says what it will do: unfold while any family is folded away.
          <Button
            variant="outline"
            size="xs"
            onClick={() => onFoldAll(families.folded > 0 ? "open" : "folded")}
            title={
              families.folded > 0
                ? `${families.big ? "A family this big opens folded, to keep it quick. " : ""}` +
                  `Show every married-in family (${families.folded} folded away)`
                : "Fold every married-in family away"
            }
          >
            {families.folded > 0 ? <UnfoldVerticalIcon /> : <FoldVerticalIcon />}
            {families.folded > 0 ? "Unfold all" : "Fold all"}
          </Button>
        )}
        {!readOnly && centre && view.layout !== "hourglass" && view.layout !== "fan" && (
          <FamiliesMenu graph={graph} onShow={onShowFamily} onHighlight={onHighlight} />
        )}
      </div>
      {!readOnly && current.colours === "closeness" && (
        <div className="pointer-events-auto rounded-lg bg-white/90 px-2 py-1">
          <ClosenessKey chosen={me !== null} />
        </div>
      )}
      {onView && (
        <div className="pointer-events-auto rounded-lg bg-white/90 px-1 empty:hidden">
          <FilterChips
            graph={graph}
            filter={view.filter}
            onChange={(filter) => onView({ ...view, filter })}
            shown={shownReal}
          />
        </div>
      )}
    </div>
  );
}
