import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EllipsisIcon, GripVerticalIcon, PlusIcon } from "lucide-react";
import { type CSSProperties, type ReactNode, type Ref, useState } from "react";
import { toast } from "sonner";
import { useChildrenOrder, useKinds, useUnlink, useUpdateLink } from "@/api/queries";
import type {
  ChildGroup,
  PersonDetail,
  Relation,
  RelationshipUpdate,
  Relative,
  SpouseStatus,
} from "@/api/types";
import { CanEdit, useCanEdit } from "@/app/copy";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { cn } from "@/lib/utils";
import { AddRelativeDialog } from "./AddRelativeDialog";
import { useFeedback } from "./useFeedback";

function Section({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex min-h-6 items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h3>
        <CanEdit>
          <Button variant="ghost" size="xs" onClick={onAdd}>
            <PlusIcon />
            {addLabel}
          </Button>
        </CanEdit>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-1 text-sm text-stone-400">{children}</p>;
}

function RelativeRow({
  relative,
  onOpen,
  actions,
  handle,
  ref,
  style,
  className,
}: {
  relative: Relative;
  onOpen: (id: string) => void;
  actions?: ReactNode;
  handle?: ReactNode;
  ref?: Ref<HTMLLIElement>;
  style?: CSSProperties;
  className?: string;
}) {
  const details = [relative.label, lifeYears(relative)].filter(Boolean).join(" · ");
  const content = (
    <>
      <PersonAvatar person={relative} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-stone-900">
          {relative.placeholder ? "Unknown parent" : relative.full_name}
        </span>
        <span className="block truncate text-xs text-stone-500">{details}</span>
      </span>
    </>
  );
  return (
    <li
      ref={ref}
      style={style}
      className={cn("group flex items-center gap-1 rounded-lg hover:bg-stone-50", className)}
    >
      {handle}
      {relative.placeholder ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 px-2 py-1.5">{content}</div>
      ) : (
        <button
          type="button"
          onClick={() => onOpen(relative.id)}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left"
        >
          {content}
        </button>
      )}
      {actions}
    </li>
  );
}

