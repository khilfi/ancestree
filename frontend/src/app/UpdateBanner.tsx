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
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-highlight-border bg-highlight-soft px-3 py-1.5 text-sm text-highlight-soft-foreground md:px-4"
    >
      <span>
        A new version of AncesTree is ready: <strong>{available.version}</strong>
      </span>
      {available.notes && (
        <details className="group">
          <summary className="cursor-pointer text-highlight-soft-foreground underline-offset-2 hover:underline">
            What's new
          </summary>
          <p className="mt-1 max-w-2xl whitespace-pre-line text-highlight-soft-foreground">
            {available.notes}
          </p>
        </details>
      )}
      <Button size="sm" className="ml-auto" onClick={() => restart.mutate()} disabled={restarting}>
        {restarting ? "Restarting…" : "Restart to update"}
      </Button>
      {restart.isError && <span className="text-destructive">{restart.error.message}</span>}
    </div>
  );
}
