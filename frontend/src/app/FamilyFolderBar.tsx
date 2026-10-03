import { useState } from "react";
import { Link } from "react-router";
import { useDesktopUpdate } from "@/api/desktop";
import {
  sendsToTheKeeper,
  useFamilyFolder,
  useFreshWhenReceived,
  useSyncNow,
} from "@/api/familyFolder";
import { useGraph } from "@/api/queries";
import type { FamilyFolderStatus } from "@/api/types";
import { Button } from "@/components/ui/button";
import { showError } from "@/lib/notify";

const NOT_NOW = "ancestree.family-folder.not-now";

function saidNotNow(): boolean {
  try {
    return localStorage.getItem(NOT_NOW) === "yes";
  } catch {
    return false;
  }
}

/** What a relative's computer says about its family. */
function onARelatives(status: FamilyFolderStatus): string {
  const family = status.family || "This family";
  if (status.role === "waiting") return "Waiting for the family's keeper to let this computer in.";
  if (!sendsToTheKeeper(status)) {
    return `${family} arrives here from its keeper, so it can't be changed on this computer.`;
  }
  const pending = status.pending ?? 0;
  const answered = (status.answers ?? []).length > 0 ? " The keeper has answered." : "";
  if (pending === 0) {
    return `${family} arrives here from its keeper. What you change goes to them first.${answered}`;
  }
  const what = pending === 1 ? "1 person or link" : `${pending} people and links`;
  return `${family} arrives here from its keeper. Your changes to ${what} wait for them.${answered}`;
}

/**
 * The family folder's word at the top of the app. On a relative's computer: that the
 * family arrives from its keeper; and either that it can't be changed here, or what of its own
 * waits for the keeper, with Send now. On a new desktop install with no family yet: the
 * first thing it asks, whether to join the family's AncesTree or start one. When a family has
 * just arrived from the folder, everything shown is asked for again.
 */
export function FamilyFolderBar() {
  const status = useFamilyFolder().data;
  useFreshWhenReceived(status);
  const desktop = useDesktopUpdate().data; // only the desktop app answers this
  const people = useGraph().data?.people.length;
  const [notNow, setNotNow] = useState(saidNotNow);
  const sync = useSyncNow();
  if (!status) return null;

  if (status.setup === "member") {
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-200 bg-stone-50 px-3 py-1.5 text-sm text-stone-700 md:px-4"
      >
        <span>{onARelatives(status)}</span>
        {sendsToTheKeeper(status) && (status.pending ?? 0) > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => sync.mutate(undefined, { onError: showError })}
            disabled={sync.isPending}
          >
            {sync.isPending ? "Sending…" : "Send now"}
          </Button>
        )}
        <Link to="/settings/family-folder" className="text-sky-700 hover:underline">
          Family folder
        </Link>
      </div>
    );
  }

  const newInstall = desktop && !status.setup && people === 0;
  if (!newInstall || notNow) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-900 md:px-4"
    >
      <span>
        Welcome to AncesTree. Has your family's keeper sent you an invitation? Join with it, or
        start your family's own.
      </span>
      <Button size="sm" className="ml-auto" asChild>
        <Link to="/settings/family-folder">Join or start</Link>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          try {
            localStorage.setItem(NOT_NOW, "yes");
          } catch {
            // Only for this visit, then.
          }
          setNotNow(true);
        }}
      >
        Not now
      </Button>
    </div>
  );
}
