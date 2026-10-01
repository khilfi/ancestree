import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ImportChange, ImportLeftOut, ImportQuestion, ImportSecondLook } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { changeNames, heldBack, type Ticks, tickedIds } from "./importTicks";

/**
 * The review of an import's changes, shared by a spreadsheet's and by the changes a copy
 * to edit brings back: each change with a tick, grouped, with what it needs and why it
 * can't happen; the questions to answer; and what's left out.
 */

/** Where the changes come from: a spreadsheet's rows, or a relative's copy. */
// Where the changes come from: a spreadsheet, a copy to edit, or a relative's
// computer, through the family folder.
export type Source = "spreadsheet" | "copy" | "computer";

const CLASHES: Record<Source, string> = {
  spreadsheet:
    "Changed in the app too since the file was exported. Unticked, the app's stays; ticked, the file's replaces it.",
  copy: "Changed in the app too since the copy was made. Unticked, the app's stays; ticked, the copy's replaces it.",
  computer:
    "You changed this too since they made their change. Unticked, yours stays; ticked, theirs replaces it.",
};
const UNSURE: Record<Source, string> = {
  spreadsheet:
    "The file doesn't say what this was when it was exported, so it waits for your tick.",
  copy: "The copy didn't start with this, so it waits for your tick.",
  computer: "Their computer didn't start with this, so it waits for your tick.",
};

