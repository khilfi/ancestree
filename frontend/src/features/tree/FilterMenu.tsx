import { FilterIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useMemo, useState } from "react";
import type { Gender, Graph } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { standings } from "@/features/timeline/lanes";
import { cn } from "@/lib/utils";
import {
  chips,
  isFiltered,
  type LeaveOut,
  type Missing,
  NO_FILTER,
  type Scope,
  type TreeFilter,
} from "./filters";
import { shortName } from "./words";

function toggled<T>(set: ReadonlySet<T>, item: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(item);
  else next.delete(item);
  return next;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="pb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Tick({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} />
      <Label htmlFor={id} className="font-normal">
        {children}
      </Label>
    </div>
  );
}

/** A year typed in full; it counts once it's left, or on Enter, so Back isn't one per digit. */
function YearInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (year: number | null) => void;
}) {
  const [text, setText] = useState(value?.toString() ?? "");
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value?.toString() ?? "");
  }
  const commit = () => {
    const year = /^\d{4}$/.test(text.trim()) ? Number(text.trim()) : null;
    if (year !== value) onCommit(year);
    if (year === null) setText("");
  };
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      placeholder="year"
      className="h-7 w-20 text-xs"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}

/** Someone to choose the others around: typed, then picked from the family. */
function PersonPicker({
  graph,
  value,
  onChange,
}: {
  graph: Graph;
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const [text, setText] = useState("");
  const people = useMemo(() => graph.people.filter((person) => !person.placeholder), [graph]);
  const chosen = people.find((person) => person.id === value);
  const matches = useMemo(() => {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return people
      .filter((person) => {
        const name = `${person.full_name} ${person.nickname ?? ""}`.toLowerCase();
        return words.every((word) => name.includes(word));
      })
      .slice(0, 8);
  }, [people, text]);

  if (chosen) {
    return (
      <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium">{chosen.full_name}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Choose someone else"
          onClick={() => onChange(null)}
        >
          <XIcon />
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        aria-label="Around whom"
        placeholder="Type a name…"
        className="h-8"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {matches.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-stone-200 bg-white text-sm">
          {matches.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                className="w-full px-2 py-1 text-left hover:bg-stone-100"
                onClick={() => {
                  setText("");
                  onChange(person.id);
                }}
              >
                {person.full_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const SCOPES: [Scope, string][] = [
  ["line", "Direct line"],
  ["ancestors", "Ancestors"],
  ["descendants", "Descendants"],
  ["blood", "Blood relatives"],
  ["within", "Within a few links"],
];

const LEAVE: [LeaveOut, string][] = [
  ["married", "Married-in families"],
  ["unknown", "Unknown parents"],
  ["care", "Adoptive and foster links"],
  ["died", "People who have died"],
  ["living", "People living"],
];

const GENDERS: [Gender, string][] = [
  ["male", "Men"],
  ["female", "Women"],
  ["unknown", "Gender not recorded"],
];

const MISSING: [Missing, string][] = [
  ["year", "Missing a birth year"],
  ["photo", "Missing a photo"],
];

/**
 * The Filter menu: who the tree and the timeline show. Every change applies at once
 * and goes into the address, so Back takes it away again.
 */
export function FilterMenu({
  graph,
  filter,
  onChange,
  selectedId = null,
}: {
  graph: Graph;
  filter: TreeFilter;
  onChange: (filter: TreeFilter) => void;
  selectedId?: string | null; // "Around" starts from whoever is open
}) {
  const active = chips(filter, () => "").length;
  const generations = useMemo(() => {
    const found = new Set<number>();
    for (const [, standing] of standings(graph).of)
      if (standing.family === 0) found.add(standing.generation);
    return [...found].sort((a, b) => a - b);
  }, [graph]);
  const places = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of graph.people) {
      if (person.born_in) counts.set(person.born_in, (counts.get(person.born_in) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [graph]);
  const set = (change: Partial<TreeFilter>) => onChange({ ...filter, ...change });
  const [first, last] = [generations[0] ?? 1, generations.at(-1) ?? 1];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="xs" className={cn(active && "border-sky-300 bg-sky-50")}>
          <FilterIcon />
          Filter{active ? ` (${active})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-[26rem] gap-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Filter</h2>
          <Button
            variant="ghost"
            size="xs"
            disabled={!isFiltered(filter)}
            onClick={() => onChange({ ...NO_FILTER, others: filter.others })}
          >
            Clear
          </Button>
        </div>

        <Section title="Who">
          <RadioGroup
            value={filter.around ? "around" : "everyone"}
            onValueChange={(value) => {
              if (value === "everyone") set({ around: null });
              else if (selectedId) set({ around: selectedId });
            }}
            className="gap-1.5"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="everyone" id="who-everyone" />
              <Label htmlFor="who-everyone" className="font-normal">
                Everyone
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="around"
                id="who-around"
                disabled={!selectedId && !filter.around}
              />
              <Label htmlFor="who-around" className="font-normal">
                Around someone
              </Label>
            </div>
          </RadioGroup>
          <div className="space-y-2 pl-6">
            <PersonPicker
              graph={graph}
              value={filter.around}
              onChange={(around) => set({ around })}
            />
            {filter.around && (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={filter.scope}
                  onValueChange={(scope) => set({ scope: scope as Scope })}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 text-xs"
                    aria-label="Which of their family"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPES.map(([scope, label]) => (
                      <SelectItem key={scope} value={scope}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filter.scope === "within" && (
                  <Select
                    value={String(filter.links)}
                    onValueChange={(links) => set({ links: Number(links) })}
                  >
                    <SelectTrigger size="sm" className="h-7 text-xs" aria-label="How many links">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6].map((links) => (
                        <SelectItem key={links} value={String(links)}>
                          {links} link{links === 1 ? "" : "s"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
          </div>
        </Section>

        <Section title="Leave out">
          {LEAVE.map(([item, label]) => (
            <Tick
              key={item}
              checked={filter.leave.has(item)}
              onChange={(on) => set({ leave: toggled(filter.leave, item, on) })}
            >
              {label}
            </Tick>
          ))}
        </Section>

        <Section title="Only">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-stone-600">Generations</span>
            <Select
              value={String(filter.generations?.[0] ?? "")}
              onValueChange={(value) =>
                set({
                  generations: [
                    Number(value),
                    Math.max(Number(value), filter.generations?.[1] ?? last),
                  ],
                })
              }
            >
              <SelectTrigger size="sm" className="h-7 w-16 text-xs" aria-label="From generation">
                <SelectValue placeholder="any" />
              </SelectTrigger>
              <SelectContent>
                {generations.map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            to
            <Select
              value={String(filter.generations?.[1] ?? "")}
              onValueChange={(value) =>
                set({
                  generations: [
                    Math.min(Number(value), filter.generations?.[0] ?? first),
                    Number(value),
                  ],
                })
              }
            >
              <SelectTrigger size="sm" className="h-7 w-16 text-xs" aria-label="To generation">
                <SelectValue placeholder="any" />
              </SelectTrigger>
              <SelectContent>
                {generations.map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-stone-600">Born</span>
            <YearInput
              label="Born from the year"
              value={filter.born?.[0] ?? null}
              onCommit={(year) =>
                set({
                  born: year === null ? null : [year, Math.max(year, filter.born?.[1] ?? year)],
                })
              }
            />
            to
            <YearInput
              label="Born to the year"
              value={filter.born?.[1] ?? null}
              onCommit={(year) =>
                set({
                  born: year === null ? null : [Math.min(year, filter.born?.[0] ?? year), year],
                })
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-24 text-stone-600">Born in</span>
            <Select
              value={filter.place ?? "anywhere"}
              onValueChange={(place) => set({ place: place === "anywhere" ? null : place })}
            >
              <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Born in">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anywhere">Anywhere</SelectItem>
                {places.map(([place, count]) => (
                  <SelectItem key={place} value={place}>
                    {place} ({count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
            {GENDERS.map(([gender, label]) => (
              <Tick
                key={gender}
                checked={filter.genders.has(gender)}
                onChange={(on) => set({ genders: toggled(filter.genders, gender, on) })}
              >
                {label}
              </Tick>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {MISSING.map(([item, label]) => (
              <Tick
                key={item}
                checked={filter.missing.has(item)}
                onChange={(on) => set({ missing: toggled(filter.missing, item, on) })}
              >
                {label}
              </Tick>
            ))}
          </div>
        </Section>

        <Section title="The others">
          <RadioGroup
            value={filter.others}
            onValueChange={(others) => set({ others: others as TreeFilter["others"] })}
            className="flex gap-4"
          >
            {(["hidden", "faded"] as const).map((others) => (
              <div key={others} className="flex items-center gap-2">
                <RadioGroupItem value={others} id={`others-${others}`} />
                <Label htmlFor={`others-${others}`} className="font-normal">
                  {others === "hidden" ? "Hidden" : "Faded"}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </Section>
      </PopoverContent>
    </Popover>
  );
}

/** The active filters as chips under the toolbar: ✕ takes one away. */
export function FilterChips({
  graph,
  filter,
  onChange,
  shown,
}: {
  graph: Graph;
  filter: TreeFilter;
  onChange: (filter: TreeFilter) => void;
  shown?: number | null; // how many people the filter keeps
}) {
  const names = useMemo(() => new Map(graph.people.map((p) => [p.id, shortName(p)])), [graph]);
  const found = chips(filter, (id) => names.get(id) ?? "someone");
  if (!found.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {found.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 py-0.5 pr-1 pl-2.5 text-xs text-sky-900"
        >
          {chip.label}
          <button
            type="button"
            aria-label={`Remove: ${chip.label}`}
            className="rounded-full p-0.5 hover:bg-sky-100"
            onClick={() => onChange(chip.without(filter))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {found.length > 1 && (
        <button
          type="button"
          className="text-xs text-sky-800 underline-offset-2 hover:underline"
          onClick={() => onChange({ ...NO_FILTER, others: filter.others })}
        >
          Clear all
        </button>
      )}
      {shown != null && (
        <span className="text-xs text-stone-500">
          {shown} {shown === 1 ? "person" : "people"} shown
        </span>
      )}
    </div>
  );
}
