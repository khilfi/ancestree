import type { Graph, TreeSettings } from "@/api/types";
import { Hint } from "@/components/Hint";
import { ClosenessKey } from "@/features/me/ClosenessKey";
import { branchColours, generationColour } from "@/features/tree/colours";
import { generationShifts, treeGeneration } from "@/features/tree/generations";
import { DRAWING } from "@/styles/drawing";

/** A bar of a colour, as the timeline draws someone's life in it. */
function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="inline-block h-1.5 w-4 rounded-full"
        style={{ background: colour }}
      />
      {label}
    </span>
  );
}

/**
 * What the timeline's colours say, as the tree colours its people: each branch
 * by whom it starts with, or each generation; or how close each is to you, with the tree's own
 * key for it. Grey for those with no colour of their own. Nothing when there are no colours.
 */
export function ColourKey({
  graph,
  colours,
  me,
  names,
}: {
  graph: Graph;
  colours: TreeSettings["colours"];
  me: string | null; // who you are, for closeness
  names: ReadonlyMap<string, string>; // what a branch's first person is called, as on its group
}) {
  if (colours === "off") return null;
  if (colours === "closeness") return <ClosenessKey chosen={me !== null} />;
  const people = graph.people.filter((person) => !person.placeholder);
  let shown: { colour: string; label: string }[];
  let grey: string | null;
  let explained: string;
  if (colours === "generation") {
    const shifts = generationShifts(graph);
    const generations = new Set<number>();
    let unseated = false;
    for (const person of people) {
      const generation = treeGeneration(graph, shifts, person.id);
      if (generation === null) unseated = true;
      else generations.add(generation);
    }
    shown = [...generations]
      .sort((a, b) => a - b)
      .map((generation) => ({
        colour: generationColour(generation),
        label: `Generation ${generation}`,
      }));
    grey = unseated ? "not linked yet" : null;
    explained = "Each generation in a colour of its own, as the tree's rings number them.";
  } else {
    const branches = branchColours(graph);
    shown = [...branches].map(([first, colour]) => ({
      colour,
      label: `${names.get(first) ?? "A"}'s branch`,
    }));
    const coloured = new Set<string>();
    for (const [id, seat] of Object.entries(graph.layout.seats)) {
      if (seat.branch && !seat.unit.startsWith("cluster:")) coloured.add(id);
    }
    grey = people.some((person) => !coloured.has(person.id))
      ? "the oldest generations, and families married in"
      : null;
    explained =
      "Each branch in a colour of its own: someone where the family first divides, everyone " +
      "descended from them, and their husbands and wives.";
  }
  if (!shown.length) return null;
  return (
    <Hint label={explained}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {shown.map(({ colour, label }) => (
          <Swatch key={label} colour={colour} label={label} />
        ))}
        {grey && <Swatch colour={DRAWING.line} label={grey} />}
      </div>
    </Hint>
  );
}
