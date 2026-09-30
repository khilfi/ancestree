import { PencilIcon, SaveIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TrashList } from "@/features/settings/TrashSection";
import { ACTION_MS, showError } from "@/lib/notify";
import type { CopyControls, CopyEditing } from "./copy";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Save a new copy": the copy with its changes inside, as a new file to send back. */
export function useSaveCopy(controls: CopyControls): { save: () => void; saving: boolean } {
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const saved = await controls.save();
      if (saved.saved) {
        toast.success(`Saved ${saved.name}.`, {
          description: "Send that file back to whoever gave you this copy.",
          duration: ACTION_MS,
        });
      }
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }
  return { save: () => void save(), saving };
}

/**
 * A copy to edit's bar, under the top bar: whom it's for, the changes not saved
 * into a new copy yet, and Save a new copy. Changes are kept in the browser as they're made; it
 * says so when it carried on from them, and when the browser can't keep them.
 */
export function CopyEditBar({
  editing,
  controls,
}: {
  editing: CopyEditing;
  controls: CopyControls;
}) {
  const changes = useSyncExternalStore(controls.subscribe, controls.changes);
  const keeping = useSyncExternalStore(controls.subscribe, controls.keeping);
  const carried = controls.carriedOn();
  const { save, saving } = useSaveCopy(controls);
  const [trash, setTrash] = useState(false);
  const [startAgain, setStartAgain] = useState(false);

  let status = "No changes yet";
  if (changes > 0) status = `${changes} change${changes === 1 ? "" : "s"} not saved yet`;
  else if (editing.saved_at) status = "No changes since it was saved";

  return (
    <div className="border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-950 md:px-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <PencilIcon className="size-4 shrink-0 text-sky-700" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium">Copy to edit</span>
          <span className="text-sky-800"> · for {editing.for}</span>
          <span className="text-sky-800" aria-live="polite">
            {" "}
            · {status}
          </span>
        </p>
        {editing.may.remove && (
          <Button variant="ghost" size="sm" onClick={() => setTrash(true)}>
            <Trash2Icon />
            Trash
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={saving}>
          <SaveIcon />
          {saving ? "Saving…" : "Save a new copy"}
        </Button>
      </div>
      {carried && (
        <p className="mt-1 text-xs text-sky-900">
          Carried on from your changes kept in this browser ({when(carried)}).{" "}
          <button
            type="button"
            className="underline hover:text-sky-700"
            onClick={() => setStartAgain(true)}
          >
            Start again from the file
          </button>
        </p>
      )}
      {!keeping && (
        <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          This browser can't keep your changes: save a new copy before you close it.
        </p>
      )}

      <Dialog open={trash} onOpenChange={setTrash}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Trash</DialogTitle>
            <DialogDescription>
              People removed in this copy, with their links. Restore anyone removed by mistake.
            </DialogDescription>
          </DialogHeader>
          <TrashList />
        </DialogContent>
      </Dialog>

      <AlertDialog open={startAgain} onOpenChange={setStartAgain}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start again from the file?</AlertDialogTitle>
            <AlertDialogDescription>
              The changes kept in this browser are forgotten, and the copy opens as the file holds
              it. To keep them, save a new copy first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void controls.startAgain().catch(showError)}
            >
              Start again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
