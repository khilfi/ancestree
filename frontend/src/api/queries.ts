import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { exportAddress, importReportAddress, templateAddress } from "./addresses";
import { api } from "./client";
import { toApiError, unwrap } from "./errors";
import type {
  Backup,
  BiographyUpdate,
  CopyPreview,
  Crop,
  ExportFormat,
  ExportRequest,
  FillIn,
  Graph,
  ImportDone,
  ImportPreview,
  KindInput,
  KindUpdate,
  KinshipLanguage,
  KinshipSettings,
  NewRelative,
  PersonDetail,
  PersonInput,
  PersonPatch,
  PictureAdded,
  Pin,
  Place,
  Position,
  RelationshipCreate,
  RelationshipUpdate,
  TreeSettings,
} from "./types";

export const keys = {
  health: ["health"] as const,
  graph: ["graph"] as const,
  person: (id: string) => ["person", id] as const,
  crop: (id: string) => ["person", id, "crop"] as const,
  people: (text: string) => ["people", text] as const,
  kinds: ["kinds"] as const,
  trash: ["trash"] as const,
  treeSettings: ["tree-settings"] as const,
  sample: (people: number) => ["sample", people] as const,
  kinship: (from: string, to: string) => ["kinship", from, to] as const,
  biography: (id: string) => ["biography", id] as const,
  backups: ["backups"] as const,
  history: ["history"] as const,
  kinshipSettings: ["kinship-settings"] as const,
  dictionary: ["kinship-dictionary"] as const,
  facts: ["family-facts"] as const,
  me: ["me"] as const,
  imports: ["imports"] as const,
  map: ["map"] as const,
  sampleMap: (people: number) => ["sample-map", people] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: keys.health,
    queryFn: () => unwrap(api.GET("/api/health")),
    refetchInterval: 15_000,
  });
}

export function useGraph(enabled = true) {
  return useQuery({ queryKey: keys.graph, queryFn: () => unwrap(api.GET("/api/graph")), enabled });
}

/** A generated, fictional family for trying the canvas at size; nothing is stored. */
export function useSampleGraph(people: number, enabled = true) {
  return useQuery({
    queryKey: keys.sample(people),
    queryFn: () => unwrap(api.GET("/api/sample/graph", { params: { query: { people } } })),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

/** Where everyone lives and was born, found on the map. */
export function useFamilyMap(enabled = true) {
  return useQuery({ queryKey: keys.map, queryFn: () => unwrap(api.GET("/api/map")), enabled });
}

/** The made-up family on the map, spread over real towns; nothing is stored. */
export function useSampleMap(people: number, enabled = true) {
  return useQuery({
    queryKey: keys.sampleMap(people),
    queryFn: () => unwrap(api.GET("/api/sample/map", { params: { query: { people } } })),
    staleTime: Number.POSITIVE_INFINITY,
    enabled,
  });
}

/** Put a place the gazetteer doesn't know on the map, by hand. One Undo step. */
export function usePutPin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Pin) => unwrap(api.PUT("/api/places/pins", { body })),
    onSuccess: () =>
      Promise.all(
        [keys.map, keys.history].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

/** Take a place's pin off the map. One Undo step. */
export function useRemovePin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (place: Place) =>
      unwrap(
        api.DELETE("/api/places/pins", {
          params: {
            query: {
              town: place.town ?? undefined,
              state: place.state ?? undefined,
              country: place.country ?? undefined,
            },
          },
        }),
      ),
    onSuccess: () =>
      Promise.all(
        [keys.map, keys.history].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

export function useTreeSettings() {
  return useQuery({ queryKey: keys.treeSettings, queryFn: () => unwrap(api.GET("/api/settings")) });
}

export function useSaveTreeSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: TreeSettings) => unwrap(api.PUT("/api/settings", { body })),
    onSuccess: (saved) => {
      client.setQueryData(keys.treeSettings, saved);
      // The centre decides the generations, which Family facts counts.
      return Promise.all(
        [keys.graph, keys.history, keys.facts].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

/** Where people were dragged to. The cached tree is updated in place: nothing jumps back. */
export function useSavePositions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (positions: Position[]) =>
      unwrap(api.PUT("/api/layout/positions", { body: { positions } })),
    onMutate: (positions) => {
      const moved = new Map(positions.map((p) => [p.id, p]));
      client.setQueryData<Graph>(keys.graph, (graph) =>
        graph
          ? {
              ...graph,
              people: graph.people.map((person) => {
                const to = moved.get(person.id);
                return to ? { ...person, x: to.x, y: to.y } : person;
              }),
            }
          : graph,
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.history }),
    onError: () => client.invalidateQueries({ queryKey: keys.graph }),
  });
}

/** Rearrange: everyone back to their place on the rings. */
export function useClearPositions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/layout/positions")),
    onSuccess: () =>
      Promise.all(
        [keys.graph, keys.history].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

/** What Undo and Redo would do next. */
export function useHistory() {
  return useQuery({
    queryKey: keys.history,
    queryFn: () => unwrap(api.GET("/api/history")),
    staleTime: 0,
  });
}

/** Undo or redo a step, if it's still the next one; then everything is read again. */
export function useHistoryMove(direction: "undo" | "redo") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (step: string) =>
      direction === "undo"
        ? unwrap(api.POST("/api/history/undo", { params: { query: { step } } }))
        : unwrap(api.POST("/api/history/redo", { params: { query: { step } } })),
    onSettled: () => client.invalidateQueries(),
  });
}

