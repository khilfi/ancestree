import { PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useFamilyFolder } from "@/api/familyFolder";
import { useKinshipSettings, useSaveKinshipSettings } from "@/api/queries";
import type { KinshipSettings } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError } from "@/lib/notify";

const DEFAULT_TITLES = ["long", "ngah", "lang"];
const DEFAULT_YOUNGEST = "su";
const MOST_PLACES = 12;
const ORDINALS = ["1st", "2nd", "3rd"];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/** Titles as saved: trimmed, lower case, without empty places at the end. */
function tidy(titles: string[]): string[] {
  const kept = titles.map((title) => title.trim().toLowerCase());
  while (kept.length > 0 && !kept[kept.length - 1]) kept.pop();
  return kept;
}

/** Settings → Kinship → Malay birth-order titles: the family's titles for uncles and
 *  aunts. The words' language is set where it's seen, in the relationship finder's
 *  answer and the dictionary. On a relative's computer the titles are the
 *  family's, set by the keeper: shown, not changed (0.3.1). */
export function KinshipSection() {
  const settings = useKinshipSettings();
  const save = useSaveKinshipSettings();
  const keepers = useFamilyFolder().data?.setup === "member";
  const [titles, setTitles] = useState<string[]>([]);
  const [youngest, setYoungest] = useState("");

  const saved = settings.data;
  useEffect(() => {
    if (saved) {
      setTitles(saved.titles?.length ? saved.titles : [""]);
      setYoungest(saved.youngest);
    }
  }, [saved]);

  function store(next: KinshipSettings, done: string) {
    save.mutate(next, { onSuccess: () => toast.success(done), onError: showError });
  }

  const changed =
    saved !== undefined &&
    (JSON.stringify(tidy(titles)) !== JSON.stringify(saved.titles) ||
      youngest.trim().toLowerCase() !== saved.youngest);
  // Pak Long · Mak Ngah · Pak Lang …: uncles and aunts alike take the titles.
  const preview = tidy(titles).map((title, index) => {
    const who = index % 2 ? "Mak" : "Pak";
    return title ? `${who} ${title[0]?.toUpperCase()}${title.slice(1)}` : `${who} Cik`;
  });
  const last = youngest.trim().toLowerCase();

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold">Malay birth-order titles</h2>
          <p className="max-w-2xl text-sm text-faint">
            Malay calls uncles and aunts by their own place among their brothers and sisters: Pak
            Long, Mak Ngah, Pak Lang … Pak Su. The titles after the third differ by region and
            family,{" "}
            {keepers
              ? "so the family's keeper sets them, for everyone: they arrive here from the family folder."
              : "so set your family's here."}{" "}
            A place without a title is Pak Cik or Mak Cik.
          </p>
          <p className="max-w-2xl text-sm text-faint">
            The words for relatives are in the language chosen where they're shown: English, Melayu
            or Jawa, beside how two people are related, and in the dictionary.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {titles.map((title, index) => (
            <div key={ordinal(index + 1)} className="w-24 space-y-1">
              <Label htmlFor={`title-${index}`} className="text-xs text-faint">
                {ordinal(index + 1)}
              </Label>
              <Input
                id={`title-${index}`}
                lang="ms"
                value={title}
                maxLength={20}
                disabled={keepers}
                onChange={(event) =>
                  setTitles((now) => now.map((t, i) => (i === index ? event.target.value : t)))
                }
              />
            </div>
          ))}
          {titles.length < MOST_PLACES && !keepers && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTitles((now) => [...now, ""])}
              aria-label="Add a title for the next place"
            >
              <PlusIcon />
              More
            </Button>
          )}
          <div className="ml-4 w-24 space-y-1">
            <Label htmlFor="title-youngest" className="text-xs text-faint">
              Youngest
            </Label>
            <Input
              id="title-youngest"
              lang="ms"
              value={youngest}
              maxLength={20}
              disabled={keepers}
              onChange={(event) => setYoungest(event.target.value)}
            />
          </div>
        </div>

        <p className="text-sm text-muted-foreground" lang="ms">
          {[...preview, last ? `Pak ${last[0]?.toUpperCase()}${last.slice(1)}` : "Pak Cik"].join(
            " · ",
          )}
        </p>

        <div className={keepers ? "hidden" : "flex gap-2"}>
          <Button
            disabled={!changed || save.isPending}
            onClick={() =>
              saved &&
              store(
                { ...saved, titles: tidy(titles), youngest: last },
                "Saved the birth-order titles.",
              )
            }
          >
            Save titles
          </Button>
          <Button
            variant="ghost"
            disabled={!saved || save.isPending}
            onClick={() => {
              setTitles(DEFAULT_TITLES);
              setYoungest(DEFAULT_YOUNGEST);
            }}
          >
            Long, Ngah, Lang … Su
          </Button>
        </div>
      </div>
    </section>
  );
}
