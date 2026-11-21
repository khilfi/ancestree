import { Handle, type Node, type NodeProps, Position, useConnection } from "@xyflow/react";
import { ArrowRightIcon } from "lucide-react";
import { memo } from "react";
import type { GraphPerson } from "@/api/types";
import { Hint } from "@/components/Hint";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StoryMark } from "@/features/biography/StoryMark";
import { ageOf } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { LINK_HANDLE, PHOTO, SMALL_PHOTO } from "./geometry";
import type { Fold } from "./rings";
import { useTreeActions } from "./TreeActions";

export type PersonNodeData = {
  person: GraphPerson;
  years: string;
  colour: string | null; // the family branch or generation
  folds: Fold[]; // clusters hanging off this person, e.g. a wife's own family
};

export type PersonFlowNode = Node<PersonNodeData, "person" | "unknown">;

/** Someone's card on the tree, which describes them to a screen reader too. */
export const cardId = (id: string) => `person-card-${id}`;

/** Where links attach, at the photo's centre. The lines are drawn to the photo's rim by
 *  the links themselves; React Flow only needs somewhere to hang them. */
function Anchors({ photo }: { photo: number }) {
  const style = { left: "50%", top: photo / 2, opacity: 0, pointerEvents: "none" } as const;
  return (
    <>
      <Handle type="target" id="in" position={Position.Top} isConnectable={false} style={style} />
      <Handle
        type="source"
        id="out"
        position={Position.Bottom}
        isConnectable={false}
        style={style}
      />
    </>
  );
}

/** Dropping a link anywhere on someone counts: while linking, the whole person is a target. */
function DropTarget({ id }: { id: string }) {
  const linking = useConnection((connection) => connection.inProgress);
  const over = useConnection((connection) => connection.inProgress && connection.toNode?.id === id);
  if (!linking) return null;
  return (
    <Handle
      type="target"
      id="drop"
      position={Position.Top}
      isConnectableStart={false}
      className={cn(
        "!absolute !inset-0 !h-full !w-full !transform-none !rounded-2xl !border-0",
        over ? "!bg-highlight-tint/60 !ring-2 !ring-highlight" : "!bg-transparent",
      )}
    />
  );
}

function FoldBadge({ folds, name }: { folds: Fold[]; name: string }) {
  const { toggleFold } = useTreeActions();
  return (
    <div className="absolute top-9 left-[86px] flex flex-col gap-1">
      {folds.map((fold) => (
        <Hint
          key={fold.unit}
          label={`${fold.open ? "Fold away" : "Show"} ${name}'s own family (${fold.size})`}
        >
          <button
            type="button"
            aria-label={`${fold.open ? "Fold away" : "Show"} ${name}'s own family (${fold.size})`}
            onClick={(event) => {
              event.stopPropagation();
              toggleFold(fold.unit);
            }}
            className={cn(
              "nodrag rounded-full border px-1.5 text-xs leading-5 font-semibold shadow-sm",
              fold.open
                ? "border-input bg-card text-muted-foreground"
                : "border-warning-border bg-warning-soft text-warning-soft-foreground",
            )}
          >
            {fold.open ? "−" : `+${fold.size}`}
          </button>
        </Hint>
      ))}
    </div>
  );
}

export const PersonNode = memo(function PersonNode({
  id,
  data,
  selected,
  type,
}: NodeProps<PersonFlowNode>) {
  const { readOnly } = useTreeActions();
  const { person, years, colour, folds } = data;

  if (type === "unknown") {
    return (
      <Hint label={readOnly ? "Unknown parent" : "Unknown parent: click to fill in"}>
        <div className={cn("group flex size-full justify-center", !readOnly && "cursor-pointer")}>
          <PersonAvatar
            person={person}
            size="sm"
            className="person-photo transition-transform group-hover:scale-125"
          />
          <Anchors photo={SMALL_PHOTO} />
          <DropTarget id={id} />
        </div>
      </Hint>
    );
  }

  const name = person.nickname || person.full_name;
  const { age } = ageOf({ born: person.born, died: person.died, living: person.is_living });
  // Their card, as the pointer rests on them or the keyboard reaches them: the full name
  // always, however long; then the nickname, years and age, as the panel says them; and
  // where they were born.
  const lines = [
    [person.nickname && `“${person.nickname}”`, years, age].filter(Boolean).join(" · "),
    person.birthplace && `Born in ${person.birthplace}`,
  ].filter(Boolean);
  return (
    <div className="group relative flex size-full cursor-pointer flex-col items-center text-center">
      <PersonAvatar
        person={person}
        size="node"
        className={cn(
          "person-photo border-[3px] shadow-sm transition-transform duration-150 group-hover:scale-140",
          selected && "!border-highlight ring-4 ring-highlight-border",
        )}
        style={colour && !selected ? { borderColor: colour } : undefined}
      />
      <StoryMark
        person={person}
        style={{ top: PHOTO - 18, left: `calc(50% + ${PHOTO / 2 - 16}px)` }}
      />
      {/* On a soft background, so the lines pass behind the name, not through it. The
          name has the person's whole width, as it had; its background a little more (-mx-1),
          no wider than neighbours on a ring are apart (rings.ts's SPACING). */}
      <div className="person-label -mx-1 mt-1 flex flex-col items-center rounded-md bg-background/90 px-1 py-px text-xs leading-tight">
        <span className="person-name line-clamp-2 font-medium text-foreground">
          {person.full_name}
        </span>
        {years && <span className="text-faint">{years}</span>}
      </div>
      <div
        id={cardId(id)}
        role="tooltip"
        className="person-card pointer-events-none absolute bottom-full mb-5 hidden w-max max-w-56 rounded-md bg-foreground px-2 py-1 text-xs leading-snug text-background shadow group-hover:block"
      >
        <div className="font-medium">{person.full_name}</div>
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      {folds.length > 0 && <FoldBadge folds={folds} name={name} />}
      <Anchors photo={PHOTO} />
      {!readOnly && (
        <Hint label={"Drag onto someone to link them"}>
          <Handle
            type="source"
            id="link"
            position={Position.Right}
            style={{
              left: LINK_HANDLE.left,
              top: (PHOTO - LINK_HANDLE.size) / 2,
              width: LINK_HANDLE.size,
              height: LINK_HANDLE.size,
              transform: "none",
            }}
            className="!flex items-center justify-center !rounded-full !border-2 !border-card !bg-highlight opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ArrowRightIcon className="pointer-events-none size-3 text-highlight-foreground" />
          </Handle>
        </Hint>
      )}
      <DropTarget id={id} />
    </div>
  );
});
