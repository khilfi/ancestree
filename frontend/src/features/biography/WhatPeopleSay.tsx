import { MessageSquarePlusIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSaid } from "@/api/queries";
import type { PersonDetail, Said } from "@/api/types";
import { useWordsHere } from "@/app/copy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showError } from "@/lib/notify";

/** "14 October 2026", from the date the engine keeps. */
export function saidOn(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Who said it, and when: "Zulkifli bin Hassan, 14 October 2026 (changed 16 October 2026)";
 *  written on another computer, its name too, "Nor binti Hassan (Nor's laptop), …", so no
 *  computer passes its words off as someone else's (0.8.0). */
export function saidBy(said: Said): string {
  let by = said.writer || "Someone";
  if (said.computer) by += ` (${said.computer})`;
  if (said.written) by += `, ${saidOn(said.written)}`;
  if (said.written && said.changed && said.changed !== said.written) {
    by += ` (changed ${saidOn(said.changed)})`;
  }
  return by;
}

/** Their words a paragraph at a time, as a blank line between them meant, each with its own
 *  line breaks. */
function paragraphs(text: string): { id: string; text: string }[] {
  return text.split(/\n\s*\n/).map((each, at) => ({ id: `${at}`, text: each }));
}

/**
 * What people say about them, on the life story's page:
 * each person's own words, with who wrote them and when. Anyone in the family writes their own,
 * a viewer too, signed with their Me, or their computer's name if they haven't chosen one. Only
 * the computer they were written on changes them or takes them back, and the keeper may take
 * any out. In a copy, and printed, they're only read.
 */
export function WhatPeopleSay({ person, said }: { person: PersonDetail; said: Said[] }) {
  const here = useWordsHere();
  const { add } = useSaid(person.id);
  const [writing, setWriting] = useState(false);
  if (said.length === 0 && !here.write) return null;
  return (
    <section aria-labelledby="what-people-say" className="life-story-card space-y-4">
      <h2 id="what-people-say" className="font-serif text-xl font-semibold">
        What people say about {person.full_name}
      </h2>
      {said.length === 0 && (
        <p className="life-story-tools text-sm text-stone-500">
          No one has written about them yet. Add what you remember of them, in your own words.
        </p>
      )}
      {said.length > 0 && (
        <ul className="space-y-5">
          {said.map((words) => (
            <li key={words.id}>
              <SaidWords
                person={person.id}
                said={words}
                mine={here.write && words.yours}
                takeOut={here.takeOut}
              />
            </li>
          ))}
        </ul>
      )}
      {here.write &&
        (writing ? (
          <WordsForm
            label={`Your words about ${person.full_name}`}
            saving={add.isPending}
            onSave={(text) =>
              add.mutate(text, { onSuccess: () => setWriting(false), onError: showError })
            }
            onCancel={() => setWriting(false)}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="life-story-tools"
            onClick={() => setWriting(true)}
          >
            <MessageSquarePlusIcon />
            Add your words
          </Button>
        ))}
    </section>
  );
}

/** One person's words: a quote, who said it and when; and, for their own computer, Change
 *  and Take back; for the keeper's, Take out. Taking them away asks first. */
function SaidWords({
  person,
  said,
  mine,
  takeOut,
}: {
  person: string;
  said: Said;
  mine: boolean;
  takeOut: boolean;
}) {
  const { change, takeOut: takingOut } = useSaid(person);
  const [changing, setChanging] = useState(false);
  const [asking, setAsking] = useState(false);
  const away = mine ? "Take back" : "Take out";
  if (changing) {
    return (
      <WordsForm
        label="Your words"
        initial={said.text}
        saving={change.isPending}
        onSave={(text) =>
          change.mutate(
            { said: said.id, text },
            { onSuccess: () => setChanging(false), onError: showError },
          )
        }
        onCancel={() => setChanging(false)}
      />
    );
  }
  return (
    <figure className="border-l-4 border-sky-300 pl-4">
      <blockquote className="space-y-2 font-serif text-lg leading-relaxed text-stone-900">
        {paragraphs(said.text).map((paragraph) => (
          <p key={paragraph.id} className="whitespace-pre-line">
            {paragraph.text}
          </p>
        ))}
      </blockquote>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-500">
        <span>— {saidBy(said)}</span>
        {(mine || takeOut) && !asking && (
          <span className="life-story-tools flex gap-1">
            {mine && (
              <Button variant="ghost" size="xs" onClick={() => setChanging(true)}>
                Change
              </Button>
            )}
            <Button variant="ghost" size="xs" onClick={() => setAsking(true)}>
              {away}
            </Button>
          </span>
        )}
        {asking && (
          <span className="life-story-tools flex items-center gap-1 text-stone-700">
            {mine ? "Take back your words?" : `Take out ${said.writer || "their"}'s words?`}
            <Button
              variant="destructive"
              size="xs"
              disabled={takingOut.isPending}
              onClick={() => takingOut.mutate(said.id, { onError: showError })}
            >
              {away}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setAsking(false)}>
              Keep them
            </Button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Writing or changing your words: a line or more, Enter for the next line. */
function WordsForm({
  label,
  initial = "",
  saving,
  onSave,
  onCancel,
}: {
  label: string;
  initial?: string;
  saving: boolean;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) onSave(text);
  };
  return (
    <form onSubmit={submit} className="life-story-tools space-y-2">
      <Textarea
        aria-label={label}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What you remember of them: a story, how they were, what they meant to you."
        maxLength={20_000}
        autoFocus
      />
      <p className="text-xs text-stone-500">
        Signed with your name under <strong>Me</strong>, or this computer's name if you haven't
        chosen yourself there, and today's date. On a relative's computer, they go to the family's
        keeper first.
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving || !text.trim()}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
