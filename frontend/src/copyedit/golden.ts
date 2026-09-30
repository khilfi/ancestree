/**
 * The golden files written by Python (backend/tests/copy_golden.py), which a backend test keeps
 * up to date: made-up families as a copy to edit carries them, and what Python makes of them
 *. For tests only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Graph, GraphLayout, KindView, PersonDetail } from "@/api/types";
import type { TwinInputs } from "@/kinship/twin";
import type { CopyFamily } from "./family";

export type CopyGolden = {
  about: string;
  year: number;
  kinship: TwinInputs;
  kinds: KindView[];
  family: CopyFamily;
  graph: Partial<Graph> & Pick<Graph, "layout">; // the big family keeps only its seats
  layouts: Record<string, GraphLayout>;
  details: Record<string, Partial<Record<"en" | "ms" | "jv", PersonDetail>>>;
};

export type CopyGoldenName = "seed" | "tables" | "notes" | "generated";

export function copyGolden(name: CopyGoldenName): CopyGolden {
  // From frontend/, where the tests run: in jsdom, import.meta.url isn't a file's address.
  const file = resolve("src", "copyedit", "golden", `${name}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as CopyGolden;
}
