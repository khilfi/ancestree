import { ChevronDownIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { TREE_DEFAULTS, useSaveTreeSettings, useTreeSettings } from "@/api/queries";
import type { Graph, TreeSettings } from "@/api/types";
import { useCopy } from "@/app/copy";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { showError } from "@/lib/notify";
import { branchMembers, type Family, familiesOf, familyMembers } from "./families";
import { shortName } from "./words";

const count = (people: number) => `${people} ${people === 1 ? "person" : "people"}`;

/**
 * The toolbar's **Centre ▾**: every family in the tree, and the branches of the
 * one at the centre. Hovering one lights its people up on the tree; **Show** brings it into
 * view, and **Centre the tree here** puts it at the centre, one Undo step as in a person's
 * panel; **Use the oldest ancestor** puts the tree back. "Centre" means that alone.
 */
export function FamiliesMenu({
  graph,
  onShow,
  onHighlight,
}: {
  graph: Graph;
  onShow: (unit: string) => void;
  onHighlight: (people: ReadonlySet<string> | null) => void;
}) {
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  // A view-only copy moves its centre only where it carries the seats for it.
  const copy = useCopy();
  const [open, setOpen] = useState(false);
  const current: TreeSettings = settings.data ?? TREE_DEFAULTS;
  const byId = new Map(graph.people.map((person) => [person.id, person]));
  const name = (id: string | null) => {
    const person = id ? byId.get(id) : undefined;
    return person ? shortName(person) : "someone";
  };
  const { families, branches } = familiesOf(graph);
  const canCentre = (id: string) => !copy || (copy.centres ?? []).includes(id);
  const light = (ids: string[]) => onHighlight(new Set(ids));

  function close() {
    onHighlight(null);
    setOpen(false);
  }
  function centreOn(centre: string | null) {
    close();
    save.mutate({ ...current, centre }, { onError: showError });
  }
  function show(unit: string) {
    close();
    onShow(unit);
  }
  function joins(family: Family, index: number): string {
    if (index === 0) return "at the centre";
    if (!family.anchor) return "not linked to the rest";
    const anchor = name(family.anchor);
    return family.married
      ? `${anchor}'s family · ${anchor} married ${name(family.married)}`
      : `hangs off ${anchor}`;
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onHighlight(null);
      }}
    >
      <Hint label="The families in the tree, and which one is at the centre">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 hover:bg-muted"
          >
            Centre: <span className="font-medium text-foreground">{families[0]?.name}</span>
            <ChevronDownIcon className="size-3.5 text-faint" aria-hidden />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="start"
        aria-label="Families in the tree"
        className="w-[26rem] max-w-[calc(100vw-1.5rem)] gap-0 p-0"
      >
        <div className="border-b border-border px-3 py-2 text-xs font-semibold tracking-wide text-faint uppercase">
          Families in the tree
        </div>
        <ul className="max-h-[60vh] overflow-y-auto py-1" onMouseLeave={() => onHighlight(null)}>
          {families.map((family, index) => (
            <Fragment key={family.unit}>
              <li
                className="flex items-center gap-2 py-1.5 pr-3 hover:bg-muted/50"
                style={{ paddingLeft: `${0.75 + family.depth}rem` }}
                onMouseEnter={() => light(familyMembers(graph, family.unit))}
              >
                <div className="min-w-0 flex-1">
                  <Hint label={family.name}>
                    <div className="truncate">
                      <span className="font-medium text-foreground">{family.name}</span>{" "}
                      <span className="text-faint">{count(family.people)}</span>
                    </div>
                  </Hint>
                  <Hint label={joins(family, index)}>
                    <div className="truncate text-xs text-faint">{joins(family, index)}</div>
                  </Hint>
                </div>
                <Button variant="ghost" size="xs" onClick={() => show(family.unit)}>
                  Show
                </Button>
                {index > 0 && canCentre(family.centre) && (
                  <Button variant="outline" size="xs" onClick={() => centreOn(family.centre)}>
                    Centre the tree here
                  </Button>
                )}
              </li>
              {index === 0 && branches.length > 0 && (
                <li className="pb-1 pl-6">
                  <div className="px-1 text-xs text-faint">Its branches</div>
                  <ul aria-label="Its branches">
                    {branches.map((branch) => (
                      <li
                        key={branch.id}
                        className="flex items-center gap-2 py-0.5 pr-3 pl-1 hover:bg-muted/50"
                        onMouseEnter={() => light(branchMembers(graph, branch.id))}
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: branch.colour ?? undefined }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {branch.name} <span className="text-faint">{branch.people}</span>
                        </span>
                        {canCentre(branch.id) && (
                          <Button variant="ghost" size="xs" onClick={() => centreOn(branch.id)}>
                            Centre the tree here
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </Fragment>
          ))}
        </ul>
        {graph.layout.centre_chosen && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              className="text-sm text-link underline-offset-2 hover:underline"
              onClick={() => centreOn(null)}
            >
              Use the oldest ancestor
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
