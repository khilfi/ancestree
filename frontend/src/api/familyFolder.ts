import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./client";
import { unwrap } from "./errors";
import type {
  Admit,
  BringIn,
  FamilyFolderStatus,
  FolderChanges,
  JoinFamily,
  Recover,
  StartFamily,
} from "./types";

export const FAMILY_FOLDER = ["family-folder"] as const;
const SHARED = ["family-folder", "shared"] as const;

/** Where this computer stands with its family's folder. Asked every two seconds while
 *  a sign-in waits for Google, and every 20 otherwise, so a relative asking to join, or a
 *  family newly arrived, shows soon. Not asked in a copy, which has no family folder. */
export function useFamilyFolder(enabled = true) {
  return useQuery({
    queryKey: FAMILY_FOLDER,
    queryFn: () => unwrap(api.GET("/api/family-folder")),
    refetchInterval: (query) => (query.state.data?.signing_in ? 2_000 : 20_000),
    retry: false,
    enabled,
  });
}

/** What waits in Settings → Family folder: for the keeper, computers asking to join and
 *  relatives' changes; for a relative, the keeper's answers, unread. */
export function waitingIn(status: FamilyFolderStatus | undefined) {
  const asking = status?.asking?.length ?? 0;
  const changes = status?.changes?.length ?? 0;
  const answered = status?.answers?.length ?? 0;
  return { asking, changes, answered, all: asking + changes + answered };
}

// A relative's computer with one of these roles sends its changes to the keeper.
const SENDS = new Set(["contributor", "trusted"]);

/** Whether the family here is kept by its keeper and nothing in it changes: on a relative's
 *  computer that doesn't send changes (a viewer's, one not let in yet, or one removed). */
export function useKeptByTheKeeper(enabled = true): boolean {
  const status = useFamilyFolder(enabled).data;
  return status?.setup === "member" && !SENDS.has(status.role ?? "");
}

/** Whether this is a relative's computer that sends its changes to the keeper: people,
 *  links, stories and photos change here, and wait for the keeper. */
export function sendsToTheKeeper(status: FamilyFolderStatus | undefined): boolean {
  return status?.setup === "member" && SENDS.has(status.role ?? "");
}

function useFolderAction<T>(send: (input: T) => Promise<FamilyFolderStatus>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (status) => client.setQueryData(FAMILY_FOLDER, status),
  });
}

/** Start signing in: Google's page opens in the browser (the desktop app sends it there). */
export function useSignInToGoogle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await unwrap(api.POST("/api/family-folder/sign-in"));
      window.open(url, "_blank", "noopener");
      return url;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: FAMILY_FOLDER }),
  });
}

export const useSignOutOfGoogle = () =>
  useFolderAction(() => unwrap(api.POST("/api/family-folder/sign-out")));
export const useStartFamily = () =>
  useFolderAction((body: StartFamily) => unwrap(api.POST("/api/family-folder/start", { body })));
export const useRecoverySeen = () =>
  useFolderAction(() => unwrap(api.POST("/api/family-folder/recovery-seen")));
export const useJoinFamily = () =>
  useFolderAction((body: JoinFamily) => unwrap(api.POST("/api/family-folder/join", { body })));
export const useRecoverFamily = () =>
  useFolderAction((body: Recover) => unwrap(api.POST("/api/family-folder/recover", { body })));
export const useInvite = () =>
  useFolderAction((email: string) =>
    unwrap(api.POST("/api/family-folder/invite", { body: { email } })),
  );
export const useAdmit = () =>
  useFolderAction((body: Admit) => unwrap(api.POST("/api/family-folder/admit", { body })));
export const useRefuse = () =>
  useFolderAction((device: string) =>
    unwrap(api.POST("/api/family-folder/refuse", { body: { device } })),
  );
export const useRemoveComputer = () =>
  useFolderAction((device: string) =>
    unwrap(api.POST("/api/family-folder/remove", { body: { device } })),
  );
export const useSyncNow = () => useFolderAction(() => unwrap(api.POST("/api/family-folder/sync")));
export const useAnswersSeen = () =>
  useFolderAction(() => unwrap(api.POST("/api/family-folder/answers-seen")));
/** A new recovery code, for one lost or seen by someone else (0.3.1): shown until it's kept. */
export const useNewRecoveryCode = () =>
  useFolderAction(() => unwrap(api.POST("/api/family-folder/new-recovery-code")));
/** This computer out of its family folder (0.3.1): it keeps the family as it is. */
export const useLeaveFamilyFolder = () =>
  useFolderAction(() => unwrap(api.POST("/api/family-folder/leave")));

/** What a relative's computer sent, compared with the family it was made on and with the tree
 *  now, for the keeper to tick, as changes from a copy to edit were. Nothing is
 *  written. */
export function useFolderReview(changes: FolderChanges | null, answers: Record<string, string>) {
  return useQuery({
    queryKey: ["family-folder", "review", changes?.device, changes?.proposal, answers],
    queryFn: () =>
      unwrap(
        api.POST("/api/family-folder/changes/{device}/{proposal}/review", {
          params: {
            path: {
              device: (changes as FolderChanges).device,
              proposal: (changes as FolderChanges).proposal,
            },
          },
          body: { answers },
        }),
      ),
    enabled: changes !== null,
    placeholderData: keepPreviousData, // answering a question keeps the review on screen
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

/** Bring in what's ticked of a relative's computer's changes: a backup first, one Undo
 *  step, and Take back later. Everything shown is asked for again. */
export function useBringIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ device, body }: { device: string; body: BringIn }) =>
      unwrap(
        api.POST("/api/family-folder/changes/{device}/bring-in", {
          params: { path: { device } },
          body,
        }),
      ),
    onSettled: () => client.invalidateQueries(),
  });
}

/** Take none of a relative's computer's changes; it hears so, with the keeper's note. */
export const useTurnDown = () =>
  useFolderAction(
    ({ device, proposal, note }: { device: string; proposal: number; note: string }) =>
      unwrap(
        api.POST("/api/family-folder/changes/{device}/turn-down", {
          params: { path: { device } },
          body: { proposal, note },
        }),
      ),
  );

/** Family folders shared with the signed-in Google account, to join. */
export function useSharedFolders(enabled: boolean) {
  return useQuery({
    queryKey: SHARED,
    queryFn: () => unwrap(api.GET("/api/family-folder/shared")),
    enabled,
    retry: false,
  });
}

/** When a family from the family folder has just replaced this one, everything shown is out
 *  of date: ask for all of it again. */
export function useFreshWhenReceived(status: FamilyFolderStatus | undefined) {
  const client = useQueryClient();
  const last = useRef<string | null | undefined>(undefined);
  const received = status?.received;
  useEffect(() => {
    if (received === undefined) return;
    if (last.current !== undefined && received !== last.current) {
      void client.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "family-folder",
      });
    }
    last.current = received;
  }, [client, received]);
}
