import { NodeToolbar, Position } from "@xyflow/react";
import { useState } from "react";
import { usePerson } from "@/api/queries";
import type { Relation } from "@/api/types";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { AddRelativeDialog } from "@/features/person/AddRelativeDialog";
import { shortName } from "./words";

const BUTTONS: [Relation, string, string][] = [
  ["parent", "+ Parent", "Add a parent of"],
  ["spouse", "+ Spouse", "Add a husband or wife of"],
  ["child", "+ Child", "Add a child of"],
];

/**
 * Beside the person chosen on the tree: **+ Parent**, **+ Spouse** and **+ Child**,
 * small, just below them, each opening Add a relative for them. An overlay of its own, drawn
 * by React Flow beside their circle at any zoom, so the people on the tree know nothing of it.
 * Nothing for no one chosen.
 */
export function AddBeside({
  personId,
  onOpen,
}: {
  personId: string | null; // the person chosen, where the family can be changed
  onOpen: (id: string) => void;
}) {
  const person = usePerson(personId).data;
  const [adding, setAdding] = useState<Relation | null>(null);
  if (!personId || !person || person.id !== personId || person.placeholder) return null;
  const name = shortName(person);
  return (
    <>
      <NodeToolbar
        nodeId={personId}
        isVisible
        position={Position.Bottom}
        offset={2}
        className="nopan nowheel flex gap-1"
        aria-label={`Add to ${name}`}
        role="group"
      >
        {BUTTONS.map(([relation, words, hint]) => (
          <Hint key={relation} label={`${hint} ${name}`}>
            <Button
              size="xs"
              variant="outline"
              className="bg-card shadow-sm"
              onClick={() => setAdding(relation)}
            >
              {words}
            </Button>
          </Hint>
        ))}
      </NodeToolbar>
      {adding && (
        <AddRelativeDialog
          person={person}
          relation={adding}
          onClose={() => setAdding(null)}
          onOpenPerson={onOpen}
        />
      )}
    </>
  );
}
