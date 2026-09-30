import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BookOpenIcon,
  CircleHelpIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useKinshipLanguage } from "@/api/queries";
import type {
  KinExplanation,
  KinPerson,
  KinRelation,
  KinStatement,
  KinshipAnswer,
  KinshipLanguage,
} from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LANGUAGE_NAMES, LanguageSwitch } from "./LanguageSwitch";
import { ladderRows } from "./ladder";

type Props = {
  answer: KinshipAnswer | undefined;
  error: Error | null;
  shown: number; // which relation's path is lit on the tree
  onShow: (index: number) => void;
  onSwap: () => void;
  onPickAnother: () => void;
  onDone: () => void;
};

/** How two people are related, both ways round, in the side panel. */
export function RelationshipCard({
  answer,
  error,
  shown,
  onShow,
  onSwap,
  onPickAnother,
  onDone,
}: Props) {
  const people = new Map(answer?.people.map((person) => [person.id, person]));
  const [main, ...others] = answer?.relations ?? [];
  const lit = answer?.relations[shown] ?? main;
  const language = useKinshipLanguage();
  const [explaining, setExplaining] = useState(false);

  return (
    <aside aria-label="Relationship" className="flex h-full flex-col bg-white">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-3">
        <h2 className="text-base font-semibold">How are they related?</h2>
        <div className="flex items-center gap-1">
          <LanguageSwitch className="mr-1" />
          <Button variant="ghost" size="sm" onClick={onSwap} disabled={!answer}>
            <ArrowLeftRightIcon />
            Swap
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label="Close">
            <XIcon />
          </Button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {answer && (
          <div className="flex items-center gap-3">
            <Who person={people.get(answer.a)} />
            <ArrowRightIcon className="size-4 shrink-0 text-stone-400" />
            <Who person={people.get(answer.b)} />
          </div>
        )}

        {!answer && !error && (
          <div className="space-y-2">
            <Skeleton className="h-6 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        )}
        {error && <p className="text-stone-600">{error.message}</p>}
        {answer && !main && <p className="text-stone-700">{answer.message}</p>}

        {main && (
          <>
            <section className="space-y-1">
              <Said statement={main.forward} language={language} large />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {main.explanation && (
                  <button
                    type="button"
                    aria-expanded={explaining}
                    onClick={() => setExplaining((now) => !now)}
                    className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline"
                  >
                    <CircleHelpIcon className="size-3.5" />
                    What does this mean?
                  </button>
                )}
                {main.forward.entry && (
                  <Link
                    to={`/dictionary?row=${main.forward.entry}`}
                    state={{ back: true }}
                    className="inline-flex items-center gap-1 text-sm text-amber-700 hover:underline"
                  >
                    <BookOpenIcon className="size-3.5" />
                    See it in the dictionary
                  </Link>
                )}
              </div>
              {explaining && main.explanation && (
                <Explained relation={main} explanation={main.explanation} people={people} />
              )}
            </section>
            <section className="space-y-1">
              <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">
                The other way round
              </h3>
              <Said statement={main.reverse} language={language} />
            </section>
          </>
        )}

        {lit && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {lit.shared_ancestors.length > 0 && (
              <>
                <dt className="text-stone-500">Shared ancestors</dt>
                <dd>{lit.shared_ancestors.map((id) => people.get(id)?.name).join(" & ")}</dd>
              </>
            )}
            <dt className="text-stone-500">Path</dt>
            <dd>{lit.path.map((id) => people.get(id)?.name).join(" › ")}</dd>
          </dl>
        )}

        {others.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium tracking-wide text-stone-500 uppercase">
              Also related as…
            </h3>
            <ul className="space-y-1.5">
              {others.map((relation, position) => {
                const index = position + 1; // the closest relation is 0
                return (
                  <li key={relation.forward.sentence}>
                    <AlsoRelated
                      relation={relation}
                      language={language}
                      lit={index === shown}
                      onShow={() => onShow(index === shown ? 0 : index)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <footer className="flex gap-2 border-t border-stone-200 px-4 py-3">
        <Button onClick={onPickAnother}>Pick another person</Button>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </footer>
    </aside>
  );
}

function Who({ person }: { person: KinPerson | undefined }) {
  if (!person) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <PersonAvatar person={person} size="sm" />
      <span className="truncate font-medium">{person.name}</span>
    </div>
  );
}

type SaidProps = { statement: KinStatement; language: KinshipLanguage; large?: boolean };

/** "Siti is Ali's mak su", the kinship word in the chosen language and the sentence in
 *  English, with the English meaning underneath. */
function Said({ statement, language, large = false }: SaidProps) {
  const said = statement.words?.[language];
  return (
    <>
      <p className={cn(large ? "text-lg leading-snug font-semibold" : "text-stone-800")}>
        <Sentence statement={statement} language={language} />
      </p>
      <Meaning
        statement={statement}
        language={language}
        className="text-sm text-stone-600"
        missing={said?.english === true}
      />
    </>
  );
}

function Sentence({ statement, language }: { statement: KinStatement; language: KinshipLanguage }) {
  const said = statement.words?.[language];
  if (!said || language === "en" || said.english || !said.sentence.endsWith(said.term)) {
    return <>{said?.sentence ?? statement.sentence}</>;
  }
  return (
    <>
      {said.sentence.slice(0, said.sentence.length - said.term.length)}
      <span lang={language} className="text-amber-800">
        {said.term}
      </span>
    </>
  );
}

/** Under an English answer, why: "(her father's elder brother)". Under a Malay or Javanese
 *  one, the English word and why: "uncle: her father's elder brother". */
function Meaning({
  statement,
  language,
  className,
  missing = false,
}: {
  statement: KinStatement;
  language: KinshipLanguage;
  className?: string;
  missing?: boolean;
}) {
  if (language === "en") {
    return statement.detail ? <p className={className}>({statement.detail})</p> : null;
  }
  if (missing) {
    return (
      <p className={className}>
        No {LANGUAGE_NAMES[language]} word for this: the English one is shown.
        {statement.detail && ` (${statement.detail})`}
      </p>
    );
  }
  return (
    <p className={className}>
      {statement.detail ? `${statement.term}: ${statement.detail}` : statement.term}
    </p>
  );
}

/** Someone on the ladder; the two people asked about stand out. */
function Rung({ label, own }: { label: string | null; own: boolean }) {
  if (!label) return <span />;
  return (
    <span className="flex flex-col items-center">
      <span aria-hidden="true" className="h-3 w-px bg-stone-300" />
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-center text-xs",
          own
            ? "border-sky-300 bg-sky-50 font-semibold text-sky-900"
            : "border-stone-200 bg-white text-stone-700",
        )}
      >
        {label}
      </span>
    </span>
  );
}

/** "What does this mean?": the answer told with the people, in English, and
 *  for blood relatives a ladder of generations down from the shared ancestors. */
function Explained({
  relation,
  explanation,
  people,
}: {
  relation: KinRelation;
  explanation: KinExplanation;
  people: Map<string, KinPerson>;
}) {
  const name = (id: string | null) => (id ? (people.get(id)?.name ?? "?") : null);
  const ends = new Set([relation.path[0], relation.path.at(-1)]);
  const top = explanation.top;
  const rows = top != null ? ladderRows(relation.path, top, explanation.removed ?? null) : [];
  const shared = relation.shared_ancestors.map((id) => name(id)).join(" & ");
  const rung = (id: string | null) => <Rung label={name(id)} own={id !== null && ends.has(id)} />;

  return (
    <div className="mt-2 space-y-3 rounded-lg border border-sky-100 bg-sky-50/40 p-3 text-sm">
      {explanation.sentences.map((sentence) => (
        <p key={sentence} className="text-stone-800">
          {sentence}
        </p>
      ))}
      {rows.length > 0 && (
        <figure aria-label="Both lines down from the shared ancestors" className="space-y-0">
          <div className="flex flex-col items-center">
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-center text-xs font-medium text-amber-900">
              {shared || name(relation.path[top ?? 0] ?? null)}
            </span>
            <span className="text-[11px] text-stone-500">the shared ancestors</span>
          </div>
          {rows.map((row) => (
            <div
              key={`${row.left ?? "-"}:${row.right ?? "-"}`} // everyone on a path is there once
              className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"
            >
              {rung(row.left)}
              <span className="pb-0.5 text-center text-[11px] whitespace-nowrap text-stone-500">
                {row.pair && explanation.pair ? `— ${explanation.pair} —` : ""}
              </span>
              <span className="flex flex-col items-center">
                {rung(row.right)}
                {row.note && (
                  <span className="text-center text-[11px] text-stone-500">{row.note}</span>
                )}
              </span>
            </div>
          ))}
        </figure>
      )}
      {explanation.rule && <p className="text-xs text-stone-600">{explanation.rule}</p>}
    </div>
  );
}

function AlsoRelated({
  relation,
  language,
  lit,
  onShow,
}: {
  relation: KinRelation;
  language: KinshipLanguage;
  lit: boolean;
  onShow: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onShow}
      className={cn(
        "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
        lit ? "border-amber-400 bg-amber-50" : "border-stone-200 hover:bg-stone-50",
      )}
    >
      <span className="block text-stone-800">
        <Sentence statement={relation.forward} language={language} />
      </span>
      <Meaning
        statement={relation.forward}
        language={language}
        className="block text-stone-500"
        missing={relation.forward.words?.[language]?.english === true}
      />
      <span className="mt-0.5 block text-xs text-amber-700">
        {lit ? "Its path is lit on the tree" : "Show this path on the tree"}
      </span>
    </button>
  );
}
