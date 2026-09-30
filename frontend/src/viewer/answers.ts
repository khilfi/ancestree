/**
 * How a copy answers the app: every question the app would ask the API is answered here.
 * A view-only copy answers from the answers it carries; a copy to edit from its
 * family as it changes, the book (src/copyedit/book.ts), which also makes the changes the copy
 * allows.
 *
 * The tables are typed against the API's routes (schema.d.ts, generated from the backend), so
 * a new route stops TypeScript from building the app until it has a place here: answered from
 * the copy, kept as a viewer's own choice, not in the copy, or refused.
 */
import { setAddresses } from "@/api/addresses";
import type { paths } from "@/api/schema";
import type {
  BiographyUpdate,
  ChildrenOrder,
  Crop,
  ExportRequest,
  FillIn,
  Graph,
  KinshipSettings,
  MeSettings,
  NewRelative,
  PersonDetail,
  PersonPatch,
  PersonSummary,
  Positions,
  RelationshipCreate,
  RelationshipUpdate,
  TreeSettings,
} from "@/api/types";
import type { CopyPermission } from "@/app/copy";
import type { Book } from "@/copyedit/book";
import type { PersonFields } from "@/copyedit/rules";
import { type FieldError, Invalid, Refusal } from "@/copyedit/rules";
import { KinshipTwin, NotInFamily } from "@/kinship/twin";
import { choices, choose, chooseFamily } from "./choices";
import { findPeople } from "./search";
import { bytes, type CopyFile, type CopySnapshot } from "./snapshot";

type Method = "get" | "put" | "post" | "patch" | "delete";
/** The API's routes that take a method: "/api/graph", "/api/persons/{person_id}", … */
type Routes<M extends Method> = {
  [P in keyof paths]: paths[P] extends { [K in M]: unknown } ? P : never;
}[keyof paths];
type WriteRoute =
  | `PUT ${Routes<"put">}`
  | `POST ${Routes<"post">}`
  | `PATCH ${Routes<"patch">}`
  | `DELETE ${Routes<"delete">}`;

type Asked = {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  form: FormData | null; // a file sent in a form: photos and story pictures
};
type Answer =
  | { json: unknown; status?: number }
  | { file: Blob }
  | { empty: true }
  | { error: string; status: number; code?: string; detail?: Record<string, unknown> }
  | { invalid: FieldError[] };
type Answering = (asked: Asked) => Answer | Promise<Answer>;

/** Pages of the app a copy leaves out: Settings, the made-up sample, the Trash and backups. */
const NOT_IN_COPY = "not in the copy";
/** Anything that adds, changes or deletes where a copy can't: always in a view-only copy, and
 *  the settings, kinds, imports and backups that are the app's own in a copy to edit. */
const REFUSED = "refused";

let copy: CopySnapshot | null = null;
let book: Book | null = null;
let twin: KinshipTwin | null = null;

function family(): CopySnapshot {
  if (!copy) throw new Error("The copy's family isn't open yet.");
  return copy;
}

/** What a view-only copy carries that a copy to edit works out instead. */
function made<K extends "graph" | "layouts" | "persons" | "search">(
  key: K,
): NonNullable<CopySnapshot[K]> {
  const value = family()[key];
  if (value === undefined) throw new Error(`This copy doesn't carry its ${key}.`);
  return value as NonNullable<CopySnapshot[K]>;
}

/** The copy's relationship finder, made the first time someone asks. */
function finder(): KinshipTwin {
  if (book) return book.twin();
  if (!twin) {
    const { people, links } = made("graph");
    const { kinds, kinship } = family();
    twin = new KinshipTwin(people, links, kinds, kinship);
  }
  return twin;
}

/** How two people are related, as the app answers it. An unknown parent can't be filled in
 *  in a view-only copy, so it doesn't suggest it. */