export function count(number: number, one: string, many = `${one}s`): string {
  return `${number} ${number === 1 ? one : many}`;
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** “Teacher”, or “empty” for a detail with nothing in it. */
export function quoted(text: string | null | undefined): string {
  return text ? `“${text}”` : "empty";
}

const BADGES = {
  plain: "bg-stone-100 text-stone-600",
  attention: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-800",
};

/** One part of the preview, folded or open, with how many it holds; `actions` sit on the
 *  right of its heading. */
export function Group({
  title,
  items,
  badge,
  open: startOpen,
  tone = "plain",
  actions,
  children,
}: {
  title: string;
  items: number;
  badge?: string;
  open: boolean;
  tone?: keyof typeof BADGES;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);
  if (items === 0) return null;
  return (
    <div className="rounded-lg border border-stone-200">
      <div className="flex items-center gap-2 pr-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((now) => !now)}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
        >
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          <span className="font-medium">{title}</span>
          <span className={`rounded-full px-2 text-xs ${BADGES[tone]}`}>{badge ?? items}</span>
        </button>
        {actions}
      </div>
      {open && <div className="border-t border-stone-100 px-3 py-2">{children}</div>}
    </div>
  );
}

/** A line of the preview, with its row in the file, if it has one. */
export function Row({ row, children }: { row: number | null | undefined; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-1.5 text-sm">
      {row !== null && row !== undefined && (
        <span className="w-14 shrink-0 text-stone-500 tabular-nums">Row {row}</span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export function Question({
  question,
  onAnswer,
}: {
  question: ImportQuestion;
  onAnswer: (option: string) => void;
}) {
  const where = question.row === null || question.row === undefined ? "" : `Row ${question.row}`;
  return (
    <li className="flex gap-3 py-2 text-sm">
      {where && <span className="w-14 shrink-0 text-stone-500 tabular-nums">{where}</span>}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p>
          <span className="text-stone-500">{question.column}</span>{" "}
          <span className="font-medium">“{question.written}”</span>: {question.text}
        </p>
        <RadioGroup
          value={question.answer}
          onValueChange={onAnswer}
          aria-label={`${where || question.column}: ${question.written}`}
          className="gap-1"
        >
          {question.options.map((option) => {
            const id = `${question.id}-${option.id}`;
            return (
              <div key={option.id} className="flex items-center gap-2">
                <RadioGroupItem value={option.id} id={id} />
                <Label htmlFor={id} className="font-normal">
                  {option.label}
                  {option.detail && <span className="text-stone-500"> · {option.detail}</span>}
                </Label>
              </div>
            );
          })}
        </RadioGroup>
      </div>
    </li>
  );
}

/** What a change does, in a line. */
function ChangeText({ change }: { change: ImportChange }) {
  switch (change.kind) {
    case "set":
    case "order":
    case "change_link":
      return (
        <>
          <span className="font-medium">{change.name}</span>
          <span className="text-stone-500"> · {change.column}: </span>
          {quoted(change.before)} → <span className="font-medium">{quoted(change.after)}</span>
        </>
      );
    case "story":
      return (
        <>
          <span className="font-medium">{change.name}</span>
          <span className="text-stone-500"> · life story {change.detail}</span>
          {change.after && (
            <span className="mt-0.5 block border-l-2 border-stone-200 pl-2 text-xs text-stone-600">
              {change.after}
            </span>
          )}
        </>
      );
    case "photo":
      return (
        <span className="flex items-center gap-2">
          {change.picture && (
            <img src={change.picture} alt="" className="size-10 shrink-0 rounded-full" />
          )}
          <span>
            <span className="font-medium">{change.name}</span>
            <span className="text-stone-500"> · photo {change.detail}</span>
          </span>
        </span>
      );
    case "add_link":
    case "remove_link":
    case "fill_in":
      return (
        <>
          <span className="font-medium">{change.name}</span>, {change.detail}
        </>
      );
    default:
      return (
        <>
          <span className="font-medium">{change.name}</span>
          {change.detail && <span className="text-stone-500"> · {change.detail}</span>}
        </>
      );
  }
}

/** Why a change starts unticked, or can't happen as ticked. */
function ChangeNote({
  change,
  held,
  source,
}: {
  change: ImportChange;
  held: string | null;
  source: Source;
}) {
  const notes: [string, string][] = [];
  if (held) notes.push(["text-stone-500", `Can't be made: ${held}.`]);
  if (change.clash) notes.push(["text-amber-800", CLASHES[source]]);
  if (change.unsure) notes.push(["text-stone-500", UNSURE[source]]);
  if (change.kind === "set" && change.detail) notes.push(["text-stone-500", change.detail]);
  if (change.kind === "remove_person") {
    notes.push([
      "text-red-700",
      "Moves to the Trash with their links, their photos and story; it can be restored for 30 days.",
    ]);
  }
  if (notes.length === 0) return null;
  return (
    <>
      {notes.map(([tone, note]) => (
        <span key={note} className={`block text-xs ${tone}`}>
          {note}
        </span>
      ))}
    </>
  );
}

function ChangeRow({
  change,
  ticked,
  held,
  source,
  onTick,
}: {
  change: ImportChange;
  ticked: boolean;
  held: string | null;
  source: Source;
  onTick: (on: boolean) => void;
}) {
  const id = `change-${change.id}`;
  return (
    <li className="flex items-start gap-3 py-1.5 text-sm">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={ticked}
        onCheckedChange={(checked) => onTick(checked === true)}
      />
      {source === "spreadsheet" && (
        <span className="w-14 shrink-0 text-stone-500 tabular-nums">
          {change.row === null || change.row === undefined ? "" : `Row ${change.row}`}
        </span>
      )}
      <Label
        htmlFor={id}
        className={`block min-w-0 flex-1 font-normal leading-snug ${held && ticked ? "text-stone-400" : ""}`}
      >
        <ChangeText change={change} />
        <ChangeNote change={change} held={ticked ? held : null} source={source} />
      </Label>
    </li>
  );
}

const GROUPS: {
  kinds: ImportChange["kind"][];
  title: string;
  open: boolean;
  tone: keyof typeof BADGES;
}[] = [
  { kinds: ["set", "order"], title: "Details changed", open: true, tone: "plain" },
  { kinds: ["add_person"], title: "People to add", open: false, tone: "plain" },
  { kinds: ["add_link", "fill_in"], title: "Links to add", open: false, tone: "plain" },
  { kinds: ["change_link"], title: "Links changed", open: true, tone: "plain" },
  { kinds: ["story"], title: "Life stories", open: true, tone: "plain" },
  { kinds: ["photo"], title: "Photos", open: true, tone: "plain" },
  { kinds: ["remove_person", "remove_link"], title: "To remove", open: true, tone: "danger" },
];

/** Everything the import would do, each for you to tick or leave out. */
export function Review({
  changes,
  ticks,
  source,
  onTicks,
}: {
  changes: ImportChange[];
  ticks: Ticks;
  source: Source;
  onTicks: (ticks: Ticks) => void;
}) {
  const ticked = tickedIds(changes, ticks);
  const names = changeNames(changes);
  return (
    <>
      {GROUPS.map(({ kinds, title, open, tone }) => {
        const group = changes.filter((change) => kinds.includes(change.kind));
        const on = group.filter((change) => ticked.has(change.id)).length;
        const setAll = (value: boolean) =>
          onTicks({ ...ticks, ...Object.fromEntries(group.map((change) => [change.id, value])) });
        return (
          <Group
            key={title}
            title={title}
            items={group.length}
            badge={`${on} of ${group.length} ticked`}
            open={open}
            tone={tone}
            actions={
              <span className="flex shrink-0 gap-1 text-xs">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={on === group.length}
                  onClick={() => setAll(true)}
                >
                  Tick all
                </Button>
                <Button variant="ghost" size="sm" disabled={on === 0} onClick={() => setAll(false)}>
                  None
                </Button>
              </span>
            }
          >
            <ul className="divide-y divide-stone-100">
              {group.map((change) => (
                <ChangeRow
                  key={change.id}
                  change={change}
                  ticked={ticked.has(change.id)}
                  held={heldBack(change, ticked, names)}
                  source={source}
                  onTick={(value) => onTicks({ ...ticks, [change.id]: value })}
                />
              ))}
            </ul>
          </Group>
        );
      })}
    </>
  );
}

/** What didn't come in, and why. */
export function LeftOut({ items }: { items: ImportLeftOut[] }) {
  return (
    <Group title="Left out" items={items.length} open tone="attention">
      <ul>
        {items.map((item) => (
          <Row key={`${item.row}-${item.column}-${item.written}-${item.why}`} row={item.row}>
            <span className="text-stone-500">{item.column}</span>
            {item.written && <span className="font-medium"> “{item.written}”</span>}: {item.why}
          </Row>
        ))}
      </ul>
    </Group>
  );
}

/** What came in but is worth a look. */
export function SecondLook({ items }: { items: ImportSecondLook[] }) {
  return (
    <Group title="Worth a second look" items={items.length} open={false}>
      <ul>
        {items.map((item) => (
          <Row key={`${item.row}-${item.message}`} row={item.row}>
            {item.message}
          </Row>
        ))}
      </ul>
    </Group>
  );
}
