import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DRAWING } from "./drawing";

/*
 * One look. Every colour on screen is one of the theme's tokens, named for what it
 * means (`index.css`'s `:root`), or a drawing colour named in `drawing.ts`; no text is under
 * 12 px; a hint is a tooltip, which shows on focus too, never a `title`; and the theme's text
 * reads at 4.5:1 or better on every surface it sits on. Each finding names its file and line.
 * Tests are left out: they may name what they look for.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));
const CSS = join(SRC, "index.css");

/** Where colours may be written: the theme's tokens, and the drawing colours. */
const DRAWING_FILE = join(SRC, "styles", "drawing.ts");

/** The pages' code: TypeScript and TSX, tests and the API's generated types left out. */
function code(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Each line of a file that matches, as "file:line: what"; `what` returns null to pass it. */
function lines(
  path: string,
  text: string,
  pattern: RegExp,
  what: (found: string, group: string) => string | null,
) {
  return text.split("\n").flatMap((line, index) =>
    [...line.matchAll(pattern)].flatMap((found) => {
      const said = what(found[0], found[1] ?? "");
      return said === null
        ? []
        : [`${relative(SRC, path).replaceAll("\\", "/")}:${index + 1}: ${said}`];
    }),
  );
}

// Tailwind's own palette, by name: the theme's tokens stand in for every one of them.
const HUES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITIES =
  "bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|fill|stroke|from|via|to|outline|divide|placeholder|decoration|shadow|accent|caret|inset-shadow|inset-ring";
const PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITIES})-(?:(?:${HUES})-\\d{2,3}|white|black)(?![\\w-])`,
  "g",
);
// #rgb, #rgba, #rrggbb or #rrggbbaa, in a class's [text-shadow:0_0_2px_#fff] too: not an
// address's #section, nor &#123;.
const HEX = /(?<![&0-9A-Za-z])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab)\(/g;
const NAMED_COLOUR =
  /\b(?:fill|stroke|color|colour|stopColor|background|backgroundColor|borderColor)\s*[=:]\s*\{?\s*["'](?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink)["']/g;

/** What may hold a colour of its own: nothing outside the drawing colours. */
function handWrittenColours(path: string, text: string): string[] {
  const found = lines(path, text, PALETTE_CLASS, (name) => `Tailwind's ${name}`);
  if (path === DRAWING_FILE) return found;
  return [
    ...found,
    ...lines(path, text, HEX, (hex) => `the colour ${hex}`),
    ...lines(path, text, COLOUR_FUNCTION, (call) => `the colour ${call}…)`),
    ...lines(path, text, NAMED_COLOUR, (named) => `the colour in ${named}`),
  ];
}

/** index.css without its `:root` block, where the tokens are given their values. */
function cssOutsideTokens(): string {
  return readFileSync(CSS, "utf-8").replace(/^:root \{[^}]*\}/m, (block) =>
    block.replace(/[^\n]/g, ""),
  );
}

const SMALL_CLASS = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\](?![\w-])/g;
const SMALL_STYLE = /\bfontSize:\s*(\d+(?:\.\d+)?)\b(?!\s*[-+*/])/g;
const SMALL_BASE = /\bfontSize:[^};\n]*?\b(\d+(?:\.\d+)?)\s*\+/g; // min(18, 10 + radius / 5): 10
const SMALL_SVG = /\bfont-size="(\d+(?:\.\d+)?)"/g;
const SMALL_CSS = /\bfont-size:\s*(\d*\.?\d+)(px|rem)\b/g;

/** Text under 12 px, however it's asked for. */
function smallText(path: string, text: string): string[] {
  return [SMALL_CLASS, SMALL_STYLE, SMALL_BASE, SMALL_SVG, SMALL_CSS].flatMap((pattern) =>
    lines(path, text, pattern, (found, size) => {
      const pixels = Number(size) * (/\d\s*rem\b|\drem\]/.test(found) ? 16 : 1);
      return pixels < 12 ? `text of ${pixels} px (${found.trim()})` : null;
    }),
  );
}

