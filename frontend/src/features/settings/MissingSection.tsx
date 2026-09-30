import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  useChildrenOrder,
  useFamilyFacts,
  useFamilyMap,
  useFillIn,
  useGraph,
  useImports,
  usePatchPerson,
  usePerson,
} from "@/api/queries";
import type { FactPerson, Graph, GraphPerson } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaceFix } from "@/features/map/PlaceFix";
import {
  type DateParts,
  DatePicker,
  dateInput,
  dateProblem,
  NO_DATE,
} from "@/features/person/DatePicker";
import { PhotoDialog } from "@/features/person/PhotoDialog";
import { shortName } from "@/features/tree/words";
import { describeDate } from "@/lib/dates";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";

const FIRST = 10; // a long list shows this many, then "Show all"

/** Who someone is, so people with the same name can be told apart: "child of Hassan & Mariam". */
function whoIs(graph: Graph, byId: Map<string, GraphPerson>) {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const spouses = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string) =>
    map.set(key, [...(map.get(key) ?? []), value]);
  for (const link of graph.links) {
    if (link.type === "spouse") {
      add(spouses, link.source, link.target);
      add(spouses, link.target, link.source);
    } else {
      add(parents, link.target, link.source);
      add(children, link.source, link.target);
    }
  }
  const names = (ids: string[] = []) =>
    ids
      .map((id) => byId.get(id))
      .filter((p): p is GraphPerson => !!p && !p.placeholder)
      .map((p) => shortName(p));
  return (id: string): string => {
    const theirParents = names(parents.get(id));
    if (theirParents.length) return `child of ${theirParents.join(" & ")}`;
    const partners = names(spouses.get(id));
    if (partners.length) return `married to ${partners.join(" & ")}`;
    const kids = names(children.get(id));
    if (kids.length) return `parent of ${kids.slice(0, 3).join(", ")}${kids.length > 3 ? "…" : ""}`;
    return "";
  };
}

function Section({
  title,
  count,
  done,
  show,
  showing = "Show on the tree",
  children,
}: {
  title: string;
  count: number;
  done: string; // what the empty list says
  show?: string; // the tree, filtered to them
  showing?: string; // what that link says
  children: ReactNode;
}) {
  const [open, setOpen] = useState(count > 0);
  return (
    <section className="rounded-xl border border-stone-200 bg-white">
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((now) => !now)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          <h2 className="font-semibold">{title}</h2>
          <span
            className={
              count ? "rounded-full bg-amber-100 px-2 text-xs text-amber-900" : "text-emerald-700"
            }
          >
            {count ? count : <CheckIcon className="size-4" aria-label="none" />}
          </span>
        </button>
        {show && count > 0 && (
          <Link to={show} className="text-xs text-sky-700 hover:underline">
            {showing}
          </Link>
        )}
      </header>
      {open && (
        <div className="border-t border-stone-100 px-4 py-2">
          {count === 0 ? <p className="py-1 text-sm text-stone-500">{done}</p> : children}
        </div>
      )}
    </section>
  );
}

