import { useIsMutating } from "@tanstack/react-query";
import { CheckIcon, Maximize2Icon, Minimize2Icon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { keys, useBiography, useSaveBiography } from "@/api/queries";
import type { Biography, PersonDetail } from "@/api/types";
import { useCanEdit, useCopy } from "@/app/copy";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { type Source, SourcesList, toSources } from "./SourcesList";

// The editor is big: it loads the first time a story is opened.
const StoryEditor = lazy(() =>
  import("./StoryEditor").then((module) => ({ default: module.StoryEditor })),
);

const IDLE_MS = 2000; // a pause this long saves

/** The Biography tab: a life story and its Sources, saved to biography.md while writing. */
export function BiographyTab({ person }: { person: PersonDetail }) {
  const canEdit = useCanEdit();
  if (person.placeholder) {
    return (
      <p className="px-4 pt-3 text-sm text-stone-500">
        {canEdit
          ? "An unknown parent has no story yet. Fill them in first."
          : "An unknown parent has no story."}
      </p>
    );
  }
  return <OpenStory person={person} />;
}

function OpenStory({ person }: { person: PersonDetail }) {
  const opened = useOpenedStory(person.id);
  const canEdit = useCanEdit();
  if (opened.error)
    return <p className="px-4 pt-3 text-sm text-stone-600">{opened.error.message}</p>;
  if (!opened.story) return <StorySkeleton />;
  if (!canEdit) return <StoryReader person={person} story={opened.story} />;
  return <StoryWriter person={person} opened={opened.story} />;
}

/** A story in a view-only copy: shown as the editor shows it, with nothing to change. */
function StoryReader({ person, story }: { person: PersonDetail; story: Biography }) {
  const copy = useCopy();
  const [wide, setWide] = useState(false);
  const [plain, setPlain] = useState(false);
  const showPlain = useCallback(() => setPlain(true), []);
  const sources = story.sources.filter((source) => source.trim());

  useEffect(() => {
    if (!wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setWide(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  if (!story.story.trim() && sources.length === 0) {
    // With living people's details left out, so are their stories.
    const left = copy?.hidden_living && person.is_living !== false;
    return (
      <p className="px-4 pt-3 text-sm text-stone-500">
        {left ? "Living people's stories aren't in this copy." : "No story written yet."}
      </p>
    );
  }
  return (
    <>
      {wide && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Back to the panel"
          className="fixed inset-0 z-40 cursor-default bg-black/30"
          onClick={() => setWide(false)}
        />
      )}
      <section
        aria-label={`Biography of ${person.full_name}`}
        className={
          wide
            ? "fixed inset-4 z-50 mx-auto flex max-w-5xl flex-col rounded-xl bg-white pt-3 shadow-2xl ring-1 ring-black/10"
            : "flex min-h-0 flex-1 flex-col pt-2"
        }
      >
        <div className="flex min-h-9 items-center gap-2 px-4 pb-2">
          {wide && <h2 className="truncate text-base font-semibold">{person.full_name}</h2>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setWide(!wide)}
            title={wide ? "Back to the side panel (Esc)" : "A wide page for reading"}
          >
            {wide ? <Minimize2Icon /> : <Maximize2Icon />}
            {wide ? "Back to the panel" : "Wide view"}
          </Button>
        </div>
        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className={wide ? "mx-auto max-w-3xl space-y-6 px-6 pb-10" : "space-y-6 px-4 pb-8"}>
            {plain ? (
              <pre className="font-sans text-sm whitespace-pre-wrap text-stone-800">
                {story.story}
              </pre>
            ) : (
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <StoryEditor
                  personId={person.id}
                  markdown={story.story}
                  onChange={() => {}}
                  onUnreadable={showPlain}
                  readOnly
                />
              </Suspense>
            )}
            {sources.length > 0 && (
              <section className="space-y-1">
                <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                  Sources
                </h3>
                <ul className="list-disc space-y-0.5 pl-5 text-sm text-stone-700">
                  {sources.map((source) => (
                    <li key={source}>{source}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function StorySkeleton() {
  return (
    <div className="space-y-3 px-4 pt-3">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-10/12" />
      <Skeleton className="h-4 w-8/12" />
    </div>
  );
}

/**
 * The story as the file is now. If a save of it is still on its way (the panel was just
 * closed and reopened), it waits for that save, so writing never starts from an older copy.
 */
function useOpenedStory(id: string) {
  const query = useBiography(id);
  const saving = useIsMutating({ mutationKey: keys.biography(id) }) > 0;
  const [story, setStory] = useState<Biography | null>(null);
  const ready = !saving && !query.isFetching && query.isFetchedAfterMount ? query.data : undefined;
  useEffect(() => {
    if (ready) setStory((current) => current ?? ready);
  }, [ready]);
  return { story, error: story ? null : query.error };
}

/** The file's text for this draft, for copying somewhere safe when it couldn't be saved. */
function asText(draft: { story: string; sources: string[] }): string {
  const sources = draft.sources.filter((source) => source.trim());
  const list = sources.length ? `## Sources\n\n${sources.map((s) => `- ${s}`).join("\n")}` : "";
  return [draft.story.trim(), list].filter(Boolean).join("\n\n");
}

function offerCopy(message: string, text: string) {
  toast.error(message, {
    duration: 60_000,
    action: { label: "Copy my text", onClick: () => void navigator.clipboard.writeText(text) },
  });
}

type Status = "idle" | "saving" | "saved" | "failed";

function StoryWriter({ person, opened }: { person: PersonDetail; opened: Biography }) {
  const save = useSaveBiography(person.id);
  const onDisk = useBiography(person.id).data;
  // What the editor opens with; `round` changes to open it afresh (the file's version).
  const [start, setStart] = useState({ story: opened.story, round: 0 });
  const [plain, setPlain] = useState<string | null>(null); // the story as text, when shown so
  const [sources, setSources] = useState(() => toSources(opened.sources));
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState("");
  const [conflict, setConflict] = useState<Biography | null>(null);
  const [wide, setWide] = useState(false);

  // Saving runs on these, not on state: typing must not wait for React.
  const draft = useRef({ story: opened.story, sources: opened.sources });
  const base = useRef(opened.version); // the file's version this draft builds on
  const known = useRef(new Set([opened.version])); // versions this editor has seen or written
  const edits = useRef(0);
  const savedEdits = useRef(0);
  const busy = useRef(false);
  const halted = useRef(false); // the file changed outside: saving waits for a choice
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flushRef = useRef(async () => {});

  /** Save after the next pause in typing. */
  const later = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushRef.current(), IDLE_MS);
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (edits.current === savedEdits.current || busy.current || halted.current) return;
    busy.current = true;
    const sent = edits.current;
    setStatus("saving");
    let saved = false;
    try {
      const file = await save.mutateAsync({ ...draft.current, base_version: base.current });
      base.current = file.version;
      known.current.add(file.version);
      savedEdits.current = sent;
      saved = true;
      setFailure("");
      setStatus(edits.current === sent ? "saved" : "saving");
    } catch (error) {
      if (error instanceof ApiError && error.code === "changed_outside") {
        halted.current = true;
        setConflict(error.detail as Biography);
        setStatus("idle");
      } else {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setFailure(message);
        setStatus("failed");
        if (!mounted.current)
          offerCopy(`The story wasn't saved: ${message}`, asText(draft.current));
      }
    } finally {
      busy.current = false;
    }
    // Typing carried on while saving: that's saved after the next pause.
    if (saved && edits.current !== savedEdits.current && mounted.current) later();
  }, [save.mutateAsync, later]);
  flushRef.current = flush;

  const edited = useCallback(() => {
    edits.current += 1;
    if (halted.current) return;
    setStatus("saving");
    later();
  }, [later]);

  const onStory = useCallback(
    (markdown: string) => {
      draft.current.story = markdown;
      edited();
    },
    [edited],
  );

  function onSources(next: Source[]) {
    setSources(next);
    draft.current.sources = next.map((source) => source.text);
    edited();
  }

  /** Show the file as it is now, dropping anything unsaved. */
  const reopen = useCallback((file: Biography) => {
    clearTimeout(timer.current);
    draft.current = { story: file.story, sources: file.sources };
    base.current = file.version;
    known.current.add(file.version);
    savedEdits.current = edits.current;
    halted.current = false;
    setConflict(null);
    setFailure("");
    setStatus("idle");
    setSources(toSources(file.sources));
    setPlain(null);
    setStart((current) => ({ story: file.story, round: current.round + 1 }));
  }, []);

  function keepMine() {
    if (!conflict) return;
    base.current = conflict.version;
    known.current.add(conflict.version);
    halted.current = false;
    setConflict(null);
    void flush();
  }

  // Coming back to the window re-reads the file: an edit made in Notepad or Obsidian shows up.
  useEffect(() => {
    if (!onDisk || busy.current || known.current.has(onDisk.version)) return;
    if (edits.current !== savedEdits.current) {
      halted.current = true;
      setConflict(onDisk);
    } else {
      reopen(onDisk);
      toast.info("This story was changed outside AncesTree. It now shows the new version.");
    }
  }, [onDisk, reopen]);

  // Leaving saves what's typed; closing the browser tab first asks.
  useEffect(() => {
    mounted.current = true;
    const leaving = (event: BeforeUnloadEvent) => {
      if (edits.current === savedEdits.current) return;
      void flushRef.current();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", leaving);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      mounted.current = false;
      if (halted.current && edits.current !== savedEdits.current) {
        offerCopy(
          "Your latest changes to the story weren't saved: the file had changed outside AncesTree.",
          asText(draft.current),
        );
      } else {
        void flushRef.current();
      }
    };
  }, []);

  useEffect(() => {
    if (!wide) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setWide(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide]);

  const showPlain = useCallback(() => setPlain(draft.current.story), []);

  return (
    <>
      {wide && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Back to the panel"
          className="fixed inset-0 z-40 cursor-default bg-black/30"
          onClick={() => setWide(false)}
        />
      )}
      <section
        aria-label={`Biography of ${person.full_name}`}
        className={
          wide
            ? "fixed inset-4 z-50 mx-auto flex max-w-5xl flex-col rounded-xl bg-white pt-3 shadow-2xl ring-1 ring-black/10"
            : "flex min-h-0 flex-1 flex-col pt-2"
        }
      >
        <div className="flex min-h-9 items-center gap-2 px-4 pb-2">
          {wide && <h2 className="truncate text-base font-semibold">{person.full_name}</h2>}
          <SaveStatus status={status} failure={failure} onRetry={() => void flush()} />
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setWide(!wide)}
            title={wide ? "Back to the side panel (Esc)" : "A wide page for writing"}
          >
            {wide ? <Minimize2Icon /> : <Maximize2Icon />}
            {wide ? "Back to the panel" : "Wide view"}
          </Button>
        </div>

        {conflict && (
          <ChangedOutside
            file={conflict}
            onKeepMine={keepMine}
            onUseFile={() => reopen(conflict)}
          />
        )}

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          <div className={wide ? "mx-auto max-w-3xl space-y-6 px-6 pb-10" : "space-y-6 px-4 pb-8"}>
            {plain === null ? (
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <StoryEditor
                  key={start.round}
                  personId={person.id}
                  markdown={start.story}
                  onChange={onStory}
                  onUnreadable={showPlain}
                />
              </Suspense>
            ) : (
              <div className="space-y-2">
                <p className="rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-600">
                  This story has something the editor can't show, such as HTML, or Obsidian's
                  properties, [[links]] or footnotes, so it's shown as plain text. Nothing in it is
                  lost.{" "}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2"
                    onClick={() => {
                      setStart((current) => ({
                        story: draft.current.story,
                        round: current.round + 1,
                      }));
                      setPlain(null);
                    }}
                  >
                    Try the editor again
                  </button>
                </p>
                <Textarea
                  aria-label="The story, as plain text"
                  value={plain}
                  onChange={(event) => {
                    setPlain(event.target.value);
                    onStory(event.target.value);
                  }}
                  className="min-h-80 font-mono text-sm"
                />
              </div>
            )}
            <SourcesList sources={sources} onChange={onSources} />
          </div>
        </div>
      </section>
    </>
  );
}

function SaveStatus({
  status,
  failure,
  onRetry,
}: {
  status: Status;
  failure: string;
  onRetry: () => void;
}) {
  if (status === "saving") return <span className="text-xs text-stone-500">Saving…</span>;
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        Saved <CheckIcon className="size-3.5" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span role="alert" className="text-xs text-red-700">
        Not saved: {failure}{" "}
        <button type="button" className="font-medium underline" onClick={onRetry}>
          Try again
        </button>
      </span>
    );
  }
  return null;
}

/** The file changed outside the app while something typed here wasn't saved yet. */
function ChangedOutside({
  file,
  onKeepMine,
  onUseFile,
}: {
  file: Biography;
  onKeepMine: () => void;
  onUseFile: () => void;
}) {
  const text = asText(file);
  return (
    <div
      role="alert"
      className="mx-4 mb-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <p className="font-medium">This story was changed outside AncesTree since you opened it.</p>
      <p>
        Your latest changes here aren't saved yet. Keep your version (the other change is replaced),
        or use the file's version (your changes here are dropped).
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer font-medium">See the file's version</summary>
        <pre className="mt-1 max-h-48 overflow-auto rounded bg-white/70 p-2 font-sans whitespace-pre-wrap">
          {text || "(The file is now empty.)"}
        </pre>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onKeepMine}>
          Keep my version
        </Button>
        <Button size="sm" variant="outline" onClick={onUseFile}>
          Use the file's version
        </Button>
      </div>
    </div>
  );
}