/** Where a component passes `title` on to the page as it is: a hint, there too. */
const PASSES_ON = /^(?:react-router|radix-ui|lucide-react|@xyflow\/react|@\/components\/ui\/)/;
/** Of those, the ones whose `title` is a name: a dialog's, read out as it opens. */
const NAMES = new Set(["CommandDialog"]);

/** `title` used as a hint: on an element of the page (an iframe's title names it, and stays),
 *  or on a component that passes it on; and SVG's `<title>`, which the browser shows the same
 *  way. A component's own `title` prop, such as a section's heading, isn't one. */
function titleHints(path: string, text: string): string[] {
  if (!path.endsWith(".tsx")) return [];
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const from = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const each of named.elements) from.set(each.name.text, statement.moduleSpecifier.text);
    }
  }
  const hinting = (tag: string) =>
    /^[a-z]/.test(tag)
      ? tag !== "iframe"
      : !NAMES.has(tag) && PASSES_ON.test(from.get(tag.split(".")[0] ?? "") ?? "");
  const found: string[] = [];
  const at = (node: ts.Node) =>
    `${relative(SRC, path).replaceAll("\\", "/")}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === "title") {
      const element = node.parent.parent;
      if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
        const tag = element.tagName.getText(file);
        if (hinting(tag)) found.push(`${at(node)}: <${tag} title=…>, a hint`);
      }
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === "title") {
      found.push(`${at(node)}: SVG's <title>, a hint`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("one look", () => {
  const files = code().map((path) => [path, readFileSync(path, "utf-8")] as const);

  it("has no colour written by hand: each is a token of the theme, or a drawing colour", () => {
    expect(files.length).toBeGreaterThan(100);
    const css = cssOutsideTokens();
    const inCss = [
      ...lines(CSS, css, HEX, (hex) => `the colour ${hex}`),
      ...lines(CSS, css, COLOUR_FUNCTION, (call) => `the colour ${call}…)`),
    ];
    expect([...files.flatMap(([path, text]) => handWrittenColours(path, text)), ...inCss]).toEqual(
      [],
    );
  });

  it("has no text under 12 px", () => {
    const css = readFileSync(CSS, "utf-8");
    expect([
      ...files.flatMap(([path, text]) => smallText(path, text)),
      ...smallText(CSS, css),
    ]).toEqual([]);
  });

  it("gives hints as tooltips, never as a title", () => {
    expect(files.flatMap(([path, text]) => titleHints(path, text))).toEqual([]);
  });

  it("finds what it looks for", () => {
    // Each rule, on a line that breaks it, so a rule that finds nothing fails here.
    const here = join(SRC, "here.tsx");
    expect(
      handWrittenColours(here, `<p className="hover:text-stone-500 bg-white/90" />`),
    ).toHaveLength(2);
    expect(
      handWrittenColours(here, `const sea = "#eef4f7"; fill="rgb(1 2 3)"; stroke="white"`),
    ).toHaveLength(3);
    expect(
      handWrittenColours(here, `<a href="#13-the-map" className="text-muted-foreground" />`),
    ).toEqual([]);
    expect(
      smallText(here, `text-[11px] text-[0.6rem] text-[12px] fontSize: 10 fontSize: 10 + r`),
    ).toHaveLength(4);
    expect(smallText(here, `font-size="11" font-size: 10px; text-xs fontSize: 12`)).toHaveLength(2);
    const hints = `import { Link } from "react-router";
      import { Panel } from "./Panel";
      <><button title="Undo" /><Link to="/" title="Home" /><Panel title="Sign in" /><iframe title="Map" /><svg><title>A</title></svg></>`;
    expect(titleHints(here, hints)).toHaveLength(3);
  });
});

/*
 * The theme's text against the surfaces it sits on (WCAG's contrast, 4.5:1 for text), from the
 * tokens' own values in index.css. The focus ring is a line, at 3:1.
 */

