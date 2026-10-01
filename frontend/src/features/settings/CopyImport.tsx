import { LockIcon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { useCopyPreview, useRunCopyImport } from "@/api/queries";
import type { CopyPreview, ImportDone } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACTION_MS, showError } from "@/lib/notify";
import { carriedOut, type Ticks, tickAll, tickedIds } from "./importTicks";
import { count, day, Group, LeftOut, Question, Review, SecondLook } from "./review";

/** "1 person added, 2 changes to details and links, 1 life story brought in": what bringing
 *  a copy's changes in did, or a relative's computer's. */
export function brought(done: ImportDone): string {
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

/** Which copy came back, as the app made it: never as the file says. */
function About({ preview }: { preview: CopyPreview }) {
  const { about } = preview;
  return (
    <div className="space-y-1 text-sm">
      <p>
        From {about.title ? <strong>“{about.title}”</strong> : "a copy"}, made for{" "}
        <strong>{about.for_name}</strong> on {day(about.made_at)}
        {about.saved_at ? `, saved from it on ${day(about.saved_at)}` : ""}
        {about.locked ? ", locked" : ""}.
      </p>
      {about.brought_at && (
        <p className="text-stone-600">
          Changes from this copy were brought in on {day(about.brought_at)}: only what's new since
          shows.
        </p>
      )}
    </div>
  );
}

/**
 * Settings → Import → Changes from a copy: a relative's copy to edit, sent back.
 * What they changed is compared with what the app knows the copy started from and with the tree
 * now, and each change is ticked or not, as a spreadsheet's are. The file is only read,
 * never run; nothing changes until you bring the changes in, and Take back undoes it all later.
 */
export function CopyImport() {
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState(0);
  const [typed, setTyped] = useState("");
  const password = useRef(""); // kept only here, while the file is open
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [ticks, setTicks] = useState<Ticks>({});
  const preview = useCopyPreview(file, token, () => password.current, answers);
  const run = useRunCopyImport();
  const input = useRef<HTMLInputElement>(null);
  const shown = file && !preview.isError ? preview.data : undefined;
  const changes = shown?.changes ?? [];
  const carried = carriedOut(changes, ticks).size;
  const code = preview.error instanceof ApiError ? preview.error.code : undefined;
  const locked = code === "locked" || code === "wrong_password";
  const waiting = changes.filter((change) => change.clash || change.removes);

  function reset(next: File | null) {
    setFile(next);
    setAnswers({});
    setTicks({});
    setTyped("");
    password.current = "";
  }

  function unlock() {
    password.current = typed;
    void preview.refetch(); // the form stays while it's checked
  }

  function bringIn() {
    if (!file || !shown) return;
    run.mutate(
      { file, password: password.current, answers, chosen: [...tickedIds(changes, ticks)] },
      {
        onSuccess: (done) => {
          toast.success(`Brought in from ${shown.about.for_name}'s copy: ${brought(done)}.`, {
            description: done.left_out
              ? `${count(done.left_out, "thing was", "things were")} left out: see its report under Earlier imports.`
              : "Take back, under Earlier imports, undoes all of it.",
            duration: ACTION_MS,
          });
          reset(null);
        },
        onError: showError,
      },
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Changes from a copy</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          A copy to edit that a relative sent back: see what they added, changed and removed, and
          bring in what you tick. The file is only read, never run, and nothing changes until you
          bring its changes in.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">1. Choose the file they sent back</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
            <UploadIcon />
            {file ? "Choose another file…" : "Choose a file…"}
          </Button>
          {file && <span className="text-sm text-stone-600">{file.name}</span>}
        </div>
        <input
          ref={input}
          type="file"
          accept=".html,.htm,text/html"
          aria-label="The copy they sent back"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (next) {
              reset(next);
              setToken((now) => now + 1);
            }
          }}
        />
      </div>

      {file && locked && (
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            unlock();
          }}
        >
          <label htmlFor="copy-password" className="flex items-center gap-1 text-sm font-medium">
            <LockIcon className="size-3.5" aria-hidden />
            This copy is locked: its password
          </label>
          <div className="flex gap-2">
            <Input
              id="copy-password"
              type="password"
              autoComplete="off"
              className="max-w-xs"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={!typed || preview.isFetching}>
              {preview.isFetching ? "Opening…" : "Open"}
            </Button>
          </div>
          <p
            className={
              code === "wrong_password" ? "text-xs text-amber-700" : "text-xs text-stone-500"
            }
          >
            {code === "wrong_password"
              ? "That isn't the password of this copy."
              : "The password it was locked with when you made it. It's used to open the file, then forgotten."}
          </p>
        </form>
      )}

      {file && !locked && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">2. What they changed</h3>
          {preview.isError ? (
            <p role="alert" className="text-sm text-red-600">
              {preview.error.message}
            </p>
          ) : !shown ? (
            <p className="text-sm text-stone-500">Reading {file.name}…</p>
          ) : (
            <>
              <About preview={shown} />
              <p className="text-sm">
                {changes.length === 0 ? (
                  "Nothing new: everything in this copy is in the tree already, or was brought in before."
                ) : (
                  <>
                    <strong>{count(changes.length, "change")}</strong> to review, {carried} ticked.
                  </>
                )}
              </p>
              <Group title="To check" items={shown.questions.length} open tone="attention">
                <ul className="divide-y divide-stone-100">
                  {shown.questions.map((question) => (
                    <Question
                      key={question.id}
                      question={question}
                      onAnswer={(option) =>
                        setAnswers((now) => ({ ...now, [question.id]: option }))
                      }
                    />
                  ))}
                </ul>
              </Group>
              {changes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTicks(tickAll(changes, true))}
                  >
                    Tick all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTicks(tickAll(changes, false))}
                  >
                    Untick all
                  </Button>
                  {waiting.length > 0 && (
                    <span className="text-xs text-stone-500">
                      Tick all leaves what takes something out, and the clashes, to their own ticks.
                    </span>
                  )}
                </div>
              )}
              <Review changes={changes} ticks={ticks} source="copy" onTicks={setTicks} />
              <LeftOut items={shown.left_out} />
              <SecondLook items={shown.second_look} />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={bringIn}
                  disabled={carried === 0 || preview.isFetching || run.isPending}
                >
                  {run.isPending ? "Bringing in…" : `Bring in ${count(carried, "change")}`}
                </Button>
                <Button variant="ghost" onClick={() => reset(null)} disabled={run.isPending}>
                  Cancel
                </Button>
                {preview.isFetching && (
                  <span className="text-sm text-stone-500">Checking your answer…</span>
                )}
              </div>
              <p className="text-xs text-stone-500">
                A backup is made first. The people, details and links are then one step for Undo;
                Take back, under Earlier imports, undoes all of it, life stories and photos too.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