/** Who changed someone, and when: the newest first, from their journal. Asked again
 *  with the person after any change. */
export function usePersonJournal(id: string) {
  return useQuery({
    queryKey: [...keys.person(id), "journal"],
    queryFn: () =>
      unwrap(api.GET("/api/persons/{person_id}/journal", { params: { path: { person_id: id } } })),
  });
}

/** What merging `other` into `keep` would change: rehearsed, nothing written. */
export function useMergePreview(keep: string, other: string | null) {
  return useQuery({
    queryKey: ["merge", keep, other],
    queryFn: () =>
      unwrap(
        api.GET("/api/persons/{person_id}/merge/{other_id}", {
          params: { path: { person_id: keep, other_id: other ?? "" } },
        }),
      ),
    enabled: other !== null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

/** Merge someone entered twice into a person: one Undo step, the other to the Trash. */
export function useMergePeople() {
  return useFamilyMutation(({ keep, other }: { keep: string; other: string }) =>
    unwrap(
      api.POST("/api/persons/{person_id}/merge", {
        params: { path: { person_id: keep } },
        body: { other },
      }),
    ),
  );
}

export function usePerson(id: string | null) {
  return useQuery({
    queryKey: keys.person(id ?? ""),
    queryFn: () =>
      unwrap(api.GET("/api/persons/{person_id}", { params: { path: { person_id: id ?? "" } } })),
    enabled: id !== null,
  });
}

/** The square currently kept from someone's photo, to start a new crop from. */
export function usePhotoCrop(id: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.crop(id),
    queryFn: () =>
      unwrap(
        api.GET("/api/persons/{person_id}/photo/crop", { params: { path: { person_id: id } } }),
      ),
    enabled,
    staleTime: 0,
  });
}

export function useSearchPeople(text: string) {
  return useQuery({
    queryKey: keys.people(text),
    queryFn: () => unwrap(api.GET("/api/persons", { params: { query: { q: text, limit: 20 } } })),
    placeholderData: (previous) => previous,
  });
}

/** How `to` is related to `from`, both ways round, with the path between them. */
export function useKinship(from: string | null, to: string | null) {
  return useQuery({
    queryKey: keys.kinship(from ?? "", to ?? ""),
    queryFn: () =>
      unwrap(api.GET("/api/kinship", { params: { query: { from: from ?? "", to: to ?? "" } } })),
    enabled: from !== null && to !== null,
  });
}

/** The kinship language and the Malay birth-order titles. */
export function useKinshipSettings() {
  return useQuery({
    queryKey: keys.kinshipSettings,
    queryFn: () => unwrap(api.GET("/api/kinship/settings")),
  });
}

/** The chosen kinship language: English until the settings arrive. */
export function useKinshipLanguage(): KinshipLanguage {
  return useKinshipSettings().data?.language ?? "en";
}

/** Switch the kinship language or change the titles. The switch shows at once; the
 *  Relatives tab and the dictionary follow once it's saved. Not an Undo step. */
export function useSaveKinshipSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: KinshipSettings) => unwrap(api.PUT("/api/kinship/settings", { body })),
    onMutate: (body) => client.setQueryData(keys.kinshipSettings, body),
    onSuccess: (saved) => {
      client.setQueryData(keys.kinshipSettings, saved);
      return Promise.all(
        [["person"], ["kinship"], keys.dictionary].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
    onError: () => client.invalidateQueries({ queryKey: keys.kinshipSettings }),
  });
}