function relationship(from: string, to: string): Answer {
  try {
    const found = finder().answer(from, to);
    const message = book
      ? found.message
      : (found.message?.replace(" Fill them in first.", "") ?? null);
    return ok({ ...found, message });
  } catch (error) {
    if (error instanceof NotInFamily) return missing("That person isn't in this copy.");
    throw error;
  }
}

const ok = (json: unknown): Answer => ({ json });
const created = (json: unknown): Answer => ({ json, status: 201 });
const missing = (message: string): Answer => ({ error: message, status: 404 });
const NO_STORY = { story: "", sources: [], version: "none" };

/** A file the copy carries, by the address the app asks for it at. */
function dataOf(address: string): string | undefined {
  return book ? book.files.get(address) : family().files[address];
}

function dataFile(address: string): Blob | null {
  const uri = dataOf(address);
  const match = uri?.match(/^data:([^;,]+);base64,(.*)$/);
  return match?.[1] && match[2] !== undefined
    ? new Blob([bytes(match[2])], { type: match[1] })
    : null;
}

const TYPES: Record<string, string> = {
  ged: "application/x-gedcom",
  csv: "text/csv",
  zip: "application/zip",
};

function carried(file: CopyFile): Blob {
  const extension = file.name.split(".").pop() ?? "";
  return new Blob([bytes(file.data)], { type: TYPES[extension] ?? "application/octet-stream" });
}

function exportNamed(name: string): CopyFile | null {
  const files = Object.values(family().exports).filter((file): file is CopyFile => file !== null);
  return files.find((file) => file.name === name) ?? null;
}

/** The tree's settings: the centre and the colours, each the viewer's own once they choose.
 *  Closeness is to whoever looks: the maker's was to them, so a copy opens with branch
 *  colours instead, until its viewer picks closeness to the person they chose as "Me". */
function treeSettings(): TreeSettings {
  const madeWith = family().tree_settings;
  const colours =
    choices().colours ?? (madeWith.colours === "closeness" ? "branch" : madeWith.colours);
  const chosen = choices().centre;
  return {
    ...madeWith,
    colours,
    centre: chosen === undefined ? (madeWith.centre ?? null) : chosen,
  };
}

/** The seats around another centre, or undefined for the one the copy was made with,
 *  whose seats are its graph's. */
function otherSeats(centre: string | null): Graph["layout"] | undefined {
  const { layouts, tree_settings } = family();
  return centre === (tree_settings.centre ?? null) ? undefined : layouts?.[centre ?? ""];
}

/** Whether a viewer can put someone at the centre: a view-only copy carries the seats around
 *  its own centre and each family's and branch's; a copy to edit seats anyone itself. */
function carries(centre: string | null): boolean {
  if (book) return centre === null || book.has(centre);
  return centre === (family().tree_settings.centre ?? null) || otherSeats(centre) !== undefined;
}

/** The family, seated around the centre the viewer chose. */
function graphNow(): Graph {
  const centre = treeSettings().centre ?? null;
  if (book) return book.graph(centre);
  const graph = made("graph");
  const layout = otherSeats(centre);
  return layout ? { ...graph, layout } : graph;
}

function kinshipSettings(): KinshipSettings {
  const madeWith = family().kinship_settings;
  return { ...madeWith, language: choices().language ?? madeWith.language };
}

function personView(id: string): PersonDetail | null {
  if (book) return book.detail(id, kinshipSettings().language);
  const person = made("persons")[id];
  return person?.[kinshipSettings().language] ?? person?.en ?? null;
}

function searchList(): PersonSummary[] {
  return book ? book.search() : made("search");
}

const ALLOWED: Record<CopyPermission, string> = {
  add: "This copy doesn't let you add people or links.",
  change: "This copy doesn't let you change details.",
  remove: "This copy doesn't let you remove people or links.",
  stories: "This copy doesn't let you write life stories.",
  photos: "This copy doesn't let you add photos.",
};

