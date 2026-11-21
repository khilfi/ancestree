import { ChevronDownIcon, ChevronRightIcon, RouteIcon, XIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useFamilyFacts } from "@/api/queries";
import type { FactPerson, FamilyFacts, NameCount } from "@/api/types";
import { InAppOnly, useCopy } from "@/app/copy";
import { Failed } from "@/components/Failed";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NO_FILTER, readView, type TreeFilter, withView, writeView } from "@/features/tree/filters";
import { useEscape } from "@/lib/escape";
import type { FactsTab } from "@/lib/familyFacts";
import { useTakeFocus } from "@/lib/focus";
import { cn } from "@/lib/utils";

function plural(count: number, noun: string, many = `${noun}s`): string {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? noun : many}`;
}

const ORDINAL = (day: number) =>
  `${day}${day % 10 === 1 && day !== 11 ? "st" : day % 10 === 2 && day !== 12 ? "nd" : day % 10 === 3 && day !== 13 ? "rd" : "th"}`;

/** Where a click goes, keeping the tree's layout and filter: someone's panel, in the
 *  view you're in (on the tree it flies there too); a path in the relationship finder; or a
 *  view filtered to the people a fact counts. */
function useOpen() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const timeline = pathname.startsWith("/timeline");
  return {
    person: (id: string) =>
      navigate(
        timeline
          ? `/timeline?${withView(params, { person: id })}`
          : `/tree?${withView(params, { person: id, focus: "1" })}`,
      ),
    path: (a: string, b: string) => navigate(`/tree?${withView(params, { person: a, relate: b })}`),
    filtered: (change: Partial<TreeFilter>) => {
      const view = readView(params);
      const next = writeView({ ...view, filter: { ...NO_FILTER, ...change } });
      navigate(`${timeline ? "/timeline" : "/tree"}?${next}`);
    },
  };
}

/** A count that opens the view filtered to whom it counts. */
function Shown({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Hint label="Show them on the tree or the timeline">
      <button
        type="button"
        onClick={onClick}
        className="text-link underline-offset-2 hover:underline"
      >
        {children}
      </button>
    </Hint>
  );
}

function Name({ person, onOpen }: { person: FactPerson; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(person.id)}
      className="font-medium text-link underline-offset-2 hover:underline"
    >
      {person.name}
    </button>
  );
}

function Names({ people, onOpen }: { people: FactPerson[]; onOpen: (id: string) => void }) {
  return (
    <>
      {people.map((person, index) => (
        <span key={person.id}>
          {index > 0 && (index === people.length - 1 ? " & " : ", ")}
          <Name person={person} onOpen={onOpen} />
        </span>
      ))}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-3 py-2">
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

/** "Siti (3)": a click shows who they are; with `onShow`, they can be shown as a filter. */
function Counted({
  items,
  onOpen,
  onShow,
}: {
  items: NameCount[];
  onOpen: (id: string) => void;
  onShow?: (name: string) => void;
}) {
  const [shown, setShown] = useState<string | null>(null);
  const open = items.find((item) => item.name === shown);
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {items.map((item) => (
          <button
            key={item.name}
            type="button"
            aria-expanded={item.name === shown}
            onClick={() => setShown(item.name === shown ? null : item.name)}
            className={cn(
              "rounded px-1 underline-offset-2 hover:underline",
              item.name === shown && "bg-highlight-soft text-highlight-soft-foreground",
            )}
          >
            {item.name} ({item.people.length})
          </button>
        ))}
      </div>
      {open && (
        <p className="text-xs text-muted-foreground">
          <Names people={open.people} onOpen={onOpen} />
          {onShow && (
            <>
              {" · "}
              <Shown onClick={() => onShow(open.name)}>Show them</Shown>
            </>
          )}
        </p>
      )}
    </div>
  );
}

type Bar = { key: string; label: string; title: string; count: number };

/** A small bar chart; a click on a bar shows its people as a filter. */
function Bars({
  bars,
  label,
  onPick,
}: {
  bars: Bar[];
  label: string;
  onPick?: (key: string) => void;
}) {
  const most = Math.max(1, ...bars.map((bar) => bar.count));
  return (
    // As many columns as bars, sharing the width: a long family history still fits.
    <fieldset
      aria-label={label}
      className="grid min-w-0 items-end gap-0.5 pt-1"
      style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1.5rem))` }}
    >
      {bars.map((bar) => (
        <Hint key={bar.key} label={onPick && bar.count ? `${bar.title}: show them` : bar.title}>
          <button
            type="button"
            disabled={!onPick || bar.count === 0}
            onClick={() => onPick?.(bar.key)}
            className="group flex min-w-0 flex-col items-center gap-0.5 disabled:cursor-default"
          >
            <span className="text-xs text-faint tabular-nums">{bar.count || ""}</span>
            <span
              className="w-full max-w-5 rounded-sm bg-facts-bar group-enabled:group-hover:bg-facts-bar-pointed"
              style={{ height: `${Math.max(2, Math.round((bar.count / most) * 40))}px` }}
            />
            <span className="text-xs whitespace-nowrap text-faint">{bar.label}</span>
          </button>
        </Hint>
      ))}
    </fieldset>
  );
}

