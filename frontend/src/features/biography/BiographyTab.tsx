import { BookOpenIcon, MessageSquarePlusIcon, PencilIcon } from "lucide-react";
import { useBiography } from "@/api/queries";
import type { PersonDetail } from "@/api/types";
import { useCanEdit, useCopy, useWordsHere } from "@/app/copy";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { openLifeStory } from "@/lib/lifeStory";
import { filled, hasStory } from "./parts";

const FIRST = 420; // characters of the story the panel shows

/**
 * The story's opening, as plain words: its Markdown's marks and pictures left out, and its
 * headings, which would run into the sentence after them.
 */
export function opening(markdown: string): string {
  const words = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s.*$/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)]|>)\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return words.length > FIRST ? `${words.slice(0, FIRST).replace(/\s+\S*$/, "")}…` : words;
}

/**
 * The Biography tab: a preview of the life story, its opening and which of its
 * parts are filled in, with **Read** and **Write**, which open it large, over everything.
 */
export function BiographyTab({ person }: { person: PersonDetail }) {
  const canEdit = useCanEdit();
  const here = useWordsHere();
  const copy = useCopy();
  const story = useBiography(person.placeholder ? null : person.id);
  if (person.placeholder) {
    return (
      <p className="px-4 pt-3 text-sm text-stone-500">
        {canEdit
          ? "An unknown parent has no story yet. Fill them in first."
          : "An unknown parent has no story."}
      </p>
    );
  }
  if (story.isError)
    return <p className="px-4 pt-3 text-sm text-stone-600">{story.error.message}</p>;
  if (!story.data) {
    return (
      <div className="space-y-3 px-4 pt-3">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-10/12" />
        <Skeleton className="h-4 w-8/12" />
      </div>
    );
  }
  const told = hasStory(story.data);
  const parts = filled(story.data.parts).map((part) => part.title);
  const said = story.data.said?.length ?? 0;
  if (said > 0) parts.push(said === 1 ? "What 1 person says" : `What ${said} people say`);
  const hidden = copy?.hidden_living && person.is_living !== false;
  return (
    <div className="space-y-4 overflow-y-auto px-4 pt-3 pb-8">
      {told ? (
        <>
          {story.data.story.trim() && (
            <p className="font-serif text-base leading-relaxed text-stone-800">
              {opening(story.data.story)}
            </p>
          )}
          {parts.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                Also written
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {parts.map((title) => (
                  <li
                    key={title}
                    className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs text-amber-900"
                  >
                    {title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-stone-500">
          {hidden
            ? "Living people's stories aren't in this copy."
            : canEdit
              ? "No story written yet: their life, in their own parts, from early life to the sayings they're remembered by."
              : "No story written yet."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {told && (
          <Button onClick={() => openLifeStory(person.id, "read")}>
            <BookOpenIcon />
            Read
          </Button>
        )}
        {canEdit && (
          <Button
            variant={told ? "outline" : "default"}
            onClick={() => openLifeStory(person.id, "write")}
          >
            <PencilIcon />
            Write
          </Button>
        )}
        {!told && !canEdit && here.write && (
          <Button onClick={() => openLifeStory(person.id, "read")}>
            <MessageSquarePlusIcon />
            Add your words
          </Button>
        )}
      </div>
    </div>
  );
}