/** Change a link's kind or marriage status, or remove it. People are never deleted here. */
function LinkMenu({
  person,
  relative,
  type,
}: {
  person: PersonDetail;
  relative: Relative;
  type: "parent" | "spouse";
}) {
  const kinds = useKinds();
  const update = useUpdateLink();
  const unlink = useUnlink();
  const feedback = useFeedback();
  const canEdit = useCanEdit();
  const [confirming, setConfirming] = useState(false);
  const linkId = relative.link_id;
  if (!linkId || !canEdit) return null;

  const current = relative.kind ?? "biological";
  const options = (kinds.data ?? []).filter((kind) => kind.active || kind.key === current);
  const them = relative.placeholder ? "the unknown parent" : relative.full_name;
  const definition = kinds.data?.find((kind) => kind.key === current);
  const linkedAs =
    type === "spouse"
      ? "spouses"
      : `${definition?.parent_label.neutral ?? "parent"} and ${definition?.child_label.neutral ?? "child"}`;

  function change(body: RelationshipUpdate) {
    if (!linkId) return;
    update.mutate(
      { id: linkId, body },
      {
        onSuccess: (result) => {
          feedback(result);
          toast.success("Link updated.");
        },
        onError: showError,
      },
    );
  }

  function remove() {
    if (!linkId) return;
    unlink.mutate(linkId, { onSuccess: () => toast.success("Link removed."), onError: showError });
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Link with ${them}`}
            className="opacity-50 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!canEdit ? null : type === "parent" ? (
            <>
              <DropdownMenuLabel>Kind of link</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={current}
                onValueChange={(kind) => change({ kind, swap: false })}
              >
                {options.map((kind) => (
                  <DropdownMenuRadioItem key={kind.key} value={kind.key}>
                    {kind.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </>
          ) : (
            <>
              <DropdownMenuLabel>Marriage</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={relative.status ?? "married"}
                onValueChange={(status) => change({ status: status as SpouseStatus, swap: false })}
              >
                <DropdownMenuRadioItem value="married">Married</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="divorced">Divorced</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="widowed">Widowed</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
          {canEdit && <DropdownMenuSeparator />}
          {canEdit && (
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
              Remove link
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this link?</AlertDialogTitle>
            <AlertDialogDescription>
              {person.full_name} and {them} will no longer be linked as {linkedAs}. Both stay in the
              tree.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SortableChild({
  child,
  person,
  onOpen,
}: {
  child: Relative;
  person: PersonDetail;
  onOpen: (id: string) => void;
}) {
  const sortable = useSortable({ id: child.id });
  return (
    <RelativeRow
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn(sortable.isDragging && "relative z-10 bg-white shadow-md")}
      relative={child}
      onOpen={onOpen}
      actions={<LinkMenu person={person} relative={child} type="parent" />}
      handle={
        <button
          type="button"
          ref={sortable.setActivatorNodeRef}
          {...sortable.attributes}
          {...sortable.listeners}
          aria-label={`Move ${child.full_name} in the birth order`}
          className="cursor-grab touch-none rounded p-1 text-stone-300 hover:text-stone-600 active:cursor-grabbing"
        >
          <GripVerticalIcon className="size-4" />
        </button>
      }
    />
  );
}

/** Children of this person with one other parent, eldest first; drag to set the birth order. */
function ChildGroupList({
  person,
  group,
  showHeading,
  onOpen,
}: {
  person: PersonDetail;
  group: ChildGroup;
  showHeading: boolean;
  onOpen: (id: string) => void;
}) {
  const order = useChildrenOrder(person.id);
  const kinds = useKinds();
  const [moved, setMoved] = useState<string[] | null>(null); // shown until the server agrees
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(group.children.map((child) => [child.id, child]));
  const ids = moved ?? group.children.map((child) => child.id);
  const children = ids.flatMap((id) => byId.get(id) ?? []);
  const others = group.other_parents
    .map((other) => (other.placeholder ? "an unknown parent" : other.full_name))
    .join(" & ");
  // Birth order belongs to children by birth; adopted, fostered and other children follow dates.
  const byBirth = group.kind === null || group.kind === undefined;
  const canEdit = useCanEdit();
  const uncertain = byBirth && children.length > 1 && !group.order_decided;
  const sortable = byBirth && children.length > 1 && canEdit;

  let heading = others ? `With ${others}` : "Other parent not recorded";
  if (!byBirth) {
    const kind = kinds.data?.find((candidate) => candidate.key === group.kind);
    heading = [kind?.label ?? group.kind, others && `with ${others}`].filter(Boolean).join(" · ");
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setMoved(next);
    order.mutate(next, { onError: showError, onSettled: () => setMoved(null) });
  }

  return (
    <div className="space-y-1">
      {showHeading && <p className="pt-1 text-xs text-stone-500">{heading}</p>}
      {uncertain && (
        <p className="text-xs text-amber-700">
          The birth order isn't certain.
          {canEdit && " Drag the children into order, eldest first."}
        </p>
      )}
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul>
              {children.map((child) => (
                <SortableChild key={child.id} child={child} person={person} onOpen={onOpen} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul>
          {children.map((child) => (
            <RelativeRow
              key={child.id}
              relative={child}
              onOpen={onOpen}
              actions={<LinkMenu person={person} relative={child} type="parent" />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Parents, spouses, brothers and sisters, and children, with ways to add and change links. */
export function RelativesTab({
  person,
  onOpen,
}: {
  person: PersonDetail;
  onOpen: (id: string) => void;
}) {
  const [adding, setAdding] = useState<Relation | null>(null);
  const groups = person.child_groups;

  return (
    <div className="space-y-6">
      <Section title="Parents" addLabel="Add parent" onAdd={() => setAdding("parent")}>
        {person.parents.length === 0 ? (
          <Empty>No parents recorded.</Empty>
        ) : (
          <ul>
            {person.parents.map((parent) => (
              <RelativeRow
                key={parent.id}
                relative={parent}
                onOpen={onOpen}
                actions={<LinkMenu person={person} relative={parent} type="parent" />}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Married to" addLabel="Add spouse" onAdd={() => setAdding("spouse")}>
        {person.spouses.length === 0 ? (
          <Empty>No marriages recorded.</Empty>
        ) : (
          <ul>
            {person.spouses.map((spouse) => (
              <RelativeRow
                key={spouse.id}
                relative={spouse}
                onOpen={onOpen}
                actions={<LinkMenu person={person} relative={spouse} type="spouse" />}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Brothers and sisters"
        addLabel="Add sibling"
        onAdd={() => setAdding("sibling")}
      >
        {person.siblings.length === 0 ? (
          <Empty>None recorded.</Empty>
        ) : (
          <>
            <ul>
              {person.siblings.map((sibling) => (
                <RelativeRow key={sibling.id} relative={sibling} onOpen={onOpen} />
              ))}
            </ul>
            <p className="text-xs text-stone-400">
              Brothers and sisters are linked through their parents.
            </p>
          </>
        )}
      </Section>

      <Section title="Children" addLabel="Add child" onAdd={() => setAdding("child")}>
        {groups.length === 0 ? (
          <Empty>No children recorded.</Empty>
        ) : (
          groups.map((group) => (
            <ChildGroupList
              key={`${group.kind ?? "birth"}:${group.other_parents.map((other) => other.id).join("+")}`}
              person={person}
              group={group}
              showHeading={groups.length > 1 || group.other_parents.length > 0 || !!group.kind}
              onOpen={onOpen}
            />
          ))
        )}
      </Section>

      {adding && (
        <AddRelativeDialog
          person={person}
          relation={adding}
          onClose={() => setAdding(null)}
          onOpenPerson={onOpen}
        />
      )}
    </div>
  );
}
