import { toast } from "sonner";
import { useDeletePerson, useRestore, useStorySettled } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { showError, showRestored, UNDO_MS } from "@/lib/notify";

/** Move someone to the Trash from their panel, with an Undo that brings them back. The panel
 *  closes first (`onGone`); the Undo outlives it and shows them again (`onRestored`). */
export function useMoveToTrash(onGone: () => void, onRestored: (id: string) => void) {
  const remove = useDeletePerson();
  const restore = useRestore();
  const storySettled = useStorySettled();
  return async (person: PersonDetail) => {
    onGone();
    // Closing the panel saves any story still being written: it goes to the Trash with them.
    await storySettled(person.id);
    remove.mutate(person.id, {
      onError: showError,
      onSuccess: (entry) =>
        toast(`${entry.full_name} is in the Trash.`, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () =>
              restore.mutate(entry.entry, {
                onError: showError,
                onSuccess: (restored) => {
                  showRestored(restored);
                  onRestored(restored.person.id);
                },
              }),
          },
        }),
    });
  };
}
