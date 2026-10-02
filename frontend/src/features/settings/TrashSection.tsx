import { useNavigate } from "react-router";
import { useRestore, useTrash } from "@/api/queries";
import type { TrashEntry } from "@/api/types";
import { Button } from "@/components/ui/button";
import { showError, showRestored } from "@/lib/notify";

function formatDay(stamp: string): string {
  return new Date(stamp).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function daysLeft(entry: TrashEntry): number {
  return Math.max(0, Math.ceil((Date.parse(entry.restore_until) - Date.now()) / 86_400_000));
}

/** Who is in the Trash, each with Restore, in Settings. */
export function TrashList() {
  const trash = useTrash();
  const restore = useRestore();
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/tree?person=${id}`);

  return (
    <>
      {trash.isPending && <p className="text-sm text-stone-500">Loading…</p>}
      {trash.isError && <p className="text-sm text-red-600">{trash.error.message}</p>}
      {trash.data?.length === 0 && (
        <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
          The Trash is empty.
        </p>
      )}

      {trash.data && trash.data.length > 0 && (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {trash.data.map((entry) => (
            <li key={entry.entry} className="flex items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{entry.full_name}</div>
                <div className="text-xs text-stone-500">
                  Deleted {formatDay(entry.deleted_at)}
                  {entry.link_count > 0 &&
                    ` · ${entry.link_count} link${entry.link_count === 1 ? "" : "s"}`}
                  {` · ${daysLeft(entry)} days left`}
                </div>
              </div>
              <Button
                variant="outline"
                disabled={restore.isPending}
                onClick={() =>
                  restore.mutate(entry.entry, {
                    onSuccess: (result) => showRestored(result, open),
                    onError: showError,
                  })
                }
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Settings → Trash: people moved to the Trash, restorable with their links and photo for
 *  30 days. */
export function TrashSection() {
  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Trash</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          People you delete stay here for 30 days, with their links and files, then are removed for
          good.
        </p>
      </div>
      <TrashList />
    </section>
  );
}
