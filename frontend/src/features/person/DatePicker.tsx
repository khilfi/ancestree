import { CalendarDaysIcon } from "lucide-react";
import { useState } from "react";
import type { PartialDate } from "@/api/types";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type DateLike,
  daysInMonth,
  describeDate,
  MONTH_NAMES,
  type Qualifier,
  readDate,
  sayDate,
} from "@/lib/dates";
import { z } from "@/lib/schema";

/** A date as the form holds it: its parts, and, while it's being typed, the
 *  words typed, null once the parts are picked or as it came saved. A typed date the parts
 *  can't show, from an old import, is kept as its text until a date is typed or picked. */
export type DateParts = {
  qualifier: Qualifier;
  day: number | null;
  month: number | null;
  year: number | null;
  year_to: number | null;
  original_text: string | null;
  typed: string | null;
};

export const NO_DATE: DateParts = {
  qualifier: "exact",
  day: null,
  month: null,
  year: null,
  year_to: null,
  original_text: null,
  typed: null,
};

const QUALIFIERS: [Qualifier, string][] = [
  ["exact", "Exact"],
  ["about", "About"],
  ["before", "Before"],
  ["after", "After"],
  ["between", "Between"],
];

const NONE = "none"; // a list's "—": Radix lists can't hold an empty value
const FIRST_YEAR = 1700;

function partsFrom(date: DateLike): DateParts {
  return {
    qualifier: date.qualifier ?? "exact",
    day: date.day ?? null,
    month: date.month ?? null,
    year: date.year ?? null,
    year_to: date.year_to ?? null,
    original_text: date.original_text ?? null,
    typed: null,
  };
}

export function partsOf(date: PartialDate | null | undefined): DateParts {
  return date ? partsFrom(date) : NO_DATE;
}

function isEmpty(parts: DateParts): boolean {
  return (
    parts.year == null &&
    parts.month == null &&
    parts.day == null &&
    parts.year_to == null &&
    !parts.original_text &&
    !parts.typed?.trim()
  );
}

/** What to send: the parts, or nothing for no date. The words typed stay here: the parts are
 *  what they were read as. */
export function dateInput(parts: DateParts): PartialDate | null {
  const { typed: _, ...date } = parts;
  return isEmpty(parts) ? null : date;
}

/** Why a date can't be saved yet, or null when it can. */
export function dateProblem(parts: DateParts): string | null {
  if (parts.typed?.trim()) {
    const read = readDate(parts.typed);
    if ("problem" in read) return read.problem;
  }
  if (parts.qualifier === "between") {
    if (parts.year == null || parts.year_to == null) return "Pick both years.";
    if (parts.year_to < parts.year) return "The second year can't be before the first.";
    return null;
  }
  if (parts.day != null && parts.month == null) return "Pick the month too, or clear the day.";
  if (parts.month != null && parts.year == null) return "Pick the year too.";
  if (parts.qualifier !== "exact" && parts.year == null) return "Pick a year.";
  return null;
}

