import { ExternalLinkIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Contents, SearchResults } from "@/features/guide/Contents";
import { GUIDE, ONLINE, searchGuide } from "@/features/guide/guide";

/** Settings → Help: the guide to this version, opened from its contents or a
 *  search, here without the internet; and the newest, online. */
export function HelpSection() {
  const [query, setQuery] = useState("");
  const found = useMemo(() => searchGuide(GUIDE, query), [query]);

  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Help</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          The guide to this version of AncesTree, here without the internet: how to use it, how to
          keep the family in step, and what to do when something goes wrong. <strong>Guide</strong>,
          the <strong>?</strong> at the top of the window, opens it too.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="sm">
          <Link to="/guide">Open the guide</Link>
        </Button>
        <a
          href={ONLINE}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline"
        >
          The newest guide, online
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-stone-400" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the guide"
          aria-label="Search the guide"
          className="pl-8"
        />
      </div>
      <div className="max-w-xl">
        {query.trim() ? <SearchResults found={found} query={query.trim()} /> : <Contents />}
      </div>
    </section>
  );
}
