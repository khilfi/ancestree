import { useDesktopUpdate, useRestartToUpdate } from "@/api/desktop";
import { Button } from "@/components/ui/button";

/** A new version of the desktop app, fetched and checked: restart into it. Without a
 *  restart, it's installed the next time the app starts. */
export function UpdateBanner() {
  const update = useDesktopUpdate();
  const restart = useRestartToUpdate();
  const available = update.data?.available;
  if (!available) return null;
  const restarting = restart.isPending || restart.isSuccess;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-900 md:px-4"
    >
      <span>
        A new version of AncesTree is ready: <strong>{available.version}</strong>
      </span>
      {available.notes && (
        <details className="group">
          <summary className="cursor-pointer text-sky-800 underline-offset-2 hover:underline">
            What's new
          </summary>
          <p className="mt-1 max-w-2xl whitespace-pre-line text-sky-950">{available.notes}</p>
        </details>
      )}
      <Button size="sm" className="ml-auto" onClick={() => restart.mutate()} disabled={restarting}>
        {restarting ? "Restarting…" : "Restart to update"}
      </Button>
      {restart.isError && <span className="text-red-700">{restart.error.message}</span>}
    </div>
  );
}
