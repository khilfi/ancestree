import {
  BookOpenIcon,
  CameraIcon,
  EllipsisIcon,
  FanIcon,
  HourglassIcon,
  LocateFixedIcon,
  MergeIcon,
  PencilIcon,
  Trash2Icon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { TREE_DEFAULTS, usePerson, useSaveTreeSettings, useTreeSettings } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { InAppOnly, useCanEdit, useCopy } from "@/app/copy";
import { Failed } from "@/components/Failed";
import { Hint } from "@/components/Hint";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BiographyTab } from "@/features/biography/BiographyTab";
import { YouLine } from "@/features/me/YouLine";
import { shortName } from "@/features/tree/words";
import { ageOf } from "@/lib/dates";
import { useEscape } from "@/lib/escape";
import { openLifeStory } from "@/lib/lifeStory";
import { showDone } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { MergeDialog } from "./MergeDialog";
import { PersonDetails } from "./PersonDetails";
import { PersonForm } from "./PersonForm";
import { PhotoDialog } from "./PhotoDialog";
import { RelativesTab } from "./RelativesTab";
import { WhoChanged } from "./WhoChanged";

type Props = {
  personId: string | null; // null: adding someone new
  onSelect: (id: string) => void;
  onClose: () => void;
  onDelete: (person: PersonDetail) => void;
  onFindRelationship?: (id: string) => void; // "how is anyone related to them?"
  // In an hourglass or fan chart: Fan from here, which draws it from them.
  fromHere?: { layout: "hourglass" | "fan"; onClick: () => void };
  // Esc, once nothing over the panel is open: the page's own, such as the tree's, which ends
  // finding a relationship first; else it closes the panel.
  onEscape?: () => void;
};

/** The side panel: one person's details and relatives, or the form for someone new. */
export function PersonPanel({
  personId,
  onSelect,
  onClose,
  onDelete,
  onFindRelationship,
  fromHere,
  onEscape,
}: Props) {
  return (
    <aside aria-label="Person" className="flex h-full flex-col bg-card">
      <EscapeCloses onEscape={onEscape ?? onClose} />
      {personId === null ? (
        <NewPerson onSelect={onSelect} onClose={onClose} />
      ) : (
        <ExistingPerson
          personId={personId}
          onSelect={onSelect}
          onClose={onClose}
          onDelete={onDelete}
          onFindRelationship={onFindRelationship}
          fromHere={fromHere}
        />
      )}
    </aside>
  );
}

/**
 * Esc closes the panel, by the user's answer of 19–20 Nov 2026, through the Esc
 * stack: what opened over it closes first, a dialog, a menu or a list, the form, Family
 * facts, a card on the tree, finding a relationship. First in the panel, so it's put on the
 * stack before the form that opens with it for someone new, which takes Esc as its Cancel.
 */
function EscapeCloses({ onEscape }: { onEscape: () => void }) {
  useEscape(onEscape);
  return null;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the panel">
      <XIcon />
    </Button>
  );
}

/** Put this person at the centre of the rings instead of the oldest ancestor, or the
 *  oldest ancestor back: "Centre" has that one meaning. From More. */
