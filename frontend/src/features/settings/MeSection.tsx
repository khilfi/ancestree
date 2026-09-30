import { useState } from "react";
import { toast } from "sonner";
import { useMe, usePerson, useSetMe } from "@/api/queries";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { MeDialog } from "@/features/me/MeDialog";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";

/** Settings → Me: which person you are, to change or forget. */
export function MeSection() {
  const me = useMe().data?.person ?? null;
  const person = usePerson(me);
  const setMe = useSetMe();
  const [choosing, setChoosing] = useState(false);

  const forget = () =>
    setMe.mutate(null, {
      onSuccess: () => toast.success("Forgotten. Nothing says “your” now."),
      onError: showError,
    });

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Me</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          Which person you are in the family. Once you've chosen, every panel says what that person
          is to you, like "your pak long", and the tree can be coloured by how close everyone is to
          you. Nothing says "your" until then.
        </p>
      </div>

      {!me && <Button onClick={() => setChoosing(true)}>Choose who you are…</Button>}

      {me && person.data && (
        <div className="flex flex-wrap items-center gap-3">
          <PersonAvatar person={person.data} size="sm" />
          <div className="min-w-0">
            <div className="font-medium">{person.data.full_name}</div>
            <div className="text-xs text-stone-500">
              {lifeYears({
                birth_year: person.data.birth_date?.value.year ?? null,
                death_year: person.data.death_date?.value.year ?? null,
              })}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setChoosing(true)}>
              I'm someone else…
            </Button>
            <Button variant="ghost" onClick={forget} disabled={setMe.isPending}>
              Forget who I am
            </Button>
          </div>
        </div>
      )}

      {me && person.isError && (
        <div className="space-y-2">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The person you chose isn't in the tree any more, perhaps in the Trash. "Me" is off until
            they're back or you choose again.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => setChoosing(true)}>Choose again…</Button>
            <Button variant="ghost" onClick={forget} disabled={setMe.isPending}>
              Forget who I am
            </Button>
          </div>
        </div>
      )}

      <MeDialog open={choosing} onOpenChange={setChoosing} />
    </section>
  );
}