/** A long list: the first ten, then "Show all". */
function Rows<T>({ items, row }: { items: T[]; row: (item: T) => ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <>
      <ul className="divide-y divide-stone-100">{shown.map(row)}</ul>
      {items.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll((now) => !now)}
          className="py-2 text-sm text-sky-700 hover:underline"
        >
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

function Who({ person, about }: { person: GraphPerson; about: string }) {
  const years = lifeYears(person);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <PersonAvatar person={person} size="sm" />
      <div className="min-w-0">
        <div className="truncate font-medium">{person.full_name}</div>
        <div className="truncate text-xs text-stone-500">
          {[years, about].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}

function Open({ id }: { id: string }) {
  return (
    <Button asChild variant="ghost" size="sm" aria-label="Open their panel">
      <Link to={`/tree?person=${id}&focus=1`}>
        <ExternalLinkIcon />
        Open
      </Link>
    </Button>
  );
}

function GenderRow({ person, about }: { person: GraphPerson; about: string }) {
  const patch = usePatchPerson();
  const set = (gender: "male" | "female") =>
    patch.mutate({ id: person.id, body: { gender } }, { onError: showError });
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Who person={person} about={about} />
      <Button variant="outline" size="sm" disabled={patch.isPending} onClick={() => set("male")}>
        Man
      </Button>
      <Button variant="outline" size="sm" disabled={patch.isPending} onClick={() => set("female")}>
        Woman
      </Button>
      <Open id={person.id} />
    </li>
  );
}

function BirthRow({ person, about }: { person: GraphPerson; about: string }) {
  const patch = usePatchPerson();
  // A date written but not readable, e.g. from a spreadsheet: the picker says what it was.
  const [date, setDate] = useState<DateParts>({
    ...NO_DATE,
    original_text: person.birth_text ?? null,
  });
  const ready = date.year !== null && dateProblem(date) === null;
  const save = () =>
    patch.mutate(
      { id: person.id, body: { birth_date: dateInput(date) } },
      {
        onSuccess: () => toast.success(`${shortName(person)}: born ${describeDate(date)}.`),
        onError: showError,
      },
    );
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex items-center gap-2">
        <Who person={person} about={about} />
        <Open id={person.id} />
      </div>
      <div className="flex flex-wrap items-start gap-2 pl-10">
        <DatePicker
          id={`born-${person.id}`}
          label={`${person.full_name}'s date of birth`}
          value={date}
          onChange={setDate}
        />
        <Button size="sm" disabled={!ready || patch.isPending} onClick={save}>
          Save
        </Button>
      </div>
    </li>
  );
}

function OrderGroup({ parents, kids }: { parents: FactPerson[]; kids: FactPerson[] }) {
  const [order, setOrder] = useState(kids);
  const parent = parents[0]?.id ?? "";
  const save = useChildrenOrder(parent);
  const move = (index: number, by: number) =>
    setOrder((now) => {
      const next = [...now];
      const [item] = next.splice(index, 1);
      if (item) next.splice(index + by, 0, item);
      return next;
    });
  return (
    <li className="space-y-2 py-2">
      <p className="text-sm">
        Children of{" "}
        <span className="font-medium">
          {parents.map((p) => p.name).join(" & ") || "unknown parents"}
        </span>
        , eldest first:
      </p>
      <ol className="space-y-1 pl-2">
        {order.map((child, index) => (
          <li key={child.id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-right text-stone-500 tabular-nums">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">{child.name}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${child.name} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Move ${child.name} down`}
              disabled={index === order.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDownIcon />
            </Button>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        disabled={!parent || save.isPending}
        onClick={() =>
          save.mutate(
            order.map((child) => child.id),
            { onSuccess: () => toast.success("Saved the birth order."), onError: showError },
          )
        }
      >
        Save this order
      </Button>
    </li>
  );
}

function UnknownRow({ id, kids }: { id: string; kids: GraphPerson[] }) {
  const fill = useFillIn(id);
  const [name, setName] = useState("");
  const first = kids[0];
  const submit = () =>
    fill.mutate(
      { person: { full_name: name.trim(), gender: "unknown" }, existing: null },
      {
        onSuccess: (added) => {
          toast.success(`${added.person.full_name} is filled in.`);
          setName("");
        },
        onError: showError,
      },
    );
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="flex size-8 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-400">
        ?
      </span>
      <span className="min-w-0 flex-1 text-sm">
        The unknown parent of{" "}
        <span className="font-medium">
          {kids.map((kid) => shortName(kid)).join(", ") || "no one"}
        </span>
      </span>
      <Input
        aria-label="Their name"
        placeholder="Their name…"
        className="h-8 w-48"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim()) submit();
        }}
      />
      <Button size="sm" disabled={!name.trim() || fill.isPending} onClick={submit}>
        Fill in
      </Button>
      {first && (
        <Button asChild variant="ghost" size="sm">
          <Link
            to={`/tree?person=${first.id}&focus=1`}
            title="Or choose someone already in the tree"
          >
            On the tree
          </Link>
        </Button>
      )}
    </li>
  );
}

function PhotoRow({ person, about }: { person: GraphPerson; about: string }) {
  const [open, setOpen] = useState(false);
  const detail = usePerson(open ? person.id : null);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <Who person={person} about={about} />
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add a photo
      </Button>
      {open && detail.data && (
        <PhotoDialog person={detail.data} open={open} onOpenChange={setOpen} />
      )}
    </li>
  );
}

function PlaceRow({ person, about }: { person: GraphPerson; about: string }) {
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex items-center gap-2">
        <Who person={person} about={about} />
        <Open id={person.id} />
      </div>
      <div className="pl-10">
        <PlaceFix person={person} field="residence" />
      </div>
    </li>
  );
}

function share(done: number, all: number): string {
  return `${done} of ${all}`;
}

/** The latest import that left things out: the rest of its gaps are listed below. */
function ImportNote() {
  const imports = useImports();
  const last = imports.data?.find(
    (item) => !item.taken_back_at && item.people_present > 0 && item.left_out.length > 0,
  );
  if (!last) return null;
  const day = new Date(last.imported_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const things = last.left_out.length === 1 ? "1 thing" : `${last.left_out.length} things`;
  return (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Your import of {day} ({last.file_name}) left out {things}.{" "}
      <Link to="/settings/import" className="font-medium underline">
        See them
      </Link>
    </p>
  );
}

/**
 * Settings → What's missing: what the family's record doesn't say yet, each gap
 * with a quick fix. Every fix is one Undo step, and the list shrinks as you go. Nothing is
 * guessed: genders aren't suggested from bin or binti (your decision of 27 Sep 2026).
 */
export function MissingSection() {
  const graph = useGraph();
  const facts = useFamilyFacts(true);
  const map = useFamilyMap();
  const data = graph.data;
  const lives = map.data;
  const lists = useMemo(() => {
    if (!data) return null;
    // Where they live: only once the map has answered, so nobody is listed wrongly.
    const placed = lives ? new Set(lives.people.filter((p) => p.lives).map((p) => p.id)) : null;
    const byId = new Map(data.people.map((person) => [person.id, person]));
    const real = data.people.filter((person) => !person.placeholder);
    const byName = (a: GraphPerson, b: GraphPerson) => a.full_name.localeCompare(b.full_name);
    const kidsOf = new Map<string, GraphPerson[]>();
    for (const link of data.links) {
      if (link.type !== "parent") continue;
      const kid = byId.get(link.target);
      if (kid) kidsOf.set(link.source, [...(kidsOf.get(link.source) ?? []), kid]);
    }
    const unlinked = new Set(data.layout.unlinked);
    return {
      about: whoIs(data, byId),
      real,
      gender: real.filter((p) => p.gender === "unknown").sort(byName),
      birth: real.filter((p) => (p.born?.year ?? p.birth_year) == null).sort(byName),
      photo: real.filter((p) => p.photo_version == null).sort(byName),
      place: placed ? real.filter((p) => !placed.has(p.id)).sort(byName) : [],
      unknown: data.people
        .filter((p) => p.placeholder)
        .map((p) => ({ id: p.id, kids: kidsOf.get(p.id) ?? [] })),
      unlinked: real.filter((p) => unlinked.has(p.id)).sort(byName),
    };
  }, [data, lives]);

  if (graph.isError) return <p className="text-sm text-red-600">{graph.error.message}</p>;
  if (graph.isPending || !lists) {
    return <p className="text-sm text-stone-500">Looking for what's missing…</p>;
  }

  const orders = facts.data?.to_fill_in.no_birth_order ?? [];
  const total = lists.real.length;
  return (
    <div className="space-y-4">
      <section className="space-y-1 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">What's missing</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          What your family's record doesn't say yet, each with a quick way to fill it in. Every fix
          can be undone, and nothing is guessed.
        </p>
        <p className="text-sm text-stone-700">
          Genders {share(total - lists.gender.length, total)} · birth years{" "}
          {share(total - lists.birth.length, total)} · photos{" "}
          {share(total - lists.photo.length, total)}
          {lives && ` · where they live ${share(total - lists.place.length, total)}`}
          {orders.length > 0 &&
            ` · ${orders.length} ${orders.length === 1 ? "family" : "families"} without a birth order`}
        </p>
        <ImportNote />
      </section>

      <Section
        title="Gender not recorded"
        count={lists.gender.length}
        done="Everyone's gender is recorded."
        show="/tree?gender=unknown"
      >
        <Rows
          items={lists.gender}
          row={(person) => (
            <GenderRow key={person.id} person={person} about={lists.about(person.id)} />
          )}
        />
      </Section>

      <Section
        title="No date of birth"
        count={lists.birth.length}
        done="Everyone has a date of birth, even if only a year."
        show="/tree?missing=year"
      >
        <Rows
          items={lists.birth}
          row={(person) => (
            <BirthRow key={person.id} person={person} about={lists.about(person.id)} />
          )}
        />
      </Section>

      <Section
        title="Birth order not known"
        count={orders.length}
        done="Every family's children are in order."
      >
        <ul className="divide-y divide-stone-100">
          {orders.map((group) => (
            <OrderGroup
              key={group.children.map((c) => c.id).join()}
              parents={group.parents}
              kids={group.children}
            />
          ))}
        </ul>
      </Section>

      <Section
        title="Unknown parents"
        count={lists.unknown.length}
        done="No unknown parents: everyone's parents are named or not recorded at all."
      >
        <Rows
          items={lists.unknown}
          row={(item) => <UnknownRow key={item.id} id={item.id} kids={item.kids} />}
        />
      </Section>

      <Section
        title="No photo"
        count={lists.photo.length}
        done="Everyone has a photo."
        show="/tree?missing=photo"
      >
        <Rows
          items={lists.photo}
          row={(person) => (
            <PhotoRow key={person.id} person={person} about={lists.about(person.id)} />
          )}
        />
      </Section>

      <Section
        title="Where they live not recorded"
        count={lists.place.length}
        done="Everyone has a place they live, and is on the map."
        show="/map"
        showing="Open the map"
      >
        <Rows
          items={lists.place}
          row={(person) => (
            <PlaceRow key={person.id} person={person} about={lists.about(person.id)} />
          )}
        />
      </Section>

      <Section
        title="Not linked to anyone"
        count={lists.unlinked.length}
        done="Everyone is linked to someone."
      >
        <Rows
          items={lists.unlinked}
          row={(person) => (
            <li key={person.id} className="flex items-center gap-2 py-2">
              <Who person={person} about="" />
              <Open id={person.id} />
            </li>
          )}
        />
      </Section>
    </div>
  );
}
