import { UploadIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFamilyFromBackup, useSampleFamilies, useSampleGraph } from "@/api/queries";
import type { Graph } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { showError } from "@/lib/notify";
import { drawTree, type Measure } from "../picture";
import { allFamilies, ringLayout, type Way } from "../placing";
import { toFlow } from "../toFlow";
import { layoutTime, type Measures, measure, routeTime, unfoldMove } from "./measures";

/*
 * Spike S7: each made-up family, the sample of 2,000, and your
 * own from a backup, laid out four ways side by side with each way's measurements, to compare
 * them. Each is the tree's own way of placing married-in families, in `placing.ts`,
 * with the links between families routed through the openings.
 * Nothing is stored: your family is read from the backup here and kept nowhere.
 */

/** The four ways in S7's order, with its names. */
const WAYS: { way: Way; name: string; how: string }[] = [
  {
    way: "discs",
    name: "A. Discs, pushed apart",
    how: "Each family a disc of whole rings, moved around its host and out until it meets nothing.",
  },
  {
    way: "fans",
    name: "B. Fans",
    how: "Each family opens outwards from its person, the oldest generation nearest, its rings arcs over the fan alone.",
  },
  {
    way: "settled",
    name: "C. Fans, settled",
    how: "The fans, then a fixed number of gentle steps: photos kept apart, links pulled towards their length.",
  },
  {
    way: "tucked",
    name: "D. Tucked in",
    how: "Each family's people on its host's own rings, at their generations, beside their person.",
  },
];

type Family = { key: string; title: string; about: string; graph: Graph };
type Result = {
  way: Way;
  picture: string;
  measures: Measures;
  moved: number;
  ms: number;
  routing: number;
};

const ROWS: { label: string; of: (result: Result) => number; unit?: string }[] = [
  { label: "Photos overlapping", of: (r) => r.measures.overlaps },
  { label: "Photos a line passes over", of: (r) => r.measures.underLines },
  { label: "…a link between families", of: (r) => r.measures.underBetween },
  { label: "…before routing", of: (r) => r.measures.underBefore },
  { label: "Rings over another family's people", of: (r) => r.measures.ringsCrossing },
  { label: "Lines crossing lines", of: (r) => r.measures.crossings },
  { label: "…before routing", of: (r) => r.measures.crossingsBefore },
  {
    label: "Drawing's area",
    of: (r) => (r.measures.width * r.measures.height) / 1e6,
    unit: "M px²",
  },
  { label: "Longest line", of: (r) => r.measures.longest, unit: "px" },
  { label: "Others move on unfolding, at most", of: (r) => r.moved, unit: "px" },
  { label: "Time to lay out", of: (r) => r.ms, unit: "ms" },
  { label: "Time to route the links", of: (r) => r.routing, unit: "ms" },
];

/** A count as it is; a size or a time to a tenth while it's small. */
const number = (value: number) =>
  Number.isInteger(value) || value >= 10
    ? Math.round(value).toLocaleString("en")
    : value.toFixed(1);

/** How wide text is, as the picture export measures it. */
function measurer(): Measure {
  const context = document.createElement("canvas").getContext("2d");
  return (text, font) => {
    if (!context) return text.length * 7;
    context.font = font;
    return context.measureText(text).width;
  };
}

/** One family laid out each way: its pictures and measurements, worked out a way at a time so
 *  that the page stays responsive at 2,000 people. */
function useResults(family: Family): Result[] {
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    let current = true;
    const pictures: string[] = [];
    const measureText = measurer();
    setResults([]);
    const work = (index: number) => {
      const way = WAYS[index]?.way;
      if (!way || !current) return;
      const layout = ringLayout(family.graph, allFamilies(family.graph), way);
      const { nodes, edges } = toFlow(family.graph, layout, "generation", {
        saved: false,
        route: true,
      });
      const { svg } = drawTree(
        { nodes, edges, rings: layout.rings, tray: layout.tray, tinted: true },
        { photos: new Map(), fontFace: "", measure: measureText },
      );
      const picture = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      pictures.push(picture);
      const result: Result = {
        way,
        picture,
        measures: measure(family.graph, layout),
        moved: unfoldMove(family.graph, way),
        ms: layoutTime(family.graph, way),
        routing: routeTime(family.graph, way),
      };
      setResults((done) => [...done, result]);
      window.setTimeout(() => work(index + 1), 0);
    };
    const first = window.setTimeout(() => work(0), 0);
    return () => {
      current = false;
      window.clearTimeout(first);
      for (const picture of pictures) URL.revokeObjectURL(picture);
    };
  }, [family]);
  return results;
}