/** A change made in a copy to edit, when the copy allows it: `what` it is. */
function editing(
  what: CopyPermission | null,
  work: (asked: Asked, book: Book) => Answer | Promise<Answer>,
): Answering {
  return (asked) => {
    if (!book) return refused();
    if (what && !family().about.editing?.may[what])
      return { error: ALLOWED[what], status: 403, code: "not_allowed" };
    return work(asked, book);
  };
}

function refused(): Answer {
  return book
    ? {
        error: "A copy to edit can't change that: it's done in the app.",
        status: 403,
        code: "not_in_copy",
      }
    : { error: "This is a view-only copy: nothing can be changed.", status: 403 };
}

const id = (asked: Asked) => asked.params.person_id ?? "";

const reads: Record<Routes<"get">, Answering | typeof NOT_IN_COPY> = {
  "/api/health": () => ok(family().health),
  "/api/graph": () => ok(graphNow()),
  "/api/sample/graph": NOT_IN_COPY,
  "/api/settings": () => ok(treeSettings()),
  "/api/persons": ({ query }) =>
    ok(findPeople(searchList(), query.get("q") ?? "", Number(query.get("limit") ?? 20))),
  "/api/persons/{person_id}": (asked) => {
    const detail = personView(id(asked));
    return detail ? ok(detail) : missing("That person isn't in this copy.");
  },
  "/api/persons/{person_id}/photo/crop": (asked) => {
    const crop = book?.photoCrop(id(asked));
    return crop ? ok(crop) : missing("There's no photo to crop in this copy.");
  },
  "/api/persons/{person_id}/photo/avatar": ({ params, query }) => {
    const file = dataFile(
      `/api/persons/${params.person_id}/photo/avatar?size=${query.get("size") ?? "128"}`,
    );
    return file ? { file } : missing("That photo isn't in this copy.");
  },
  "/api/persons/{person_id}/photo/display": (asked) => {
    const file = dataFile(`/api/persons/${id(asked)}/photo/display`);
    return file ? { file } : missing("That photo isn't in this copy.");
  },
  "/api/persons/{person_id}/biography": (asked) =>
    ok(book ? book.story(id(asked)) : (family().stories[id(asked)] ?? NO_STORY)),
  "/api/persons/{person_id}/media/{name}": ({ params }) => {
    const file = dataFile(`/api/persons/${params.person_id}/media/${params.name}`);
    return file ? { file } : missing("That picture isn't in this copy.");
  },
  "/api/relationship-kinds": () => ok(family().kinds),
  // Worked out in the copy, by a twin of the app's kinship engine.
  "/api/kinship": ({ query }) => relationship(query.get("from") ?? "", query.get("to") ?? ""),
  "/api/kinship/dictionary": () => ok(family().dictionary),
  "/api/kinship/settings": () => ok(kinshipSettings()),
  "/api/trash": () => (book ? ok(book.trashList()) : missing("That isn't in a view-only copy.")),
  "/api/dates/read": NOT_IN_COPY,
  "/api/exports/{name}": ({ params }) => {
    const file = exportNamed(params.name ?? "");
    return file ? { file: carried(file) } : missing("That file isn't in this copy.");
  },
  "/api/backups": NOT_IN_COPY,
  "/api/history": () => ok(book ? book.historyView() : { undo: null, redo: null }),
  "/api/family/facts": () => ok(family().facts),
  // Who you are: each viewer's own choice, kept in their browser.
  "/api/family/me": () => ok({ person: choices().me ?? null }),
  "/api/imports/template": ({ query }) =>
    query.get("example")
      ? missing("The example isn't in this copy.")
      : { file: carried(family().exports.template) },
  "/api/imports": NOT_IN_COPY,
  "/api/imports/{import_id}/report": NOT_IN_COPY,
  // Found when the copy was made: a copy carries the points, not the gazetteer.
  "/api/map": () => ok(book ? book.map() : family().map),
  "/api/sample/map": NOT_IN_COPY,
};

