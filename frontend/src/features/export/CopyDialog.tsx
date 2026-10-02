import { LockIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { downloadExport, useBackups, useMakeExport } from "@/api/queries";
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

/**
 * Export → View-only copy: the app with the family inside, as one .html file to
 * give to relatives. It opens in any browser, needs nothing installed, and changes nothing.
 */
export function CopyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
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
  const withArchive = archive && !hideLiving;

  function makeCopy() {
    make.mutate(
      {
        format: "copy",
        title: title.trim(),
        hide_living: hideLiving,
        password: locked ? password : null,
        archive: withArchive,
      },
      {
        onSuccess: (file) => {
          downloadExport(file.name);
          toast.success(`Saved ${file.name} (${fileSize(file.size)}).`, {
            description: `A copy stays in ${file.folder}. It opens in any browser: send it as a file.`,
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
          <DialogTitle>Make a view-only copy</DialogTitle>
          <DialogDescription>
            The whole app with your family inside, as one file for relatives. It opens in any
            browser with nothing to install, and nothing in it can be changed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
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
                    Their names, photos, birth years and links stay. For copies that go beyond close
                    family.
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

          <div className="flex items-start gap-2">
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
            A copy shows the family as it is today. Once it's sent it can't be changed or taken
            back: to update someone, send them a new one.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={make.isPending}>
            Cancel
          </Button>
          <Button onClick={makeCopy} disabled={make.isPending || passwordProblem !== null}>
            {make.isPending ? "Making the copy…" : "Make the copy"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
