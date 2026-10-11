import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import text from "@guide/GUIDE.md?raw";
import { describe, expect, it } from "vitest";

/*
 * The guide names each button as the app shows it: every word in bold is on the
 * screen, word for word. A button renamed in the app fails this until the guide follows, so the
 * two never drift apart. The guide's own labels are in italics, not bold.
 */

/** The repository's root: frontend/src/features/guide is four folders down. */
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Where the app's words are: its pages, the engine's messages, and the desktop shell's own:
 *  its first-start page and the menu of its icon by the clock. Tests left out. */
const PLACES: [string, RegExp][] = [
  ["frontend/src", /\.tsx?$/],
  ["backend/src", /\.py$/],
  ["desktop/loading", /\.(html|js)$/],
  ["desktop/src-tauri/src", /\.rs$/],
];

function appWords(): string {
  const texts: string[] = [];
  for (const [folder, wanted] of PLACES) {
    const at = join(ROOT, folder);
    if (!existsSync(at)) throw new Error(`no ${folder}`);
    for (const name of readdirSync(at, { recursive: true }) as string[]) {
      if (!wanted.test(name) || /(\.test\.|^test_|[\\/]test_)/.test(name)) continue;
      texts.push(readFileSync(join(at, name), "utf-8"));
    }
  }
  // As the screen shows it: JSX's line breaks are spaces, and quotes are as typed.
  return texts
    .join("\n")
    .replace(/\s+/g, " ")
    .replace(/\\'/g, "'")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

/** Words of the other programs the guide walks through, in bold as their screens show them. */
const OTHERS: Record<string, string[]> = {
  windows: [
    "Start",
    "Downloads",
    "Windows protected your PC",
    "More info",
    "Run anyway",
    "Smart App Control",
    "Smart App Control settings",
    "Off",
    "On",
    "Settings → Apps → Installed apps",
    "Uninstall",
    "Settings → Privacy & security → Device encryption",
    "Manage BitLocker",
    "Turn on BitLocker",
    "Enter",
  ],
  // The Windows installer, Tauri's own.
  installer: [
    "Next",
    "Install",
    "Finish",
    "Run AncesTree",
    "Create desktop shortcut",
    "Delete the application data",
  ],
  mac: [
    "Done",
    "Move to Trash",
    "System Settings",
    "Privacy & Security",
    "Security",
    "Open Anyway",
    "Applications",
    "Go → Go to Folder…",
    "System Settings → Privacy & Security → FileVault",
    "Turn On",
    "About This Mac",
    "Return",
  ],
  google: [
    "Google hasn't verified this app",
    "Advanced",
    "Go to AncesTree (unsafe)",
    "Continue",
    "New project",
    "Create",
    "APIs & Services → Library",
    "Google Drive API",
    "Enable",
    "Google Auth platform",
    "Get started",
    "App name",
    "User support email",
    "Audience",
    "External",
    "Contact information",
    "Data Access",
    "Add or remove scopes",
    "Manually add scopes",
    "Update",
    "Save",
    "Publishing status",
    "Publish app",
    "Confirm",
    "Clients",
    "Create client",
    "Application type",
    "Desktop app",
    "Download JSON",
    "IAM & Admin → IAM → Grant access",
    "Owner",
  ],
  github: ["Assets"],
  linux: ["Properties", "Executable as Program", "Allow executing file as program", "AppIndicator"],
};

/** Keys to press, and the symbols on buttons that show no word. */
const KEYS = /^(Ctrl|Shift|Command|Control|Alt|Option)\b|^⌘|^(\+|−|×|\?|\^|…|☰|F)$/;

/** The guide's bold words, as written: none from its code or its diagrams. */
function boldWords(markdown: string): string[] {
  const prose = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/`[^`\n]*`/g, "");
  return [...prose.matchAll(/\*\*(.+?)\*\*/g)].map(([, words]) => words ?? "");
}

/** Whether the app says these words: "…" stands for what the app fills in, such as a name,
 *  and "A → B" is a place inside another, such as Settings → Backups. */
function said(words: string, app: string): boolean {
  const clean = words
    .trim()
    .replace(/^["“]|["”]$/g, "")
    .replace(/[:.,]$/, "")
    .trim();
  if (!clean || KEYS.test(clean)) return true;
  if (Object.values(OTHERS).some((list) => list.includes(clean))) return true;
  const pieces = clean.includes(" → ") ? clean.split(" → ") : [clean];
  return pieces.every((piece) => {
    const parts = piece
      .split("…")
      .map((part) => part.trim())
      .filter(Boolean);
    const escaped = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return new RegExp(escaped.join(".{0,80}?")).test(app);
  });
}

describe("the guide's words", () => {
  const app = appWords();

  it("names every button and message as the app shows it", () => {
    const words = boldWords(text);
    expect(words.length).toBeGreaterThan(300);
    expect([...new Set(words.filter((each) => !said(each, app)))]).toEqual([]);
  });

  it("knows the app's words when it sees them, and not others", () => {
    expect(said("Settings → Family folder", app)).toBe(true);
    expect(said("Bring in … changes", app)).toBe(true);
    expect(said("Ctrl+Shift+N", app)).toBe(true);
    expect(said("Run anyway", app)).toBe(true);
    expect(said("Make the family disappear", app)).toBe(false);
    expect(said("Settings → Nowhere", app)).toBe(false);
  });

  it("finds bold words only in the guide's prose", () => {
    expect(boldWords("**One** and `**two**`\n```\n**three**\n```\n<!-- **four** -->")).toEqual([
      "One",
    ]);
  });
});