const writes: Record<WriteRoute, Answering | typeof REFUSED> = {
  // The viewer's own view: kept in their browser, never in the file.
  "PUT /api/settings": ({ body }) => {
    const wanted = body as TreeSettings;
    const centre = wanted.centre ?? null;
    if (centre !== treeSettings().centre) {
      if (!carries(centre)) {
        return { error: "This copy can't put that person at the centre.", status: 409 };
      }
      choose({ centre });
    }
    choose({ colours: wanted.colours });
    return ok(treeSettings());
  },
  "PUT /api/kinship/settings": ({ body }) => {
    const wanted = body as KinshipSettings;
    const madeWith = family().kinship_settings;
    const same =
      JSON.stringify(wanted.titles ?? []) === JSON.stringify(madeWith.titles ?? []) &&
      wanted.youngest === madeWith.youngest;
    if (!same) return { error: "The Malay titles can't be changed in a copy.", status: 409 };
    choose({ language: wanted.language });
    return ok(kinshipSettings());
  },
  // The files made with the copy: its GEDCOM, spreadsheet and full archive.
  "POST /api/exports": ({ body }) => {
    const wanted = body as ExportRequest;
    const files = family().exports;
    const file =
      wanted.format === "gedcom"
        ? files.gedcom
        : wanted.format === "csv"
          ? files.csv
          : wanted.format === "archive"
            ? files.archive
            : null;
    if (!file) {
      return missing(
        wanted.format === "archive"
          ? "The full archive isn't in this copy."
          : "A copy can't make that.",
      );
    }
    return ok({ name: file.name, folder: "", format: wanted.format, size: file.size });
  },
  "PUT /api/family/me": ({ body }) => {
    const person = (body as MeSettings | null)?.person ?? null;
    if (person !== null) {
      const found = book ? book.person(person) : made("graph").people.find((p) => p.id === person);
      if (!found) return missing("That person isn't in this copy.");
      if (found.placeholder) {
        return { error: "An unknown parent can't be you.", status: 409, code: "not_a_person" };
      }
    }
    choose({ me: person });
    return ok({ person });
  },
  // Where people sit: only how the tree looks, so anyone who can edit may move them.
  "PUT /api/layout/positions": editing(null, ({ body }, family) => {
    family.savePositions((body as Positions).positions);
    return { empty: true };
  }),
  "DELETE /api/layout/positions": editing(null, (_, family) => {
    family.clearPositions();
    return { empty: true };
  }),
  "POST /api/persons": editing("add", ({ body }, family) =>
    created(family.createPerson(body as PersonFields)),
  ),
  "PUT /api/persons/{person_id}": editing("change", (asked, family) =>
    ok(family.updatePerson(id(asked), asked.body as PersonFields)),
  ),
  "PATCH /api/persons/{person_id}": editing("change", (asked, family) =>
    ok(family.patchPerson(id(asked), asked.body as PersonPatch)),
  ),
  "DELETE /api/persons/{person_id}": editing("remove", (asked, family) =>
    ok(family.deletePerson(id(asked))),
  ),
  "POST /api/persons/{person_id}/relatives": editing("add", (asked, family) =>
    created(family.addRelative(id(asked), asked.body as NewRelative)),
  ),
  "POST /api/persons/{person_id}/fill-in": editing("add", (asked, family) =>
    ok(family.fillIn(id(asked), asked.body as FillIn)),
  ),
  "PUT /api/persons/{person_id}/children/order": editing("change", (asked, family) =>
    ok(family.orderChildren(id(asked), (asked.body as ChildrenOrder).child_ids)),
  ),
  "PUT /api/persons/{person_id}/photo": editing("photos", async (asked, family) => {
    const file = asked.form?.get("file");
    if (!(file instanceof Blob))
      return { error: "Choose a photo.", status: 422, code: "bad_photo" };
    const crop = asked.form?.get("crop");
    let chosen: unknown = null;
    if (typeof crop === "string" && crop) {
      try {
        chosen = JSON.parse(crop);
      } catch {
        return { error: "The crop couldn't be read.", status: 422, code: "bad_crop" };
      }
    }
    return ok(await family.uploadPhoto(id(asked), file, chosen));
  }),
  "DELETE /api/persons/{person_id}/photo": editing("photos", (asked, family) =>
    ok(family.removePhoto(id(asked))),
  ),
  "PUT /api/persons/{person_id}/photo/crop": editing("photos", async (asked, family) =>
    ok(await family.recrop(id(asked), asked.body as Crop)),
  ),
  "PUT /api/persons/{person_id}/biography": editing("stories", (asked, family) =>
    ok(family.saveStory(id(asked), asked.body as BiographyUpdate)),
  ),
  "POST /api/persons/{person_id}/media": editing("stories", async (asked, family) => {
    const file = asked.form?.get("file");
    if (!(file instanceof Blob))
      return { error: "Choose a picture.", status: 422, code: "bad_photo" };
    return created(await family.addPicture(id(asked), file));
  }),
  "POST /api/relationships": editing("add", ({ body }, family) =>
    created(family.link(body as RelationshipCreate)),
  ),
  "PATCH /api/relationships/{link_id}": editing("change", ({ params, body }, family) =>
    ok(family.updateLink(params.link_id ?? "", body as RelationshipUpdate)),
  ),
  "DELETE /api/relationships/{link_id}": editing("remove", ({ params }, family) => {
    family.unlink(params.link_id ?? "");
    return { empty: true };
  }),
  "POST /api/trash/{entry}/restore": editing("remove", ({ params }, family) =>
    ok(family.restore(params.entry ?? "")),
  ),
  "POST /api/history/undo": editing(null, ({ query }, family) =>
    ok(family.move(false, query.get("step"))),
  ),
  "POST /api/history/redo": editing(null, ({ query }, family) =>
    ok(family.move(true, query.get("step"))),
  ),
  "POST /api/relationship-kinds": REFUSED,
  "PATCH /api/relationship-kinds/{key}": REFUSED,
  "DELETE /api/relationship-kinds/{key}": REFUSED,
  "POST /api/backups": REFUSED,
  "POST /api/backups/{name}/restore": REFUSED,
  "POST /api/imports/preview": REFUSED,
  "POST /api/imports": REFUSED,
  "POST /api/imports/{import_id}/take-back": REFUSED,
  // A copy's changes come back into the app, never into another copy.
  "POST /api/imports/copy/preview": REFUSED,
  "POST /api/imports/copy": REFUSED,
  "PUT /api/places/pins": REFUSED,
  "DELETE /api/places/pins": REFUSED,
};

