import { useState } from "react";
import { toast } from "sonner";
import { useSearchPeople, useSetMe } from "@/api/queries";
import { useCopy } from "@/app/copy";
import { PersonAvatar } from "@/components/PersonAvatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { useDebounced } from "@/lib/useDebounced";

/**
 * "Which person are you?": the first thing "Me" asks. Nothing says "your" until
 * you've chosen yourself here.
 */
export function MeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const copy = useCopy(); // a view-only copy: each viewer's own choice
  const results = useSearchPeople(useDebounced(text.trim(), 150));
  const setMe = useSetMe();
  const people = (results.data ?? []).filter((person) => !person.placeholder);

  function choose(id: string, name: string) {
    setMe.mutate(id, {
      onSuccess: () => {
        toast.success(`You're ${name}.`, {
          description: "Every panel now says what that person is to you.",
        });
        setText("");
        onOpenChange(false);
      },
      onError: showError,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Which person are you?</DialogTitle>
          <DialogDescription>
            Choose yourself in the family. Every panel then says what that person is to you, like
            "your pak long", and the tree can colour everyone by how close they are to you.{" "}
            {copy
              ? "It's kept in this browser only, and Me changes it any time."
              : "You can change it later in Settings → Me."}
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          aria-label="Search for yourself"
          placeholder="Type your name…"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <ul className="max-h-72 space-y-0.5 overflow-y-auto" aria-label="People">
          {people.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                disabled={setMe.isPending}
                onClick={() => choose(person.id, person.nickname || person.full_name)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-stone-100"
              >
                <PersonAvatar person={person} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {person.full_name}
                  {person.nickname && <span className="text-stone-500"> “{person.nickname}”</span>}
                </span>
                <span className="text-xs text-stone-500">{lifeYears(person)}</span>
              </button>
            </li>
          ))}
          {text.trim() && results.isFetched && people.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-stone-500">No one by that name.</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
