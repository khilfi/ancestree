/**
 * The Kinship dictionary row an answer belongs to (backend/src/ancestree/kinship/dictionary.py
 * row_for), from the rows' relations as dictionary.yaml gives them.
 */
import type { Gender } from "@/api/types";
import { Place } from "./blood";
import { blood, type Kin } from "./kin";

type Spec = Record<string, unknown>;

/** A row's relation, as the finder would describe it (see the top of dictionary.yaml). */
export function kinFromSpec(spec: Spec): Kin {
  const gender = (
    typeof spec.gender === "string" && spec.gender ? spec.gender : "unknown"
  ) as Gender;
  const seniority = (spec.seniority as "elder" | "younger" | undefined) ?? null;
  const place = placeOf(spec.place);
  const parts = Array.isArray(spec.parts)
    ? spec.parts.map((part) => kinFromSpec(part as Spec))
    : [];
  if ("blood" in spec) {
    const [up, down] = String(spec.blood).split(",").map(Number) as [number, number];
    const side = (spec.side as string | undefined) ?? null;
    return blood(up, down, gender, {
      side,
      seniority,
      place,
      half: !!spec.half,
      parts: parts.filter((part) => part.type === "blood"),
    });
  }
  if ("marriage" in spec) return { type: "spouse", gender, former: !!spec.former };
  for (const group of ["in_law", "step"] as const) {
    if (group in spec) {
      return {
        type: "compound",
        key: String(spec[group]),
        group,
        gender,
        former: !!spec.former,
        parts,
        seniority,
        place,
      };
    }
  }
  if ("kind" in spec) {
    if (spec.side === "sibling") {
      return { type: "kindSibling", kind: String(spec.kind), gender, seniority };
    }
    return { type: "kindStep", kind: String(spec.kind), upward: spec.side === "parent", gender };
  }
  throw new Error(`A dictionary row names no relation: ${JSON.stringify(spec)}`);
}

/** "1/4": the eldest of four. */
function placeOf(value: unknown): Place | null {
  if (!value) return null;
  const [number, of] = String(value).split("/").map(Number) as [number, number];
  return new Place(number, of);
}

/** `weight` when the row specifies a detail that holds, 0 when it doesn't specify it, null
 *  when it specifies one that doesn't hold. */
function same(specified: boolean, holds: boolean, weight = 1): number | null {
  if (!specified) return 0;
  return holds ? weight : null;
}

function samePlace(row: Place | null, kin: Place | null): boolean {
  if (!row || !kin) return false;
  if (row.youngest || kin.youngest) return row.youngest === kin.youngest;
  return row.number === kin.number;
}

/** How well an answer fits a row: null when the row says something else; otherwise the number
 *  of details they share. A row's detail must hold for the answer. */
function match(row: Kin, kin: Kin): number | null {
  let checks: (number | null)[];
  if (row.type === "blood" && kin.type === "blood" && row.up === kin.up && row.down === kin.down) {
    checks = [
      same(row.gender !== "unknown", row.gender === kin.gender),
      same(row.seniority !== null, row.seniority === kin.seniority),
      same(row.half, kin.half),
      same(row.side !== null, row.side === kin.side),
      same(row.place !== null, samePlace(row.place, kin.place), 2),
    ];
  } else if (row.type === "spouse" && kin.type === "spouse") {
    checks = [
      same(row.gender !== "unknown", row.gender === kin.gender),
      same(true, row.former === kin.former),
    ];
  } else if (
    row.type === "compound" &&
    kin.type === "compound" &&
    row.group === kin.group &&
    row.key === kin.key
  ) {
    checks = [
      same(row.gender !== "unknown", row.gender === kin.gender),
      same(row.seniority !== null, row.seniority === kin.seniority),
      same(row.place !== null, samePlace(row.place, kin.place), 2),
    ];
  } else if (
    row.type === "kindStep" &&
    kin.type === "kindStep" &&
    row.kind === kin.kind &&
    row.upward === kin.upward
  ) {
    checks = [same(row.gender !== "unknown", row.gender === kin.gender)];
  } else if (row.type === "kindSibling" && kin.type === "kindSibling" && row.kind === kin.kind) {
    checks = [same(row.gender !== "unknown", row.gender === kin.gender)];
  } else {
    return null;
  }
  if (checks.some((check) => check === null)) return null;
  return checks.reduce<number>((sum, check) => sum + (check ?? 0), 0);
}

function shape(kin: Kin): string {
  switch (kin.type) {
    case "blood":
      return `blood|${kin.up}|${kin.down}`;
    case "compound":
      return `${kin.group}|${kin.key}`;
    case "kindStep":
      return `kind|${kin.kind}|${kin.upward}`;
    case "kindSibling":
      return `kind sibling|${kin.kind}`;
    default:
      return kin.type;
  }
}

export class DictionaryRows {
  private readonly rows: [string, Kin][];

  constructor(specs: readonly (readonly [string, Spec])[]) {
    this.rows = specs.map(([id, spec]) => [id, kinFromSpec(spec)]);
  }

  /** The row that matches the most of what the answer knows, else the row for the same kind
   *  of relation, e.g. a parent's cousin for any removed cousin above. */
  rowFor(kin: Kin): string | null {
    let best: [number, string] | null = null;
    for (const [id, row] of this.rows) {
      const score = match(row, kin);
      if (score !== null && (best === null || score > best[0])) best = [score, id];
    }
    return best ? best[1] : this.nearestRow(kin);
  }

  /** For an answer no row fits exactly: the row for the same kind of relation. */
  private nearestRow(kin: Kin): string | null {
    let loose: Kin;
    switch (kin.type) {
      case "blood": {
        const { up, down } = kin;
        if (up >= 2 && down >= 2 && up !== down)
          return up > down ? "cousin-of-parent" : "child-of-cousin";
        if (up === down && down >= 5) return "cousin-4";
        if (down === 1 && up >= 4) return kin.gender !== "female" ? "great-uncle" : "great-aunt";
        if (up === 1 && down >= 4) return "great-grandnephew";
        loose = blood(up, down, "unknown");
        break;
      }
      case "compound":
        loose = {
          ...kin,
          gender: "unknown",
          former: false,
          parts: [],
          seniority: null,
          place: null,
        };
        break;
      case "kindStep":
        loose = { ...kin, gender: "unknown" };
        break;
      case "kindSibling":
        loose = { ...kin, gender: "unknown", seniority: null };
        break;
      default:
        return null;
    }
    // The same relation with none of the details: any row of that shape.
    const wanted = shape(loose);
    return this.rows.find(([, row]) => shape(row) === wanted)?.[0] ?? null;
  }
}
