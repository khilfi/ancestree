import { LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadExport, useBackups, useMakeExport } from "@/api/queries";
import type { CopyPermission, CopyPermissions } from "@/app/copy";
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
import { fileSize } from "@/lib/files";
import { ACTION_MS, showError } from "@/lib/notify";

const SHORTEST_PASSWORD = 6;

// What relatives may do in a copy to edit: all of it unless switched off.
const MAY: { what: CopyPermission; label: string }[] = [
  { what: "add", label: "add people and links" },
  { what: "change", label: "change details" },
  { what: "remove", label: "remove people and links" },
  { what: "stories", label: "write life stories" },
  { what: "photos", label: "add photos" },
];
const EVERYTHING: CopyPermissions = {
  add: true,
  change: true,
  remove: true,
  stories: true,
  photos: true,
};

/**
 * Export → View-only copy: the app with the family inside, as one .html file to
 * give to relatives. It opens in any browser, needs nothing installed, and changes nothing.
 *
 * Export → Copy to edit: the same, made for one relative, with what they may do
 * in it. They save their changes into a new file and send it back; the app keeps what the copy
 * starts from, to compare with what comes back.
 */
export function CopyDialog({
  toEdit = false,
  open,
  onOpenChange,
}: {
  toEdit?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [forName, setForName] = useState("");
  const [may, setMay] = useState<CopyPermissions>(EVERYTHING);
  const [hideLiving, setHideLiving] = useState(false);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState("");
  const [archive, setArchive] = useState(true);
  const make = useMakeExport();
  const latest = useBackups().data?.backups[0];
  const passwordProblem =
    locked && password.length < SHORTEST_PASSWORD
      ? `At least ${SHORTEST_PASSWORD} characters.`
      : null;
  const withArchive = archive && !hideLiving && !toEdit;
  const whom = forName.trim();

  function makeCopy() {
    make.mutate(
      {
        format: "copy",
        title: title.trim(),
        hide_living: hideLiving,
        password: locked ? password : null,
        archive: withArchive,
        editable: toEdit,
        for_name: toEdit ? whom : "",
        may,
      },
      {
        onSuccess: (file) => {
          downloadExport(file.name);
          toast.success(`Saved ${file.name} (${fileSize(file.size)}).`, {
            description: toEdit
              ? `A copy stays in ${file.folder}. Send it to ${whom} as a file.`
              : `A copy stays in ${file.folder}. It opens in any browser: send it as a file.`,
            duration: ACTION_MS,
          });
          setPassword("");
          onOpenChange(false);
        },
        onError: showError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !make.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{toEdit ? "Make a copy to edit" : "Make a view-only copy"}</DialogTitle>
          <DialogDescription>
            {toEdit
              ? "The whole app with your family inside, as one file for a relative to add to and correct. They save their changes into a new file and send it back to you."
              : "The whole app with your family inside, as one file for relatives. It opens in any browser with nothing to install, and nothing in it can be changed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          {toEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="copy-for">For</Label>
              <Input
                id="copy-for"
                value={forName}
                maxLength={60}
                placeholder="e.g. Mak Long"
                onChange={(event) => setForName(event.target.value)}
              />
              <p className="text-xs text-stone-500">
                Whom it's made for: their changes come back under this name.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="copy-title">Title (optional)</Label>
            <Input
              id="copy-title"
              value={title}
              maxLength={60}
              placeholder="e.g. Keluarga Contoh"
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-xs text-stone-500">
              Shown at the top of the copy, and in its file name.
            </p>
          </div>

          {toEdit && (
            <fieldset className="space-y-2">
              <legend className="mb-1.5 font-medium">They can</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {MAY.map(({ what, label }) => (
                  <div key={what} className="flex items-center gap-2">
                    <Checkbox
                      id={`copy-may-${what}`}
                      checked={may[what]}
                      onCheckedChange={(checked) =>
                        setMay((now) => ({ ...now, [what]: checked === true }))
                      }
                    />
                    <Label htmlFor={`copy-may-${what}`} className="font-normal">
                      {label}
                    </Label>
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1.5 font-medium">Living people</legend>
            <RadioGroup
              value={hideLiving ? "hide" : "show"}
              onValueChange={(value) => setHideLiving(value === "hide")}
              className="gap-2"
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="show" id="copy-show" className="mt-0.5" />
                <Label htmlFor="copy-show" className="font-normal">
                  Show everything, for close family
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem value="hide" id="copy-hide" className="mt-0.5" />
                <Label htmlFor="copy-hide" className="block font-normal">
                  Hide their details: day and month of birth, places, notes and life stories.
                  <span className="block text-xs text-stone-500">
                    {toEdit
                      ? "Their names, photos, birth years and links stay. Their details can't be edited in the copy then."
                      : "Their names, photos, birth years and links stay. For copies that go beyond close family."}
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </fieldset>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="copy-lock"
                checked={locked}
                onCheckedChange={(checked) => setLocked(checked === true)}
              />
              <Label htmlFor="copy-lock" className="font-normal">
                <LockIcon className="size-3.5" aria-hidden />
                Lock the copy with a password
              </Label>
            </div>
            {locked && (
              <div className="space-y-1 pl-6">
                <Input
                  type="password"
                  aria-label="The copy's password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <p
                  className={passwordProblem ? "text-xs text-amber-700" : "text-xs text-stone-500"}
                >
                  {passwordProblem ??
                    "Tell them the password another way, e.g. by phone. It can't be recovered: if it's forgotten, make a new copy."}
                </p>
              </div>
            )}
          </div>

          <div className={toEdit ? "hidden" : "flex items-start gap-2"}>
            <Checkbox
              id="copy-archive"
              className="mt-0.5"
              checked={withArchive}
              disabled={hideLiving}
              onCheckedChange={(checked) => setArchive(checked === true)}
            />
            <Label htmlFor="copy-archive" className="block font-normal">
              Include the full archive in the copy's Export
              <span className="block text-xs text-stone-500">
                {hideLiving
                  ? "Not with living people's details hidden: the archive holds everything."
                  : `Everything, photos included${latest ? `: about ${fileSize(latest.size)}, like your latest backup` : ""}.`}
              </span>
            </Label>
          </div>

          <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
            {toEdit
              ? "Nothing they change reaches the family until you bring it in, ticking what comes: Settings → Import → Changes from a copy. The app keeps what the copy starts from, to compare with what comes back."
              : "A copy shows the family as it is today. Once it's sent it can't be changed or taken back: to update someone, send them a new one."}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={make.isPending}>
            Cancel
          </Button>
          <Button
            onClick={makeCopy}
            disabled={make.isPending || passwordProblem !== null || (toEdit && !whom)}
          >
            {make.isPending ? "Making the copy…" : "Make the copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