/** The form's check: a date that can't be read, or is incomplete, isn't saved. */
export const datePartsSchema = z
  .object({
    qualifier: z.enum(["exact", "about", "before", "after", "between"]),
    day: z.number().nullable(),
    month: z.number().nullable(),
    year: z.number().nullable(),
    year_to: z.number().nullable(),
    original_text: z.string().nullable(),
    typed: z.string().nullable(),
  })
  .superRefine((parts, context) => {
    const problem = dateProblem(parts);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

function years(keep: (number | null)[]): number[] {
  const now = new Date().getFullYear();
  const list: number[] = [];
  for (let year = now; year >= FIRST_YEAR; year--) list.push(year);
  // A year outside the list, from an import, stays pickable.
  for (const year of keep) if (year != null && (year > now || year < FIRST_YEAR)) list.push(year);
  return list.sort((a, b) => b - a);
}

function Pick({
  label,
  placeholder,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  options: [number, string][];
  onChange: (value: number | null) => void;
  className: string;
}) {
  return (
    <Select
      value={value == null ? "" : String(value)}
      onValueChange={(picked) => onChange(picked === NONE ? null : Number(picked))}
    >
      <SelectTrigger aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>—</SelectItem>
        {options.map(([option, text]) => (
          <SelectItem key={option} value={String(option)}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The lists, the second way: how sure, then day, month and year, all but the year
 *  optional. "Between" takes two years. Typing digits on a list jumps to them ("19", "38"). */
function DateLists({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateParts;
  onChange: (value: DateParts) => void;
}) {
  const between = value.qualifier === "between";
  const yearOptions = years([value.year, value.year_to]).map((y): [number, string] => [
    y,
    String(y),
  ]);
  const lastDay = value.month != null ? daysInMonth(value.month, value.year) : 31;
  const dayOptions = Array.from({ length: lastDay }, (_, i): [number, string] => [
    i + 1,
    String(i + 1),
  ]);
  const monthOptions = MONTH_NAMES.map((name, i): [number, string] => [i + 1, name]);

  function set(change: Partial<DateParts>) {
    // Picked, the box says it in its own words again.
    const next = { ...value, ...change, original_text: null, typed: null };
    // A day the month doesn't have is dropped: there's no 30 February.
    if (next.day != null && next.month != null && next.day > daysInMonth(next.month, next.year)) {
      next.day = null;
    }
    onChange(next);
  }

  function setQualifier(qualifier: Qualifier) {
    if (qualifier === "between") set({ qualifier, day: null, month: null });
    else set({ qualifier, year_to: null });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={value.qualifier} onValueChange={(q) => setQualifier(q as Qualifier)}>
        <SelectTrigger aria-label={`${label}: how sure`} className="w-[6.25rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {QUALIFIERS.map(([qualifier, name]) => (
            <SelectItem key={qualifier} value={qualifier}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {between ? (
        <>
          <Pick
            label={`${label}: from the year`}
            placeholder="Year"
            value={value.year}
            options={yearOptions}
            onChange={(year) => set({ year })}
            className="w-[4.75rem]"
          />
          <span className="text-sm text-faint">to</span>
          <Pick
            label={`${label}: to the year`}
            placeholder="Year"
            value={value.year_to}
            options={yearOptions}
            onChange={(year_to) => set({ year_to })}
            className="w-[4.75rem]"
          />
        </>
      ) : (
        <>
          <Pick
            label={`${label}: day`}
            placeholder="Day"
            value={value.day}
            options={dayOptions}
            onChange={(day) => set({ day })}
            className="w-16"
          />
          <Pick
            label={`${label}: month`}
            placeholder="Month"
            value={value.month}
            options={monthOptions}
            onChange={(month) => set({ month })}
            className="w-[6.75rem]"
          />
          <Pick
            label={`${label}: year`}
            placeholder="Year"
            value={value.year}
            options={yearOptions}
            onChange={(year) => set({ year })}
            className="w-[4.75rem]"
          />
        </>
      )}
    </div>
  );
}

/**
 * A date typed as it's said: "12/3/1950", the day first, "March 1950", "about
 * 1950", "before 1960", "1950–1955", "kira-kira 1950", read as the server reads it
 * (`readDate`). What it understood shows beside it, "12 March 1950"; what can't be read, once
 * the box is left. The lists stay as a second way, behind the calendar beside the box.
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string; // "Date of birth": names the box, and each list, for screen readers
  value: DateParts;
  onChange: (value: DateParts) => void;
  error?: string;
}) {
  const [lists, setLists] = useState(false);
  const [typing, setTyping] = useState(false);
  const text = value.typed ?? sayDate(value);
  const said = `${id}-said`;

  function type(words: string) {
    const read = readDate(words);
    if ("problem" in read) onChange({ ...NO_DATE, typed: words });
    else if (read.date) onChange({ ...partsFrom(read.date), typed: words });
    else onChange(NO_DATE);
  }

  // What it understood, beside the box; why not, beneath it.
  const problem = dateProblem(value);
  let beside = null;
  let beneath = null;
  if (error) {
    beneath = (
      <p id={said} className="text-xs text-destructive">
        {error}
      </p>
    );
  } else if (value.year == null && value.original_text && !value.typed) {
    beneath = (
      <p id={said} className="text-xs text-faint">
        Recorded as “{value.original_text}”. Typing a date replaces it.
      </p>
    );
  } else if (problem && !isEmpty(value)) {
    // While it's being typed, it's only half there: the problem waits until the box is left.
    if (!(typing && value.typed !== null)) {
      beneath = (
        <p id={said} className="text-xs text-warning">
          {problem}
        </p>
      );
    }
  } else if (!isEmpty(value)) {
    beside = (
      <span id={said} className="text-sm text-muted-foreground">
        {describeDate(value)}
      </span>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Input
          id={id}
          aria-label={label}
          aria-describedby={beside || beneath ? said : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          spellCheck={false}
          placeholder="e.g. 12/3/1950"
          value={text}
          onChange={(event) => type(event.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          className="w-44"
        />
        <Hint label={lists ? "Hide the lists" : "Pick from lists"}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`${label}: pick from lists`}
            aria-expanded={lists}
            onClick={() => setLists((open) => !open)}
          >
            <CalendarDaysIcon />
          </Button>
        </Hint>
        {beside}
      </div>
      {beneath}
      {lists && <DateLists label={label} value={value} onChange={onChange} />}
    </div>
  );
}
