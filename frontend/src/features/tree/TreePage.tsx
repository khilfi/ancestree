import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useGraph, useKinship } from "@/api/queries";
import { useCanEdit } from "@/app/copy";
import { CouldNotLoad } from "@/app/StartAdvice";
import { LoadingView } from "@/components/Loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RelationshipCard } from "@/features/kinship/RelationshipCard";
import { PersonPanel } from "@/features/person/PersonPanel";
import { usePanelWidth } from "@/features/person/panelWidth";
import { useMoveToTrash } from "@/features/person/useMoveToTrash";
import { useNarrow } from "@/lib/media";
import { drawnFrom, readView, type TreeView, withView, writeView } from "./filters";
import { TreeCanvas } from "./TreeCanvas";
import { focusFor, NO_TRAIL, step, visit } from "./trail";

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-faint">
      <div className="max-w-md space-y-2">{children}</div>
    </div>
  );
}

/** Someone on the tree, as the keyboard reaches them: drawn only while in view. */
function onTree(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
}

/** The tree, with the person panel docked beside it: the canvas shrinks, nothing is covered. */
export function TreePage() {
  const graph = useGraph();
  const narrow = useNarrow();
  const width = usePanelWidth(); // the panel as wide as it was last
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("person");
  // Someone new, where people can be added: not in a view-only copy, nor on a computer that
  // only receives the family.
  const mayAdd = useCanEdit();
  const creating = params.has("new") && mayAdd;
  const panelOpen = creating || selectedId !== null;

  // ?focus=1 comes from a search: fly to the person once, then forget it.
  const focusId = params.has("focus") ? selectedId : null;
  const focused = useCallback(() => {
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  // The layout and the filter live in the address too: opening someone keeps them.
  const view = readView(params);
  const go = (next: Record<string, string>) => setParams(withView(params, next));
  const changeView = (next: TreeView) =>
    setParams((now) =>
      // Someone chosen for the filter in an hourglass or fan chart: it's drawn from them, as
      // it was before charts kept to whom they're drawn from.
      writeView(
        drawnFrom(next.layout) && next.filter.around && next.filter.around !== view.filter.around
          ? { ...next, from: next.filter.around }
          : next,
        now,
      ),
    );
  const select = (id: string) => go({ person: id });
  const close = () => go({});

  // An hourglass or fan chart is drawn from one person, kept in the address while others are
  // opened and closed. Moving it adds nothing to the browser's history: Back and Forward
  // step through the people it was drawn from, the trail, instead.
  const fanLike = drawnFrom(view.layout);
  const from = graph.data && fanLike ? focusFor(graph.data, view, selectedId) : null;
  // A search's person is shown: the chart is drawn from them.
  const searched =
    focusId && graph.data?.people.some((person) => person.id === focusId && !person.placeholder)
      ? focusId
      : null;
  const wanted = fanLike ? (searched ?? from) : null;
  const drawFrom = useCallback(
    (id: string) =>
      setParams((now) => writeView({ ...readView(now), from: id }, now), { replace: true }),
    [setParams],
  );
  useEffect(() => {
    if (wanted && wanted !== view.from) drawFrom(wanted);
  }, [wanted, view.from, drawFrom]);
  const [trail, setTrail] = useState(NO_TRAIL);
  // Wherever the chart's person came from, the trail takes them in; away from the hourglass
  // and fan chart, it starts again.
  useEffect(() => setTrail((now) => (view.from ? visit(now, view.from) : NO_TRAIL)), [view.from]);
  const steps = {
    back: step(trail, -1)?.ids[trail.at - 1] ?? null,
    forward: step(trail, 1)?.ids[trail.at + 1] ?? null,
    onStep: (by: -1 | 1) => {
      const next = step(trail, by);
      const id = next?.ids[next.at];
      if (!next || !id) return;
      setTrail(next);
      drawFrom(id);
    },
  };

  // Finding a relationship lives in the address too: ?person=Ali&relate=pick while
  // the second person is picked, then &relate=<their id> for the answer.
  const relate = selectedId !== null ? params.get("relate") : null;
  const target = relate && relate !== "pick" ? relate : null;
  const kinship = useKinship(target ? selectedId : null, target);
  const [shown, setShown] = useState({ key: "", index: 0 }); // whose path is lit
  const answerKey = `${selectedId}>${target}`;
  const shownIndex = shown.key === answerKey ? shown.index : 0;
  const relation = kinship.data?.relations[shownIndex] ?? null;
  const findRelationship = (id: string) => go({ person: id, relate: "pick" });
  const pick = (id: string) => selectedId && go({ person: selectedId, relate: id });
  const stopRelating = () => (selectedId ? go({ person: selectedId }) : go({}));
  // Esc, once nothing over the panel is open: finding a relationship ends first; then the
  // panel closes, and the focus goes back to them on the tree, where the keyboard goes on.
  const onEscape = () => {
    if (relate) return stopRelating();
    if (selectedId) onTree(selectedId)?.focus();
    close();
  };

  // Handled here rather than in the panel, which closes first: the Undo outlives it.
  const moveToTrash = useMoveToTrash(close, select);

  let canvas: ReactNode;
  if (graph.isPending) {
    canvas = <LoadingView label="Loading the family…" view="tree" />;
  } else if (graph.isError) {
    canvas = (
      <Message>
        <CouldNotLoad what="the family" error={graph.error} onRetry={() => void graph.refetch()} />
      </Message>
    );
  } else if (graph.data.people.length === 0) {
    canvas = (
      <Message>
        <p className="font-medium text-foreground">No one here yet.</p>
        <p className="text-sm">Start with the oldest ancestor you know: use “Add person” above.</p>
      </Message>
    );
  } else {
    canvas = (
      <ReactFlowProvider>
        <TreeCanvas
          graph={graph.data}
          selectedId={selectedId}
          onSelect={select}
          focusId={focusId}
          onFocused={focused}
          relating={
            relate && selectedId ? { from: selectedId, picking: target === null, relation } : null
          }
          onPick={pick}
          onStopRelating={stopRelating}
          view={view}
          onView={changeView}
          onFrom={drawFrom}
          steps={fanLike ? steps : undefined}
        />
      </ReactFlowProvider>
    );
  }

  const panel =
    target && selectedId ? (
      <RelationshipCard
        answer={kinship.data}
        error={kinship.error}
        shown={shownIndex}
        onShow={(index) => setShown({ key: answerKey, index })}
        onSwap={() => go({ person: target, relate: selectedId })}
        onPickAnother={() => go({ person: selectedId, relate: "pick" })}
        onDone={stopRelating}
      />
    ) : (
      <PersonPanel
        key={creating ? "new" : selectedId}
        personId={creating ? null : selectedId}
        onSelect={select}
        onClose={close}
        onEscape={onEscape}
        onDelete={moveToTrash}
        onFindRelationship={findRelationship}
        fromHere={
          drawnFrom(view.layout) && selectedId && selectedId !== view.from
            ? {
                layout: view.layout,
                // On a phone the panel covers the chart: it closes, to show it.
                onClick: () =>
                  narrow
                    ? setParams(withView(writeView({ ...view, from: selectedId }, params), {}))
                    : drawFrom(selectedId),
              }
            : undefined
        }
      />
    );

  if (narrow) {
    // A phone: the panel or the answer takes the whole screen. While someone is being
    // picked to compare with, the tree does.
    return (
      <div className="relative h-full">
        {canvas}
        {panelOpen && relate !== "pick" && (
          <div className="absolute inset-0 z-20 bg-card">{panel}</div>
        )}
      </div>
    );
  }
  return (
    <ResizablePanelGroup className="h-full" {...width.group}>
      <ResizablePanel id="canvas" minSize="30">
        {canvas}
      </ResizablePanel>
      {panelOpen && (
        <>
          <ResizableHandle withHandle />
          <ResizablePanel id="person" {...width.panel}>
            {panel}
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}
