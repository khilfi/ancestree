import { EyeIcon, PencilIcon } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CopyAbout, CopyPermissions } from "./copy";

function day(iso: string, month: "short" | "long"): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month, year: "numeric" });
}

const CAN: Record<keyof CopyPermissions, string> = {
  add: "add people and links",
  change: "change details",
  remove: "remove people and links",
  stories: "write life stories",
  photos: "add photos",
};

/** "add people and links, change details and add photos" */
function listed(may: CopyPermissions): string {
  const parts = (Object.keys(CAN) as (keyof CopyPermissions)[])
    .filter((what) => may[what])
    .map((what) => CAN[what]);
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** In a copy's top bar: what copy this is, and About this copy. */
export function CopyBadge({ copy }: { copy: CopyAbout }) {
  const [open, setOpen] = useState(false);
  const editing = copy.editing ?? null;
  const Icon = editing ? PencilIcon : EyeIcon;
  const kind = editing ? "to edit" : "view-only";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="About this copy"
        className="flex min-w-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-100"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate max-md:hidden">
          {copy.title ? `${copy.title} · ` : ""}
          {kind}, {day(copy.made_at, "short")}
        </span>
        {/* On a phone, short: the rest is in About this copy. */}
        <span className="truncate md:hidden">
          {copy.title || (editing ? "To edit" : "View-only")}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>About this copy</DialogTitle>
            <DialogDescription>
              {copy.title ? `${copy.title}: a` : "A"}
              {editing
                ? ` copy of AncesTree to edit, made for ${editing.for} on `
                : " view-only copy of AncesTree, made on "}
              {day(copy.made_at, "long")}, with {copy.people} people.
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="space-y-2 text-sm text-stone-700">
              <p>
                {listed(editing.may)
                  ? `In this copy you can ${listed(editing.may)}.`
                  : "This copy lets you look around, but not change anything."}{" "}
                Your changes are kept in this browser as you make them, so closing it loses nothing
                on this device.
              </p>
              <p>
                When you're done, choose <strong>Save a new copy</strong> and send the new file back
                to whoever gave you this copy. Nothing you change reaches the family's record until
                they approve it.
              </p>
              {copy.hidden_living && (
                <p>
                  Living people's day and month of birth, their places, notes and life stories are
                  left out of this copy, so those can't be changed here.
                </p>
              )}
              <p>
                To see how any two people are related, open someone and choose{" "}
                <strong>Find relationship</strong>. The copy never connects to the internet.
              </p>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-stone-700">
              <p>
                Look around as you like: nothing you do here changes the family's record. What you
                choose, such as who you are (<strong>Me</strong>), the colours or the language of
                kinship words, stays in this browser.
              </p>
              <p>
                To see how any two people are related, open someone and choose{" "}
                <strong>Find relationship</strong>.
              </p>
              {copy.hidden_living && (
                <p>
                  Living people's day and month of birth, their places, notes and life stories are
                  left out of this copy.
                </p>
              )}
              <p>
                The copy never connects to the internet. It doesn't update itself either: for a
                newer one, ask for a new copy.
              </p>
              <p>
                To add someone or correct something, use <strong>Export → Import template</strong>:
                fill it in with Excel and send it back to whoever gave you this copy.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
