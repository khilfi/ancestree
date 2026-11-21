import { type ReactNode, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useGraph, useSampleGraph } from "@/api/queries";
import { CouldNotLoad } from "@/app/StartAdvice";
import { LoadingView } from "@/components/Loading";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { PersonPanel } from "@/features/person/PersonPanel";
import { usePanelWidth } from "@/features/person/panelWidth";
import { useMoveToTrash } from "@/features/person/useMoveToTrash";
import { readView, withView, writeView } from "@/features/tree/filters";
import { useNarrow } from "@/lib/media";
import { sampleSize } from "@/lib/samples";
import { Timeline } from "./Timeline";

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-faint">
      <div className="max-w-md space-y-2">{children}</div>
    </div>
  );
}

/** The timeline, with the same side panel as the tree. `?sample=2000` shows a made-up
 *  family instead, to try it at size, in a development build alone; nothing is stored.
 *  The tree's filters apply here too: they're in the address. */
export function TimelinePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const width = usePanelWidth(); // the panel as wide as it was last
  const sample = sampleSize(params);
  const real = useGraph(sample === 0);
  const made = useSampleGraph(sample || 10, sample > 0);
  const graph = sample ? made : real;
  const selectedId = sample ? null : params.get("person");
  const view = readView(params);

  const go = (next: Record<string, string>) => setParams(withView(params, next));
  const select = (id: string) => go({ person: id });
  const close = () => go({});
  const moveToTrash = useMoveToTrash(close, select);
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

  let content: ReactNode;
  if (graph.isPending) {
    content = <LoadingView label="Loading the family…" view="timeline" />;
  } else if (graph.isError) {
    content = (
      <Message>
        <CouldNotLoad what="the family" error={graph.error} onRetry={() => void graph.refetch()} />
      </Message>
    );
  } else if (graph.data.people.length === 0) {
    content = (
      <Message>
        <p className="font-medium text-foreground">No one here yet.</p>
        <p className="text-sm">Add people on the tree; anyone with a birth year appears here.</p>
      </Message>
    );
  } else {
    content = (
      <Timeline
        graph={graph.data}
        selectedId={selectedId}
        onSelect={sample ? undefined : select}
        focusId={focusId}
        onFocused={focused}
        filter={view.filter}
        onFilter={(filter) => setParams((now) => writeView({ ...view, filter }, now))}
      />
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
        {panel && <div className="absolute inset-0 z-20 bg-card">{panel}</div>}
      </div>
    );
  }
  return (
    <ResizablePanelGroup className="h-full" {...width.group}>
      <ResizablePanel id="timeline" minSize="30">
        {content}
      </ResizablePanel>
      {panel && (
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
