import { useIsMutating } from "@tanstack/react-query";
import { CheckIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import { keys, useBiography, useSaveBiography } from "@/api/queries";
import type { Biography, PersonDetail } from "@/api/types";
import { Button } from "@/components/ui/button";
import { GrowingText } from "@/components/ui/growing-text";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  listItems,
  listMarkdown,
  PARTS,
  type PartInfo,
  type PartKey,
  type Saying,
  sayingsMarkdown,
  sayingsOf,
} from "./parts";
import { type Source, SourcesList, toSources } from "./SourcesList";

// The editor is big: it loads the first time a story is opened.
const StoryEditor = lazy(() =>
  import("./StoryEditor").then((module) => ({ default: module.StoryEditor })),
);

const IDLE_MS = 2000; // a pause this long saves

type Parts = Record<string, string>; // by part, as the API keeps them

/**
 * The story as the file is now. If a save of it is still on its way (the window was just
 * closed and opened again), it waits for that save, so writing never starts from an older copy.
 */
export function useOpenedStory(id: string) {
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
function asText(draft: { story: string; parts?: Parts; sources: string[] }): string {
  const parts = PARTS.flatMap(({ key, title }) => {
    const text = (draft.parts?.[key] ?? "").trim();
    return text ? [`## ${title}\n\n${text}`] : [];
  });
  const sources = draft.sources.filter((source) => source.trim());
  const list = sources.length ? `## Sources\n\n${sources.map((s) => `- ${s}`).join("\n")}` : "";
  return [draft.story.trim(), ...parts, list].filter(Boolean).join("\n\n");
}

function offerCopy(message: string, text: string) {
  toast.error(message, {
    duration: 60_000,
    action: { label: "Copy my text", onClick: () => void navigator.clipboard.writeText(text) },
  });
}

type Status = "idle" | "saving" | "saved" | "failed";

/**
 * Write: their story in the editor as before, then each of
 * the eleven parts, filled in only if wanted, then the Sources. It all saves on its own after
 * a pause in typing, into the one biography.md, and a change made outside the app since is
 * never overwritten unseen.
 */
export function StoryWrite({ person, opened }: { person: PersonDetail; opened: Biography }) {
  const save = useSaveBiography(person.id);
  const onDisk = useBiography(person.id).data;
  // What the editors open with; `round` changes to open them afresh (the file's version).
  const [start, setStart] = useState({ story: opened.story, parts: opened.parts ?? {}, round: 0 });
  const [plain, setPlain] = useState<string | null>(null); // the story as text, when shown so
  const [sources, setSources] = useState(() => toSources(opened.sources));
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState("");
  const [conflict, setConflict] = useState<Biography | null>(null);

  // Saving runs on these, not on state: typing must not wait for React.
  const draft = useRef({
    story: opened.story,
    parts: { ...(opened.parts ?? {}) } as Parts,
    sources: opened.sources,
  });
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

  const onPart = useCallback(
    (key: PartKey, markdown: string) => {
      draft.current.parts = { ...draft.current.parts, [key]: markdown };
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
    draft.current = { story: file.story, parts: { ...(file.parts ?? {}) }, sources: file.sources };
    base.current = file.version;
    known.current.add(file.version);
    savedEdits.current = edits.current;
    halted.current = false;
    setConflict(null);
    setFailure("");
    setStatus("idle");
    setSources(toSources(file.sources));
    setPlain(null);
    setStart((current) => ({
      story: file.story,
      parts: file.parts ?? {},
      round: current.round + 1,
    }));
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

  const showPlain = useCallback(() => setPlain(draft.current.story), []);

  return (
    <div className="space-y-6">
      <div className="flex min-h-6 items-center">
        <SaveStatus status={status} failure={failure} onRetry={() => void flush()} />
      </div>

      {conflict && (
        <ChangedOutside file={conflict} onKeepMine={keepMine} onUseFile={() => reopen(conflict)} />
      )}

      <section aria-labelledby="their-story" className="space-y-2">
        <h3 id="their-story" className="text-sm font-semibold text-stone-800">
          Their story
        </h3>
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
                    ...current,
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
      </section>

      <section aria-labelledby="their-parts" className="space-y-2">
        <h3 id="their-parts" className="text-sm font-semibold text-stone-800">
          The parts of their life
        </h3>
        <p className="text-xs text-stone-500">
          Fill in only those you want: an empty one doesn't show when it's read.
        </p>
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {PARTS.map((part) => (
            <PartWriter
              key={`${part.key}:${start.round}`}
              part={part}
              personId={person.id}
              markdown={start.parts[part.key] ?? ""}
              onChange={onPart}
            />
          ))}
        </div>
      </section>

      <SourcesList sources={sources} onChange={onSources} />
    </div>
  );
}

/** One part, open when it's filled in or chosen: its own editor for text, a list, or sayings. */
function PartWriter({
  part,
  personId,
  markdown,
  onChange,
}: {
  part: PartInfo;
  personId: string;
  markdown: string;
  onChange: (key: PartKey, markdown: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(markdown.trim()));
  const id = `part-${part.key}`;
  return (
    <section aria-labelledby={id} className="px-3 py-2">
      <button
        type="button"
        id={id}
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-stone-800"
      >
        <ChevronRightIcon
          className={`size-4 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {part.title}
      </button>
      {open && (
        <div className="life-story-part space-y-2 pt-2 pb-1 pl-5">
          <p className="text-xs text-stone-500">{part.hint}</p>
          {part.kind === "text" ? (
            <Suspense fallback={<Skeleton className="h-24 w-full" />}>
              <StoryEditor
                personId={personId}
                markdown={markdown}
                onChange={(text) => onChange(part.key, text)}
                onUnreadable={() => {}}
                part
              />
            </Suspense>
          ) : part.kind === "list" ? (
            <ItemsList
              title={part.title}
              items={listItems(markdown)}
              onChange={(items) => onChange(part.key, listMarkdown(items))}
            />
          ) : (
            <SayingsList
              sayings={sayingsOf(markdown)}
              onChange={(sayings) => onChange(part.key, sayingsMarkdown(sayings))}
            />
          )}
        </div>
      )}
    </section>
  );
}

let nextId = 0;
type Item = { id: number; text: string };
const toItems = (texts: string[]): Item[] => texts.map((text) => ({ id: nextId++, text }));

/** A list part, one a line: Enter adds the next, Backspace in an empty one takes it away. */
function ItemsList({
  title,
  items,
  onChange,
}: {
  title: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [rows, setRows] = useState(() => toItems(items));
  const fields = useRef(new Map<number, HTMLTextAreaElement>());
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    if (focus === null) return;
    fields.current.get(focus)?.focus();
    setFocus(null);
  }, [focus]);
  const change = (next: Item[]) => {
    setRows(next);
    onChange(next.map((row) => row.text));
  };
  const addAt = (index: number) => {
    const [added] = toItems([""]) as [Item];
    change([...rows.slice(0, index), added, ...rows.slice(index)]);
    setFocus(added.id);
  };
  const remove = (index: number) => {
    change(rows.filter((_, i) => i !== index));
    const neighbour = rows[index - 1] ?? rows[index + 1];
    if (neighbour) setFocus(neighbour.id);
  };
  return (
    <div className="space-y-1.5">
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-start gap-1">
          <span className="pt-1.5 text-stone-400">•</span>
          <GrowingText
            ref={(element) => {
              if (element) fields.current.set(row.id, element);
              else fields.current.delete(row.id);
            }}
            value={row.text}
            maxLength={1000}
            aria-label={`${title}: ${index + 1}`}
            onChange={(event) =>
              change(rows.map((r) => (r.id === row.id ? { ...r, text: event.target.value } : r)))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                addAt(index + 1);
              } else if (event.key === "Backspace" && row.text === "") {
                event.preventDefault();
                remove(index);
              }
            }}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Take out ${index + 1}`}
            onClick={() => remove(index)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => addAt(rows.length)}>
        <PlusIcon />
        Add one
      </Button>
    </div>
  );
}

type SayingRow = Saying & { id: number };

/** Sayings and quotes: each one, and when or to whom, if known. */
function SayingsList({
  sayings,
  onChange,
}: {
  sayings: Saying[];
  onChange: (sayings: Saying[]) => void;
}) {
  const [rows, setRows] = useState<SayingRow[]>(() =>
    sayings.map((saying) => ({ ...saying, id: nextId++ })),
  );
  const change = (next: SayingRow[]) => {
    setRows(next);
    onChange(next.map(({ text, note }) => ({ text, note })));
  };
  const update = (id: number, field: "text" | "note", value: string) =>
    change(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={row.id} className="flex items-start gap-1">
          <div className="min-w-0 flex-1 space-y-1">
            <GrowingText
              value={row.text}
              maxLength={1000}
              aria-label={`Saying ${index + 1}`}
              placeholder="What they used to say"
              onChange={(event) => update(row.id, "text", event.target.value)}
            />
            <Input
              value={row.note}
              maxLength={200}
              aria-label={`Saying ${index + 1}: when or to whom`}
              placeholder="When, or to whom (if known)"
              className="h-8 text-xs"
              onChange={(event) => update(row.id, "note", event.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Take out saying ${index + 1}`}
            onClick={() => change(rows.filter((r) => r.id !== row.id))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => change([...rows, { text: "", note: "", id: nextId++ }])}
      >
        <PlusIcon />
        Add a saying
      </Button>
    </div>
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
      className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
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
