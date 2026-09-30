import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function code(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

// A view-only copy answers the API itself (src/viewer/answers.ts), and hands out its photos and
// downloads through src/api/addresses.ts. An address written anywhere else would go past it.
describe("the API's addresses", () => {
  it("are written only in src/api, and in the copy's answers", () => {
    const allowed = [join(SRC, "api") + sep, join(SRC, "viewer", "answers.ts")];
    const elsewhere = code(SRC)
      .filter((path) => !allowed.some((place) => path.startsWith(place)))
      .filter((path) => /["'`]\/api\//.test(readFileSync(path, "utf-8")))
      .map((path) => relative(SRC, path));
    expect(elsewhere).toEqual([]);
  });
});