/** Every kinship word in English, Malay and Javanese, as the answers say them. */
export function useKinshipDictionary() {
  return useQuery({
    queryKey: keys.dictionary,
    queryFn: () => unwrap(api.GET("/api/kinship/dictionary")),
    staleTime: 5 * 60_000,
  });
}

/** Which person you are, for "Me"; none until you've chosen. */
export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: () => unwrap(api.GET("/api/family/me")) });
}

/** Choose yourself, or forget (null). Not an Undo step. */
export function useSetMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (person: string | null) => unwrap(api.PUT("/api/family/me", { body: { person } })),
    onSuccess: (saved) => client.setQueryData(keys.me, saved),
  });
}

/** Facts about the whole family, read while the panel is open. */
export function useFamilyFacts(enabled: boolean) {
  return useQuery({
    queryKey: keys.facts,
    queryFn: () => unwrap(api.GET("/api/family/facts")),
    enabled,
  });
}

export function useKinds() {
  return useQuery({
    queryKey: keys.kinds,
    queryFn: () => unwrap(api.GET("/api/relationship-kinds")),
  });
}

export function useTrash() {
  return useQuery({ queryKey: keys.trash, queryFn: () => unwrap(api.GET("/api/trash")) });
}

/** After any change to people or links: everything that shows them is refetched. */
function useRefreshFamily() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      [
        keys.graph,
        ["person"],
        ["people"],
        keys.trash,
        keys.kinds,
        ["kinship"],
        keys.history,
        keys.dictionary, // the kinds' words are in it
        keys.facts,
        keys.map, // where people live and were born
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
}

function useFamilyMutation<Input, Output>(run: (input: Input) => Promise<Output>) {
  const refresh = useRefreshFamily();
  return useMutation({ mutationFn: run, onSuccess: () => refresh() });
}

export function useCreatePerson() {
  return useFamilyMutation((body: PersonInput) => unwrap(api.POST("/api/persons", { body })));
}

export function useUpdatePerson(id: string) {
  return useFamilyMutation((body: PersonInput) =>
    unwrap(api.PUT("/api/persons/{person_id}", { params: { path: { person_id: id } }, body })),
  );
}

/** A quick fix from What's missing: only the fields given change. */
export function usePatchPerson() {
  return useFamilyMutation(({ id, body }: { id: string; body: PersonPatch }) =>
    unwrap(api.PATCH("/api/persons/{person_id}", { params: { path: { person_id: id } }, body })),
  );
}

export function useDeletePerson() {
  return useFamilyMutation((id: string) =>
    unwrap(api.DELETE("/api/persons/{person_id}", { params: { path: { person_id: id } } })),
  );
}

export function useRestore() {
  return useFamilyMutation((entry: string) =>
    unwrap(api.POST("/api/trash/{entry}/restore", { params: { path: { entry } } })),
  );
}

export function useAddRelative(id: string) {
  return useFamilyMutation((body: NewRelative) =>
    unwrap(
      api.POST("/api/persons/{person_id}/relatives", {
        params: { path: { person_id: id } },
        body,
      }),
    ),
  );
}

/** An unknown parent becomes someone new, or someone already in the tree. */
export function useFillIn(id: string) {
  return useFamilyMutation((body: FillIn) =>
    unwrap(
      api.POST("/api/persons/{person_id}/fill-in", { params: { path: { person_id: id } }, body }),
    ),
  );
}

export function useChildrenOrder(id: string) {
  return useFamilyMutation((childIds: string[]) =>
    unwrap(
      api.PUT("/api/persons/{person_id}/children/order", {
        params: { path: { person_id: id } },
        body: { child_ids: childIds },
      }),
    ),
  );
}

export function useLink() {
  return useFamilyMutation((body: RelationshipCreate) =>
    unwrap(api.POST("/api/relationships", { body })),
  );
}

export function useUpdateLink() {
  return useFamilyMutation(({ id, body }: { id: string; body: RelationshipUpdate }) =>
    unwrap(api.PATCH("/api/relationships/{link_id}", { params: { path: { link_id: id } }, body })),
  );
}

export function useUnlink() {
  return useFamilyMutation((id: string) =>
    unwrap(api.DELETE("/api/relationships/{link_id}", { params: { path: { link_id: id } } })),
  );
}