function CentreItem({ person }: { person: PersonDetail }) {
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  const current = settings.data ?? TREE_DEFAULTS;
  if (current.centre === person.id) {
    return (
      <DropdownMenuItem
        disabled={save.isPending}
        onSelect={() =>
          save.mutate(
            { ...current, centre: null },
            { onSuccess: () => toast.success("The oldest ancestor is back at the centre.") },
          )
        }
      >
        <LocateFixedIcon />
        Use the oldest ancestor
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem
      disabled={save.isPending || settings.isPending}
      onSelect={() =>
        save.mutate(
          { ...current, centre: person.id },
          {
            onSuccess: () =>
              toast.success(
                `${person.nickname || person.full_name} is now at the centre of the tree.`,
              ),
          },
        )
      }
    >
      <LocateFixedIcon />
      Centre the tree here
    </DropdownMenuItem>
  );
}

/**
 * Under their name: **Edit** and **Life story**, and **More** for the rest: Fan or
 * Hourglass from here (in those charts), Find relationship, Centre the tree here, Same person
 * as…, and Move to Trash. What can't be done here, in a copy, isn't offered.
 */
function Actions({
  person,
  onEdit,
  onFindRelationship,
  fromHere,
  onMerge,
  onTrash,
}: {
  person: PersonDetail;
  onEdit: () => void;
  onFindRelationship?: (id: string) => void;
  fromHere?: Props["fromHere"];
  onMerge: () => void;
  onTrash: () => void;
}) {
  const canEdit = useCanEdit();
  const inApp = useCopy() === null;
  const story = !person.placeholder;
  const drawFrom = fromHere && !person.placeholder ? fromHere : null;
  const more = Boolean(drawFrom || onFindRelationship || canEdit);
  if (!canEdit && !story && !more) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {canEdit && (
        <Button size="sm" onClick={onEdit}>
          <PencilIcon />
          Edit
        </Button>
      )}
      {story && (
        <Button size="sm" variant="outline" onClick={() => openLifeStory(person.id)}>
          <BookOpenIcon />
          Life story
        </Button>
      )}
      {more && (
        <DropdownMenu modal={false}>
          <Hint label="More">
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="outline" aria-label={`More for ${shortName(person)}`}>
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="start" className="min-w-52">
            {drawFrom && (
              <DropdownMenuItem onSelect={drawFrom.onClick}>
                {drawFrom.layout === "fan" ? <FanIcon /> : <HourglassIcon />}
                {drawFrom.layout === "fan" ? "Fan from here" : "Hourglass from here"}
              </DropdownMenuItem>
            )}
            {onFindRelationship && (
              <DropdownMenuItem onSelect={() => onFindRelationship(person.id)}>
                <WaypointsIcon />
                Find relationship
              </DropdownMenuItem>
            )}
            {canEdit && <CentreItem person={person} />}
            {/* What's seldom needed: someone entered twice, made one. */}
            {canEdit && inApp && !person.placeholder && (
              <DropdownMenuItem onSelect={onMerge}>
                <MergeIcon />
                Same person as…
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onTrash}>
                  <Trash2Icon />
                  Move to Trash
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8">{children}</div>;
}

function NewPerson({ onSelect, onClose }: Pick<Props, "onSelect" | "onClose">) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">Add a person</h2>
        <CloseButton onClose={onClose} />
      </header>
      <PersonForm
        onSaved={(saved) => {
          showDone(`Added ${saved.person.full_name}.`, { notices: saved.notices });
          onSelect(saved.person.id);
        }}
        onCancel={onClose}
      />
    </>
  );
}

/** Whether they've gone from the tree: an Undo of adding them, the Trash, or a merge. */
function gone(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 404;
}

function ExistingPerson({
  personId,
  onSelect,
  onClose,
  onDelete,
  onFindRelationship,
  fromHere,
}: Omit<Props, "personId"> & { personId: string }) {
  const query = usePerson(personId);
  const canEdit = useCanEdit();
  const [tab, setTab] = useState("details");
  const [storyOpened, setStoryOpened] = useState(false);
  if (tab === "biography" && !storyOpened) setStoryOpened(true);
  const [editing, setEditing] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [merging, setMerging] = useState(false);
  // Gone from the tree while open, as after Undo of adding them: the panel closes, rather
  // than saying "That person isn't in the tree."
  const missing = query.isError && gone(query.error);
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  if (query.isPending || missing) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-3 p-4">
        <div className="flex justify-end">
          <CloseButton onClose={onClose} />
        </div>
        <Failed
          error={query.error}
          onRetry={() => void query.refetch()}
          className="text-muted-foreground"
        />
      </div>
    );
  }

  const person = query.data;
  const years = lifeYears({
    birth_year: person.birth_date?.value.year ?? null,
    death_year: person.death_date?.value.year ?? null,
    born: person.birth_date?.value,
    died: person.death_date?.value,
  });
  const { age } = ageOf({
    born: person.birth_date?.value,
    died: person.death_date?.value,
    living: person.is_living,
  });
  const relatives =
    person.parents.length +
    person.spouses.length +
    person.siblings.length +
    person.child_groups.reduce((count, group) => count + group.children.length, 0);

  return (
    <>
      <header className="border-b border-border p-4">
        <div className="flex gap-4">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setPhotoOpen(true)}
              className="group relative shrink-0 rounded-full"
              aria-label={person.photo_version === null ? "Add a photo" : "Change the photo"}
            >
              <PersonAvatar person={person} size="lg" />
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-foreground/40 text-primary-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <CameraIcon className="size-6" />
              </span>
            </button>
          ) : (
            <PersonAvatar person={person} size="lg" />
          )}
          <div className="min-w-0 flex-1 space-y-1 pt-1">
            <h2 className="text-lg leading-tight font-semibold break-words">
              {person.title ? `${person.title} ${person.full_name}` : person.full_name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {[person.nickname && `“${person.nickname}”`, years, age].filter(Boolean).join(" · ")}
            </p>
            {person.sibling_position && (
              <p className="text-sm text-faint">{person.sibling_position}</p>
            )}
            <YouLine personId={person.id} />
          </div>
          <div className="-mt-1 -mr-2">
            <CloseButton onClose={onClose} />
          </div>
        </div>
        {!editing && (
          <Actions
            person={person}
            onEdit={() => setEditing(true)}
            onFindRelationship={onFindRelationship}
            fromHere={fromHere}
            onMerge={() => setMerging(true)}
            onTrash={() => setConfirmDelete(true)}
          />
        )}
      </header>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0 pt-3">
        <TabsList className="mx-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="relatives" disabled={editing}>
            Relatives{relatives > 0 ? ` (${relatives})` : ""}
          </TabsTrigger>
          <TabsTrigger value="biography" disabled={editing}>
            Life story
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex min-h-0 flex-col">
          {editing ? (
            <PersonForm
              person={person}
              onSaved={(saved) => {
                showDone("Saved.", { notices: saved.notices });
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Scroll>
              <div className="space-y-4">
                <PersonDetails person={person} />
                <InAppOnly>
                  <WhoChanged personId={person.id} />
                </InAppOnly>
              </div>
            </Scroll>
          )}
        </TabsContent>

        <TabsContent value="relatives" className="flex min-h-0 flex-col">
          <Scroll>
            <RelativesTab person={person} onOpen={onSelect} />
          </Scroll>
        </TabsContent>

        {/* Kept open once visited, so switching tabs never interrupts writing. */}
        <TabsContent
          value="biography"
          forceMount={storyOpened || undefined}
          className="flex min-h-0 flex-col data-[state=inactive]:hidden"
        >
          {storyOpened && <BiographyTab person={person} />}
        </TabsContent>
      </Tabs>

      {canEdit && <PhotoDialog person={person} open={photoOpen} onOpenChange={setPhotoOpen} />}
      {merging && <MergeDialog person={person} open={merging} onOpenChange={setMerging} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move {person.full_name} to the Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              {person.link_count > 0
                ? `Their ${person.link_count} link${person.link_count === 1 ? "" : "s"} to family go with them. `
                : ""}
              You can restore everything, photo included, from the Trash for 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => onDelete(person)}>
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
