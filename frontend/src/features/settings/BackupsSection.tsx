import { ArchiveIcon, CheckCheckIcon, DownloadIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import {
  downloadExport,
  useAddBackup,
  useBackups,
  useCheckBackup,
  useMakeExport,
  useRestoreBackup,
} from "@/api/queries";
import type { Backup } from "@/api/types";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fileSize } from "@/lib/files";
import { ACTION_MS, showError } from "@/lib/notify";
import { ElsewherePanel } from "./ElsewherePanel";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Settings → Backups: make one now, bring one in, restore one. In the desktop
 *  app, one is also made each day. */
export function BackupsSection() {
  const backups = useBackups();
  const list = backups.data?.backups ?? [];
  const folder = backups.data?.folder;
  const daily = backups.data?.automatic_backups ?? false;
  // The family open, of several on this computer, in the desktop app (0.4.0).
  const family = backups.data?.family_id ? backups.data.family_name : null;
  const make = useMakeExport();
  const add = useAddBackup();
  const restore = useRestoreBackup();
  const check = useCheckBackup();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<Backup | null>(null);
  // A copy locked with a password (0.4.0), waiting for its password to be added.
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const busy = make.isPending || add.isPending || restore.isPending;

  function backUpNow() {
    make.mutate("archive", {
      onSuccess: (file) =>
        toast.success(`Backed up: ${file.name} (${fileSize(file.size)}).`, {
          description: `It's in ${file.folder}.`,
        }),
      onError: showError,
    });
  }

  function bringIn(file: File, password?: string) {
    add.mutate(
      { file, password },
      {
        onSuccess: (backup) => {
          setLocked(null);
          setPassword("");
          toast.success(`Added the backup from ${when(backup.made_at)}.`, {
            description: "Restore it from the list when you're ready.",
          });
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "locked_backup") {
            setLocked(file); // asks for its password
            return;
          }
          showError(error);
        },
      },
    );
  }

  function checkBackup(backup: Backup) {
    check.mutate(backup.name, {
      onSuccess: (checked) =>
        toast.success(`The backup from ${when(backup.made_at)} is whole.`, {
          description: `Every one of its files is as it was made: ${checked.people} people, ${checked.links} links, ${checked.files} files.`,
        }),
      onError: showError,
    });
  }

  function restoreBackup(backup: Backup) {
    restore.mutate(backup.name, {
      onSuccess: (result) =>
        toast.success(
          `Restored the backup from ${when(result.made_at)}: ${result.people} people, ` +
            `${result.links} links, ${result.files} files.`,
          {
            description: result.backup
              ? `Everything as it was just before is in ${result.backup}.`
              : undefined,
            duration: ACTION_MS,
            action: { label: "Open the tree", onClick: () => navigate("/tree") },
          },
        ),
      onError: showError,
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Backups</h2>
          <p className="max-w-2xl text-sm text-stone-500">
            A backup holds everything: people, links, photos, stories and settings.{" "}
            {daily
              ? "AncesTree makes one each day while it runs, and keeps the last 30 of those. " +
                "Make one yourself whenever you like; AncesTree never deletes those."
              : "Make one whenever you like; AncesTree never deletes one."}
            {folder && (
              <>
                {" "}
                New backups go to <code className="break-all">{folder}</code>.
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy}>
            <UploadIcon />
            Add a backup file…
          </Button>
          <Button onClick={backUpNow} disabled={busy}>
            <ArchiveIcon />
            {make.isPending ? "Backing up…" : "Back up now"}
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept=".zip,.locked,application/zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) bringIn(file);
          }}
        />
      </div>

      <ElsewherePanel elsewhere={backups.data?.elsewhere} />

      {backups.data?.reachable === false && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The backup folder <code className="break-all">{folder}</code> can't be reached. Is its
          disk connected? Backups can't be made or added until it is.
        </p>
      )}

      {backups.isError ? (
        <p className="text-sm text-red-600">{backups.error.message}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-stone-500">
          {backups.isPending ? "Looking for backups…" : "No backups yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Made</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="text-right">Links</TableHead>
              <TableHead className="text-right">Files</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((backup) => (
              <TableRow key={`${backup.folder}/${backup.name}`}>
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {when(backup.made_at)}
                    {backup.automatic && <Badge variant="secondary">Automatic</Badge>}
                  </div>
                  <div className="text-xs break-all text-stone-500">
                    {backup.name}
                    {backup.folder !== folder && ` · in ${backup.folder}`}
                    {backup.family_id &&
                      backup.family_id !== backups.data?.family_id &&
                      ` · of ${backup.family_name}`}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{backup.people}</TableCell>
                <TableCell className="text-right tabular-nums">{backup.links}</TableCell>
                <TableCell className="text-right tabular-nums">{backup.files}</TableCell>
                <TableCell className="text-right tabular-nums">{fileSize(backup.size)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => downloadExport(backup.name)}
                    aria-label={`Download the backup from ${when(backup.made_at)}`}
                  >
                    <DownloadIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={check.isPending}
                    onClick={() => checkBackup(backup)}
                    aria-label={`Check the backup from ${when(backup.made_at)}`}
                    title="Check it: every file against its checksum, restoring nothing"
                  >
                    <CheckCheckIcon />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirming(backup)}
                  >
                    {restore.isPending && restore.variables === backup.name
                      ? "Restoring…"
                      : "Restore…"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={locked !== null} onOpenChange={(open) => !open && setLocked(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This backup is locked</AlertDialogTitle>
            <AlertDialogDescription>
              It's a copy kept in another place, locked with a password. Type the password it was
              locked with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (locked) bringIn(locked, password);
            }}
          >
            <Input
              type="password"
              aria-label="The backup's password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="off"
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
              <Button type="submit" disabled={!password || add.isPending}>
                {add.isPending ? "Opening…" : "Open it"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Restore the backup from {confirming ? when(confirming.made_at) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everything in {family ?? "AncesTree"} is replaced by what this backup holds:{" "}
              {confirming?.people} people, {confirming?.links} links and {confirming?.files} files.
              Everything as it is now is backed up first, so you can come back to it.
              {family && confirming && !confirming.family_id && (
                <>
                  {" "}
                  <strong>
                    This backup was made before AncesTree kept several families, so it can't say
                    which family it's of: check it's {family}'s.
                  </strong>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => confirming && restoreBackup(confirming)}
            >
              Replace everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