type Route<T> = { method: string; parts: string[]; answer: T };

function routes<T>(table: Record<string, T>, method?: string): Route<T>[] {
  const list = Object.entries(table).map(([key, answer]) => {
    const [verb, path] = method ? [method, key] : (key.split(" ") as [string, string]);
    return { method: verb, parts: path.split("/"), answer };
  });
  // Fixed words before {placeholders}: "/api/imports/template" before any "/api/imports/{id}".
  const holes = (route: Route<T>) => route.parts.filter((part) => part.startsWith("{")).length;
  return list.sort((a, b) => holes(a) - holes(b));
}

const readRoutes = routes(reads, "GET");
const writeRoutes = routes(writes);

function match<T>(list: Route<T>[], method: string, path: string) {
  const parts = path.split("/");
  for (const route of list) {
    if (route.method !== method || route.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = route.parts.every((part, index) => {
      const given = parts[index] ?? "";
      if (part.startsWith("{")) {
        params[part.slice(1, -1)] = decodeURIComponent(given);
        return given !== "";
      }
      return part === given;
    });
    if (fits) return { route, params };
  }
  return null;
}

function reply(answer: Answer): Response {
  if ("file" in answer) return new Response(answer.file, { status: 200 });
  if ("empty" in answer) return new Response(null, { status: 204 });
  if ("invalid" in answer) return Response.json({ detail: answer.invalid }, { status: 422 });
  if ("error" in answer) {
    const code = answer.code ?? (answer.status === 404 ? "not_found" : "view_only");
    return Response.json(
      { detail: { ...answer.detail, code, message: answer.error } },
      { status: answer.status },
    );
  }
  return Response.json(answer.json, { status: answer.status ?? 200 });
}

/** A refused change as the API answers it. */
function problem(error: unknown): Answer {
  if (error instanceof Invalid) return { invalid: error.errors };
  if (error instanceof Refusal) {
    return { error: error.message, status: error.status, code: error.code, detail: error.detail };
  }
  throw error;
}

/**
 * The API path a request is for, or null for any other address. Opened from a Windows disk,
 * the page is file:///C:/…, where Chrome and Edge make "/api/graph" file:///C:/api/graph, so
 * the drive is taken off here.
 */
export function apiPath(address: string): string | null {
  const path = new URL(address).pathname.replace(/^\/[A-Za-z]:(?=\/)/, "");
  return path.startsWith("/api/") ? path : null;
}

async function asked(request: Request, method: string): Promise<Pick<Asked, "body" | "form">> {
  if (method === "GET") return { body: null, form: null };
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    return { body: null, form: await request.formData() };
  }
  const text = await request.text();
  try {
    return { body: text ? JSON.parse(text) : null, form: null };
  } catch {
    return { body: null, form: null };
  }
}

