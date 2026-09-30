/**
 * The golden files written by the Python engine (backend/tests/kinship_golden.py), which a
 * backend test keeps up to date: made-up families, and their answers word for word.
 * For tests only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { KinshipAnswer } from "@/api/types";
import type { TwinInputs, TwinKind, TwinLink, TwinPerson } from "./twin";

export type Golden = {
  about: string;
  kinship: TwinInputs;
  kinds: TwinKind[];
  people: TwinPerson[];
  links: TwinLink[];
  answers: KinshipAnswer[];
};

export type GoldenName = "seed" | "tables" | "notes" | "generated";

export function golden(name: GoldenName): Golden {
  // From frontend/, where the tests run: in jsdom, import.meta.url isn't a file's address.
  const file = resolve("src", "kinship", "golden", `${name}.json.gz`);
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Golden;
}
