import { BookOpenIcon, PencilIcon, PrinterIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useState } from "react";
import { displayPhotoAddress } from "@/api/addresses";
import { useBiography, useKinds, usePerson } from "@/api/queries";
import type { Biography, KindView, PersonDetail, PersonSummary, Relative } from "@/api/types";
import { useCanEdit, useCopy } from "@/app/copy";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { closeLifeStory, openLifeStory, type StoryMode, useLifeStoryAsked } from "@/lib/lifeStory";
import { formatPlace } from "@/lib/people";
import { cn } from "@/lib/utils";
import { filled, hasStory, listItems, type PartInfo, sayingsOf } from "./parts";
import { StoryWrite, useOpenedStory } from "./StoryWrite";
import { WhatPeopleSay } from "./WhatPeopleSay";

// The editor shows the story and its text parts as they're written: it loads when first needed.
const StoryEditor = lazy(() =>
  import("./StoryEditor").then((module) => ({ default: module.StoryEditor })),
);

/** Where a life story opens: once in the app and in a view-only copy, over everything. */
export function LifeStoryHost() {
  const asked = useLifeStoryAsked();
  if (!asked) return null;
  return <LifeStoryWindow key={asked.person} personId={asked.person} mode={asked.mode} />;
}

/**
 * A life story's window: large and centred over everything,
 * with **Read**, the page laid out on its own, and **Write**, the story and its parts. It opens
 * on Read where there's a story, and on Write where there isn't one yet. Esc closes it.
 */
