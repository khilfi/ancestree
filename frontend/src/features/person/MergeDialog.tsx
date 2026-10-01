import { useState } from "react";
import { toast } from "sonner";
import { useMergePeople, useMergePreview, useSearchPeople } from "@/api/queries";
import type { MergePreview, PersonDetail } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ACTION_MS, showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { useDebounced } from "@/lib/useDebounced";

const OUTCOMES: Record<MergePreview["links"][number]["outcome"], string> = {
  moved: "moves across",
  already: "is there already",
  between: "goes: it joined the two of them",
  left_out: "stays with them, in the Trash",
};

function Files({ preview }: { preview: MergePreview }) {
  const notes = [
    preview.photo === "taken" && `${preview.keep_name} takes their photo.`,
    preview.photo === "kept" && `${preview.keep_name}'s photo stays; theirs goes with them.`,
    preview.story === "taken" && `${preview.keep_name} takes their life story.`,
    preview.story === "both" &&
      `${preview.keep_name}'s life story stays; theirs goes with them, to copy from before the Trash empties.`,
  ].filter(Boolean);
  if (notes.length === 0) return null;
  return (
    <ul className="list-disc space-y-0.5 pl-5 text-sm text-stone-600">
      {notes.map((note) => (
        <li key={String(note)}>{note}</li>
      ))}
    </ul>
  );
}

function Preview({ preview }: { preview: MergePreview }) {
  return (
    <div className="space-y-3 text-sm">
      {preview.details.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">Details</h3>
          <ul className="space-y-0.5">
            {preview.details.map((detail) => (
              <li key={detail.label}>
                <span className="text-stone-500">{detail.label}: </span>
                {detail.taken ? (
                  <>
                    <strong>{detail.other}</strong> <span className="text-stone-500">(theirs)</span>
                  </>
                ) : (
                  <>
                    {detail.keep}
                    {detail.keep !== detail.other && (
                      <span className="text-stone-500"> stays; theirs was {detail.other}</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.links.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-medium">Their links</h3>
          <ul className="space-y-0.5">
            {preview.links.map((item) => (
              <li key={item.description}>
                {item.description}{" "}
                <span className={item.outcome === "left_out" ? "text-amber-700" : "text-stone-500"}>
                  {OUTCOMES[item.outcome]}
                  {item.why ? `: ${item.why}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Files preview={preview} />
    </div>
  );
}

/**
 * Merge someone entered twice into this person. Where this person has nothing,
 * they take the other's detail; the other's links move across through the app's rules; the
 * other then goes to the Trash. One step for Undo, and the Trash keeps the other 30 days.
 */
export function MergeDialog({
  person,
  open,
  onOpenChange,
}: {
  person: PersonDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [other, setOther] = useState<string | null>(null);
  const results = useSearchPeople(useDebounced(text.trim(), 150));
  const preview = useMergePreview(person.id, other);
  const merge = useMergePeople();
  const people = (results.data ?? []).filter((p) => !p.placeholder && p.id !== person.id);

  function close(next: boolean) {
    if (!next) {
      setText("");
      setOther(null);
    }
    onOpenChange(next);
  }

  function run() {
    if (!other || !preview.data) return;
    const name = preview.data.other_name;
    merge.mutate(
      { keep: person.id, other },
      {
        onSuccess: () => {
          toast.success(`${name} is merged into ${person.full_name}.`, {
            description: "Undo puts them back as two, and the Trash keeps them for 30 days.",
            duration: ACTION_MS,
          });
          close(false);
        },
        onError: showError,
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge someone into {person.full_name}</DialogTitle>
          <DialogDescription>
            For someone entered twice. {person.full_name} keeps everything they have, and takes the
            other's details where they have none; the other's links move across, and the other goes
            to the Trash.
          </DialogDescription>
        </DialogHeader>
        {other === null ? (
          <>
            <Input
              autoFocus
              aria-label="Search for the same person"
              placeholder="Who's the same person? Type their name…"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label="People">
              {people.map((found) => (
                <li key={found.id}>
                  <button
                    type="button"
                    onClick={() => setOther(found.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-stone-100"
                  >
                    <PersonAvatar person={found} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      {found.full_name}
                      {found.nickname && (
                        <span className="text-stone-500"> “{found.nickname}”</span>
                      )}
                    </span>
                    <span className="text-xs text-stone-500">{lifeYears(found)}</span>
                  </button>
                </li>
              ))}
              {text.trim() && results.isFetched && people.length === 0 && (
                <li className="px-2 py-1.5 text-sm text-stone-500">No one else by that name.</li>
              )}
            </ul>
          </>
        ) : preview.isError ? (
          <p role="alert" className="text-sm text-red-600">
            {preview.error.message}
          </p>
        ) : !preview.data ? (
          <p className="text-sm text-stone-500">Working out what would change…</p>
        ) : (
          <Preview preview={preview.data} />
        )}
        <DialogFooter>
          {other !== null && (
            <Button variant="ghost" onClick={() => setOther(null)} disabled={merge.isPending}>
              Choose someone else
            </Button>
          )}
          <Button onClick={run} disabled={other === null || !preview.data || merge.isPending}>
            {merge.isPending
              ? "Merging…"
              : preview.data
                ? `Merge ${preview.data.other_name} into ${person.full_name}`
                : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