type Rgb = [number, number, number]; // linear sRGB, 0 to 1

/** A token's value: oklch(L C h), with L as a fraction or a percentage, or #rrggbb. */
function linear(value: string): Rgb {
  const clamp = (rgb: number[]) => rgb.map((each) => Math.min(1, Math.max(0, each))) as Rgb;
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex?.[1]) {
    return clamp(
      [0, 2, 4].map((at) => {
        const channel = Number.parseInt(hex[1]?.slice(at, at + 2) ?? "0", 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }),
    );
  }
  const oklch = /^oklch\(([\d.]+)(%?) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!oklch) throw new Error(`Can't read the colour ${value}`);
  const lightness = Number(oklch[1]) / (oklch[2] ? 100 : 1);
  const chroma = Number(oklch[3]);
  const hue = (Number(oklch[4]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return clamp([
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]);
}

function contrast(one: string, other: string): number {
  const luminance = (value: string) => {
    const [r, g, b] = linear(value);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(other)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The tokens, as `:root` gives them. */
function tokens(): Map<string, string> {
  const block = /^:root \{([^}]*)\}/m.exec(readFileSync(CSS, "utf-8"))?.[1] ?? "";
  return new Map(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((found) => [
      found[1] ?? "",
      (found[2] ?? "").trim(),
    ]),
  );
}

const SURFACES = ["background", "card", "popover", "muted"];
const TEXTS = [
  "foreground",
  "muted-foreground",
  "faint",
  "link",
  "highlight",
  "warning",
  "kin",
  "kin-soft-foreground",
  "story-soft-foreground",
  "today-foreground",
  "destructive",
  "success",
];

describe("the theme's contrast", () => {
  const theme = tokens();
  const value = (name: string) => {
    const found = theme.get(name);
    if (!found) throw new Error(`index.css has no --${name}`);
    return found;
  };

  it.each(TEXTS)("%s reads at 4.5:1 on every surface", (text) => {
    for (const surface of SURFACES) {
      expect(contrast(value(text), value(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("reads at 4.5:1 in the soft boxes, and on every fill", () => {
    const pairs: [string, string][] = [
      ["highlight-soft-foreground", "highlight-soft"],
      ["muted-foreground", "highlight-soft"],
      ["faint", "highlight-soft"],
      ["link", "highlight-soft"],
      ["highlight-soft-foreground", "highlight-tint"],
      ["warning-soft-foreground", "warning-soft"],
      ["warning-soft-foreground", "warning-tint"],
      ["warning", "warning-soft"],
      ["kin", "kin-soft"],
      ["kin-soft-foreground", "kin-soft"],
      ["story-soft-foreground", "story-soft"],
      ["muted-foreground", "warning-soft"],
      ["faint", "warning-soft"],
      ["link", "warning-soft"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["accent-foreground", "accent"],
      ["highlight-foreground", "highlight"],
      ["warning-foreground", "warning"],
      ["map-circle-foreground", "map-circle"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
    ];
    for (const [text, surface] of pairs) {
      expect(contrast(value(text), value(surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("draws the focus ring at 3:1 on every surface, and the story's book on its mark", () => {
    for (const surface of SURFACES) {
      expect(contrast(value("ring"), value(surface)), `ring on ${surface}`).toBeGreaterThanOrEqual(
        3,
      );
    }
    expect(contrast(value("story-mark-foreground"), value("story-mark"))).toBeGreaterThanOrEqual(3);
  });

  it("gives the drawing colours index.css uses the values drawing.ts has", () => {
    const named: [string, string][] = [
      ["tree-line", DRAWING.line],
      ["tree-line-strong", DRAWING.lineStrong],
      ["tree-marriage", DRAWING.marriage],
      ["tree-pair", DRAWING.pair],
      ["tree-kin", DRAWING.kin],
    ];
    for (const [name, colour] of named) expect(value(name), name).toBe(colour);
  });
});