function Facts({ facts, onFillIn }: { facts: FamilyFacts; onFillIn: () => void }) {
  const open = useOpen();
  const person = open.person;
  const [missing, setMissing] = useState(false);
  const { counts, to_fill_in: toFill } = facts;
  const about = (flag: boolean) => (flag ? "about " : "");

  const birthdays = facts.this_month.filter((a) => a.kind === "birthday");
  const deaths = facts.this_month.filter((a) => a.kind === "death");
  const toFillCount =
    toFill.no_gender.length + toFill.no_birth_year.length + toFill.no_birth_order.length;

  return (
    <dl className="divide-y divide-border text-sm">
      <div className="pb-3 text-foreground">
        <span className="font-semibold">{plural(counts.people, "person", "people")}</span>
        {" · "}
        {plural(counts.links, "link")}
        {" · "}
        {plural(counts.couples, "couple")}
        {counts.unknown_parents > 0 && ` · ${plural(counts.unknown_parents, "unknown parent")}`}
        {counts.families > 1 &&
          ` · ${plural(counts.families, "separate family", "separate families")}`}
        {counts.unlinked > 0 && ` · ${counts.unlinked} not linked yet`}
      </div>

      {facts.generations.length > 0 && (
        <Row label={plural(facts.generations.length, "generation")}>
          <Bars
            label="People in each generation"
            onPick={(key) => open.filtered({ generations: [Number(key), Number(key)] })}
            bars={facts.generations.map((g) => ({
              key: String(g.generation),
              label: String(g.generation),
              title: `Generation ${g.generation}: ${plural(g.people, "person", "people")}`,
              count: g.people,
            }))}
          />
        </Row>
      )}
      {facts.oldest && (
        <Row label="Oldest recorded">
          <Name person={facts.oldest.person} onOpen={person} />, born {facts.oldest.date}
        </Row>
      )}
      {facts.youngest && (
        <Row label="Youngest">
          <Name person={facts.youngest.person} onOpen={person} />, born {facts.youngest.date}
          {facts.span_years != null &&
            ` · ${about(facts.span_about)}${plural(facts.span_years, "year")} between them`}
        </Row>
      )}
      {facts.longest_life && (
        <Row label="Longest life">
          <Name person={facts.longest_life.person} onOpen={person} />,{" "}
          {about(facts.longest_life.about)}
          {plural(facts.longest_life.years, "year")}
          {facts.average_life != null &&
            ` · average life ${plural(facts.average_life, "year")} (of ${plural(facts.lives_known, "person", "people")})`}
        </Row>
      )}
      {facts.oldest_living && (
        <Row label="Oldest living">
          <Name person={facts.oldest_living.person} onOpen={person} />,{" "}
          {about(facts.oldest_living.about)}
          {facts.oldest_living.years}
        </Row>
      )}
      {facts.biggest_family && (
        <Row label="Biggest family">
          <Names people={facts.biggest_family.parents} onOpen={person} />,{" "}
          {plural(facts.biggest_family.children, "child", "children")}
        </Row>
      )}
      {facts.most_descendants && (
        <Row label="Most descendants">
          <Names people={facts.most_descendants.people} onOpen={person} />,{" "}
          {facts.most_descendants.count} over{" "}
          {plural(facts.most_descendants.generations, "generation")}
        </Row>
      )}
      {facts.longest_chain && (
        <Row label="Longest chain">
          <Name person={facts.longest_chain.a} onOpen={person} /> and{" "}
          <Name person={facts.longest_chain.b} onOpen={person} /> are{" "}
          {plural(facts.longest_chain.links ?? 0, "link")} apart{" "}
          <PathButton
            onClick={() =>
              facts.longest_chain && open.path(facts.longest_chain.a.id, facts.longest_chain.b.id)
            }
          />
        </Row>
      )}
      {facts.farthest_by_blood?.term && (
        <Row label="Farthest by blood">
          <Name person={facts.farthest_by_blood.b} onOpen={person} /> is{" "}
          <Name person={facts.farthest_by_blood.a} onOpen={person} />
          's {facts.farthest_by_blood.term}{" "}
          <PathButton
            onClick={() =>
              facts.farthest_by_blood &&
              open.path(facts.farthest_by_blood.a.id, facts.farthest_by_blood.b.id)
            }
          />
        </Row>
      )}
      <Row label="Cousins who married">
        {facts.cousins_married.length === 0
          ? "None recorded"
          : facts.cousins_married.map((couple) => (
              <div key={`${couple.a.id}:${couple.b.id}`}>
                <Name person={couple.a} onOpen={person} /> &amp;{" "}
                <Name person={couple.b} onOpen={person} />
                {couple.term && (
                  <span className="text-faint">, {couple.term.replace("cousin", "cousins")}</span>
                )}{" "}
                <PathButton onClick={() => open.path(couple.a.id, couple.b.id)} />
              </div>
            ))}
      </Row>
      {facts.names.length > 0 && (
        <Row label="Most common names">
          <Counted items={facts.names} onOpen={person} />
        </Row>
      )}
      {facts.birthplaces.length > 0 && (
        <Row label="Born in">
          <Counted
            items={facts.birthplaces}
            onOpen={person}
            onShow={(place) => open.filtered({ place })}
          />
        </Row>
      )}
      {facts.decades.length > 0 && (
        <Row label="Births by decade">
          <Bars
            label="Births in each decade"
            onPick={(key) => open.filtered({ born: [Number(key), Number(key) + 9] })}
            bars={facts.decades.map((d) => ({
              key: String(d.decade),
              label: `’${String(d.decade).slice(2)}`,
              title: `The ${d.decade}s: ${plural(d.people, "birth")}`,
              count: d.people,
            }))}
          />
          <p className="text-xs text-faint">
            The {facts.decades[0]?.decade}s to the {facts.decades.at(-1)?.decade}s
          </p>
        </Row>
      )}
      <Row label={`This month (${facts.month})`}>
        {facts.this_month.length === 0 && <span className="text-faint">Nothing recorded</span>}
        {birthdays.length > 0 && (
          <div>
            Birthdays:{" "}
            {birthdays.map((a, index) => (
              <span key={a.person.id}>
                {index > 0 && "; "}
                <Name person={a.person} onOpen={person} />
                {a.day != null && ` (${ORDINAL(a.day)}`}
                {a.years != null && `${a.day != null ? ", " : " ("}turns ${a.years}`}
                {(a.day != null || a.years != null) && ")"}
              </span>
            ))}
          </div>
        )}
        {deaths.length > 0 && (
          <div>
            Remembering:{" "}
            {deaths.map((a, index) => (
              <span key={a.person.id}>
                {index > 0 && "; "}
                <Name person={a.person} onOpen={person} /> (died {a.date})
              </span>
            ))}
          </div>
        )}
      </Row>
      <Row label="Still to fill in">
        {toFillCount === 0 ? (
          "Nothing: well done"
        ) : (
          <div className="space-y-1">
            {/* Each count opens the tree or timeline filtered to them. */}
            <p className="flex flex-wrap gap-x-1.5">
              {toFill.no_gender.length > 0 && (
                <Shown onClick={() => open.filtered({ genders: new Set(["unknown"]) })}>
                  {toFill.no_gender.length} without a gender
                </Shown>
              )}
              {toFill.no_birth_year.length > 0 && (
                <>
                  {toFill.no_gender.length > 0 && <span aria-hidden="true">·</span>}
                  <Shown onClick={() => open.filtered({ missing: new Set(["year"]) })}>
                    {toFill.no_birth_year.length} without a birth year
                  </Shown>
                </>
              )}
              {toFill.no_birth_order.length > 0 && (
                <span>
                  {toFill.no_gender.length + toFill.no_birth_year.length > 0 && "· "}
                  {plural(toFill.no_birth_order.length, "family", "families")} without a birth order
                </span>
              )}
            </p>
            <button
              type="button"
              aria-expanded={missing}
              onClick={() => setMissing((now) => !now)}
              className="inline-flex items-center gap-0.5 text-link hover:underline"
            >
              {missing ? (
                <ChevronDownIcon className="size-3.5" />
              ) : (
                <ChevronRightIcon className="size-3.5" />
              )}
              {missing ? "Hide them" : "Show them"}
            </button>
            {/* What's missing, beside these facts: a quick fix for each. */}
            <InAppOnly>
              <button type="button" onClick={onFillIn} className="ml-3 text-link hover:underline">
                Fill them in…
              </button>
            </InAppOnly>
            {missing && (
              <div className="space-y-2 text-xs text-foreground">
                {toFill.no_gender.length > 0 && (
                  <p>
                    <span className="text-faint">Without a gender: </span>
                    <Names people={toFill.no_gender} onOpen={person} />
                  </p>
                )}
                {toFill.no_birth_year.length > 0 && (
                  <p>
                    <span className="text-faint">Without a birth year: </span>
                    <Names people={toFill.no_birth_year} onOpen={person} />
                  </p>
                )}
                {toFill.no_birth_order.map((group) => (
                  <p key={group.children.map((c) => c.id).join()}>
                    <span className="text-faint">
                      Order not known among the children of{" "}
                      {group.parents.map((p) => p.name).join(" & ") || "unknown parents"}:{" "}
                    </span>
                    <Names people={group.children} onOpen={person} />
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </Row>
    </dl>
  );
}

function Loading() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

function PathButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-1 inline-flex items-center gap-0.5 text-xs text-kin hover:underline"
    >
      <RouteIcon className="size-3" />
      Show the path
    </button>
  );
}

// What's missing, Settings' until 0.9.0: a chunk of its own, and never in a copy.
const Missing =
  import.meta.env.MODE === "viewer"
    ? null
    : lazy(() =>
        import("@/features/settings/MissingSection").then((module) => ({
          default: module.MissingSection,
        })),
      );

/**
 * Family facts: facts about the whole family, from the ⓘ beside the family's
 * name; and What's missing, with a quick fix for each gap, as its second tab, in the
 * app itself. It slides in from the left, over the tree or the timeline, wider for What's
 * missing; the person panel keeps the right. It takes the focus as it opens, and Esc closes it
 * when nothing opened after it is still open, a dialog over it closing first.
 */
export function FamilyFactsPanel({
  tab,
  onTab,
  onClose,
}: {
  tab: FactsTab;
  onTab: (tab: FactsTab) => void;
  onClose: () => void;
}) {
  const facts = useFamilyFacts(true);
  const copy = useCopy(); // facts as they were when the copy was made
  const shown = copy || !Missing ? "facts" : tab;
  const own = useRef<HTMLElement>(null);
  useTakeFocus(own);
  useEscape(onClose);

  return (
    <aside
      ref={own}
      tabIndex={-1}
      aria-label="Family facts"
      className={cn(
        "absolute inset-y-0 left-0 z-30 flex w-[26rem] max-w-full flex-col border-r border-border bg-card shadow-xl outline-none",
        shown === "missing" && "w-[40rem]",
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Family facts</h2>
          {copy && (
            <p className="text-xs text-faint">
              As on{" "}
              {new Date(copy.made_at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              , when this copy was made
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Family facts">
          <XIcon />
        </Button>
      </header>
      <Tabs
        value={shown}
        onValueChange={(next) => onTab(next as FactsTab)}
        className="min-h-0 flex-1 gap-0"
      >
        {Missing && (
          <InAppOnly>
            <TabsList className="mx-4 mt-3">
              <TabsTrigger value="facts">Facts</TabsTrigger>
              <TabsTrigger value="missing">What's missing</TabsTrigger>
            </TabsList>
          </InAppOnly>
        )}
        <TabsContent value="facts" className="relative min-h-0 overflow-y-auto px-4 py-3">
          {facts.isPending && <Loading />}
          {facts.isError && (
            <Failed
              error={facts.error}
              onRetry={() => void facts.refetch()}
              className="text-sm text-destructive"
            />
          )}
          {facts.data && <Facts facts={facts.data} onFillIn={() => onTab("missing")} />}
        </TabsContent>
        {Missing && (
          <TabsContent value="missing" className="relative min-h-0 overflow-y-auto px-4 py-3">
            <Suspense fallback={<Loading />}>
              <Missing />
            </Suspense>
          </TabsContent>
        )}
      </Tabs>
    </aside>
  );
}
