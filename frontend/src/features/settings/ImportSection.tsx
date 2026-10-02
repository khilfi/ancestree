import {
  ChevronDownIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  LaptopIcon,
  PencilIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  downloadImportReport,
  downloadTemplate,
  useImportPreview,
  useImports,
  useRunImport,
  useTakeBack,
} from "@/api/queries";
import type { ImportDone, ImportPreview, ImportSummary, ImportTakenBack } from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ACTION_MS, showError } from "@/lib/notify";
import { carriedOut, type Ticks, tickAll, tickedIds } from "./importTicks";
import { count, Group, LeftOut, Question, quoted, Review, Row, SecondLook, when } from "./review";

/** The columns an import reads, as the template has them. */
const COLUMNS: [string, string, string][] = [
  [
    "ID",
    "Empty, or a short tag of your own so other rows can point at this person. Someone exported from AncesTree keeps their ID, so they're recognised.",
    "P1",
  ],
  ["Full name", "The only column that must be filled in.", "Ismail bin Ahmad"],
  ["Nickname, Title, Name in Jawi", "As in the person panel.", "Tok Ismail · Haji"],
  ["Gender", "Male or Female (M, F, Lelaki, Perempuan, L, P); empty when not known.", "Female"],
  [
    "Born, Died",
    "A date as it's typed anywhere in the app.",
    "14/3/1938 · 3/1938 · 1938 · c. 1938 · before 1900 · 1910-1915",
  ],
  [
    "Birthplace, Death place, Lives in",
    "Town and state; add the country when it isn't Malaysia.",
    "Kota Bharu, Kelantan · Jakarta, Indonesia",
  ],
  ["Burial place, Occupation, Notes", "Text.", ""],
  ["Living", "yes or no; empty to work it out from the dates.", ""],
  [
    "Parents, Spouses, Children",
    "People separated by ;. Each is an ID or a full name. A word in brackets says what kind of link: (adoptive), (foster) or any kind in Relationship kinds for a parent; (former) for a divorced spouse. No word: a birth parent, a married couple.",
    "Ismail bin Ahmad; Fatimah binti Yusof · P1; P2 (adoptive)",
  ],
  [
    "Remove",
    "yes to take someone already in the tree out of it. They go to the Trash with their links, and only if you tick it when you review the import.",
    "yes",
  ],
  [
    "Version",
    "Only in a spreadsheet exported from AncesTree: it tells which details were changed in the file and which in the app since. Leave it as it is.",
    "",
  ],
];

function ColumnGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex items-center gap-1 text-sm text-sky-700 hover:underline"
      >
        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
        What goes in each column
      </button>
      {open && (
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs text-stone-500">
            <tr>
              <th className="py-1 pr-3 font-medium">Column</th>
              <th className="py-1 pr-3 font-medium">What goes in</th>
              <th className="py-1 font-medium">For example</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 align-top">
            {COLUMNS.map(([column, what, example]) => (
              <tr key={column}>
                <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{column}</td>
                <td className="py-1.5 pr-3 text-stone-700">{what}</td>
                <td className="py-1.5 text-stone-500">{example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Preview({
  preview,
  ticks,
  onAnswer,
  onTicks,
}: {
  preview: ImportPreview;
  ticks: Ticks;
  onAnswer: (question: string, option: string) => void;
  onTicks: (ticks: Ticks) => void;
}) {
  const changes = preview.changes ?? [];
  const carried = carriedOut(changes, ticks).size;
  const waiting = changes.filter((change) => change.clash || change.removes);
  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm">
        <p>
          {count(preview.rows, "row")}.{" "}
          {changes.length === 0 ? (
            "Nothing to import: everyone here is in the tree already, with the same details and links."
          ) : (
            <>
              <strong>{count(changes.length, "change")}</strong> to review, {carried} ticked.
            </>
          )}
        </p>
        {preview.matched > 0 && (
          <p className="text-stone-600">
            {count(preview.matched, "row is", "rows are")} someone already in the tree:{" "}
            {preview.matched === 1 ? "what its row changes is" : "what their rows change is"} listed
            for you to tick.
          </p>
        )}
        {preview.columns_not_read.length > 0 && (
          <p className="text-stone-600">
            Not read: {preview.columns_not_read.join(", ")}. The template shows the columns an
            import reads.
          </p>
        )}
      </div>

      <Group title="To check" items={preview.questions.length} open tone="attention">
        <ul className="divide-y divide-stone-100">
          {preview.questions.map((question) => (
            <Question
              key={question.id}
              question={question}
              onAnswer={(option) => onAnswer(question.id, option)}
            />
          ))}
        </ul>
      </Group>

      {changes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Button variant="outline" size="sm" onClick={() => onTicks(tickAll(changes, true))}>
            Tick all
          </Button>
          <Button variant="outline" size="sm" onClick={() => onTicks(tickAll(changes, false))}>
            Untick all
          </Button>
          {waiting.length > 0 && (
            <span className="text-xs text-stone-500">
              Tick all leaves removals and clashes to their own ticks.
            </span>
          )}
        </div>
      )}
      <Review changes={changes} ticks={ticks} source="spreadsheet" onTicks={onTicks} />
      <LeftOut items={preview.left_out} />
      <SecondLook items={preview.second_look} />

      <Group title="Newer in the tree" items={preview.differences.length} open={false}>
        <p className="pb-1 text-xs text-stone-500">
          These have been changed in the app since the file was exported, and the file still has the
          old. The tree keeps its own.
        </p>
        <ul>
          {preview.differences.map((item) => (
            <Row key={`${item.row}-${item.column}`} row={item.row}>
              {item.name}, <span className="text-stone-500">{item.column}</span>:{" "}
              {quoted(item.written)} in the file, {quoted(item.in_tree)} in the tree
            </Row>
          ))}
        </ul>
      </Group>
    </div>
  );
}

function EarlierImport({
  item,
  onTakeBack,
  busy,
}: {
  item: ImportSummary;
  onTakeBack: (item: ImportSummary) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const gone = item.people - item.people_present;
  const anything =
    item.people_present > 0 ||
    item.links > 0 ||
    item.changed + item.removed + (item.stories ?? 0) + (item.photos ?? 0) > 0;
  return (
    <li className="space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {item.kind === "folder" ? (
          <LaptopIcon className="size-4 text-stone-400" aria-hidden />
        ) : item.kind === "copy" ? (
          <PencilIcon className="size-4 text-stone-400" aria-hidden />
        ) : (
          <FileSpreadsheetIcon className="size-4 text-stone-400" aria-hidden />
        )}
        <span className="font-medium">{when(item.imported_at)}</span>
        <span className="text-stone-600">
          ·{" "}
          {item.kind === "folder"
            ? `changes from ${item.for_name}`
            : item.kind === "copy"
              ? `changes from ${item.for_name}'s copy, ${item.file_name}`
              : item.file_name}
        </span>
        <span className="text-stone-600">
          · {count(item.people, "person", "people")}, {count(item.links, "link")}
          {item.changed > 0 && `, ${item.changed} changed`}
          {item.removed > 0 && `, ${item.removed} removed`}
          {(item.stories ?? 0) > 0 && `, ${count(item.stories ?? 0, "story", "stories")}`}
          {(item.photos ?? 0) > 0 && `, ${count(item.photos ?? 0, "photo")}`}
          {item.left_out.length > 0 && `, ${item.left_out.length} left out`}
        </span>
        {item.taken_back_at ? (
          <span className="text-stone-500">· taken back {when(item.taken_back_at)}</span>
        ) : (
          gone > 0 && (
            <span className="text-stone-500">
              · {item.people_present === 0 ? "none" : item.people_present} still in the tree
            </span>
          )
        )}
        <span className="ml-auto flex gap-1">
          {item.left_out.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setOpen((now) => !now)}>
              {open ? "Hide what was left out" : "What was left out"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => downloadImportReport(item.id)}
            aria-label={`Download the report of the import of ${when(item.imported_at)}`}
          >
            <DownloadIcon />
            Report
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || item.taken_back_at !== null || !anything}
            onClick={() => onTakeBack(item)}
          >
            Take back…
          </Button>
        </span>
      </div>
      {open && (
        <ul className="pl-6">
          {item.left_out.map((left) => (
            <Row key={`${left.row}-${left.column}-${left.written}`} row={left.row}>
              <span className="text-stone-500">{left.column}</span>
              {left.written && <span className="font-medium"> “{left.written}”</span>}: {left.why}
            </Row>
          ))}
        </ul>
      )}
    </li>
  );
}

/** What Take back will do to this import, part by part. */
function takingBack(item: ImportSummary): string {
  const one = (n: number, single: string, several: string) => (n === 1 ? single : several);
  const parts: string[] = [];
  const added = item.people_present;
  if (added > 0) {
    parts.push(
      one(
        added,
        "The person it added moves to the Trash, with their links, and can be restored for 30 days.",
        `The ${added} people it added move to the Trash, with their links; each can be restored for 30 days.`,
      ),
    );
  }
  if (item.links > 0) parts.push("Links it made between people already here go too.");
  if (item.kind === "copy" || item.kind === "folder") {
    const more = item.changed + (item.stories ?? 0) + (item.photos ?? 0);
    if (more > 0) {
      parts.push(
        "What else it changed goes back as it was, unless changed again since: details and links, life stories and photos.",
      );
    }
  } else if (item.changed > 0) {
    parts.push(
      one(
        item.changed,
        "The detail it changed goes back as it was, unless it's been changed again since.",
        `The ${item.changed} details it changed go back as they were, unless changed again since.`,
      ),
    );
  }
  if (item.removed > 0) {
    parts.push(
      one(
        item.removed,
        "The person it removed comes back from the Trash.",
        `The ${item.removed} people it removed come back from the Trash.`,
      ),
    );
  }
  parts.push("Undo and Redo start afresh afterwards.");
  return parts.join(" ");
}

function takenBack(result: ImportTakenBack): { title: string; description: string } {
  const done = [
    result.moved > 0 && `${count(result.moved, "person", "people")} it added moved to the Trash`,
    result.reverted > 0 && `${count(result.reverted, "detail")} put back`,
    result.restored > 0 &&
      `${count(result.restored, "person", "people")} it removed back from the Trash`,
    (result.links ?? 0) > 0 && `${count(result.links ?? 0, "link")} put back`,
    (result.stories ?? 0) > 0 && `${count(result.stories ?? 0, "story", "stories")} put back`,
    (result.photos ?? 0) > 0 && `${count(result.photos ?? 0, "photo")} put back`,
  ].filter(Boolean);
  const more = [
    result.kept > 0 &&
      `${count(result.kept, "detail was", "details were")} changed again since, so kept.`,
    result.gone > 0 && `${count(result.gone, "person was", "people were")} gone already.`,
  ].filter(Boolean);
  return {
    title: done.length > 0 ? `Taken back: ${done.join(", ")}.` : "Nothing was left to take back.",
    description: more.join(" "),
  };
}

function EarlierImports() {
  const imports = useImports();
  const takeBack = useTakeBack();
  const [confirming, setConfirming] = useState<ImportSummary | null>(null);
  const list = imports.data ?? [];
  if (list.length === 0) return null;

  function takeBackNow(item: ImportSummary) {
    takeBack.mutate(item.id, {
      onSuccess: (result) => {
        const { title, description } = takenBack(result);
        toast.success(title, { description: description || undefined });
      },
      onError: showError,
    });
  }

  return (
    <section className="space-y-2 rounded-xl border border-stone-200 bg-white p-5">
      <h2 className="font-semibold">Earlier imports</h2>
      <ul className="divide-y divide-stone-100">
        {list.map((item) => (
          <EarlierImport
            key={item.id}
            item={item}
            busy={takeBack.isPending}
            onTakeBack={setConfirming}
          />
        ))}
      </ul>
      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Take back the import of {confirming ? when(confirming.imported_at) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? takingBack(confirming) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => confirming && takeBackNow(confirming)}
            >
              Take back
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** "3 people added, 2 details changed": what an import did. */
function imported(done: ImportDone): string {
  return [
    done.people > 0 && `${count(done.people, "person", "people")} added`,
    done.links > 0 && `${count(done.links, "link")} made`,
    done.changed > 0 && `${count(done.changed, "detail")} changed`,
    done.removed > 0 && `${count(done.removed, "person", "people")} moved to the Trash`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Settings → Import: people from a spreadsheet. Fill in the template, or edit a
 * spreadsheet exported from AncesTree; review what the import would do, ticking what should
 * happen; import. What can't be read is left out and listed; What's missing takes over
 * from there. The import is one Undo step, and Take back later undoes it all.
 */
export function ImportSection() {
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Your ticks, kept by change while answers bring a new preview.
  const [ticks, setTicks] = useState<Ticks>({});
  const preview = useImportPreview(file, token, answers);
  const run = useRunImport();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const shown = file ? preview.data : undefined;
  const changes = shown?.changes ?? [];
  const carried = carriedOut(changes, ticks).size;

  function reset(next: File | null) {
    setFile(next);
    setAnswers({});
    setTicks({});
  }

  function importNow() {
    if (!file || !shown) return;
    run.mutate(
      { file, answers, chosen: [...tickedIds(changes, ticks)] },
      {
        onSuccess: (done) => {
          toast.success(`Imported from ${shown.file_name}: ${imported(done)}.`, {
            description: done.left_out
              ? `${count(done.left_out, "thing was", "things were")} left out: see Earlier imports. What's missing lists what's still to fill in.`
              : "Undo takes the whole import back. What's missing lists what's still to fill in.",
            duration: ACTION_MS,
            action: { label: "What's missing", onClick: () => navigate("/settings/missing") },
          });
          reset(null);
        },
        onError: showError,
      },
    );
  }

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">Import from a spreadsheet</h2>
          <p className="max-w-2xl text-sm text-stone-500">
            Bring in people from a spreadsheet: a branch a cousin typed up, or corrections and
            additions sent back on an export. You tick what should happen before anything changes,
            and the whole import can be undone.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            1. Fill in the template in Excel, one row per person
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => downloadTemplate(false)}>
              <DownloadIcon />
              Template (.csv)
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadTemplate(true)}>
              <DownloadIcon />
              Example (.csv)
            </Button>
          </div>
          <p className="text-sm text-stone-500">
            The example is filled in with the made-up test family. A spreadsheet exported from
            AncesTree can be edited and imported too: the people already here are recognised by
            their IDs, what was changed in the file is offered for you to tick, and Remove marks
            someone to take out. Save it from Excel as “CSV UTF-8”.
          </p>
          <ColumnGuide />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">2. Choose the filled-in file</h3>
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
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
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

        {file && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">3. What will happen</h3>
            {preview.isError ? (
              <p role="alert" className="text-sm text-red-600">
                {preview.error.message}
              </p>
            ) : !shown ? (
              <p className="text-sm text-stone-500">Reading {file.name}…</p>
            ) : (
              <>
                <Preview
                  preview={shown}
                  ticks={ticks}
                  onAnswer={(question, option) =>
                    setAnswers((now) => ({ ...now, [question]: option }))
                  }
                  onTicks={setTicks}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={importNow}
                    disabled={carried === 0 || preview.isFetching || run.isPending}
                  >
                    {run.isPending ? "Importing…" : `Import ${count(carried, "change")}`}
                  </Button>
                  <Button variant="ghost" onClick={() => reset(null)} disabled={run.isPending}>
                    Cancel
                  </Button>
                  {preview.isFetching && (
                    <span className="text-sm text-stone-500">Checking your answer…</span>
                  )}
                  {changes.length > 0 && carried === 0 && !preview.isFetching && (
                    <span className="text-sm text-stone-500">Nothing is ticked.</span>
                  )}
                </div>
                <p className="text-xs text-stone-500">
                  A backup is made first. The import is then one step for Undo.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <EarlierImports />
    </div>
  );
}
