import { Handle, type Node, type NodeProps, Position, useConnection } from "@xyflow/react";
import { ArrowRightIcon } from "lucide-react";
import { memo } from "react";
import type { GraphPerson } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
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
        over ? "!bg-sky-100/60 !ring-2 !ring-sky-400" : "!bg-transparent",
      )}
    />
  );
}

function FoldBadge({ folds, name }: { folds: Fold[]; name: string }) {
  const { toggleFold } = useTreeActions();
  return (
    <div className="absolute top-9 left-[86px] flex flex-col gap-1">
      {folds.map((fold) => (
        <button
          key={fold.unit}
          type="button"
          title={`${fold.open ? "Fold away" : "Show"} ${name}'s own family (${fold.size})`}
          onClick={(event) => {
            event.stopPropagation();
            toggleFold(fold.unit);
          }}
          className={cn(
            "nodrag rounded-full border px-1.5 text-[11px] leading-5 font-semibold shadow-sm",
            fold.open
              ? "border-stone-300 bg-white text-stone-600"
              : "border-amber-300 bg-amber-50 text-amber-800",
          )}
        >
          {fold.open ? "−" : `+${fold.size}`}
        </button>
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
      <div
        className={cn("group flex size-full justify-center", !readOnly && "cursor-pointer")}
        title={readOnly ? "Unknown parent" : "Unknown parent: click to fill in"}
      >
        <PersonAvatar
          person={person}
          size="sm"
          className="person-photo transition-transform group-hover:scale-125"
        />
        <Anchors photo={SMALL_PHOTO} />
        <DropTarget id={id} />
      </div>
    );
  }

  const name = person.nickname || person.full_name;
  const { age } = ageOf({ born: person.born, died: person.died, living: person.is_living });
  const extra = [
    person.nickname && person.full_name,
    age && (years ? `${years} · ${age}` : age), // "b. 1939 · about 87 years old"
    person.birthplace && `Born in ${person.birthplace}`,
  ];
  return (
    <div className="group relative flex size-full cursor-pointer flex-col items-center text-center">
      <PersonAvatar
        person={person}
        size="node"
        className={cn(
          "person-photo border-[3px] shadow-sm transition-transform duration-150 group-hover:scale-140",
          selected && "!border-sky-500 ring-4 ring-sky-200",
        )}
        style={colour && !selected ? { borderColor: colour } : undefined}
      />
      <div className="person-label mt-1.5 line-clamp-2 text-xs leading-tight font-medium text-stone-800">
        {person.full_name}
      </div>
      <div className="person-label text-[11px] text-stone-500">{years}</div>
      {extra.some(Boolean) && (
        <div className="pointer-events-none absolute bottom-full mb-5 hidden w-max max-w-56 rounded-md bg-stone-900 px-2 py-1 text-[11px] leading-snug text-white shadow group-hover:block">
          {extra.filter(Boolean).map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {folds.length > 0 && <FoldBadge folds={folds} name={name} />}
      <Anchors photo={PHOTO} />
      {!readOnly && (
        <Handle
          type="source"
          id="link"
          position={Position.Right}
          title="Drag onto someone to link them"
          style={{
            left: LINK_HANDLE.left,
            top: (PHOTO - LINK_HANDLE.size) / 2,
            width: LINK_HANDLE.size,
            height: LINK_HANDLE.size,
            transform: "none",
          }}
          className="!flex items-center justify-center !rounded-full !border-2 !border-white !bg-sky-500 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <ArrowRightIcon className="pointer-events-none size-3 text-white" />
        </Handle>
      )}
      <DropTarget id={id} />
    </div>
  );
});
