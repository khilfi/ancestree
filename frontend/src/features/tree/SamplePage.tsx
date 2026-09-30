import { ReactFlowProvider } from "@xyflow/react";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useSampleGraph } from "@/api/queries";
import { readView, writeView } from "./filters";
import { TreeCanvas } from "./TreeCanvas";

/** A generated, fictional family (default 2,000 people) to try the canvas at size.
 *  Nothing on this page is stored. Open /sample?people=500 for another size; the layouts and
 *  filters work here too. */
export function SamplePage() {
  const [params, setParams] = useSearchParams();
  const people = Math.min(Math.max(Number(params.get("people")) || 2000, 10), 5000);
  const sample = useSampleGraph(people);
  // No panel here: a click just picks whom an hourglass or fan chart is around.
  const [picked, setPicked] = useState<string | null>(null);

  if (sample.isPending) {
    return <p className="p-8 text-stone-500">Making up a family of {people} people…</p>;
  }
  if (sample.isError) {
    return <p className="p-8 text-red-600">{sample.error.message}</p>;
  }
  return (
    <div className="relative h-full">
      <ReactFlowProvider>
        <TreeCanvas
          graph={sample.data}
          selectedId={picked}
          onSelect={setPicked}
          readOnly
          view={readView(params)}
          onView={(view) => setParams((now) => writeView(view, now))}
        />
      </ReactFlowProvider>
      <p className="pointer-events-none absolute top-3 right-3 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900 shadow-sm">
        A made-up family of {people} people, to try the tree at size. Nothing here is stored.
      </p>
    </div>
  );
}
