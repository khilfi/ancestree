import type { ReactNode } from "react";
import {
  type DesktopUpdate,
  useCheckForUpdates,
  useDesktopUpdate,
  useRestartToUpdate,
} from "@/api/desktop";
import { useHealth } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

function Folder({ path, note }: { path: string | undefined; note: string }) {
  return (
    <>
      <code className="break-all">{path ?? "…"}</code>
      <div className="text-xs text-stone-500">{note}</div>
    </>
  );
}

/** The desktop app's version, and asking for a new one. */
function Updates({ update }: { update: DesktopUpdate }) {
  const check = useCheckForUpdates();
  const restart = useRestartToUpdate();
  const available = update.available;
  const checking = update.checking || check.isPending;
  const restarting = restart.isPending || restart.isSuccess;

  let status: string | null = null;
  if (checking) status = "Looking for a new version…";
  else if (available) status = `Version ${available.version} is ready.`;
  else if (update.problem || check.isError)
    status = `Couldn't check for a new version: ${update.problem ?? check.error?.message}`;
  else if (update.checked_at) status = "This is the latest version.";

  return (
    <>
      Version {update.current}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {available ? (
          <Button size="sm" onClick={() => restart.mutate()} disabled={restarting}>
            {restarting ? "Restarting…" : "Restart to update"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => check.mutate()} disabled={checking}>
            Check for updates
          </Button>
        )}
        {status && (
          <span role="status" className="text-xs text-stone-500">
            {status}
          </span>
        )}
      </div>
    </>
  );
}

/** Settings → About: the database, the app's version and where the files are kept. */
export function AboutSection() {
  const health = useHealth();
  const about = health.data;
  const desktop = useDesktopUpdate().data;
  const up = about?.database === "up";
  const down = health.isError || about?.database === "down";

  let status = "Checking…";
  if (health.isError) status = "Can't reach AncesTree's server";
  else if (about?.database === "down") status = "Can't reach the database";
  else if (up) status = `Connected · schema v${about.schema_version ?? 0}`;

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">About</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          AncesTree runs only on this computer. This is what it's connected to, and where it keeps
          your family's files.
        </p>
      </div>

      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
        <Row label="Database">
          <span className="flex items-center gap-2" role="status">
            <span
              className={cn(
                "size-2 rounded-full",
                up ? "bg-emerald-500" : down ? "bg-red-500" : "bg-stone-300",
              )}
            />
            <span className={down ? "font-medium text-red-700" : undefined}>{status}</span>
          </span>
          {about?.database_version && (
            <div className="text-xs text-stone-500">{about.database_version.replace("/", " ")}</div>
          )}
          {down && (
            <p className="mt-2 max-w-xl text-xs text-stone-600">
              {desktop ? (
                <>Quit AncesTree from its icon by the clock, then open it again.</>
              ) : (
                <>
                  Is Docker Desktop running? <code>scripts\dev.ps1</code> starts the database and
                  the app.
                </>
              )}{" "}
              Nothing is lost while it's stopped: your family is safe on disk.
            </p>
          )}
        </Row>
        <Row label="AncesTree">
          {desktop ? <Updates update={desktop} /> : about ? `Version ${about.version}` : "…"}
        </Row>
        <Row label="Data folder">
          <Folder path={about?.data_folder} note="Photos, life stories and settings." />
        </Row>
        <Row label="Backup folder">
          <Folder path={about?.backup_folder} note="Where Settings → Backups puts new backups." />
        </Row>
        <Row label="The map">
          Places from{" "}
          <a
            href="https://www.geonames.org/"
            target="_blank"
            rel="noreferrer"
            className="text-sky-700 hover:underline"
          >
            GeoNames
          </a>{" "}
          (CC BY), and borders from Natural Earth (public domain). Both come with the app, so the
          map looks nothing up online.
        </Row>
      </dl>
    </section>
  );
}
