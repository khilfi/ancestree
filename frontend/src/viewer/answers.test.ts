import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  avatarAddress,
  exportAddress,
  storyPictureAddress,
  templateAddress,
} from "@/api/addresses";
import { golden } from "@/kinship/golden";
import { apiPath, installCopy } from "./answers";
import type { CopyFile, CopySnapshot } from "./snapshot";

const stored = new Map<string, string>();
vi.stubGlobal("window", {
  localStorage: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  },
});

const base64 = (text: string) => Buffer.from(text).toString("base64");
const carried = (name: string, text: string) => ({ name, size: text.length, data: base64(text) });
const HASSAN = "01a0e019-0000-7000-8000-000000000001";
const AMINAH = "01a0e019-0000-7000-8000-000000000002";
const PICTURE = "2026-09-27-4f3a9c.webp";
// A small made-up family as the backend writes it down, with its answers.
const notes = golden("notes");

// The seats around Aminah, for a viewer who puts her family at the centre.
const AROUND_AMINAH = {
  units: [{ id: "main:0", centre: [AMINAH], anchor: null, anchor_seat: null, size: 1 }],
  seats: {},
  unlinked: [],
  centre_chosen: true,
};

// Only what these tests look at: the answers are passed on as the copy holds them.
const family = {
  format: 1,
  about: { family: HASSAN, archive: false, centres: [AMINAH] },
  graph: { people: notes.people, links: notes.links },
  layouts: { [AMINAH]: AROUND_AMINAH },
  map: {
    people: [
      {
        id: HASSAN,
        lives: null,
        born: {
          place: { town: "Kota Bharu", state: "Kelantan", country: "Malaysia" },
          lat: 6.12,
          lon: 102.24,
          found: "town",
          name: "Kota Bharu",
          state: "Kelantan",
          country: "Malaysia",
        },
      },
    ],
    pins: [],
  },
  kinds: notes.kinds,
  kinship: notes.kinship,
  tree_settings: { centre: null, colours: "closeness" },
  kinship_settings: { language: "en", titles: ["long", "ngah"], youngest: "su" },
  persons: {
    [HASSAN]: {
      en: { id: HASSAN, parents: "father" },
      ms: { id: HASSAN, parents: "ayah" },
    },
  },
  stories: { [HASSAN]: { story: "He worked on the railway.", sources: [], version: "1" } },
  search: [
    { id: HASSAN, full_name: "Hassan bin Ismail", nickname: "Acan" },
    { id: AMINAH, full_name: "Aminah binti Hassan", nickname: null },
  ],
  files: {
    [`/api/persons/${HASSAN}/photo/avatar?size=128`]: `data:image/webp;base64,${base64("small")}`,
    [`/api/persons/${HASSAN}/media/${PICTURE}`]: `data:image/webp;base64,${base64("picture")}`,
  },
  exports: {
    gedcom: carried("ancestree-2026-09-27T20-00-00.ged", "0 HEAD\r\n0 TRLR\r\n"),
    csv: carried("ancestree-people-2026-09-27T20-00-00.csv", "ID,Full name\r\n"),
    template: carried("ancestree-import-template.csv", "ID,Full name\r\n"),
    archive: null,
  },
} as unknown as CopySnapshot;

const network = vi.fn(async (_: Request) => new Response("from the network"));
const PAGE = "http://127.0.0.1:8765/ancestree-keluarga-contoh-2026-09-27.html";

beforeAll(() => {
  vi.stubGlobal("fetch", network);
  installCopy(family);
});

