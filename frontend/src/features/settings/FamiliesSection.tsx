import { useState } from "react";
import {
  type DesktopFamily,
  useFamilies,
  usePutFamilyBack,
  useRemoveFamily,
  useRenameFamily,
} from "@/api/desktop";
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
import { Input } from "@/components/ui/input";
import {
  AddFamilyDialog,
  familyPlace,
  Opening,
  useOpenAnother,
} from "@/features/families/FamilyMenu";
import { showError } from "@/lib/notify";

/** When a family removed today is deleted for good: 30 days on. */
function deletedOn(removed: string): string {
  const day = new Date(new Date(removed).getTime() + 30 * 86_400_000);
  return day.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

function Row({ family, single }: { family: DesktopFamily; single: boolean }) {
  const rename = useRenameFamily();
  const another = useOpenAnother();
  const [name, setName] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const remove = useRemoveFamily();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        {name === null ? (
          <div className="font-medium">
            {family.name}
            {family.open && <span className="font-normal text-stone-500"> · open now</span>}
          </div>
        ) : (
          <form
            className="flex max-w-sm gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              rename.mutate(
                { id: family.id, name },
                { onError: showError, onSuccess: () => setName(null) },
              );
            }}
          >
            <Input
              aria-label={`${family.name}'s new name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              autoFocus
              required
            />
            <Button type="submit" size="sm" disabled={rename.isPending || !name.trim()}>
              Rename
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setName(null)}>
              Cancel
            </Button>
          </form>
        )}
        <div className="text-xs text-stone-500">{familyPlace(family)}</div>
      </div>
      {name === null && (
        <div className="flex shrink-0 gap-2">
          {!family.open && (
            <Button size="sm" onClick={() => another.choose(family)}>
              Open
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setName(family.name)}>
            Rename…
          </Button>
          {!family.open && !single && (
            <Button size="sm" variant="ghost" onClick={() => setRemoving(true)}>
              Remove…
            </Button>
          )}
        </div>
      )}
      <AlertDialog open={removing} onOpenChange={setRemoving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {family.name} from this computer?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-stone-600">
                <p>
                  It goes to AncesTree's bin, with its photos, stories and backups, for 30 days:
                  until then you can put it back here. After that it's deleted.
                </p>
                {family.role === "keeper" && (
                  <p className="font-medium text-amber-700">
                    This computer keeps {family.name}'s family folder: while it's removed, nothing
                    you change reaches relatives, and their changes wait. With your recovery code,
                    you can be its keeper again on another computer.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate(family.id, { onError: showError })}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {another.opening && <Opening name={another.opening} />}
    </li>
  );
}

/** Settings → Families (0.4.0, D44): the families on this computer, each kept completely
 *  apart, with its own database, data folder, backups and family folder. Only in the desktop
 *  app. */
export function FamiliesSection() {
  const families = useFamilies();
  const putBack = usePutFamilyBack();
  const [adding, setAdding] = useState(false);
  const listed = families.data;
  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Families</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          The families on this computer, such as your mother's side and your father's. Each is kept
          completely apart: its own database, photos and stories, backups and family folder. Nothing
          of one shows in another, and one is open at a time. Only the open family keeps in step
          with its family folder; the others catch up when they're opened.
        </p>
      </div>
      {!listed ? (
        <p className="text-sm text-stone-500">
          {families.isError
            ? "Can't be reached."
            : families.isLoading
              ? "…"
              : "Only in the desktop app."}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-stone-100">
            {listed.families.map((family) => (
              <Row key={family.id} family={family} single={Boolean(listed.single)} />
            ))}
          </ul>
          {listed.single ? (
            <p className="text-xs text-stone-500">
              This AncesTree uses a database of its own choosing, which holds one family.
            </p>
          ) : (
            <Button variant="outline" onClick={() => setAdding(true)}>
              Add a family…
            </Button>
          )}
          {listed.removed.length > 0 && (
            <div className="space-y-2 rounded-lg border border-stone-200 p-4">
              <h3 className="text-sm font-semibold">In AncesTree's bin</h3>
              <ul className="space-y-2 text-sm">
                {listed.removed.map((family) => (
                  <li key={family.id} className="flex flex-wrap items-center gap-3">
                    <span>
                      {family.name}
                      <span className="text-stone-500">
                        {" "}
                        · deleted on {deletedOn(family.removed)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={putBack.isPending}
                      onClick={() => putBack.mutate(family.id, { onError: showError })}
                    >
                      Put back
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <AddFamilyDialog open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}
