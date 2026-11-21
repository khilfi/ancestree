import { toast } from "sonner";
import { useDeletePerson, useRestore, useStorySettled } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { offerTryAgain, showRestored, UNDO_MS } from "@/lib/notify";

/** Move someone to the Trash from their panel, with an Undo that brings them back. The panel
 *  closes first (`onGone`); the Undo outlives it and shows them again (`onRestored`). Where the
 *  engine didn't answer, each offers Try again. */
export function useMoveToTrash(onGone: () => void, onRestored: (id: string) => void) {
  const remove = useDeletePerson();
  const restore = useRestore();
  const storySettled = useStorySettled();
  return async (person: PersonDetail) => {
    onGone();
    // Closing the panel saves any story still being written: it goes to the Trash with them.
    await storySettled(person.id);
    const move = () =>
      remove.mutate(person.id, {
        onError: (error) => offerTryAgain(error, move),
        onSuccess: (entry) => {
          const undo = () =>
            restore.mutate(entry.entry, {
              onError: (error) => offerTryAgain(error, undo),
              onSuccess: (restored) => {
                showRestored(restored);
                onRestored(restored.person.id);
              },
            });
          toast(`${entry.full_name} is in the Trash.`, {
            duration: UNDO_MS,
            action: { label: "Undo", onClick: undo },
          });
        },
      });
    move();
  };
}
