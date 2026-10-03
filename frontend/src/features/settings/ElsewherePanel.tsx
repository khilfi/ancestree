import { useState } from "react";
import { toast } from "sonner";
import { useCopyElsewhere, useCopyNow, usePlacesForCopies, useStopCopying } from "@/api/queries";
import type { Elsewhere } from "@/api/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ago } from "@/lib/ago";
import { showError } from "@/lib/notify";

const OTHER = "";

/** Choosing the second place (0.4.0): a place found on this computer, or a folder typed; and
 *  a password to lock the copies with, suggested. */
function ChoosePlace({ open, onClose }: { open: boolean; onClose: () => void }) {
  const places = usePlacesForCopies(open);
  const choose = useCopyElsewhere();
  const [picked, setPicked] = useState<string>(OTHER);
  const [typed, setTyped] = useState("");
  const [lock, setLock] = useState(true);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const folder = picked === OTHER ? typed.trim() : picked;
  const mismatch = lock && again !== "" && password !== again;
  const ready = folder !== "" && (!lock || (password.length >= 8 && password === again));
  return (
    <AlertDialog open={open} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Keep copies of the backups in another place</AlertDialogTitle>
          <AlertDialogDescription>
            A USB stick, another disk, or a folder OneDrive, Dropbox or Google Drive keeps: if this
            computer or its disk is lost, the copies are still there. Each backup is copied there as
            it's made, into a folder of this family's own.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            choose.mutate(
              { folder, password: lock ? password : null },
              {
                onError: showError,
                onSuccess: (list) => {
                  const copies = list.elsewhere?.copies ?? 0;
                  toast.success(`Backups are copied there now: ${copies} so far.`);
                  onClose();
                },
              },
            );
          }}
        >
          <RadioGroup value={picked} onValueChange={setPicked} className="gap-2">
            {(places.data ?? []).map((place) => (
              <div key={place.path} className="flex items-center gap-2">
                <RadioGroupItem value={place.path} id={`place-${place.path}`} />
                <Label htmlFor={`place-${place.path}`} className="font-normal">
                  {place.name}{" "}
                  <span className="text-xs text-stone-500">
                    {place.kind === "cloud" ? "· kept by its cloud" : "· a disk"} · {place.path}
                  </span>
                </Label>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <RadioGroupItem value={OTHER} id="place-other" />
              <Label htmlFor="place-other" className="font-normal">
                Another folder
              </Label>
            </div>
          </RadioGroup>
          {picked === OTHER && (
            <Input
              aria-label="The folder, as its path"
              placeholder="e.g. E:\AncesTree backups"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="lock-copies"
                checked={lock}
                onCheckedChange={(checked) => setLock(checked === true)}
              />
              <Label htmlFor="lock-copies" className="font-normal">
                Lock the copies with a password (best for a folder a cloud keeps)
              </Label>
            </div>
            {lock && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  type="password"
                  aria-label="The password"
                  placeholder="A password, 8 characters or more"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <Input
                  type="password"
                  aria-label="The password again"
                  placeholder="The password again"
                  value={again}
                  onChange={(event) => setAgain(event.target.value)}
                  autoComplete="new-password"
                />
                <p className="text-xs text-stone-500 sm:col-span-2">
                  {mismatch
                    ? "The two aren't the same."
                    : "AncesTree doesn't keep it: keep it with your recovery code. Opening a copy on another computer asks for it."}
                </p>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" disabled={!ready || choose.isPending}>
              {choose.isPending ? "Copying…" : "Copy them there"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Settings → Backups' second place (0.4.0): where the copies go, how they stand, and what's
 *  in the way. */
export function ElsewherePanel({ elsewhere }: { elsewhere: Elsewhere | null | undefined }) {
  const [choosing, setChoosing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const copy = useCopyNow();
  const stop = useStopCopying();
  return (
    <div className="space-y-2 rounded-lg border border-stone-200 p-4 text-sm">
      <h3 className="font-semibold">Copies in another place</h3>
      {!elsewhere ? (
        <>
          <p className="max-w-2xl text-stone-600">
            The backups are on this computer's own disk. Keep copies somewhere else too, such as a
            USB stick, or a folder OneDrive or Dropbox keeps, so that losing this computer doesn't
            lose them.
          </p>
          <Button variant="outline" onClick={() => setChoosing(true)}>
            Choose a place…
          </Button>
        </>
      ) : (
        <>
          <p className="text-stone-600">
            Each backup is copied to <code className="break-all">{elsewhere.inside}</code>
            {elsewhere.locked ? ", locked with your password" : ""}: {elsewhere.copies}{" "}
            {elsewhere.copies === 1 ? "copy" : "copies"} there
            {elsewhere.copied ? `, the last made ${ago(elsewhere.copied)}` : ""}.
            {elsewhere.waiting > 0 &&
              ` ${elsewhere.waiting} ${elsewhere.waiting === 1 ? "backup waits" : "backups wait"} to be copied.`}
          </p>
          {elsewhere.problem && (
            <p role="alert" className="font-medium text-amber-700">
              {elsewhere.problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={copy.isPending}
              onClick={() =>
                copy.mutate(undefined, {
                  onError: showError,
                  onSuccess: (list) =>
                    list.elsewhere?.problem
                      ? toast.warning(list.elsewhere.problem)
                      : toast.success("The copies there are up to date."),
                })
              }
            >
              {copy.isPending ? "Copying…" : "Copy now"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setChoosing(true)}>
              Change…
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setStopping(true)}>
              Stop copying…
            </Button>
          </div>
        </>
      )}
      <ChoosePlace open={choosing} onClose={() => setChoosing(false)} />
      <AlertDialog open={stopping} onOpenChange={setStopping}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop copying the backups there?</AlertDialogTitle>
            <AlertDialogDescription>
              The copies already there stay where they are. New backups stay on this computer alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => stop.mutate(undefined, { onError: showError })}>
              Stop copying
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
