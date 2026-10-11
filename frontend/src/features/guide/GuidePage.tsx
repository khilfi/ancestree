import { ArrowLeftIcon, ExternalLinkIcon, PrinterIcon, SearchIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Contents, SearchResults } from "./Contents";
import { GUIDE, ONLINE, searchGuide, sectionFor } from "./guide";

// The guide's text is read with MDXEditor, as life stories are: its own chunk.
const GuideText = lazy(() =>
  import("./GuideText").then((module) => ({ default: module.GuideText })),
);

type Picture = { src: string; alt: string };

/**
 * The user guide: this version's guide, from the same file
 * as GitHub's, here without the internet. Its contents down the side, with a search; each
 * section as GitHub shows it, its links between sections working here, with Back to return.
 * Pictures open larger, and Print prints the section alone. The address says where:
 * /guide#13-the-map, as on GitHub.
 */
export function GuidePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [picture, setPicture] = useState<Picture | null>(null);
  const found = useMemo(() => searchGuide(GUIDE, query), [query]);

  const asked = decodeURIComponent(location.hash.replace(/^#/, ""));
  const known = asked ? sectionFor(GUIDE, asked) : undefined;
  const section = known ?? GUIDE.sections[0];
  const target = known ? asked : (section?.slug ?? "");
  const open = useCallback((slug: string) => navigate({ hash: `#${slug}` }), [navigate]);

  if (!section) return <p className="p-6 text-sm text-stone-600">This guide is empty.</p>;
  return (
    <div className="guide-page flex h-full min-h-0 flex-col md:flex-row">
      <aside className="flex max-h-[40%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-stone-200 bg-white p-3 md:max-h-none md:w-72 md:border-r md:border-b-0">
        <div className="relative">
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
        {query.trim() ? (
          <SearchResults found={found} query={query.trim()} />
        ) : (
          <Contents current={section} />
        )}
      </aside>
      <div className="guide-scroller min-w-0 flex-1 overflow-y-auto">
        <div className="guide-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeftIcon />
            Back
          </Button>
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <PrinterIcon />
            Print
          </Button>
          <a
            href={`${ONLINE}#${target}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm text-sky-700 hover:underline"
          >
            The newest guide, online
            <ExternalLinkIcon className="size-3.5" />
          </a>
        </div>
        <article className="guide-print mx-auto max-w-3xl px-6 pt-2 pb-16">
          <Suspense fallback={<p className="py-6 text-sm text-stone-500">Opening the guide…</p>}>
            <GuideText
              key={section.slug}
              section={section}
              target={target}
              onOpen={open}
              onPicture={setPicture}
            />
          </Suspense>
        </article>
      </div>
      <Dialog open={picture !== null} onOpenChange={(opened) => !opened && setPicture(null)}>
        <DialogContent className="sm:max-w-[min(95vw,1400px)]" aria-describedby={undefined}>
          <DialogTitle className="sr-only">
            {picture?.alt || "A picture from the guide"}
          </DialogTitle>
          {picture && (
            <img
              src={picture.src}
              alt={picture.alt}
              className="mx-auto max-h-[85vh] w-auto max-w-full rounded-md"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