/** The copy's answer to one request the app makes to the API. */
export async function answer(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const table = method === "GET" ? readRoutes : writeRoutes;
  const found = match<Answering | string>(table, method, apiPath(request.url) ?? "");
  if (!found) return reply(missing("This copy doesn't know that address."));
  const { route, params } = found;
  if (route.answer === NOT_IN_COPY) return reply(missing("That isn't in a copy."));
  if (route.answer === REFUSED || typeof route.answer === "string") return reply(refused());
  const given = await asked(request, method);
  try {
    return reply(await route.answer({ params, query: url.searchParams, ...given }));
  } catch (error) {
    return reply(problem(error));
  }
}

const madeFiles = new Map<string, string>();

/** Where the page finds a file: photos and pictures as the data the copy carries; downloads
 *  as a file made from it. Anything else isn't in the copy. */
function addressIn(path: string): string {
  const [base, query = ""] = path.split("?");
  if (base?.endsWith("/photo/avatar")) {
    const size = new URLSearchParams(query).get("size") ?? "128";
    return dataOf(`${base}?size=${size}`) ?? "";
  }
  if (base?.endsWith("/photo/display")) return dataOf(base) ?? "";
  if (base?.includes("/media/")) return dataOf(base) ?? "";
  let file: CopyFile | null = null;
  if (base?.startsWith("/api/exports/")) file = exportNamed(decodeURIComponent(base.slice(13)));
  else if (base === "/api/imports/template" && !query) file = family().exports.template;
  if (!file) return "";
  let url = madeFiles.get(file.name);
  if (!url) {
    url = URL.createObjectURL(carried(file));
    madeFiles.set(file.name, url);
  }
  return url;
}

/** Open the copy: from now on the app's requests to the API are answered here, and its photos
 *  and downloads come from the copy. A copy to edit answers from its book. */
export function installCopy(snapshot: CopySnapshot, editable: Book | null = null): void {
  copy = snapshot;
  book = editable;
  twin = null;
  chooseFamily(snapshot.about.family);
  const network = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return apiPath(request.url) ? answer(request) : network(request);
  };
  setAddresses(addressIn);
}

/** The language the viewer chose, for people's views in a copy to edit. */
export function viewerLanguage(): "en" | "ms" | "jv" {
  return kinshipSettings().language;
}
