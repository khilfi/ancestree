import { useState } from "react";
import { toast } from "sonner";
import { useKinds, useLink, useUnlink, useUpdateLink } from "@/api/queries";
import type { GraphLink, GraphPerson, SpouseStatus } from "@/api/types";
import { useCanEdit } from "@/app/copy";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KindSelect } from "@/features/person/KindSelect";
import { useFeedback } from "@/features/person/useFeedback";
import { showError } from "@/lib/notify";
import { FloatingCard } from "./FloatingCard";
import type { Point } from "./rings";
import { kindWord, shortName } from "./words";

export type EdgePick =
  | { type: "child"; links: GraphLink[] }
  | { type: "spouse"; link: GraphLink }
  | { type: "pair"; a: string; b: string };

function RemoveButton({ what, onRemove }: { what: string; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  if (!sure) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setSure(true)}>
        Remove
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">Remove {what}?</span>
      <Button variant="destructive" size="sm" onClick={onRemove}>
        Remove
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setSure(false)}>
        Keep
      </Button>
    </span>
  );
}

function ParentLinkRow({
  link,
  people,
  onDone,
}: {
  link: GraphLink;
  people: Map<string, GraphPerson>;
  onDone: () => void;
}) {
  const kinds = useKinds();
  const update = useUpdateLink();
  const unlink = useUnlink();
  const feedback = useFeedback();
  const canEdit = useCanEdit();
  const parent = people.get(link.source);
  const child = people.get(link.target);
  if (!parent || !child) return null;
  const current = link.kind ?? "biological";
  const kind = kinds.data?.find((candidate) => candidate.key === current);
  const who = parent.placeholder ? "An unknown parent" : shortName(parent);

  const change = (body: { kind?: string; swap: boolean }, done: string) =>
    update.mutate(
      { id: link.id, body },
      {
        onSuccess: (result) => {
          feedback(done, result);
          onDone();
        },
        onError: showError,
      },
    );

  return (
    <div className="space-y-2">
      <p>
        {who} is {shortName(child)}'s {kindWord(kind, "parent", parent.gender)}.
      </p>
      {!parent.placeholder && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <div className="w-36">
                <KindSelect
                  value={current}
                  onChange={(next) => change({ kind: next, swap: false }, "Kind of link changed.")}
                />
              </div>
              <Hint label={`Make ${shortName(child)} the parent instead`}>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => change({ swap: true }, "Direction swapped.")}
                >
                  Swap
                </Button>
              </Hint>
            </>
          )}
          {canEdit && (
            <RemoveButton
              what="this link"
              onRemove={() =>
                unlink.mutate(link.id, {
                  onSuccess: () => {
                    toast.success("Link removed.");
                    onDone();
                  },
                  onError: showError,
                })
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function MarriageRow({
  link,
  people,
  onDone,
}: {
  link: GraphLink;
  people: Map<string, GraphPerson>;
  onDone: () => void;
}) {
  const update = useUpdateLink();
  const unlink = useUnlink();
  const canEdit = useCanEdit();
  const [a, b] = [people.get(link.source), people.get(link.target)];
  if (!a || !b) return null;
  return (
    <div className="space-y-2">
      <p>
        {shortName(a)} and {shortName(b)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <Select
            value={link.status ?? "married"}
            onValueChange={(status) =>
              update.mutate(
                { id: link.id, body: { status: status as SpouseStatus, swap: false } },
                { onSuccess: () => toast.success("Marriage updated."), onError: showError },
              )
            }
          >
            <SelectTrigger className="w-36" aria-label="Marriage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="married">Married</SelectItem>
              <SelectItem value="divorced">Divorced</SelectItem>
              <SelectItem value="widowed">Widowed</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canEdit && (
          <RemoveButton
            what="this marriage"
            onRemove={() =>
              unlink.mutate(link.id, {
                onSuccess: () => {
                  toast.success("Marriage removed.");
                  onDone();
                },
                onError: showError,
              })
            }
          />
        )}
      </div>
    </div>
  );
}

function PairRow({ a, b, onDone }: { a: GraphPerson; b: GraphPerson; onDone: () => void }) {
  const link = useLink();
  const canAdd = useCanEdit();
  if (a.placeholder || b.placeholder) {
    return <p>One parent isn't known yet.{canAdd && " Click the “?” to fill them in."}</p>;
  }
  if (!canAdd) {
    return (
      <p>
        {shortName(a)} and {shortName(b)} are parents of the same children, but no marriage is
        recorded.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p>
        {shortName(a)} and {shortName(b)} are parents of the same children, but no marriage is
        recorded.
      </p>
      <Button
        size="sm"
        onClick={() =>
          link.mutate(
            {
              person_a: a.id,
              person_b: b.id,
              a_is: "spouse",
              kind: "biological",
              status: "married",
            },
            {
              onSuccess: () => {
                toast.success("Marriage recorded.");
                onDone();
              },
              onError: showError,
            },
          )
        }
      >
        Record them as married
      </Button>
    </div>
  );
}

/** Click a link to change or remove it. */
export function LinkEditor({
  pick,
  people,
  at,
  bounds,
  onClose,
}: {
  pick: EdgePick;
  people: Map<string, GraphPerson>;
  at: Point;
  bounds: { width: number; height: number };
  onClose: () => void;
}) {
  const name = (id: string | undefined) => {
    const person = id ? people.get(id) : undefined;
    return person ? shortName(person) : "";
  };
  let body = null;
  let label = "A link on the tree"; // its name, by whom it links
  if (pick.type === "child") {
    body = pick.links.map((link) => (
      <ParentLinkRow key={link.id} link={link} people={people} onDone={onClose} />
    ));
    const child = name(pick.links[0]?.target);
    if (child) label = `${child}'s parents`;
  } else if (pick.type === "spouse") {
    body = <MarriageRow link={pick.link} people={people} onDone={onClose} />;
    label = `The marriage of ${name(pick.link.source)} and ${name(pick.link.target)}`;
  } else {
    const [a, b] = [people.get(pick.a), people.get(pick.b)];
    if (a && b) body = <PairRow a={a} b={b} onDone={onClose} />;
    label = `${name(pick.a)} and ${name(pick.b)}`;
  }
  return (
    <FloatingCard at={at} bounds={bounds} width={340} label={label} onClose={onClose}>
      {body}
    </FloatingCard>
  );
}
