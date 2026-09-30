import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  const response = await fetch(path, { method });
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