/** What the app would get from the API, from a page at `page`. */
async function ask(path: string, method = "GET", body?: unknown, page = PAGE) {
  const response = await fetch(new URL(path, page), {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe("a view-only copy", () => {
  it("answers the app from the family it carries", async () => {
    expect((await ask("/api/graph")).json).toEqual(family.graph);
    expect((await ask(`/api/persons/${HASSAN}`)).json).toEqual({ id: HASSAN, parents: "father" });
    expect((await ask(`/api/persons/${HASSAN}/biography`)).json.story).toBe(
      "He worked on the railway.",
    );
    expect((await ask(`/api/persons/${AMINAH}/biography`)).json).toEqual({
      story: "",
      sources: [],
      version: "none",
    });
    const found = (await ask("/api/persons?q=has&limit=5")).json as { id: string }[];
    expect(found.map((person) => person.id)).toEqual([HASSAN, AMINAH]);
    const nobody = await ask("/api/persons/nobody");
    expect([nobody.status, nobody.json.detail.code]).toEqual([404, "not_found"]);
    // The map, found when the copy was made; nothing can be put on it by hand.
    expect((await ask("/api/map")).json).toEqual(family.map);
    const pin = { town: "Kampung Contoh", state: "Kelantan", lat: 6, lon: 102 };
    expect((await ask("/api/places/pins", "PUT", pin)).status).toBe(403);
  });

  it("answers a page opened from a Windows disk too", async () => {
    // There "/api/graph" becomes file:///C:/api/graph.
    expect(apiPath("file:///C:/api/graph")).toBe("/api/graph");
    expect(apiPath("file:///api/graph")).toBe("/api/graph");
    expect(apiPath("file:///C:/Users/me/Downloads/copy.html")).toBeNull();
    expect(apiPath("data:image/webp;base64,AAAA")).toBeNull();
    const fromDisk = await ask("/api/graph", "GET", undefined, "file:///C:/Users/me/copy.html");
    expect(fromDisk.json).toEqual(family.graph);
  });

  it("keeps a viewer's choices in their browser, for this family", async () => {
    const kinship = family.kinship_settings;
    expect((await ask("/api/kinship/settings", "PUT", { ...kinship, language: "ms" })).status).toBe(
      200,
    );
    expect((await ask(`/api/persons/${HASSAN}`)).json).toEqual({ id: HASSAN, parents: "ayah" });
    expect(JSON.parse(stored.get(`ancestree-copy:${HASSAN}`) ?? "{}")).toEqual({ language: "ms" });
    const titles = await ask("/api/kinship/settings", "PUT", { ...kinship, titles: ["sulung"] });
    expect(titles.status).toBe(409);

    // Closeness needs "Me", which isn't in a copy yet: branch colours stand in.
    expect((await ask("/api/settings")).json.colours).toBe("branch");
    const chosen = await ask("/api/settings", "PUT", { centre: null, colours: "generation" });
    expect(chosen.json.colours).toBe("generation");
    // Only a centre whose seats the copy carries.
    expect((await ask("/api/settings", "PUT", { centre: HASSAN, colours: "off" })).status).toBe(
      409,
    );
    expect((await ask("/api/settings")).json.colours).toBe("generation");
  });

  it("moves its centre to a family it carries the seats for, in the viewer's browser", async () => {
    const moved = await ask("/api/settings", "PUT", { centre: AMINAH, colours: "generation" });
    expect(moved.json).toEqual({ centre: AMINAH, colours: "generation" });
    expect((await ask("/api/graph")).json).toEqual({ ...family.graph, layout: AROUND_AMINAH });
    expect(JSON.parse(stored.get(`ancestree-copy:${HASSAN}`) ?? "{}").centre).toBe(AMINAH);

    // Back to the oldest ancestor, the centre the copy was made with.
    const back = await ask("/api/settings", "PUT", { centre: null, colours: "generation" });
    expect(back.json.centre).toBeNull();
    expect((await ask("/api/graph")).json).toEqual(family.graph);
  });

  it("changes nothing in the family", async () => {
    const changes: [string, string][] = [
      ["POST", "/api/persons"],
      ["PUT", `/api/persons/${HASSAN}`],
      ["DELETE", `/api/persons/${HASSAN}`],
      ["PUT", `/api/persons/${HASSAN}/biography`],
      ["POST", "/api/relationships"],
      ["POST", "/api/history/undo"],
      ["POST", "/api/backups/ancestree-backup.zip/restore"],
    ];
    for (const [method, path] of changes) {
      const refused = await ask(path, method, {});
      expect([refused.status, refused.json.detail.code], `${method} ${path}`).toEqual([
        403,
        "view_only",
      ]);
    }
    for (const path of ["/api/trash", "/api/backups", "/api/sample/graph", "/api/nothing"]) {
      expect((await ask(path)).status, path).toBe(404);
    }
  });

  it("gives the files it carries, and makes no others", async () => {
    const gedcom = family.exports.gedcom as CopyFile;
    const made = await ask("/api/exports", "POST", { format: "gedcom" });
    expect(made.json).toEqual({
      name: gedcom.name,
      folder: "",
      format: "gedcom",
      size: gedcom.size,
    });
    const download = await fetch(new URL(`/api/exports/${gedcom.name}`, PAGE));
    expect(await download.text()).toBe("0 HEAD\r\n0 TRLR\r\n");
    expect((await ask("/api/exports", "POST", { format: "archive" })).status).toBe(404);
    expect((await ask("/api/exports", "POST", { format: "copy" })).status).toBe(404);
  });

  it("hands out photos and pictures as the data it carries", () => {
    const small = family.files[`/api/persons/${HASSAN}/photo/avatar?size=128`];
    expect(avatarAddress(HASSAN, 128, 3)).toBe(small);
    expect(avatarAddress(AMINAH, 128, 1)).toBe("");
    expect(storyPictureAddress(HASSAN, `media/${PICTURE}`)).toMatch(/^data:image\/webp;base64,/);
    expect(exportAddress((family.exports.gedcom as CopyFile).name)).toMatch(/^blob:/);
    expect(templateAddress(false)).toMatch(/^blob:/);
    expect(templateAddress(true)).toBe("");
  });

  it("leaves every other address to the network", async () => {
    await fetch("https://example.org/font.woff2");
    expect(network).toHaveBeenCalledOnce();
  });

  it("finds how two people are related, as the app does", async () => {
    const related = notes.answers.find((answer) => answer.relations.length > 0);
    if (!related) throw new Error("The notes family has no related pair");
    const found = await ask(`/api/kinship?from=${related.a}&to=${related.b}`);
    expect(found.json).toEqual(related);

    // An unknown parent can't be filled in here, so the copy doesn't suggest it.
    const unknown = notes.people.find((person) => person.placeholder)?.id;
    const someone = notes.people.find((person) => !person.placeholder)?.id;
    const refused = await ask(`/api/kinship?from=${unknown}&to=${someone}`);
    expect(refused.json.message).toBe("An unknown parent can't be compared.");
    expect((await ask(`/api/kinship?from=${someone}&to=nobody`)).status).toBe(404);
  });

  it("keeps who each viewer is in their browser, for this family", async () => {
    const someone = notes.people.find((person) => !person.placeholder)?.id;
    const unknown = notes.people.find((person) => person.placeholder)?.id;
    expect((await ask("/api/family/me")).json).toEqual({ person: null });

    expect((await ask("/api/family/me", "PUT", { person: someone })).json).toEqual({
      person: someone,
    });
    expect((await ask("/api/family/me")).json).toEqual({ person: someone });
    expect(JSON.parse(stored.get(`ancestree-copy:${HASSAN}`) ?? "{}").me).toBe(someone);

    const refused = await ask("/api/family/me", "PUT", { person: unknown });
    expect([refused.status, refused.json.detail.code]).toEqual([409, "not_a_person"]);
    expect((await ask("/api/family/me", "PUT", { person: HASSAN })).status).toBe(404);
    expect((await ask("/api/family/me", "PUT", { person: null })).json).toEqual({ person: null });
  });
});
