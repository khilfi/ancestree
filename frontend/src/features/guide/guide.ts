/**
 * The user guide inside the app: `public/GUIDE.md` and its
 * pictures, read by the app's build as they are, so the app and GitHub show one file. Each
 * version of the app has its own version's guide. Here it's split into its parts and sections,
 * each named by the address GitHub gives its heading, so the guide's own links work alike.
 */
import text from "@guide/GUIDE.md?raw";

/** The newest guide, online: GitHub's, which a change reaches as soon as it's published. */
export const ONLINE = "https://github.com/khilfi/ancestree/blob/main/GUIDE.md";
const REPOSITORY = "https://github.com/khilfi/ancestree/blob/main/";

// The guide's pictures, by name: "guide/app-map.png".
const PICTURES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("@guide/guide/*.{png,jpg,jpeg,webp,gif,svg}", {
      eager: true,
      query: "?url",
      import: "default",
    }),
  ).map(([path, url]) => [`guide/${path.split("/").pop()}`, url]),
);

export type Heading = { level: number; text: string; slug: string };

export type Section = {
  slug: string; // its heading's address, as GitHub makes it: "13-the-map"
  title: string; // "13. The map"
  part: string; // "Part 2: Use AncesTree"; "" for the guide's start
  markdown: string; // its text, from its heading, without the notes left for pictures to come
  headings: Heading[]; // its headings, its own first, each with its address
  plain: string; // its words, for the search
};

export type Part = { title: string; slug: string; sections: Section[] };

export type Guide = { title: string; sections: Section[]; parts: Part[] };

/** The words of a heading as GitHub reads them: no emphasis, code marks or link addresses. */
function words(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * The address GitHub gives a heading: in lower case, without punctuation or symbols, each space
 * a hyphen; and "-1", "-2" after it when an earlier heading has the same.
 */
export function slugFor(heading: string, taken: Map<string, number>): string {
  const base = words(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
  const count = taken.get(base) ?? 0;
  taken.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Plain words, for the search: no Markdown, no pictures, no tables' rules, and no diagrams,
 *  whose source would show in what the search finds, and whose words the text says too. */
function plainWords(markdown: string): string {
  return markdown
    .replace(/^```[^\n]*\n[\s\S]*?^```$/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+ /gm, "")
    .replace(/^\|?[\s|:-]+\|?$/gm, " ")
    .replace(/[*_`|>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The guide in its parts and sections. A section starts at each numbered section's heading
 * (##), and at a part's (#) where the part says something of its own before its first section.
 * Everything before the first part is the guide's start: its words to the reader and contents.
 */
export function readGuide(markdown: string): Guide {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const taken = new Map<string, number>();
  const sections: Section[] = [];
  const parts: Part[] = [];
  let title = "";
  let part = "";
  let current: { start: number; heading: Heading; part: string; headings: Heading[] } | null = null;
  let inPart = false;
  let fenced = false;

  const close = (end: number) => {
    if (!current) return;
    const body = lines
      .slice(current.start, end)
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // A part's heading with nothing after it is a label in the contents, not a section.
    if (current.heading.level === 1 && current.start > 0 && body === `# ${current.heading.text}`) {
      current = null;
      return;
    }
    const section: Section = {
      slug: current.heading.slug,
      title: current.heading.level === 1 && current.start === 0 ? title : current.heading.text,
      part: current.part,
      markdown: body.replace(/^---$/gm, "").trim(),
      headings: current.headings,
      plain: plainWords(body),
    };
    sections.push(section);
    parts.at(-1)?.sections.push(section);
    current = null;
  };

  lines.forEach((line, index) => {
    if (/^```/.test(line)) fenced = !fenced;
    const found = fenced ? null : /^(#{1,3}) (.+?)\s*$/.exec(line);
    if (!found) return;
    const level = found[1]?.length ?? 0;
    const heading = { level, text: words(found[2] ?? ""), slug: slugFor(found[2] ?? "", taken) };
    if (index === 0 && level === 1) {
      title = heading.text;
      current = { start: 0, heading, part: "", headings: [heading] };
      return;
    }
    if (level === 1) {
      close(index);
      part = heading.text;
      inPart = true;
      parts.push({ title: part, slug: heading.slug, sections: [] });
      current = { start: index, heading, part, headings: [heading] };
      return;
    }
    if (level === 2 && inPart) {
      close(index);
      current = { start: index, heading, part, headings: [heading] };
      return;
    }
    current?.headings.push(heading);
  });
  close(lines.length);
  return { title, sections, parts };
}

export const GUIDE: Guide = readGuide(text);

/** The section a heading's address leads to, its own or one of its headings'. */
export function sectionFor(guide: Guide, slug: string): Section | undefined {
  return guide.sections.find((section) => section.headings.some((each) => each.slug === slug));
}

/** Where a picture named in the guide is in the app: "guide/app-map.png"; else nowhere. */
export function pictureUrl(src: string): string {
  return PICTURES[src.replace(/^\.\//, "")] ?? "";
}

/** What a link in the guide leads to: a section here, a page on the web, or a file of the
 *  guide's repository, on GitHub. */
export function linkTarget(href: string): { section: string } | { web: string } | null {
  if (href.startsWith("#")) return { section: decodeURIComponent(href.slice(1)) };
  if (/^(https?:|mailto:)/i.test(href)) return { web: href };
  if (/^[\w./-]+(#[\w-]+)?$/.test(href) && !href.includes("..")) {
    return { web: REPOSITORY + href.replace(/^\.\//, "") };
  }
  return null;
}

export type Found = { section: Section; snippet: string };

/**
 * Sections with every word asked for, those with them in their title first, then by how often
 * they say them; each with the words around the first.
 */
export function searchGuide(guide: Guide, query: string): Found[] {
  const wanted = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!wanted.length) return [];
  const found = guide.sections.flatMap((section) => {
    const words = `${section.title} ${section.plain}`.toLowerCase();
    if (!wanted.every((word) => words.includes(word))) return [];
    const inTitle = wanted.every((word) => section.title.toLowerCase().includes(word));
    const often = wanted.reduce((sum, word) => sum + words.split(word).length - 1, 0);
    const at = section.plain.toLowerCase().indexOf(wanted[0] ?? "");
    const from = Math.max(0, at - 60);
    const snippet =
      at < 0
        ? section.plain.slice(0, 140)
        : `${from > 0 ? "…" : ""}${section.plain.slice(from, at + 100)}…`;
    return [{ section, snippet, score: (inTitle ? 1000 : 0) + often }];
  });
  return found
    .sort((a, b) => b.score - a.score)
    .map(({ section, snippet }) => ({ section, snippet }));
}
