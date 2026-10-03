import { CircleCheckIcon, CloudOffIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router";
import { useFamilyFolder, useSyncNow, waitingIn } from "@/api/familyFolder";
import type { FamilyFolderStatus } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ago } from "@/lib/ago";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
// The window back after this long away: a round at once, rather than within the minute.
const AWAY = 2 * 60_000;

type Tone = "good" | "busy" | "warn";

export interface InStep {
  tone: Tone;
  text: string; // at the top, short
  why: string; // in its window: what stands in the way, if anything
}

/** "today at 14:02", "yesterday at 09:15", or "Tue 1 Oct at 18:40". */
export function at(iso: string, now: number = Date.now()): string {
  const when = new Date(iso);
  const time = when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days =
    Math.floor(new Date(now).setHours(0, 0, 0, 0) / DAY) -
    Math.floor(new Date(when).setHours(0, 0, 0, 0) / DAY);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const day = when.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} at ${time}`;
}

/** How the family stands with its family folder, as the top of the window says it (0.4.0,
 *  D47): in step and when; keeping in step; offline; not in step for a day; or what's in the
 *  way. Null with no family folder. */
export function inStep(
  status: FamilyFolderStatus | undefined,
  now: number = Date.now(),
): InStep | null {
  if (!status?.setup) return null;
  const since = status.last_sync;
  const long = since !== null && since !== undefined && now - new Date(since).getTime() > DAY;
  if (status.broken || status.replaced) {
    return { tone: "warn", text: "Not keeping in step", why: status.problem };
  }
  if (!status.available) {
    return {
      tone: "warn",
      text: "Needs its Google project",
      why: "Give the family's Google project, in Settings → Family folder.",
    };
  }
  if (!status.email) {
    return {
      tone: "warn",
      text: "Sign in to Google",
      why: status.problem || "The sign-in to Google has ended: sign in again.",
    };
  }
  if (status.syncing) return { tone: "busy", text: "Keeping in step…", why: "" };
  if (status.through && !long) {
    return {
      tone: "good",
      text: `In step · ${ago(since ?? new Date(now).toISOString(), now)}`,
      why: status.problem,
    };
  }
  if (long && since) {
    return {
      tone: "warn",
      text: `Not in step since ${at(since, now).replace(/ at .*/, "")}`,
      why: status.problem,
    };
  }
  if (status.trouble === "offline") {
    return {
      tone: "warn",
      text: since ? `Offline · in step ${ago(since, now)}` : "Offline",
      why: status.problem,
    };
  }
  if (status.trouble) {
    return {
      tone: "warn",
      text:
        status.trouble === "foreign"
          ? "Family folder to rebuild"
          : status.lost
            ? "Family folder gone"
            : "Not in step",
      why: status.problem,
    };
  }
  if (!since) return { tone: "busy", text: "Not in step yet", why: "" };
  return { tone: "good", text: `In step · ${ago(since, now)}`, why: status.problem };
}

const ICONS: Record<Tone, typeof CircleCheckIcon> = {
  good: CircleCheckIcon,
  busy: RefreshCwIcon,
  warn: TriangleAlertIcon,
};

/** What waits, said plainly: for the keeper, computers asking and changes to look at; for a
 *  relative, its own changes waiting for the keeper. */
function waits(status: FamilyFolderStatus): string[] {
  const lines: string[] = [];
  const { asking, changes } = waitingIn(status);
  if (asking) lines.push(`${asking} ${asking === 1 ? "computer asks" : "computers ask"} to join`);
  if (changes)
    lines.push(
      `${changes} ${changes === 1 ? "relative's changes wait" : "relatives' changes wait"} for you`,
    );
  const pending = status.pending ?? 0;
  if (pending) {
    const what = pending === 1 ? "1 person or link" : `${pending} people and links`;
    lines.push(
      `Your changes to ${what} wait for the keeper${status.sent_at ? `, sent ${ago(status.sent_at)}` : ""}`,
    );
  }
  return lines;
}

/**
 * The family folder's state at the top of the window (0.4.0, D47), on every computer in a
 * family folder; its window says when the family was last in step, when it arrived or was
 * published, what waits, and has Sync now. Coming back to the window after a while starts a
 * round at once.
 */
export function SyncIndicator() {
  const status = useFamilyFolder().data;
  const sync = useSyncNow();
  const tried = status?.tried;
  const setup = status?.setup;
  useEffect(() => {
    if (!setup) return;
    const back = () => {
      if (document.visibilityState !== "visible") return;
      if (tried && Date.now() - new Date(tried).getTime() < AWAY) return;
      sync.mutate(undefined, { onError: () => {} });
    };
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [setup, tried, sync]);
  const state = inStep(status);
  if (!status || !state) return null;
  const Icon =
    state.tone === "warn" && status.trouble === "offline" ? CloudOffIcon : ICONS[state.tone];
  const busy = state.tone === "busy" || sync.isPending;
  const keeper = status.setup === "keeper";
  const waiting = waits(status);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Family folder: ${state.text}`}
          title="The family folder: how the family stands with it"
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs whitespace-nowrap transition-colors",
            state.tone === "warn"
              ? "bg-amber-50 font-medium text-amber-800 hover:bg-amber-100"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-800",
          )}
        >
          <Icon
            className={cn(
              "size-3.5",
              busy && "animate-spin",
              state.tone === "good" && "text-emerald-600",
            )}
          />
          <span className="max-xl:sr-only">{sync.isPending ? "Keeping in step…" : state.text}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-3 p-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium">{status.family || "The family"}'s family folder</p>
          <p className="text-stone-600">
            {status.last_sync ? `Last in step ${at(status.last_sync)}.` : "Not in step yet."}{" "}
            {keeper
              ? status.published
                ? `Your last change went out ${at(status.published)}.`
                : ""
              : status.received
                ? `The family last arrived ${at(status.received)}.`
                : ""}
          </p>
        </div>
        {state.why && (
          <p
            className={cn(state.tone === "warn" ? "font-medium text-amber-700" : "text-stone-600")}
          >
            {state.why}
          </p>
        )}
        {waiting.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-stone-600">
            {waiting.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-500">
          AncesTree keeps in step every minute while it's on, and soon after each change here.
        </p>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            onClick={() => sync.mutate(undefined, { onError: showError })}
            disabled={busy || !status.email}
          >
            <RefreshCwIcon className={cn(busy && "animate-spin")} />
            {busy ? "Keeping in step…" : "Sync now"}
          </Button>
          <Link to="/settings/family-folder" className="text-sky-700 hover:underline">
            Family folder settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
