import { XIcon } from "lucide-react";
import { z } from "zod";
import type { PartialDate } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { daysInMonth, describeDate, MONTH_NAMES, type Qualifier } from "@/lib/dates";

/** A date as the picker holds it. A typed date the parts can't show, from an old
 *  import, is kept as its text until a date is picked. */
export type DateParts = {
  qualifier: Qualifier;
  day: number | null;
  month: number | null;
  year: number | null;
  year_to: number | null;
  original_text: string | null;
};

export const NO_DATE: DateParts = {
  qualifier: "exact",
  day: null,
  month: null,
  year: null,
  year_to: null,
  original_text: null,
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

export function partsOf(date: PartialDate | null | undefined): DateParts {
  if (!date) return NO_DATE;
  return {
    qualifier: date.qualifier,
    day: date.day ?? null,
    month: date.month ?? null,
    year: date.year ?? null,
    year_to: date.year_to ?? null,
    original_text: date.original_text ?? null,
  };
}

function isEmpty(parts: DateParts): boolean {
  return (
    parts.year == null &&
    parts.month == null &&
    parts.day == null &&
    parts.year_to == null &&
    !parts.original_text
  );
}

/** What to send: the parts, or nothing for no date. */
export function dateInput(parts: DateParts): PartialDate | null {
  return isEmpty(parts) ? null : { ...parts };
}

/** Why a date can't be saved yet, or null when it can. */
export function dateProblem(parts: DateParts): string | null {
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

/** The form's check: an incomplete date isn't saved. */
export const datePartsSchema = z
  .object({
    qualifier: z.enum(["exact", "about", "before", "after", "between"]),
    day: z.number().nullable(),
    month: z.number().nullable(),
    year: z.number().nullable(),
    year_to: z.number().nullable(),
    original_text: z.string().nullable(),
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
  id,
  label,
  placeholder,
  value,
  options,
  onChange,
  className,
}: {
  id?: string;
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
      <SelectTrigger id={id} aria-label={label} className={className}>
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

/**
 * A date picked from lists: how sure, then day, month and year, all but the year
 * optional. "Between" takes two years. Typing digits on a list jumps to them ("19", "38").
 */
export function DatePicker({
  id,
  label,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string; // "Date of birth": names each list for screen readers
  value: DateParts;
  onChange: (value: DateParts) => void;
  error?: string;
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
    const next = { ...value, ...change, original_text: null };
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

  const problem = dateProblem(value);
  let hint = null;
  if (error) {
    hint = <p className="text-xs text-red-600">{error}</p>;
  } else if (value.year == null && value.original_text) {
    hint = (
      <p className="text-xs text-stone-500">
        Recorded as “{value.original_text}”. Picking a date replaces it.
      </p>
    );
  } else if (problem && !isEmpty(value)) {
    hint = <p className="text-xs text-amber-700">{problem}</p>;
  } else if (!isEmpty(value)) {
    hint = <p className="text-xs text-stone-500">{describeDate(value)}</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={value.qualifier} onValueChange={(q) => setQualifier(q as Qualifier)}>
          <SelectTrigger
            id={id}
            aria-label={`${label}: how sure`}
            aria-invalid={Boolean(error)}
            className="w-[6.25rem]"
          >
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
            <span className="text-sm text-stone-500">to</span>
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
        {!isEmpty(value) && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Clear the ${label.toLowerCase()}`}
            title="Clear"
            onClick={() => onChange(NO_DATE)}
          >
            <XIcon />
          </Button>
        )}
      </div>
      {hint}
    </div>
  );
}