/** Multipart upload; openapi-fetch's typed body doesn't model File objects. */
async function sendForm<T>(url: string, method: "PUT" | "POST", form: FormData): Promise<T> {
  const response = await fetch(url, { method, body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

function uploadPhoto(id: string, file: File, crop: Crop | null): Promise<PersonDetail> {
  const form = new FormData();
  form.append("file", file);
  if (crop) form.append("crop", JSON.stringify(crop));
  return sendForm(`/api/persons/${id}/photo`, "PUT", form);
}

export function useUploadPhoto(id: string) {
  return useFamilyMutation(({ file, crop }: { file: File; crop: Crop | null }) =>
    uploadPhoto(id, file, crop),
  );
}

export function useRecropPhoto(id: string) {
  return useFamilyMutation((crop: Crop) =>
    unwrap(
      api.PUT("/api/persons/{person_id}/photo/crop", {
        params: { path: { person_id: id } },
        body: crop,
      }),
    ),
  );
}

export function useRemovePhoto(id: string) {
  return useFamilyMutation(() =>
    unwrap(api.DELETE("/api/persons/{person_id}/photo", { params: { path: { person_id: id } } })),
  );
}

/**
 * A life story and its Sources, as the file on disk is now. Always asked again, on
 * opening and on coming back to the window: the file may have been edited in Notepad.
 */
export function useBiography(id: string) {
  return useQuery({
    queryKey: keys.biography(id),
    queryFn: () =>
      unwrap(
        api.GET("/api/persons/{person_id}/biography", { params: { path: { person_id: id } } }),
      ),
    staleTime: 0,
  });
}

/** Saves a story. Keyed by person, so a save still on its way can be waited for. */
export function useSaveBiography(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: keys.biography(id),
    mutationFn: (body: BiographyUpdate) =>
      unwrap(
        api.PUT("/api/persons/{person_id}/biography", {
          params: { path: { person_id: id } },
          body,
        }),
      ),
    onSuccess: async (saved) => {
      // A reading that started before this save finished must not land after it.
      await client.cancelQueries({ queryKey: keys.biography(id) });
      client.setQueryData(keys.biography(id), saved);
    },
  });
}

/** Waits until no save of someone's story is on its way. Closing their panel starts one. */
export function useStorySettled() {
  const client = useQueryClient();
  return useCallback(
    (id: string) =>
      new Promise<void>((resolve) => {
        const saving = () => client.isMutating({ mutationKey: keys.biography(id) }) > 0;
        // Look once React has closed the panel, which is when the save starts.
        setTimeout(() => {
          if (!saving()) return resolve();
          const stop = client.getMutationCache().subscribe(() => {
            if (saving()) return;
            stop();
            resolve();
          });
        });
      }),
    [client],
  );
}

/** A picture for a story, kept in the person's media/ folder. Answers its path in the story. */
export function addPicture(id: string, file: File): Promise<PictureAdded> {
  const form = new FormData();
  form.append("file", file);
  return sendForm(`/api/persons/${id}/media`, "POST", form);
}

/** Make an export in DATA_DIR/exports; `downloadExport` then saves it. A copy
 *  comes with its choices: its title, living people, a password, the archive; a copy to
 *  edit also whom it's for and what they may do. */
export function useMakeExport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: ExportFormat | ExportRequest) =>
      unwrap(
        api.POST("/api/exports", {
          body:
            typeof request === "string"
              ? {
                  format: request,
                  title: "",
                  hide_living: false,
                  archive: true,
                  editable: false,
                  for_name: "",
                }
              : request,
        }),
      ),
    // Even when it fails: the backup folder's disk may have gone, and the list says so.
    onSettled: (_, __, request) =>
      (typeof request === "string" ? request : request.format) === "archive"
        ? client.invalidateQueries({ queryKey: keys.backups })
        : undefined,
  });
}

/** Save a file the backend makes: the browser downloads it under its own name. */
function download(url: string, name = ""): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

/** Save an export or backup. */
export function downloadExport(name: string): void {
  download(exportAddress(name), name);
}

export function useBackups() {
  return useQuery({ queryKey: keys.backups, queryFn: () => unwrap(api.GET("/api/backups")) });
}

/** A backup archive from elsewhere, kept with the others so it can be restored. */
export function useAddBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return sendForm<Backup>("/api/backups", "POST", form);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.backups }),
  });
}

