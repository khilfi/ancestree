/**
 * The fictional family as a copy to edit carries it, for tests: its records and word lists
 * from the seed's golden file, as exchange/copies.py puts them in a copy.
 */
import type { CopyPermissions } from "@/app/copy";
import type { CopySnapshot } from "@/viewer/snapshot";
import { copyGolden } from "./golden";

export const EVERYTHING: CopyPermissions = {
  add: true,
  change: true,
  remove: true,
  stories: true,
  photos: true,
};

const seed = copyGolden("seed");

/** Everyone's id in the fictional family, by full name. */
export const SEED_IDS = new Map(seed.family.people.map((person) => [person.full_name, person.id]));

/** A fresh copy to edit of the fictional family, for someone, allowing `may`. */
export function editableCopy(may: CopyPermissions = EVERYTHING): CopySnapshot {
  const family = structuredClone(seed.family);
  const made_at = "2026-09-29T00:00:00+00:00";
  return {
    format: 1,
    about: {
      title: "Keluarga Contoh",
      made_at,
      people: family.people.filter((person) => !person.placeholder).length,
      hidden_living: false,
      archive: false,
      family: "keluarga-contoh",
      version: "test",
      centres: [],
      editing: {
        id: "0199aaaa-0000-7000-8000-000000000001",
        for: "Mak Long",
        may,
        made_at,
        saved_at: null,
        hidden: [],
      },
    },
    health: {
      status: "ok",
      version: "test",
      database: "up",
      schema_version: null,
      database_version: null,
      data_folder: "",
      backup_folder: "",
    },
    map: { people: [], pins: [] },
    tree_settings: { centre: null, colours: "branch" },
    kinds: seed.kinds,
    dictionary: { rows: [] },
    kinship_settings: { language: "en", titles: [], youngest: "su" },
    kinship: seed.kinship,
    facts: {},
    stories: {},
    files: {},
    exports: {
      gedcom: null,
      csv: null,
      template: { name: "ancestree-import-template.csv", size: 0, data: "" },
      archive: null,
    },
    family,
    photos: {},
    trash: [],
    places: {},
  } as unknown as CopySnapshot;
}
