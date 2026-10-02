import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { useGraph, useKinship } from "@/api/queries";
import { useCanEdit } from "@/app/copy";
import { StartAdvice } from "@/app/StartAdvice";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { RelationshipCard } from "@/features/kinship/RelationshipCard";
import { PersonPanel } from "@/features/person/PersonPanel";
import { useMoveToTrash } from "@/features/person/useMoveToTrash";
import { useNarrow } from "@/lib/media";
import { readView, type TreeView, withView, writeView } from "./filters";
import { TreeCanvas } from "./TreeCanvas";

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-stone-500">
      <div className="max-w-md space-y-2">{children}</div>
    </div>
  );
}

/** The tree, with the person panel docked beside it: the canvas shrinks, nothing is covered. */
export function TreePage() {
  const graph = useGraph();
  const narrow = useNarrow();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("person");
  // Someone new, where people can be added: not in a view-only copy, nor in a copy to edit
  // that doesn't allow it.
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
  const changeView = (next: TreeView) => setParams((now) => writeView(next, now));
  const select = (id: string) => go({ person: id });
  const close = () => go({});

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

  // Handled here rather than in the panel, which closes first: the Undo outlives it.
  const moveToTrash = useMoveToTrash(close, select);

  let canvas: ReactNode;
  if (graph.isPending) {
    canvas = <Message>Loading the family…</Message>;
  } else if (graph.isError) {
    canvas = (
      <Message>
        <p className="font-medium text-stone-700">Could not load the family.</p>
        <p className="text-sm">
          <StartAdvice />
        </p>
      </Message>
    );
  } else if (graph.data.people.length === 0) {
    canvas = (
      <Message>
        <p className="font-medium text-stone-700">No one here yet.</p>
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
        onDelete={moveToTrash}
        onFindRelationship={findRelationship}
      />
    );

  if (narrow) {
    // A phone: the panel or the answer takes the whole screen. While someone is being
    // picked to compare with, the tree does.
    return (
      <div className="relative h-full">
        {canvas}
        {panelOpen && relate !== "pick" && (
          <div className="absolute inset-0 z-20 bg-white">{panel}</div>
        )}
      </div>
    );
  }
  return (
    <ResizablePanelGroup className="h-full">
      <ResizablePanel id="canvas" minSize="30">
        {canvas}
      </ResizablePanel>
      {panelOpen && (
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
