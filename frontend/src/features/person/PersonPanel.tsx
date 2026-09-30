import {
  CameraIcon,
  LocateFixedIcon,
  PencilIcon,
  Trash2Icon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { usePerson, useSaveTreeSettings, useTreeSettings } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { CanEdit, useCanEdit, useHiddenHere } from "@/app/copy";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BiographyTab } from "@/features/biography/BiographyTab";
import { YouLine } from "@/features/me/YouLine";
import { ageOf } from "@/lib/dates";
import { showNotices } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { PersonDetails } from "./PersonDetails";
import { PersonForm } from "./PersonForm";
import { PhotoDialog } from "./PhotoDialog";
import { RelativesTab } from "./RelativesTab";

type Props = {
  personId: string | null; // null: adding someone new
  onSelect: (id: string) => void;
  onClose: () => void;
  onDelete: (person: PersonDetail) => void;
  onFindRelationship?: (id: string) => void; // "how is anyone related to them?"
};

/** The side panel: one person's details and relatives, or the form for someone new. */
export function PersonPanel({ personId, onSelect, onClose, onDelete, onFindRelationship }: Props) {
  return (
    <aside aria-label="Person" className="flex h-full flex-col bg-white">
      {personId === null ? (
        <NewPerson onSelect={onSelect} onClose={onClose} />
      ) : (
        <ExistingPerson
          personId={personId}
          onSelect={onSelect}
          onClose={onClose}
          onDelete={onDelete}
          onFindRelationship={onFindRelationship}
        />
      )}
    </aside>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the panel">
      <XIcon />
    </Button>
  );
}

/** Put this person at the centre of the rings instead of the oldest ancestor. */
function CentreButton({ person }: { person: PersonDetail }) {
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  const current = settings.data ?? { centre: null, colours: "branch" as const };
  if (current.centre === person.id) {
    return (
      <Button
        variant="outline"
        disabled={save.isPending}
        onClick={() =>
          save.mutate(
            { ...current, centre: null },
            { onSuccess: () => toast.success("The oldest ancestor is back at the centre.") },
          )
        }
      >
        <LocateFixedIcon />
        Undo centre
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      disabled={save.isPending || settings.isPending}
      onClick={() =>
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
    </Button>
  );
}

function Scroll({ children }: { children: ReactNode }) {
  return <div className="relative min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-8">{children}</div>;
}

function NewPerson({ onSelect, onClose }: Pick<Props, "onSelect" | "onClose">) {
  return (
    <>
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <h2 className="text-base font-semibold">Add a person</h2>
        <CloseButton onClose={onClose} />
      </header>
      <Scroll>
        <PersonForm
          onSaved={(saved) => {
            showNotices(saved.notices);
            toast.success(`Added ${saved.person.full_name}.`);
            onSelect(saved.person.id);
          }}
          onCancel={onClose}
        />
      </Scroll>
    </>
  );
}

function ExistingPerson({
  personId,
  onSelect,
  onClose,
  onDelete,
  onFindRelationship,
}: Omit<Props, "personId"> & { personId: string }) {
  const query = usePerson(personId);
  const canEdit = useCanEdit();
  const canPhoto = useCanEdit("photos");
  const hidden = useHiddenHere(personId); // in a copy to edit that hides their details
  const [tab, setTab] = useState("details");
  const [storyOpened, setStoryOpened] = useState(false);
  if (tab === "biography" && !storyOpened) setStoryOpened(true);
  const [editing, setEditing] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (query.isPending) {
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
        <p className="text-stone-600">{query.error.message}</p>
      </div>
    );
  }

  const person = query.data;
  const years = lifeYears({
    birth_year: person.birth_date?.value.year ?? null,
    death_year: person.death_date?.value.year ?? null,
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
      <header className="flex gap-4 border-b border-stone-200 p-4">
        {canPhoto ? (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="group relative shrink-0 rounded-full"
            aria-label={person.photo_version === null ? "Add a photo" : "Change the photo"}
          >
            <PersonAvatar person={person} size="lg" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
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
          <p className="text-sm text-stone-600">
            {[person.nickname && `“${person.nickname}”`, years, age].filter(Boolean).join(" · ")}
          </p>
          {person.sibling_position && (
            <p className="text-sm text-stone-500">{person.sibling_position}</p>
          )}
          <YouLine personId={person.id} />
        </div>
        <div className="-mt-1 -mr-2">
          <CloseButton onClose={onClose} />
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0 pt-3">
        <TabsList className="mx-4">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="relatives" disabled={editing}>
            Relatives{relatives > 0 ? ` (${relatives})` : ""}
          </TabsTrigger>
          <TabsTrigger value="biography" disabled={editing}>
            Biography
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex min-h-0 flex-col">
          <Scroll>
            {editing ? (
              <PersonForm
                person={person}
                onSaved={(saved) => {
                  showNotices(saved.notices);
                  toast.success("Saved.");
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="space-y-4">
                <PersonDetails person={person} />
                {(canEdit || onFindRelationship) && (
                  <div className="flex flex-wrap gap-2 border-t border-stone-100 pt-4">
                    {!hidden && (
                      <CanEdit what="change">
                        <Button onClick={() => setEditing(true)}>
                          <PencilIcon />
                          Edit
                        </Button>
                      </CanEdit>
                    )}
                    {onFindRelationship && (
                      <Button variant="outline" onClick={() => onFindRelationship(person.id)}>
                        <WaypointsIcon />
                        Find relationship
                      </Button>
                    )}
                    <CanEdit>
                      <CentreButton person={person} />
                    </CanEdit>
                    <CanEdit what="remove">
                      <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                        <Trash2Icon />
                        Move to Trash
                      </Button>
                    </CanEdit>
                  </div>
                )}
              </div>
            )}
          </Scroll>
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

      {canPhoto && <PhotoDialog person={person} open={photoOpen} onOpenChange={setPhotoOpen} />}

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
