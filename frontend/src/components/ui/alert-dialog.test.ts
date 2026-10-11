import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function code(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

// An alert dialog is data-[size=default]:sm:max-w-sm wide (alert-dialog.tsx), and that outranks
// a plain sm:max-w-xl in the CSS: asked for that way, a wider window stays narrow, as the
// keeper's invitation did, its long line past the window's edge and Copy with it. Asked
// for with the same data-[size=…] start, cn swaps it for the default.
describe("an alert dialog's width", () => {
  it("is asked for in the way that replaces its default", () => {
    const widths = code(SRC).flatMap((path) =>
      [...readFileSync(path, "utf-8").matchAll(/<AlertDialogContent[^>]*className="([^"]*)"/g)]
        .flatMap((found) => (found[1] ?? "").split(/\s+/))
        .filter((name) => /(^|:)max-w-/.test(name))
        .map((name) => `${relative(SRC, path)}: ${name}`),
    );
    expect(widths.length).toBeGreaterThan(0); // the invitation's, at least
    expect(widths.filter((width) => !/: data-\[size=(default|sm)\]:/.test(width))).toEqual([]);
  });
});
