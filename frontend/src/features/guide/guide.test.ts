import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import text from "@guide/GUIDE.md?raw";
import { describe, expect, it } from "vitest";
import {
  GUIDE,
  linkTarget,
  pictureUrl,
  readGuide,
  searchGuide,
  sectionFor,
  slugFor,
} from "./guide";
import { GUIDE_AT } from "./places";

/** GUIDE.md where it is: in public/ here, or at the root of the public repository. */
function guideOnDisk(): string {
  const [here] = ["../../../../public/GUIDE.md", "../../../../GUIDE.md"]
    .map((path) => fileURLToPath(new URL(path, import.meta.url)))
    .filter((path) => existsSync(path));
  if (!here) throw new Error("no GUIDE.md");
  return readFileSync(here, "utf-8");
}

const slug = (heading: string) => slugFor(heading, new Map());

describe("the guide in the app", () => {
  it("is GUIDE.md itself, as GitHub shows it: no copy to keep in step", () => {
    expect(text).toBe(guideOnDisk());
    expect(GUIDE.title).toBe("The AncesTree guide");
  });

  it("names each heading's address as GitHub does", () => {
    expect(slug("13. The map")).toBe("13-the-map");
    expect(slug("Your family's Google project")).toBe("your-familys-google-project");
    expect(slug("Me: telling AncesTree who you are")).toBe("me-telling-ancestree-who-you-are");
    expect(slug("Settings → Help")).toBe("settings--help");
    expect(slug("**Bold**, `code` and [a link](https://example.org)")).toBe("bold-code-and-a-link");
    expect(slug("Kampung Laut, Tumpat")).toBe("kampung-laut-tumpat");
    expect(slug("Ibu & bapa")).toBe("ibu--bapa");
    const taken = new Map<string, number>();
    expect(["Join", "Join", "Join"].map((each) => slugFor(each, taken))).toEqual([
      "join",
      "join-1",
      "join-2",
    ]);
  });

  it("has its start, then its four parts, each with its sections", () => {
    const [start] = GUIDE.sections;
    expect(start?.title).toBe("The AncesTree guide");
    expect(start?.headings.map((heading) => heading.slug)).toContain("contents");
    expect(GUIDE.parts.map((part) => part.title)).toEqual([
      "Part 1: Get started",
      "Part 2: Use AncesTree",
      "Part 3: The family folder",
      "Part 4: Look after AncesTree",
    ]);
    const numbered = GUIDE.sections.filter((section) => /^\d+\. /.test(section.title));
    expect(numbered.map((section) => Number.parseInt(section.title, 10))).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 1),
    );
    // A part that says something before its first section is a section of its own.
    expect(sectionFor(GUIDE, "keeping-in-step")?.title).toBe("Part 3: The family folder");
    expect(sectionFor(GUIDE, "on-a-mac")?.title).toBe("2. Install AncesTree");
  });

  it("leads every link between its sections somewhere, as on GitHub", () => {
    const links = [...text.matchAll(/\]\(#([^)]+)\)/g)].map(([, anchor]) => anchor ?? "");
    expect(links.length).toBeGreaterThan(50);
    const lost = links.filter((anchor) => sectionFor(GUIDE, anchor) === undefined);
    expect(lost).toEqual([]);
  });

  it("has every picture it shows", () => {
    const pictures = [
      ...[...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map(([, src]) => src ?? ""),
      ...[...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(([, src]) => src ?? ""),
    ];
    expect(pictures.length).toBeGreaterThan(20);
    expect(pictures.filter((src) => pictureUrl(src) === "")).toEqual([]);
  });

  it("shows no notes left for pictures to come", () => {
    expect(text).toContain("<!-- picture:");
    for (const section of GUIDE.sections) expect(section.markdown).not.toContain("<!--");
  });

  it("opens each place's How does this work? at its section", () => {
    const missing = Object.entries(GUIDE_AT).filter(([, slug]) => !sectionFor(GUIDE, slug));
    expect(missing).toEqual([]);
  });

  it("finds sections by their words, those named so first", () => {
    const found = searchGuide(GUIDE, "Backups");
    expect(found[0]?.section.title).toBe("20. Backups");
    expect(found.length).toBeGreaterThan(3);
    expect(searchGuide(GUIDE, "recovery code").every(({ snippet }) => snippet.length > 0)).toBe(
      true,
    );
    expect(searchGuide(GUIDE, "zzz no such words")).toEqual([]);
    expect(searchGuide(GUIDE, "   ")).toEqual([]);
  });

  it("finds nothing in a diagram's source, and shows none of it", () => {
    const guide = readGuide(
      '# A guide\n\n# Part 1: First\n\n## 1. One\n\nThe first day.\n\n```mermaid\nflowchart TD\n  A["Install AncesTree"] --> B["The first day"]\n```\n\nThen install AncesTree.\n',
    );
    expect(searchGuide(guide, "flowchart")).toEqual([]);
    const found = searchGuide(guide, "install");
    expect(found.map(({ snippet }) => snippet)).toEqual([
      "1. One The first day. Then install AncesTree.…",
    ]);
    expect(searchGuide(GUIDE, "keeper").some(({ snippet }) => /mermaid|-->/.test(snippet))).toBe(
      false,
    );
  });

  it("opens links as GitHub would, and never one that runs something", () => {
    expect(linkTarget("#13-the-map")).toEqual({ section: "13-the-map" });
    expect(linkTarget("https://myaccount.google.com/permissions")).toEqual({
      web: "https://myaccount.google.com/permissions",
    });
    expect(linkTarget("SECURITY.md")).toEqual({
      web: "https://github.com/khilfi/ancestree/blob/main/SECURITY.md",
    });
    for (const harmful of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "../../etc/hosts",
      "file:///C:/",
    ]) {
      expect(linkTarget(harmful), harmful).toBeNull();
    }
  });

  it("reads a part with nothing of its own as a label, and code as code", () => {
    const guide = readGuide(
      "# A guide\n\nHello.\n\n# Part 1: First\n\n## 1. One\n\n```\n# not a heading\n```\n\n# Part 2: Second\n\nSomething.\n\n### Inside\n",
    );
    expect(guide.parts.map((part) => part.sections.map((section) => section.title))).toEqual([
      ["1. One"],
      ["Part 2: Second"],
    ]);
    expect(guide.sections[1]?.markdown).toContain("# not a heading");
    expect(sectionFor(guide, "inside")?.title).toBe("Part 2: Second");
  });
});
