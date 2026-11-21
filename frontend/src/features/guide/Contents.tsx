import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { type Found, GUIDE, type Section } from "./guide";

function linkClass(current: boolean): string {
  return cn(
    "block rounded-md px-2 py-1 text-left text-sm transition-colors",
    current
      ? "bg-highlight-soft font-medium text-highlight-soft-foreground"
      : "text-foreground hover:bg-muted",
  );
}

/** The guide's contents, by part, on its own page. */
export function Contents({ current }: { current?: Section }) {
  const start = GUIDE.sections[0];
  return (
    <nav aria-label="The guide's contents" className="space-y-3">
      {start && (
        <Link
          to={`/guide#${start.slug}`}
          className={linkClass(current === start)}
          aria-current={current === start ? "page" : undefined}
        >
          About this guide
        </Link>
      )}
      {GUIDE.parts.map((part) => {
        const own = part.sections[0]?.slug === part.slug ? part.sections[0] : undefined;
        return (
          <div key={part.slug} className="space-y-0.5">
            {own ? (
              <Link
                to={`/guide#${own.slug}`}
                className={cn(linkClass(current === own), "text-xs font-semibold text-faint")}
                aria-current={current === own ? "page" : undefined}
              >
                {part.title}
              </Link>
            ) : (
              <div className="px-2 py-1 text-xs font-semibold text-faint">{part.title}</div>
            )}
            <ul>
              {part.sections
                .filter((section) => section !== own)
                .map((section) => (
                  <li key={section.slug}>
                    <Link
                      to={`/guide#${section.slug}`}
                      className={linkClass(current === section)}
                      aria-current={current === section ? "page" : undefined}
                    >
                      {section.title}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** What a search of the guide found: each section, with the words around the first match. */
export function SearchResults({ found, query }: { found: Found[]; query: string }) {
  if (!found.length) {
    return <p className="px-2 text-sm text-faint">Nothing in the guide says "{query}".</p>;
  }
  return (
    <ul aria-label="Found in the guide" className="space-y-1">
      {found.map(({ section, snippet }) => (
        <li key={section.slug}>
          <Link
            to={`/guide#${section.slug}`}
            className="block rounded-md px-2 py-1.5 hover:bg-muted"
          >
            <span className="block text-sm font-medium text-foreground">{section.title}</span>
            <span className="block text-xs text-faint">{snippet}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
