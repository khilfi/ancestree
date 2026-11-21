import { useState } from "react";
import { Link } from "react-router";
import { type Removing, useRemoveAncesTree, useRemoving, useSaveBackupsTo } from "@/api/desktop";
import { saveClientFile } from "@/api/downloads";
import { sendsToTheKeeper, sendsWords, useFamilyFolder, useSyncNow } from "@/api/familyFolder";
import { usePlacesForCopies } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { HowDoesThisWork } from "@/features/guide/HowDoesThisWork";
import { showError } from "@/lib/notify";
import { Leave, Sending } from "./FamilyFolderSection";

/** What the keeper needs to keep the family again, once this computer's families are gone. */
export const THREE = [
  "I have my recovery code",
  "I have my Google project's client file",
  "I can sign in to the keeper's Google account",
] as const;

const OTHER = "";

/** Names in a sentence: "A", "A and B", "A, B and C". */
function listed(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What each way out does on this system: Windows' uninstaller, or the Mac's and Linux's Bin. */
export function whatHappens(removing: Removing): { remove: string; keep: string } {
  if (removing.system === "windows") {
    return {
      remove: `AncesTree closes, and its uninstaller opens with Also delete the families ticked, and But keep the backups too, which moves them to Documents\\${removing.kept} first.`,
      keep: "AncesTree closes, and its uninstaller opens with the families' box unticked: they stay on this computer, for if you install AncesTree again.",
    };
  }
  const where = removing.app ?? "";
  const app =
    removing.system === "mac"
      ? `Then drag AncesTree from ${where.slice(0, where.lastIndexOf("/")) || "Applications"} to the Bin.`
      : `Then delete its AppImage${where ? `, ${where}` : ""}.`;
  return {
    remove: `Start when I sign in goes off, AncesTree quits, and its folder goes to the ${removing.bin}, where you can still take it out. ${app}`,
    keep: `Start when I sign in goes off, AncesTree quits, and its families stay in its folder, for if you install it again. ${app}`,
  };
}

/** Save the backups to a folder… (D88): every family's, to a place found on this computer,
 *  Documents, or a folder typed, each family's in a folder of its name. */
function SaveBackups({ removing }: { removing: Removing }) {
  const [choosing, setChoosing] = useState(false);
  const places = usePlacesForCopies(choosing);
  const save = useSaveBackupsTo();
  const [picked, setPicked] = useState(removing.documents);
  const [typed, setTyped] = useState("");
  const folder = picked === OTHER ? typed.trim() : picked;
  const backups = removing.families.reduce((sum, family) => sum + family.backups, 0);
  const binned = removing.families.some((family) => family.removed && family.backups > 0);
  const found = (places.data ?? []).filter((place) => place.path !== removing.documents);
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">
        {backups === 0
          ? "There are no backups on this computer to save."
          : `First, you can copy every family's backups (${plural(backups, "backup")}) to a USB stick, Documents or any other folder: each family's into a folder of its name, in ${removing.kept}${binned ? `; those of a family in the Trash into one of its name and "(removed)"` : ""}.`}
      </p>
      {save.data && (
        <p role="status" className="text-success">
          Saved: {plural(save.data.backups, "backup")} of{" "}
          {plural(save.data.families, "family", "families")}, in{" "}
          <code className="break-all">{save.data.folder}</code>.
        </p>
      )}
      {!choosing ? (
        backups > 0 && (
          <Button variant="outline" size="sm" onClick={() => setChoosing(true)}>
            Save the backups to a folder…
          </Button>
        )
      ) : (
        <form
          className="space-y-2 rounded-lg border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(folder, { onError: showError, onSuccess: () => setChoosing(false) });
          }}
        >
          <RadioGroup value={picked} onValueChange={setPicked} className="gap-1.5">
            {[{ path: removing.documents, name: "Documents", kind: "" }, ...found].map((place) => (
              <div key={place.path} className="flex items-center gap-2">
                <RadioGroupItem value={place.path} id={`save-${place.path}`} />
                <Label htmlFor={`save-${place.path}`} className="font-normal">
                  {place.name} <span className="text-xs text-faint">· {place.path}</span>
                </Label>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <RadioGroupItem value={OTHER} id="save-other" />
              <Label htmlFor="save-other" className="font-normal">
                Another folder
              </Label>
            </div>
          </RadioGroup>
          {picked === OTHER && (
            <Input
              aria-label="The folder, as its path"
              placeholder="e.g. E:\"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
          <Button type="submit" size="sm" disabled={!folder || save.isPending}>
            {save.isPending ? "Saving…" : "Save them there"}
          </Button>
        </form>
      )}
    </div>
  );
}

/** On the keeper's computer, three ticks before the families can go, or the handover instead. */
function KeeperTicks({
  removing,
  ticked,
  onTick,
}: {
  removing: Removing;
  ticked: boolean[];
  onTick: (index: number, on: boolean) => void;
}) {
  const status = useFamilyFolder().data;
  const kept = removing.families.filter((family) => family.keeper);
  const keptOpen = kept.some((family) => family.open);
  // The client's file is the keeper's own only where it wasn't given with an invitation.
  const ownClient = keptOpen && status?.setup === "keeper" && !status.project_invited;
  const saveClient = () => saveClientFile("Keep it with your recovery code.").catch(showError);
  return (
    <div className="space-y-2 rounded-lg border border-warning-border bg-warning-soft p-3">
      <p className="font-medium text-warning-soft-foreground">
        This computer keeps {listed(kept.map((family) => family.name))}.
      </p>
      <p className="text-foreground">
        If {kept.length === 1 ? "its family goes" : "their families go"}, keeping{" "}
        {kept.length === 1 ? "the family" : "each"} again, on this computer or another, needs three
        things. Tick each one you have:
      </p>
      {THREE.map((text, index) => (
        <div key={text} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Checkbox
            id={`have-${index}`}
            checked={ticked[index]}
            onCheckedChange={(checked) => onTick(index, checked === true)}
          />
          <Label htmlFor={`have-${index}`} className="font-normal">
            {text}
          </Label>
          {index === 1 && ownClient && (
            <Button size="xs" variant="outline" onClick={saveClient}>
              Save it again…
            </Button>
          )}
        </div>
      ))}
      <p className="text-foreground">
        Or hand the family to someone else first: another of the family's computers keeps it, and
        this one can go.
      </p>
      {keptOpen ? (
        <Button size="sm" variant="outline" asChild>
          <Link to="/settings/family#family-folder">Hand the family to someone else…</Link>
        </Button>
      ) : (
        <p className="text-xs text-faint">
          Open {listed(kept.map((family) => family.name))} first, then hand it over in Settings →
          You and your family → Family folder.
        </p>
      )}
    </div>
  );
}

/** On a relative's computer: what waits to go to the keeper, Send now, and leaving. */
function RelativeSteps() {
  const status = useFamilyFolder().data;
  const sync = useSyncNow();
  if (status?.setup !== "member") return null;
  const sends = sendsToTheKeeper(status) || sendsWords(status);
  return (
    <div className="space-y-2">
      <p className="font-medium">
        This computer is a relative's, in {status.family || "the family"}'s family folder.
      </p>
      {sends && (
        <div className="flex flex-wrap items-center gap-3">
          <Sending status={status} />
          {(status.pending ?? 0) > 0 && (
            <Button
              size="sm"
              onClick={() => sync.mutate(undefined, { onError: showError })}
              disabled={sync.isPending}
            >
              {sync.isPending ? "Sending…" : "Send now"}
            </Button>
          )}
        </div>
      )}
      <p className="text-muted-foreground">
        Ask your keeper to remove this computer from the family, or leave the family folder first.
      </p>
      {status.may_leave && <Leave keeper={false} />}
    </div>
  );
}

function RemoveDialog({ onClose }: { onClose: () => void }) {
  const removing = useRemoving(true).data;
  const remove = useRemoveAncesTree();
  const [ticked, setTicked] = useState([false, false, false]);
  const going = remove.isPending || remove.isSuccess;
  const keeper = removing?.families.some((family) => family.keeper) ?? false;
  const installed = removing?.installed ?? false;
  const what = removing ? whatHappens(removing) : null;
  const listedHere = (removing?.families ?? []).filter((family) => !family.removed);
  const names = listedHere.map((family) => family.name);
  const binned = (removing?.families ?? []).filter((family) => family.removed);
  return (
    <Dialog open onOpenChange={(open) => !open && !going && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Remove AncesTree from this computer</DialogTitle>
          <DialogDescription>
            Before it goes: what goes with it, and what stays. <HowDoesThisWork at="remove" />
          </DialogDescription>
        </DialogHeader>
        {!removing || !what ? (
          <p className="text-sm text-faint">…</p>
        ) : remove.isSuccess ? (
          <p role="status" className="text-sm">
            {removing.system === "windows"
              ? "AncesTree is closing, and its uninstaller opening."
              : "AncesTree is quitting."}
          </p>
        ) : (
          <div className="space-y-4 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Goes:</strong> AncesTree, and this computer's{" "}
                {names.length === 1 ? "family" : "families"}, {listed(names)}:{" "}
                {names.length === 1 ? "its" : "their"} people, photos, life stories, settings and
                backups
                {binned.length > 0 &&
                  `; and ${listed(binned.map((family) => family.name))}, in the Trash`}
                .
              </li>
              <li>
                <strong>Stays:</strong> the family folder in Google Drive, and the family's other
                computers; and copies of the backups kept in another place, such as a USB stick or
                OneDrive.
              </li>
            </ul>
            <SaveBackups removing={removing} />
            {keeper && (
              <KeeperTicks
                removing={removing}
                ticked={ticked}
                onTick={(index, on) =>
                  setTicked((now) => now.map((was, at) => (at === index ? on : was)))
                }
              />
            )}
            <RelativeSteps />
            <div className="space-y-1.5 text-muted-foreground">
              <p>
                <strong>Remove AncesTree and its families:</strong> {what.remove}
              </p>
              <p>
                <strong>Keep the families on this computer:</strong> {what.keep}
              </p>
              {!installed && (
                <p role="status" className="font-medium text-warning">
                  This AncesTree runs from its code, for trying things out: removing it does nothing
                  here.
                </p>
              )}
              {keeper && installed && !ticked.every(Boolean) && (
                <p className="text-xs text-faint">
                  Tick the three things above for the families to go too.
                </p>
              )}
            </div>
          </div>
        )}
        {!remove.isSuccess && (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={going}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={!installed || going}
              onClick={() => remove.mutate("keep", { onError: showError })}
            >
              Keep the families on this computer
            </Button>
            <Button
              variant="destructive"
              disabled={!installed || going || (keeper && !ticked.every(Boolean))}
              onClick={() => remove.mutate("delete", { onError: showError })}
            >
              Remove AncesTree and its families
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Remove AncesTree from this computer… (D88), in Settings → About, on every system: what goes
 *  and what stays, the backups saved to a folder first, the keeper's three things ticked or the
 *  family handed over, what waits sent; then the uninstaller on Windows, or the Bin elsewhere. */
export function RemoveAncesTree() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <p className="max-w-xl text-xs text-faint">
        Takes AncesTree off this computer, with the backups safe. The family folder in Google Drive,
        and the family's other computers, stay as they are.
      </p>
      <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
        Remove AncesTree from this computer…
      </Button>
      {open && <RemoveDialog onClose={() => setOpen(false)} />}
    </>
  );
}