function LifeStoryWindow({ personId, mode }: { personId: string; mode: StoryMode | null }) {
  const person = usePerson(personId);
  const opened = useOpenedStory(personId);
  const live = useBiography(personId).data;
  const canEdit = useCanEdit();
  const [chosen, setChosen] = useState<StoryMode | null>(mode);
  const story = opened.story;
  // Read shows the story as it's saved now: what was just written, or words just added.
  const shown = story && live ? live : story;
  const view: StoryMode =
    !canEdit || person.data?.placeholder
      ? "read"
      : (chosen ?? (story && !hasStory(story) ? "write" : "read"));
  const name = person.data?.full_name ?? "";
  return (
    <Dialog open onOpenChange={(open) => !open && closeLifeStory()}>
      <DialogContent
        className="life-story-print flex h-[92vh] max-h-[92vh] flex-col gap-0 p-0 sm:max-w-5xl"
        aria-describedby="life-story-about"
      >
        <DialogHeader className="life-story-chrome flex-row items-center gap-3 border-b border-border py-3 pr-14 pl-5">
          <DialogTitle className="truncate">
            {name ? `${name}: life story` : "Life story"}
          </DialogTitle>
          <DialogDescription id="life-story-about" className="sr-only">
            {view === "read" ? "Their life story, to read." : "Their life story, to write."}
          </DialogDescription>
          {canEdit && !person.data?.placeholder && (
            <fieldset className="ml-auto flex rounded-lg border-0 bg-muted p-0.5">
              <legend className="sr-only">Read or write</legend>
              <ModeButton active={view === "read"} onClick={() => setChosen("read")}>
                <BookOpenIcon />
                Read
              </ModeButton>
              <ModeButton active={view === "write"} onClick={() => setChosen("write")}>
                <PencilIcon />
                Write
              </ModeButton>
            </fieldset>
          )}
          {view === "read" && shown && hasStory(shown) && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(!canEdit && "ml-auto")}
              onClick={() => window.print()}
            >
              <PrinterIcon />
              Print
            </Button>
          )}
        </DialogHeader>
        <div className="life-story-scroll min-h-0 flex-1 overflow-y-auto">
          {person.isError || opened.error ? (
            <p className="p-6 text-sm text-muted-foreground">
              {(person.error ?? opened.error)?.message}
            </p>
          ) : !person.data || !story ? (
            <div className="space-y-3 p-6">
              <Skeleton className="size-32 rounded-full" />
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : view === "read" ? (
            <StoryPage person={person.data} story={shown ?? story} />
          ) : (
            <div className="mx-auto max-w-3xl px-6 py-5">
              <Writing person={person.data} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Write, from the file as it's saved when it opens: after Read, where something may have been
 *  written or words added since, its draft starts from what's there now. */
function Writing({ person }: { person: PersonDetail }) {
  const opened = useOpenedStory(person.id);
  if (opened.error) return <p className="text-sm text-muted-foreground">{opened.error.message}</p>;
  if (!opened.story) return <Skeleton className="h-48 w-full" />;
  return <StoryWrite person={person} opened={opened.story} />;
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm [&_svg]:size-4",
        active ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}

type Moment = { text: string; year: number | null };

/** "a daughter", "an adopted son": the child, in English, as the life story is written. */
function whichChild(child: Relative, kinds: KindView[] | undefined): string {
  const kind = kinds?.find((each) => each.key === (child.kind ?? "biological"));
  let word: string;
  if (!kind || kind.blood) {
    word = { male: "son", female: "daughter", unknown: "child" }[child.gender];
  } else {
    const label = kind.child_label;
    word = (child.gender !== "unknown" && label[child.gender]) || label.neutral;
  }
  word = word.charAt(0).toLowerCase() + word.slice(1);
  return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word}`;
}

/** "Born 14 March 1938 in Kota Bharu, Kelantan": when and where, whichever is known. */
function event(verb: string, when: string | undefined, where: string): string {
  return [verb, when, where && `in ${where}`].filter(Boolean).join(" ");
}

/** The line of their life, from what's known, each a sentence: born, married, their
 *  children born, died. "Aminah binti Hassan, a daughter, born 1962". Moves aren't dated
 *  anywhere yet, so they aren't on it. */
export function lifeLine(person: PersonDetail, kinds?: KindView[]): Moment[] {
  const children = person.child_groups.flatMap((group) => group.children);
  const born: Moment[] =
    person.birth_date || person.birth_place
      ? [
          {
            text: event("Born", person.birth_date?.description, formatPlace(person.birth_place)),
            year: person.birth_date?.value.year ?? null,
          },
        ]
      : [];
  const married: Moment[] = person.spouses.map((spouse) => ({
    text: `Married ${spouse.full_name}${spouse.status === "divorced" ? ", later divorced" : ""}`,
    year: null,
  }));
  const had: Moment[] = children
    .filter((child) => child.birth_year != null)
    .sort((a, b) => (a.birth_year ?? 0) - (b.birth_year ?? 0))
    .map((child) => ({
      text: `${child.full_name}, ${whichChild(child, kinds)}, born ${child.birth_year}`,
      year: child.birth_year,
    }));
  const died: Moment[] = person.death_date
    ? [
        {
          text: event("Died", person.death_date.description, formatPlace(person.death_place)),
          year: person.death_date.value.year ?? null,
        },
      ]
    : [];
  return [...born, ...married, ...had, ...died];
}

/**
 * Read: a page laid out on its own. The photo, large, with their name, dates and
 * places; the line of their life beside; their story, then each part filled in as a card, the
 * sayings as quotes and the message to the next generations framed; their family, each a click
 * away; what people say about them; and the Sources. It prints, on its own, and saves as a
 * PDF from the print window.
 */
export function StoryPage({ person, story }: { person: PersonDetail; story: Biography }) {
  const copy = useCopy();
  const [plain, setPlain] = useState(false);
  const showPlain = useCallback(() => setPlain(true), []);
  const parts = filled(story.parts);
  const sources = story.sources.filter((source) => source.trim());
  const line = lifeLine(person, useKinds().data);
  const family = [
    ...person.parents,
    ...person.spouses,
    ...person.child_groups.flatMap((group) => group.children),
  ].filter((relative) => !relative.placeholder);
  const lives = formatPlace(person.residence, person.residence_district);
  const nothing = !hasStory(story);
  const hidden = copy?.hidden_living && person.is_living !== false;

  return (
    <article className="life-story-page mx-auto max-w-4xl space-y-8 px-6 py-8 text-foreground">
      <header className="grid gap-6 sm:grid-cols-[auto_1fr]">
        {person.photo_version != null ? (
          <img
            src={displayPhotoAddress(person.id, person.photo_version)}
            alt={person.full_name}
            className="size-44 rounded-2xl object-cover shadow-md ring-1 ring-border"
          />
        ) : (
          <PersonAvatar person={person} size="lg" className="size-44 text-5xl" />
        )}
        <div className="space-y-2">
          <h1 className="font-serif text-3xl leading-tight font-semibold">
            {person.title ? `${person.title} ${person.full_name}` : person.full_name}
          </h1>
          {(person.nickname || person.name_jawi) && (
            <p className="text-lg text-muted-foreground">
              {person.nickname && `“${person.nickname}”`}
              {person.nickname && person.name_jawi && " · "}
              {person.name_jawi && (
                <span dir="rtl" lang="ms-Arab">
                  {person.name_jawi}
                </span>
              )}
            </p>
          )}
          {lives && (
            <p className="text-sm text-muted-foreground">
              {/* As their details say it: where they lived, once they've died. */}
              {person.is_living === false ? "Lived in" : "Lives in"} {lives}
            </p>
          )}
          {line.length > 0 && (
            <ol
              className="mt-3 space-y-1 border-l-2 border-story-accent pl-4 text-sm"
              aria-label="Their life"
            >
              {line.map((moment) => (
                <li key={moment.text}>{moment.text}</li>
              ))}
            </ol>
          )}
        </div>
      </header>

      {nothing && (
        <p className="text-sm text-faint">
          {hidden ? "Living people's stories aren't in this copy." : "No story written yet."}
        </p>
      )}

      {story.story.trim() && (
        <section aria-label="Their story" className="life-story-card">
          {plain ? (
            <pre className="font-sans text-base whitespace-pre-wrap">{story.story}</pre>
          ) : (
            <Suspense fallback={<Skeleton className="h-48 w-full" />}>
              <StoryEditor
                personId={person.id}
                markdown={story.story}
                onChange={() => {}}
                onUnreadable={showPlain}
                readOnly
              />
            </Suspense>
          )}
        </section>
      )}

      {parts.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {parts.map((part) => (
            <PartCard
              key={part.key}
              part={part}
              personId={person.id}
              markdown={story.parts?.[part.key] ?? ""}
            />
          ))}
        </div>
      )}

      {family.length > 0 && (
        <section aria-labelledby="their-family" className="life-story-card space-y-3">
          <h2 id="their-family" className="font-serif text-xl font-semibold">
            Their family
          </h2>
          <ul className="flex flex-wrap gap-2">
            {family.map((relative) => (
              <li key={`${relative.id}|${relative.label}`}>
                <FamilyChip relative={relative} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hidden && <WhatPeopleSay person={person} said={story.said ?? []} />}

      {sources.length > 0 && (
        <section aria-labelledby="their-sources" className="life-story-card space-y-1">
          <h2
            id="their-sources"
            className="text-xs font-semibold tracking-wide text-faint uppercase"
          >
            Sources
          </h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-foreground">
            {sources.map((source) => (
              <li key={source}>{source}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** A part as the page shows it: a list as a list, sayings as quotes, the message framed. */
function PartCard({
  part,
  personId,
  markdown,
}: {
  part: PartInfo;
  personId: string;
  markdown: string;
}) {
  const wide = part.kind === "sayings" || part.key === "message" || part.kind === "text";
  return (
    <section
      aria-label={part.title}
      className={cn(
        "life-story-card space-y-3 rounded-2xl p-5",
        wide && "sm:col-span-2",
        part.key === "message"
          ? "border-2 border-double border-story-accent bg-story-soft/60"
          : "bg-muted/50 ring-1 ring-border",
      )}
    >
      <h2 className="font-serif text-xl font-semibold">{part.title}</h2>
      {part.kind === "list" ? (
        <ul className="list-disc space-y-1 pl-5">
          {listItems(markdown).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : part.kind === "sayings" ? (
        <div className="space-y-4">
          {sayingsOf(markdown).map((saying) => (
            <figure
              key={`${saying.text}|${saying.note}`}
              className="border-l-4 border-story-accent pl-4"
            >
              <blockquote className="font-serif text-2xl leading-snug text-foreground">
                “{saying.text}”
              </blockquote>
              {saying.note && (
                <figcaption className="mt-1 text-sm text-faint">{saying.note}</figcaption>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <Suspense fallback={<Skeleton className="h-24 w-full" />}>
          <StoryEditor
            personId={personId}
            markdown={markdown}
            onChange={() => {}}
            onUnreadable={() => {}}
            readOnly
          />
        </Suspense>
      )}
    </section>
  );
}

/** A relative on the page: a click opens their life story. */
function FamilyChip({ relative }: { relative: PersonSummary & { label: string } }) {
  return (
    <button
      type="button"
      onClick={() => openLifeStory(relative.id)}
      className="flex items-center gap-2 rounded-full bg-muted py-1 pr-3 pl-1 text-left text-sm hover:bg-border"
    >
      <PersonAvatar person={relative} size="sm" />
      <span>
        <span className="block leading-tight font-medium">{relative.full_name}</span>
        <span className="block text-xs leading-tight text-faint">{relative.label}</span>
      </span>
    </button>
  );
}
