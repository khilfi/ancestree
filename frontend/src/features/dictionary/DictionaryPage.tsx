import { ArrowLeftIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useKinshipDictionary, useKinshipLanguage } from "@/api/queries";
import type { DictionaryRow, DictionaryWord, KinshipLanguage } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  KINSHIP_LANGUAGES,
  LANGUAGE_NAMES,
  LanguageSwitch,
} from "@/features/kinship/LanguageSwitch";
import { cn } from "@/lib/utils";
import { columnOrder, rowMatches } from "./search";

/** The Kinship dictionary: every kinship word in English, Malay and Javanese,
 *  to read and understand. Read only; the words come from the answers' own word lists. */
export function DictionaryPage() {
  const dictionary = useKinshipDictionary();
  const chosen = useKinshipLanguage();
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<KinshipLanguage[]>([...KINSHIP_LANGUAGES]);
  const [params] = useSearchParams();
  const target = params.get("row"); // from an answer's "See it in the dictionary"
  const location = useLocation();
  const navigate = useNavigate();
  const columns = columnOrder(chosen, shown);

  const sections = useMemo(
    () =>
      (dictionary.data?.sections ?? [])
        .map((section) => ({
          ...section,
          rows: section.rows.filter((row) => rowMatches(row, query, columns)),
        }))
        .filter((section) => section.rows.length > 0),
    [dictionary.data, query, columns],
  );

  useEffect(() => {
    if (target && dictionary.data) {
      document.getElementById(`row-${target}`)?.scrollIntoView({ block: "center" });
    }
  }, [target, dictionary.data]);

  function toggle(code: KinshipLanguage) {
    setShown((now) =>
      now.includes(code) ? (now.length > 1 ? now.filter((c) => c !== code) : now) : [...now, code],
    );
  }

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Kinship dictionary</h1>
            <p className="max-w-3xl text-sm text-stone-500">
              Every word AncesTree uses for a relative, in English, Bahasa Melayu and Basa Jawa. The
              answers use the word in bold; below it are other words people say.
            </p>
          </div>
          {location.state?.back && (
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeftIcon />
              Back to the answer
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-stone-400" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search words or relations…"
              aria-label="Search the dictionary"
              className="pl-8"
            />
          </div>
          <fieldset aria-label="Languages shown" className="flex items-center gap-1.5 text-sm">
            <span className="text-stone-500">Show</span>
            {KINSHIP_LANGUAGES.map((code) => (
              <button
                key={code}
                type="button"
                aria-pressed={shown.includes(code)}
                onClick={() => toggle(code)}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
                  shown.includes(code)
                    ? "border-stone-300 bg-white text-stone-900"
                    : "border-transparent text-stone-400 hover:text-stone-700",
                )}
              >
                {LANGUAGE_NAMES[code]}
              </button>
            ))}
          </fieldset>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-stone-500">Answers in</span>
            <LanguageSwitch />
          </div>
        </div>

        <Guide />

        {dictionary.isPending && <p className="text-sm text-stone-500">Loading…</p>}
        {dictionary.isError && <p className="text-sm text-red-600">{dictionary.error.message}</p>}
        {dictionary.data && sections.length === 0 && (
          <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            No word or relation matches “{query}”.
          </p>
        )}

        {sections.map((section) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`} className="space-y-2">
            <h2 id={`section-${section.id}`} className="font-semibold">
              {section.title}
            </h2>
            {/* On a phone, a card for each relation instead of columns. */}
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full text-sm max-md:block md:min-w-[40rem]">
                <thead className="max-md:hidden">
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th scope="col" className="w-1/4 px-3 py-2 font-medium">
                      Relation
                    </th>
                    {columns.map((code) => (
                      <th key={code} scope="col" className="px-3 py-2 font-medium">
                        {LANGUAGE_NAMES[code]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 max-md:block">
                  {section.rows.map((row) => (
                    <Row key={row.id} row={row} columns={columns} lit={row.id === target} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Row({
  row,
  columns,
  lit,
}: {
  row: DictionaryRow;
  columns: KinshipLanguage[];
  lit: boolean;
}) {
  return (
    <tr
      id={`row-${row.id}`}
      className={cn("align-top max-md:block max-md:px-3 max-md:py-2.5", lit && "bg-amber-50")}
    >
      <th
        scope="row"
        className="px-3 py-2 text-left font-normal text-stone-700 max-md:block max-md:px-0 max-md:pt-0 max-md:pb-1 max-md:font-medium max-md:text-stone-900"
      >
        {row.relation}
      </th>
      {columns.map((code) => (
        <td key={code} className="px-3 py-2 max-md:flex max-md:gap-3 max-md:px-0 max-md:py-1">
          <span className="w-24 shrink-0 pt-px text-xs text-stone-500 md:hidden">
            {LANGUAGE_NAMES[code]}
          </span>
          <Word word={row.words[code]} language={code} />
        </td>
      ))}
    </tr>
  );
}

function Word({ word, language }: { word: DictionaryWord | undefined; language: KinshipLanguage }) {
  if (!word?.word) {
    return (
      <div className="space-y-0.5">
        <span className="text-stone-400" title="No word for this">
          —
        </span>
        {word?.note && <p className="text-xs text-stone-500 italic">{word.note}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      <p>
        <span lang={language} className="font-semibold text-stone-900">
          {word.word}
        </span>
        {word.descr && (
          <span
            className="ml-1 text-xs text-stone-500"
            title="A description, not a word of its own"
          >
            (descr.)
          </span>
        )}
      </p>
      {(word.also ?? []).length > 0 && (
        <p lang={language} className="text-xs text-stone-600">
          {(word.also ?? []).join(" · ")}
        </p>
      )}
      {(word.krama || word.krama_inggil) && (
        <p className="text-xs text-stone-600">
          {word.krama && (
            <>
              krama <span lang="jv">{word.krama}</span>
            </>
          )}
          {word.krama && word.krama_inggil && " · "}
          {word.krama_inggil && (
            <>
              krama inggil <span lang="jv">{word.krama_inggil}</span>
            </>
          )}
        </p>
      )}
      {(word.address ?? []).length > 0 && (
        <p className="text-xs text-stone-500">
          Address: <span lang={language}>{(word.address ?? []).join(", ")}</span>
        </p>
      )}
      {word.note && <p className="text-xs text-stone-500 italic">{word.note}</p>}
    </div>
  );
}

/** How the three languages see family, and how to read the tables. */
function Guide() {
  return (
    <details className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">
        How the three languages see family, and how to read this
      </summary>
      <div className="mt-3 grid gap-4 text-stone-700 md:grid-cols-2">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>English</strong> names a relative by line and distance: <em>grand-</em>,{" "}
            <em>great-</em>, and cousins by degree and “removed”. Being older or younger never
            changes the word.
          </li>
          <li>
            <strong>Bahasa Melayu</strong> puts age into the word (<em lang="ms">abang</em>,{" "}
            <em lang="ms">kakak</em>, <em lang="ms">adik</em>) and names each generation. Uncles and
            aunts are called by their own place among their brothers and sisters: Pak Long, Mak Ngah
            … Pak Su.
          </li>
          <li>
            <strong>Basa Jawa</strong> ranks every line as older or younger: your parent's older
            brother is <em lang="jv">pakdhé</em>, the younger one <em lang="jv">paklik</em>, and
            their children are <em lang="jv">mas</em> or <em lang="jv">dhik</em> to you whatever
            their age. It names 18 generations, up and down.
          </li>
        </ul>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Bold</strong> is the word the answers use; under it are formal, everyday, older
            and regional words. <strong>Address</strong> is what you call them to their face.
          </li>
          <li>
            Javanese has three speech levels: <em>ngoko</em> (plain, used in the answers),{" "}
            <em>krama</em> (polite) and <em>krama inggil</em> (honorific, for elders).
          </li>
          <li>
            <strong>(descr.)</strong> marks a description: the language has no word of its own, so
            it says the relation in pieces.
          </li>
          <li>
            Words differ by region and family. Your Malay birth-order titles are set in Settings →
            Kinship words. Sources include Kamus Dewan, S. O. Robson's study of Javanese kinship
            (1987) and Bausastra Jawa.
          </li>
        </ul>
      </div>
    </details>
  );
}
