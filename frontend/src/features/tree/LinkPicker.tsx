import { useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useKinds, useLink } from "@/api/queries";
import type { GraphPerson, Relation } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useFeedback } from "@/features/person/useFeedback";
import { showError } from "@/lib/notify";
import { relationWord } from "@/lib/people";
import { FloatingCard } from "./FloatingCard";
import type { Point } from "./rings";
import { capitalised, kindWord, shortName } from "./words";

type Choice = { relation: Relation; kind: string; word: string };
type Candidate = { id: string; full_name: string; parent_of: string };

const RELATIONS: Relation[] = ["parent", "child", "spouse", "sibling"];

/** After dropping a link on someone: "Siti is Ali's …" [Mother] [Daughter] [Wife] [Sister]. */
export function LinkPicker({
  source,
  target,
  at,
  bounds,
  onClose,
}: {
  source: GraphPerson;
  target: GraphPerson;
  at: Point;
  bounds: { width: number; height: number };
  onClose: () => void;
}) {
  const kinds = useKinds();
  const link = useLink();
  const feedback = useFeedback();
  const [hovered, setHovered] = useState<Choice | null>(null);
  const [more, setMore] = useState(false);
  const [asking, setAsking] = useState<{ choice: Choice; candidates: Candidate[] } | null>(null);
  const [shared, setShared] = useState<string[]>([]);
  const [a, b] = [shortName(source), shortName(target)];

  const choices: Choice[] = RELATIONS.map((relation) => ({
    relation,
    kind: "biological",
    word: relationWord(relation, source.gender),
  }));
  const others: Choice[] = (kinds.data ?? [])
    .filter((kind) => kind.active && !kind.blood)
    .flatMap((kind) => [
      {
        relation: "parent",
        kind: kind.key,
        word: capitalised(kindWord(kind, "parent", source.gender)),
      },
      {
        relation: "child",
        kind: kind.key,
        word: capitalised(kindWord(kind, "child", source.gender)),
      },
    ]);

  function choose(choice: Choice, sharedParents: string[] | null = null) {
    link.mutate(
      {
        person_a: source.id,
        person_b: target.id,
        a_is: choice.relation,
        kind: choice.kind,
        status: "married",
        shared_parents: sharedParents,
      },
      {
        onSuccess: (result) => {
          feedback(result);
          toast.success(`${a} is now ${b}'s ${choice.word.toLowerCase()}.`);
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "choose_shared_parents") {
            const candidates = (error.detail as { candidates?: Candidate[] }).candidates ?? [];
            const sides = new Set(candidates.map((candidate) => candidate.parent_of));
            setShared(sides.size === 1 ? candidates.map((candidate) => candidate.id) : []);
            setAsking({ choice, candidates });
            return;
          }
          showError(error);
        },
      },
    );
  }

  if (asking) {
    const nameOf = (id: string) => (id === source.id ? a : b);
    return (
      <FloatingCard at={at} bounds={bounds}>
        <p className="font-medium">
          Which parents do {a} and {b} share?
        </p>
        {asking.candidates.map((candidate) => (
          <div key={candidate.id} className="flex items-center gap-2">
            <Checkbox
              id={`share-${candidate.id}`}
              checked={shared.includes(candidate.id)}
              onCheckedChange={(on) =>
                setShared((now) =>
                  on ? [...now, candidate.id] : now.filter((id) => id !== candidate.id),
                )
              }
            />
            <Label htmlFor={`share-${candidate.id}`} className="font-normal">
              {candidate.full_name}
              <span className="text-stone-500">· parent of {nameOf(candidate.parent_of)}</span>
            </Label>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!shared.length || link.isPending}
            onClick={() => choose(asking.choice, shared)}
          >
            Link
          </Button>
        </div>
      </FloatingCard>
    );
  }

  const sentence = (choice: Choice) => `${a} is ${b}'s ${choice.word.toLowerCase()}`;
  return (
    <FloatingCard at={at} bounds={bounds}>
      <p className="font-medium">
        {a} is {b}'s …
      </p>
      <div className="grid grid-cols-2 gap-2">
        {[...choices, ...(more ? others : [])].map((choice) => (
          <Button
            key={`${choice.relation}:${choice.kind}`}
            variant="outline"
            size="sm"
            disabled={link.isPending}
            onMouseEnter={() => setHovered(choice)}
            onFocus={() => setHovered(choice)}
            onClick={() => choose(choice)}
          >
            {choice.word}
          </Button>
        ))}
        {!more && others.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMore(true)}>
            More…
          </Button>
        )}
      </div>
      <p className="min-h-4 text-xs text-stone-500">
        {hovered ? `“${sentence(hovered)}”` : "Esc cancels"}
      </p>
    </FloatingCard>
  );
}
