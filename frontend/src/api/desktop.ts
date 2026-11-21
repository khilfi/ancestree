import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, reach } from "./errors";

/** What the desktop app's engine knows about new versions of the app. */
export interface DesktopUpdate {
  current: string;
  available: { version: string; notes: string } | null;
  checking: boolean;
  checked_at: string | null;
  problem: string | null;
}

const UPDATE = ["desktop", "update"] as const;

async function send(path: string, method = "GET"): Promise<DesktopUpdate | null> {
  const response = await reach(path, { method });
  if (response.status === 404) return null; // not the desktop app: the browser, or a copy
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail?.message ?? "AncesTree couldn't answer");
  return body as DesktopUpdate;
}

/** The desktop app's updates; null in a browser or a copy, which have none. Asked again
 *  every few minutes, and every two seconds while a check is on its way. */
export function useDesktopUpdate() {
  return useQuery({
    queryKey: UPDATE,
    queryFn: () => send("/api/desktop/update"),
    refetchInterval: (query) => (query.state.data?.checking ? 2_000 : 5 * 60_000),
    retry: false,
  });
}

/** Ask the app to look for a new version now. */
export function useCheckForUpdates() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => send("/api/desktop/update/check", "POST"),
    onSuccess: (state) => client.setQueryData(UPDATE, state),
  });
}

/** Restart into the new version: the app closes and opens again as it. */
export function useRestartToUpdate() {
  return useMutation({ mutationFn: () => send("/api/desktop/update/restart", "POST") });
}

/** A family on this computer (0.4.0), as the desktop app's engine lists them. */
export interface DesktopFamily {
  id: string;
  name: string;
  open: boolean;
  role: "keeper" | "member" | "";
  in_step: string | null;
  added: string;
  example?: boolean; // the example family: made up, to look around in
}

export interface DesktopFamilies {
  open: string;
  families: DesktopFamily[];
  removed: { id: string; name: string; removed: string }[];
  single?: boolean; // a database of the developer's own: one family
  added?: string; // the family just added
  opening?: string | null; // the family being opened: the app starts again on it
}

const FAMILIES = ["desktop", "families"] as const;

async function families(
  path: string,
  method = "GET",
  body?: BodyInit,
  json = true,
): Promise<DesktopFamilies | null> {
  const response = await reach(path, {
    method,
    body,
    headers: body && json ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 404 && method === "GET") return null; // not the desktop app
  const answer = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      answer?.detail?.message ?? "AncesTree couldn't answer",
      response.status,
      answer?.detail?.code,
      answer?.detail,
    );
  }
  return answer as DesktopFamilies;
}

/** The families on this computer (0.4.0); null in a browser or a copy, which have one. */
export function useFamilies() {
  return useQuery({
    queryKey: FAMILIES,
    queryFn: () => families("/api/desktop/families"),
    refetchInterval: 60_000,
    retry: false,
  });
}

function useFamiliesChange<T>(send: (input: T) => Promise<DesktopFamilies | null>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (listed) => {
      if (listed) client.setQueryData(FAMILIES, listed);
    },
  });
}

/** A new family, empty, in folders of its own. */
export const useAddFamily = () =>
  useFamiliesChange((name: string) =>
    families("/api/desktop/families", "POST", JSON.stringify({ name })),
  );

/** The example family: a family of its own, filled as it first opens; the one here
 *  already, if there is one. */
export const useAddExample = () =>
  useFamiliesChange((_: undefined) => families("/api/desktop/families/example", "POST"));

/** A family from a backup: it opens with the backup restored. One locked with a password, as
 *  copies kept elsewhere can be, is opened with `password`. */
export const useAddFamilyFromBackup = () =>
  useFamiliesChange(({ file, password }: { file: File; password?: string }) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    return families("/api/desktop/families/from-backup", "POST", form, false);
  });

export const useRenameFamily = () =>
  useFamiliesChange(({ id, name }: { id: string; name: string }) =>
    families(`/api/desktop/families/${id}`, "PATCH", JSON.stringify({ name })),
  );

/** A family out of the way, in the Trash for 30 days. */
export const useRemoveFamily = () =>
  useFamiliesChange((id: string) => families(`/api/desktop/families/${id}`, "DELETE"));

export const usePutFamilyBack = () =>
  useFamiliesChange((id: string) =>
    families(`/api/desktop/families/removed/${id}/put-back`, "POST"),
  );

/** Another family opened: the open one keeps in step a last time, then AncesTree starts again
 *  on the other's folders. */
export const useOpenFamily = () =>
  useFamiliesChange((id: string) => families(`/api/desktop/families/${id}/open`, "POST"));

/** What removing AncesTree from this computer takes: its families, whether this computer
 *  keeps each, and how it's done on this system. `installed` is false for an engine run from the
 *  code, which removes nothing. */
export interface Removing {
  system: "windows" | "mac" | "linux";
  installed: boolean;
  app: string | null; // the app itself: its folder on Windows, AncesTree.app, the AppImage
  folder: string; // AncesTree's own folder, every family's
  documents: string; // where Windows' uninstaller keeps the backups
  kept: string; // the folder they're kept in there, or wherever they're saved: AncesTree backups
  bin: string; // the system's bin, as it names it
  families: {
    id: string;
    name: string;
    open: boolean;
    example: boolean;
    keeper: boolean; // this computer keeps its family folder
    backups: number;
    // In the Trash, for under 30 days: its backups are kept too, as "<name> (removed)".
    removed?: boolean;
  }[];
}

/** Every family's backups, saved to a folder. */
export interface BackupsSaved {
  folder: string; // AncesTree backups, in the place chosen
  families: number;
  backups: number;
  copied: number;
}

async function desktopCall<T>(path: string, method = "GET", body?: object): Promise<T | null> {
  const response = await reach(path, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
  if (response.status === 404 && method === "GET") return null; // not the desktop app
  const answer = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      answer?.detail?.message ?? "AncesTree couldn't answer",
      response.status,
      answer?.detail?.code,
      answer?.detail,
    );
  }
  return answer as T;
}

const REMOVING = ["desktop", "removing"] as const;

/** What removing AncesTree would take: asked while its dialog is open. */
export function useRemoving(enabled: boolean) {
  return useQuery({
    queryKey: REMOVING,
    queryFn: () => desktopCall<Removing>("/api/desktop/removing"),
    enabled,
    retry: false,
  });
}

/** Every family's backups copied to `folder`, each family's in a folder of its name. */
export function useSaveBackupsTo() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (folder: string) =>
      desktopCall<BackupsSaved>("/api/desktop/removing/save-backups", "POST", { folder }),
    onSuccess: () => client.invalidateQueries({ queryKey: REMOVING }),
  });
}

/** AncesTree removed from this computer, the families too or not: the app closes, and on
 *  Windows its uninstaller opens. */
export function useRemoveAncesTree() {
  return useMutation({
    mutationFn: (families: "delete" | "keep") =>
      desktopCall<{ removing: string }>("/api/desktop/removing/remove", "POST", { families }),
  });
}