/** Replace everything with a backup. Afterwards, everything on screen is read again. */
export function useRestoreBackup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(api.POST("/api/backups/{name}/restore", { params: { path: { name } } })),
    onSuccess: () => client.invalidateQueries(),
  });
}

export function useCreateKind() {
  return useFamilyMutation((body: KindInput) =>
    unwrap(api.POST("/api/relationship-kinds", { body })),
  );
}

export function useUpdateKind() {
  return useFamilyMutation(({ key, body }: { key: string; body: KindUpdate }) =>
    unwrap(api.PATCH("/api/relationship-kinds/{key}", { params: { path: { key } }, body })),
  );
}

export function useDeleteKind() {
  return useFamilyMutation((key: string) =>
    unwrap(api.DELETE("/api/relationship-kinds/{key}", { params: { path: { key } } })),
  );
}

/** The import template: empty, or filled in with the fictional test family. */
export function downloadTemplate(example: boolean): void {
  download(
    templateAddress(example),
    example ? "ancestree-import-example.csv" : "ancestree-import-template.csv",
  );
}

/** What an import left out or found different, as a spreadsheet. */
export function downloadImportReport(id: string): void {
  download(importReportAddress(id));
}

function importForm(file: File, answers: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", file);
  form.append("answers", JSON.stringify(answers));
  return form;
}

export function useImports() {
  return useQuery({ queryKey: keys.imports, queryFn: () => unwrap(api.GET("/api/imports")) });
}

/** What importing `file` with these answers would do; nothing is written. `token`
 *  changes with every file chosen, so the same name chosen twice is read again. */
export function useImportPreview(
  file: File | null,
  token: number,
  answers: Record<string, string>,
) {
  return useQuery({
    queryKey: ["import-preview", token, answers],
    queryFn: () =>
      sendForm<ImportPreview>("/api/imports/preview", "POST", importForm(file as File, answers)),
    enabled: file !== null,
    placeholderData: keepPreviousData, // answering a question keeps the preview on screen
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

/** Import for real what's ticked: a backup first, then one Undo step. Everything that
 *  shows people is read again, and the backups too. */
export function useRunImport() {
  const refresh = useRefreshFamily();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      answers,
      chosen,
    }: {
      file: File;
      answers: Record<string, string>;
      chosen: string[];
    }) => {
      const form = importForm(file, answers);
      form.append("chosen", JSON.stringify(chosen));
      return sendForm<ImportDone>("/api/imports", "POST", form);
    },
    onSuccess: () => refresh(),
    onSettled: () =>
      Promise.all(
        [keys.imports, keys.backups].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

function copyForm(file: File, password: string, answers: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", file);
  if (password) form.append("password", password);
  form.append("answers", JSON.stringify(answers));
  return form;
}

/** What a copy to edit brings back, for you to tick; nothing is written. `token` changes
 *  with every file chosen. The password, when it's locked, is read when asked: typed, it's
 *  sent by refetching, so it's never part of the key. */
export function useCopyPreview(
  file: File | null,
  token: number,
  password: () => string,
  answers: Record<string, string>,
) {
  return useQuery({
    queryKey: ["copy-preview", token, answers],
    queryFn: () =>
      sendForm<CopyPreview>(
        "/api/imports/copy/preview",
        "POST",
        copyForm(file as File, password(), answers),
      ),
    enabled: file !== null,
    placeholderData: keepPreviousData, // answering a question keeps the review on screen
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

/** Bring in what's ticked from a copy: a backup first, then one Undo step for the people,
 *  details and links; stories and photos after. */
export function useRunCopyImport() {
  const refresh = useRefreshFamily();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      password,
      answers,
      chosen,
    }: {
      file: File;
      password: string;
      answers: Record<string, string>;
      chosen: string[];
    }) => {
      const form = copyForm(file, password, answers);
      form.append("chosen", JSON.stringify(chosen));
      return sendForm<ImportDone>("/api/imports/copy", "POST", form);
    },
    onSuccess: () => refresh(),
    onSettled: () =>
      Promise.all(
        [keys.imports, keys.backups].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
}

/** Undo an import: everyone it added to the Trash, and what it changed or removed put back. */
export function useTakeBack() {
  const refresh = useRefreshFamily();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/api/imports/{import_id}/take-back", { params: { path: { import_id: id } } }),
      ),
    onSuccess: () => refresh(),
    onSettled: () => client.invalidateQueries({ queryKey: keys.imports }),
  });
}
