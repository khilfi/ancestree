/**
 * Putting relationships into words from a word list per language
 * (backend/src/ancestree/kinship/terms.py). The lists travel in the copy as the backend
 * reads them; these are the rules that read them. Where a language has no word, a term says
 * the relation in pieces, as that language would; a blank word is never guessed.
 */
import type { Gender } from "@/api/types";
import type { Place } from "./blood";
import type { TwinKind } from "./family";
import type { Blood, Kin, KindSibling } from "./kin";
import { blood as bloodKin } from "./kin";

const MAX_CHAIN = 6; // longer than this, a chain of relations stops being an answer
const KINDS_FROM_SETTINGS = "settings";
const VOWELS = new Set("aeiouéèåAEIOUÉÈÅ");

type Data = Record<string, unknown>;
type Values = Record<string, string | null | undefined>;

const isMapping = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const mapping = (value: unknown): Data => (isMapping(value) ? value : {});
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Python's str.format for the templates in the lists: {name} blanks, {{ and }} for braces.
 *  Anything it can't fill is no word at all. */
function format(template: string, values: Values): string | null {
  let out = "";
  for (let i = 0; i < template.length; ) {
    const char = template[i] as string;
    const next = template[i + 1];
    if ((char === "{" || char === "}") && next === char) {
      out += char;
      i += 2;
    } else if (char === "{") {
      const close = template.indexOf("}", i + 1);
      const field = close < 0 ? "" : template.slice(i + 1, close);
      if (!/^[A-Za-z_]\w*$/.test(field) || !Object.hasOwn(values, field)) return null;
      out += values[field] || "";
      i = close + 1;
    } else if (char === "}") {
      return null; // a single "}"
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/** A template with its blanks filled; null if it's blank or a value it needs is missing. */
export function fill(template: string | null | undefined, values: Values): string | null {
  if (!template) return null;
  for (const [name, value] of Object.entries(values)) {
    if (template.includes(`{${name}}`) && !value) return null;
  }
  return format(template, values);
}

/** The word for this gender; "any" suits everyone; "unknown" is the neutral word. */
function gendered(entry: Data, gender: Gender): string | null {
  for (const key of [gender, "any", "unknown"]) {
    const value = entry[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function pick(entry: unknown, gender: Gender): string | null {
  if (typeof entry === "string") return entry || null;
  return isMapping(entry) ? gendered(entry, gender) : null;
}

/** A word chosen by seniority or birth order: {elder: …} or {male: {elder: …}}. */
function by(table: unknown, key: string | null, gender: Gender): string | null {
  if (!key || !isMapping(table)) return null;
  const value = table[key];
  if (typeof value === "string") return value || null;
  if (isMapping(value)) return gendered(value, gender);
  const byGender = table[gender];
  if (isMapping(byGender)) return text(byGender[key]) || null;
  return null;
}

function englishOrdinal(number: number): string {
  const tens = number % 100;
  const suffix =
    tens >= 10 && tens <= 20 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] ?? "th");
  return `${number}${suffix}`;
}

function forGender(
  label: { neutral: string; male?: string | null; female?: string | null },
  gender: Gender,
): string {
  if (gender === "male" && label.male) return label.male;
  if (gender === "female" && label.female) return label.female;
  return label.neutral;
}

/** Birth-order titles, e.g. Malay long, ngah, lang … su. */
export type Titles = { places: string[]; youngest: string };

/** One language's words, as the copy carries them (services/kinship.py twin_inputs). */
export type Book = { code: string; data: Data; titles: Titles };

export class TermBook {
  readonly code: string;
  readonly data: Data;
  readonly titles: Titles;
  readonly language: string;

  constructor(book: Book) {
    this.code = book.code;
    this.data = book.data;
    this.titles = book.titles;
    this.language = String(book.data.language || "");
  }

  // --- Whole answers ---------------------------------------------------------------------

  /** "Siti is Ali's aunt"; null when this language can't say it yet. */
  sentence(b: string, a: string, term: string | null): string | null {
    if (!term) return null;
    return fill(this.grammar("sentence"), { b, a, term });
  }

  term(kin: Kin, kinds: ReadonlyMap<string, TwinKind>): string | null {
    switch (kin.type) {
      case "blood":
        // No word for it (a parent's cousin, in Malay): say it in its two pieces.
        return this.blood(kin) || (kin.parts.length ? this.chain(kin.parts, kinds) : null);
      case "spouse": {
        const word = pick(this.section("marriage")["="], kin.gender);
        return kin.former ? this.former(word) : word;
      }
      case "kindStep":
        return this.kindWord(kinds, kin.kind, kin.upward ? "parent" : "child", kin.gender);
      case "kindSibling":
        return this.kindSibling(kin, kinds);
      case "compound": {
        const [word] = this.pickDetailed(
          this.section(kin.group)[kin.key],
          kin.gender,
          kin.seniority,
          kin.place,
        );
        if (word) return kin.former ? this.former(word) : word;
        return this.chain(kin.parts, kinds); // no single word for it: say it in pieces
      }
      case "chain":
        return this.chain(kin.parts, kinds);
    }
  }

  // --- Blood -----------------------------------------------------------------------------

  blood(kin: Blood): string | null {
    const { up, down } = kin;
    const entry = this.section("blood")[`${up},${down}`];
    let word: string | null;
    let saidSeniority = false;
    if (entry !== undefined && entry !== null) {
      [word, saidSeniority] = this.pickDetailed(entry, kin.gender, kin.seniority, kin.place);
    } else {
      word = this.bloodPattern(up, down, kin.gender);
    }
    if (!word) return null;
    if (up === 1 && down === 1) {
      if (kin.half) {
        // "Half-brother"; a language may say which parent is shared (half_paternal).
        const names = kin.side ? [`half_${kin.side}`, "half"] : ["half"];
        word = this.compose(names, { term: word });
      }
      if (kin.seniority && !saidSeniority) {
        word = this.compose(["seniority"], { term: word, seniority: this.word(kin.seniority) });
      }
    }
    if (down === 0 && up >= 2 && kin.side) {
      word = this.compose(["side"], { term: word, side: this.word(kin.side) });
    }
    return word;
  }

  private bloodPattern(up: number, down: number, gender: Gender): string | null {
    const patterns = this.section("patterns");
    if (down === 0 && up >= 4) {
      return fill(pick(patterns.ancestor, gender), { nth: this.nth(up - 2) });
    }
    if (up === 0 && down >= 4) {
      return fill(pick(patterns.descendant, gender), { nth: this.nth(down - 2) });
    }
    if (down === 1 && up >= 4) {
      return fill(pick(patterns.uncle, gender), {
        nth: this.nth(up - 2),
        ancestor: this.blood(bloodKin(up - 1, 0, "unknown")),
      });
    }
    if (up === 1 && down >= 5) {
      return fill(pick(patterns.nephew, gender), {
        nth: this.nth(down - 3),
        descendant: this.blood(bloodKin(0, down - 1, "unknown")),
      });
    }
    if (up >= 2 && down >= 2) {
      const cousin = fill(text(patterns.cousin), {
        degree: this.listed("degrees", Math.min(up, down) - 1),
      });
      if (up === down) return cousin;
      return fill(text(patterns.removed), {
        cousin,
        times: this.listed("times", Math.abs(up - down)),
      });
    }
    return null;
  }

  // --- Other kinds of link -------------------------------------------------------------

  /** "adoptive father", "bapa angkat": the words set in Settings, in this language where the
   *  kind has them, otherwise its English ones. */
  private kindWord(
    kinds: ReadonlyMap<string, TwinKind>,
    kind: string,
    side: "parent" | "child",
    gender: Gender,
  ): string | null {
    if (this.data.kinds === KINDS_FROM_SETTINGS) {
      const definition = kinds.get(kind);
      if (!definition) return null;
      const said = definition.words?.[this.code] ?? definition;
      return forGender(side === "parent" ? said.parent_label : said.child_label, gender);
    }
    return pick(mapping(this.section("kinds")[kind])[side], gender);
  }

  private kindSibling(kin: KindSibling, kinds: ReadonlyMap<string, TwinKind>): string | null {
    let word: string | null;
    let said: boolean;
    if (this.data.kinds === KINDS_FROM_SETTINGS) {
      const definition = kinds.get(kin.kind);
      let sibling: string | null;
      [sibling, said] = this.pickDetailed(
        this.section("blood")["1,1"],
        kin.gender,
        kin.seniority,
        null,
      );
      if (!definition || !sibling) return null;
      const words = definition.words?.[this.code];
      const adjective = words ? words.label : definition.label.toLowerCase();
      word = this.compose(["kind"], { kind: adjective, term: sibling });
    } else {
      const entry = mapping(this.section("kinds")[kin.kind]).sibling;
      [word, said] = this.pickDetailed(entry, kin.gender, kin.seniority, null);
      if (!word) return null;
    }
    if (kin.seniority && !said) {
      word = this.compose(["seniority"], { term: word, seniority: this.word(kin.seniority) });
    }
    return word;
  }

  /** "wife's sister's husband": each part said from the one before it. */
  chain(parts: readonly Kin[], kinds: ReadonlyMap<string, TwinKind>): string | null {
    if (parts.length > MAX_CHAIN) return this.grammar("distant") || null;
    const words = parts.map((part) => this.term(part, kinds));
    if (!words.length || !words.every(Boolean)) return null;
    let said = words[0] as string | null;
    for (const word of words.slice(1)) {
      said = fill(this.grammar("possessive"), { owner: said, thing: this.owned(word) });
    }
    return said;
  }

  /** Javanese adds -é to what is owned, or -né after a vowel: bapaké, adhiné. */
  private owned(word: string | null): string | null {
    const suffix = mapping(this.section("grammar").possessive_suffix);
    if (!word || !Object.keys(suffix).length) return word;
    const afterVowel = text(suffix.after_vowel);
    const afterConsonant = text(suffix.after_consonant);
    return word
      .split(" / ")
      .map((alt) => alt + (VOWELS.has(alt.at(-1) ?? "") ? afterVowel : afterConsonant))
      .join(" / ");
  }

  // --- Grammar and words -----------------------------------------------------------------

  private section(name: string): Data {
    return mapping(this.data[name]);
  }

  private grammar(name: string): string {
    return text(this.section("grammar")[name]);
  }

  /** The most specific word an entry has, and whether it already says elder or younger:
   *  birth-order words first (pak long), then seniority (pakdhé, abang), then gender. */
  private pickDetailed(
    entry: unknown,
    gender: Gender,
    seniority: string | null,
    place: Place | null,
  ): [string | null, boolean] {
    if (isMapping(entry)) {
      if (place) {
        const word = this.byPlace(entry.by_birth_order, place, gender);
        if (word) return [word, false];
      }
      const word = by(entry.by_seniority, seniority, gender);
      if (word) return [word, true];
    }
    return [pick(entry, gender), false];
  }

  /** A word by B's place: named ("eldest", "youngest"), then a title template such as
   *  "pak {title}" with the family's titles, then "other". */
  private byPlace(table: unknown, place: Place, gender: Gender): string | null {
    if (!isMapping(table)) return null;
    const keys = place.keys();
    const other = keys[keys.length - 1] as string;
    for (const key of keys.slice(0, -1)) {
      const word = by(table, key, gender);
      if (word) return word;
    }
    const titled = table.titled;
    if (titled !== undefined && titled !== null) {
      const title = this.title(place);
      if (title) return fill(pick(titled, gender), { title });
    }
    return by(table, other, gender);
  }

  private title(place: Place): string | null {
    const { places, youngest } = this.titles;
    if (place.youngest && youngest) return youngest;
    const named = places[place.number - 1];
    if (place.number <= places.length && named) return named;
    return null;
  }

  private word(name: string): string | null {
    return text(this.section("words")[name]) || null;
  }

  /** Add a qualifier ("elder", "maternal", "former") with the first template the language has;
   *  without one, the bare term is still true, just less precise. */
  private compose(templates: readonly string[], values: Values): string | null {
    const term = values.term ?? null;
    for (const name of templates) {
      const template = this.grammar(name);
      if (template) return fill(template, values) || term;
    }
    return term;
  }

  private former(word: string | null): string | null {
    return word ? this.compose(["former"], { term: word }) : null;
  }

  /** "2nd", "3rd": the numbering in "2nd great-grandfather". */
  private nth(number: number): string | null {
    const style = this.grammar("nth");
    if (style === "english") return englishOrdinal(number);
    return fill(style, { n: String(number) });
  }

  /** "first", "second" (cousins); "once", "twice" (removed). Beyond the list: 11th. */
  private listed(name: string, number: number): string | null {
    const words = this.section("patterns")[name];
    if (Array.isArray(words) && number > 0 && number <= words.length && words[number - 1]) {
      return String(words[number - 1]);
    }
    const overflow = text(this.section("patterns")[`${name}_beyond`]);
    return fill(overflow, { n: String(number), nth: this.nth(number) });
  }
}
