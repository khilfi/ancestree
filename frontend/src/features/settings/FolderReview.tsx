import { useState } from "react";
import { toast } from "sonner";
import { useBringIn, useFolderReview, useTurnDown } from "@/api/familyFolder";
import type { FolderChanges, ImportDone } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_MS, showError } from "@/lib/notify";
import { carriedOut, type Ticks, tickAll, tickedIds } from "./importTicks";
import { count, Group, LeftOut, Question, Review, SecondLook, when } from "./review";

/** "1 person added, 2 changes to details and links, 1 life story brought in": what bringing
 *  a relative's changes in did. */
function brought(done: ImportDone): string {
  const stories = done.stories ?? 0;
  const photos = done.photos ?? 0;
  const tail = [
    stories > 0 && count(stories, "life story", "life stories"),
    photos > 0 && count(photos, "photo"),
  ].filter(Boolean);
  const parts = [
    done.people > 0 && `${count(done.people, "person", "people")} added`,
    done.links > 0 && `${count(done.links, "link")} made`,
    done.changed > 0 && `${count(done.changed, "change")} to details and links`,
    done.removed > 0 && `${count(done.removed, "person", "people")} moved to the Trash`,
    tail.length > 0 && `${tail.join(" and ")} brought in`,
  ].filter(Boolean);
  return parts.join(", ") || "nothing new";
}

/**
 * The keeper's review of what a relative's computer sent through the family folder:
 * the review of M19, as it was for a copy to edit. What they changed is compared with
 * the family as your
 * record had it when they made their change, and with the tree now. A clash keeps yours unless
 * you tick theirs, look-alikes are asked about, and anything that takes something out waits for
 * its own tick. What you bring in reaches everyone; what you don't goes back to them, with your
 * note.
 */
export function FolderReview({
  changes,
  onClose,
}: {
  changes: FolderChanges;
  onClose: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Ticks>({});
  const [note, setNote] = useState("");
  const review = useFolderReview(changes, answers);
  const bringIn = useBringIn();
  const turnDown = useTurnDown();
  const shown = review.isError ? undefined : review.data;
  const list = shown?.changes ?? [];
  const carried = carriedOut(list, ticks).size;
  const waiting = list.filter((change) => change.clash || change.removes);
  const busy = bringIn.isPending || turnDown.isPending;

  function bring() {
    bringIn.mutate(
      {
        device: changes.device,
        body: {
          proposal: changes.proposal,
          answers,
          chosen: [...tickedIds(list, ticks)],
          note,
        },
      },
      {
        onSuccess: (done) => {
          toast.success(`Brought in from ${changes.name}: ${brought(done)}.`, {
            description: done.left_out
              ? `${count(done.left_out, "thing was", "things were")} left out: ${changes.name} hears which.`
              : "It reaches every computer in the family. Take back, under Settings → Import, undoes it.",
            duration: ACTION_MS,
          });
          onClose();
        },
        onError: showError,
      },
    );
  }

  function down() {
    turnDown.mutate(
      { device: changes.device, proposal: changes.proposal, note },
      {
        onSuccess: () => {
          toast.success(`None of it was taken: ${changes.name} hears so.`, {
            duration: ACTION_MS,
          });
          onClose();
        },
        onError: showError,
      },
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-stone-50/60 p-4">
      <p className="text-sm">
        From <strong>{changes.name}</strong>
        {changes.email ? ` (${changes.email})` : ""}, sent {when(changes.sent_at)}.
      </p>
      {review.isError ? (
        <p role="alert" className="text-sm text-red-600">
          {review.error.message}
        </p>
      ) : !shown ? (
        <p className="text-sm text-stone-500">Comparing what they sent with your tree…</p>
      ) : (
        <>
          <p className="text-sm">
            {list.length === 0 ? (
              "Nothing new: everything they changed is in your tree already."
            ) : (
              <>
                <strong>{count(list.length, "change")}</strong> to review, {carried} ticked.
              </>
            )}
          </p>
          <Group title="To check" items={shown.questions.length} open tone="attention">
            <ul className="divide-y divide-stone-100">
              {shown.questions.map((question) => (
                <Question
                  key={question.id}
                  question={question}
                  onAnswer={(option) => setAnswers((now) => ({ ...now, [question.id]: option }))}
                />
              ))}
            </ul>
          </Group>
          {list.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button variant="outline" size="sm" onClick={() => setTicks(tickAll(list, true))}>
                Tick all
              </Button>
              <Button variant="outline" size="sm" onClick={() => setTicks(tickAll(list, false))}>
                Untick all
              </Button>
              {waiting.length > 0 && (
                <span className="text-xs text-stone-500">
                  Tick all leaves what takes something out, and the clashes, to their own ticks.
                </span>
              )}
            </div>
          )}
          <Review changes={list} ticks={ticks} source="computer" onTicks={setTicks} />
          <LeftOut items={shown.left_out} />
          <SecondLook items={shown.second_look} />
          <div className="max-w-xl space-y-1">
            <Label htmlFor={`note-${changes.device}`}>
              A note for {changes.name}, if you like: it goes with what isn't taken
            </Label>
            <Textarea
              id={`note-${changes.device}`}
              rows={2}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={bring} disabled={carried === 0 || review.isFetching || busy}>
              {bringIn.isPending ? "Bringing in…" : `Bring in ${count(carried, "change")}`}
            </Button>
            <Button variant="outline" onClick={down} disabled={busy}>
              {turnDown.isPending ? "Turning down…" : "Take none"}
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Not now
            </Button>
            {review.isFetching && (
              <span className="text-sm text-stone-500">Checking your answer…</span>
            )}
          </div>
          <p className="text-xs text-stone-500">
            A backup is made first. The people, details and links are then one step for Undo; Take
            back, under Settings → Import, undoes all of it, life stories and photos too. What you
            bring in reaches every computer in the family.
          </p>
        </>
      )}
    </div>
  );
}