function FamilyRow({ family, onDone }: { family: Family; onDone: (results: Result[]) => void }) {
  const results = useResults(family);
  const [large, setLarge] = useState<Result | null>(null);
  const [actual, setActual] = useState(false);
  useEffect(() => {
    if (results.length === WAYS.length) onDone(results);
  }, [results, onDone]);
  const best = (of: (result: Result) => number) => Math.min(...results.map(of));
  return (
    <section
      className="space-y-3 border-t border-stone-200 pt-6"
      aria-labelledby={`family-${family.key}`}
    >
      <div>
        <h2 id={`family-${family.key}`} className="text-lg font-semibold">
          {family.title}
        </h2>
        <p className="max-w-3xl text-sm text-stone-600">
          {family.about} {family.graph.people.length.toLocaleString("en")} people,{" "}
          {family.graph.layout.units.filter((unit) => unit.anchor).length} married-in families, all
          open.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {WAYS.map(({ way, name }) => {
          const result = results.find((each) => each.way === way);
          return (
            <figure key={way} className="space-y-2">
              <figcaption className="text-sm font-medium">{name}</figcaption>
              {result ? (
                <button
                  type="button"
                  className="block w-full cursor-zoom-in rounded-md border border-stone-200 bg-white"
                  onClick={() => setLarge(result)}
                  aria-label={`${name}, larger`}
                >
                  <img
                    src={result.picture}
                    alt={`${family.title}, ${name}`}
                    className="aspect-square w-full object-contain"
                  />
                </button>
              ) : (
                <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-stone-200 text-sm text-stone-500">
                  Laying it out…
                </div>
              )}
              {result && (
                <table className="w-full text-xs">
                  <tbody>
                    {ROWS.map((row) => {
                      const value = row.of(result);
                      const out = row.label === "Photos overlapping" && value > 0;
                      return (
                        <tr key={row.label} className="border-b border-stone-100">
                          <td className="py-0.5 pr-2 text-stone-600">{row.label}</td>
                          <td
                            className={`py-0.5 text-right tabular-nums ${out ? "font-semibold text-red-700" : value === best(row.of) ? "font-semibold" : ""}`}
                          >
                            {number(value)}
                            {row.unit ? ` ${row.unit}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </figure>
          );
        })}
      </div>
      <Dialog
        open={large !== null}
        onOpenChange={(open) => {
          if (!open) setLarge(null);
          setActual(false);
        }}
      >
        <DialogContent
          className="flex max-h-[94vh] max-w-[94vw] flex-col sm:max-w-[94vw]"
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between gap-4 pr-8">
            <DialogTitle>
              {family.title}: {WAYS.find((each) => each.way === large?.way)?.name}
            </DialogTitle>
            <Button size="sm" variant="outline" onClick={() => setActual((now) => !now)}>
              {actual ? "Fit the window" : "Actual size"}
            </Button>
          </div>
          {/* The whole drawing in the window, or at the tree's own size to look closer. */}
          <div className="min-h-0 flex-1 overflow-auto">
            {large && (
              <img
                src={large.picture}
                alt=""
                className={actual ? "max-w-none" : "mx-auto max-h-[80vh] w-auto max-w-full"}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Each way's totals over every family laid out so far. */
function Summary({ done }: { done: Map<string, Result[]> }) {
  const totals = WAYS.map(({ way, name, how }) => {
    const all = [...done.values()].map((results) => results.find((each) => each.way === way));
    const sum = (of: (result: Result) => number) =>
      all.reduce((total, result) => total + (result ? of(result) : 0), 0);
    return {
      way,
      name,
      how,
      overlaps: sum((r) => r.measures.overlaps),
      underLines: sum((r) => r.measures.underLines),
      underBetween: sum((r) => r.measures.underBetween),
      underBefore: sum((r) => r.measures.underBefore),
      ringsCrossing: sum((r) => r.measures.ringsCrossing),
      crossings: sum((r) => r.measures.crossings),
      crossingsBefore: sum((r) => r.measures.crossingsBefore),
      slowest: Math.max(0, ...all.map((result) => result?.ms ?? 0)),
      slowestRouting: Math.max(0, ...all.map((result) => result?.routing ?? 0)),
    };
  });
  return (
    <table className="w-full max-w-6xl text-sm">
      <thead>
        <tr className="border-b border-stone-200 text-left text-stone-600">
          <th className="py-1 pr-3 font-medium">Way</th>
          <th className="py-1 pr-3 text-right font-medium">Photos overlapping</th>
          <th className="py-1 pr-3 text-right font-medium">Photos under lines</th>
          <th className="py-1 pr-3 text-right font-medium">…links between families</th>
          <th className="py-1 pr-3 text-right font-medium">…before routing</th>
          <th className="py-1 pr-3 text-right font-medium">Rings over others</th>
          <th className="py-1 pr-3 text-right font-medium">Lines crossing</th>
          <th className="py-1 pr-3 text-right font-medium">…before routing</th>
          <th className="py-1 pr-3 text-right font-medium">Slowest layout</th>
          <th className="py-1 text-right font-medium">Slowest routing</th>
        </tr>
      </thead>
      <tbody>
        {totals.map((total) => (
          <tr key={total.way} className="border-b border-stone-100 align-top">
            <td className="py-1.5 pr-3">
              <div className="font-medium">
                {total.name}
                {total.overlaps > 0 && (
                  <span className="ml-2 text-red-700">out: photos overlap</span>
                )}
              </div>
              <div className="text-xs text-stone-500">{total.how}</div>
            </td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.overlaps}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.underLines}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.underBetween}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.underBefore}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.ringsCrossing}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.crossings}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{total.crossingsBefore}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums">{number(total.slowest)} ms</td>
            <td className="py-1.5 text-right tabular-nums">{number(total.slowestRouting)} ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SideBySidePage() {
  const families = useSampleFamilies();
  const sample = useSampleGraph(2000);
  const fromBackup = useFamilyFromBackup();
  const [yours, setYours] = useState<Graph | null>(null);
  const [done, setDone] = useState(() => new Map<string, Result[]>());
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    const all: Family[] = [...(families.data ?? [])];
    if (sample.data) {
      all.push({
        key: "sample",
        title: "7. The sample of 2,000",
        about:
          "The made-up family of 2,000 people, with the married-in families that came with it.",
        graph: sample.data,
      });
    }
    if (yours) {
      all.push({
        key: "yours",
        title: "Your family",
        about: "From your backup: read here, kept nowhere, and centred on its oldest ancestor.",
        graph: yours,
      });
    }
    return all;
  }, [families.data, sample.data, yours]);

  const onDone = useMemo(
    () => (key: string) => (results: Result[]) =>
      setDone((now) => (now.get(key) === results ? now : new Map(now).set(key, results))),
    [],
  );
  const doneFor = useMemo(
    () => new Map(list.map((family) => [family.key, onDone(family.key)])),
    [list, onDone],
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Families side by side</h1>
          <p className="max-w-3xl text-sm text-stone-600">
            Four ways of placing married-in families when several are open, tried on families made
            up to be hard. Each is drawn as the tree's picture is, the links between families routed
            through the openings, with what each way measures: the best of each row in bold, and in
            red a way that lets photos overlap, which is out. Click a picture to see it larger.
            Nothing here is stored.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => input.current?.click()}
              disabled={fromBackup.isPending}
            >
              <UploadIcon />
              {fromBackup.isPending
                ? "Reading it…"
                : yours
                  ? "Another backup…"
                  : "Add your family from a backup…"}
            </Button>
            <span className="text-xs text-stone-500">
              A backup from Settings → Backups. It's read here, on this computer, and kept nowhere.
            </span>
            <input
              ref={input}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) fromBackup.mutate(file, { onSuccess: setYours, onError: showError });
              }}
            />
          </div>
        </header>
        <Summary done={done} />
        {families.isPending && <p className="text-sm text-stone-500">Making up the families…</p>}
        {families.isError && <p className="text-sm text-red-700">{families.error.message}</p>}
        {list.map((family) => (
          <FamilyRow
            key={family.key}
            family={family}
            onDone={doneFor.get(family.key) ?? (() => {})}
          />
        ))}
      </div>
    </div>
  );
}
