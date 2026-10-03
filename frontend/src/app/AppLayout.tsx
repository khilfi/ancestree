import { BookOpenIcon, InfoIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useFamilyFolder, waitingIn } from "@/api/familyFolder";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/features/export/ExportDialog";
import { TreePictureProvider } from "@/features/export/treePicture";
import { FamilyFactsPanel } from "@/features/facts/FamilyFactsPanel";
import { FamilyMenu } from "@/features/families/FamilyMenu";
import { UndoRedo } from "@/features/history/UndoRedo";
import { MeButton } from "@/features/me/MeButton";
import { PeopleSearch } from "@/features/search/PeopleSearch";
import { viewSearch, withView } from "@/features/tree/filters";
import { cn } from "@/lib/utils";
import { CopyBadge } from "./CopyBadge";
import { CanEdit, InAppOnly, useCopy } from "./copy";
import { DatabaseWarning } from "./DatabaseWarning";
import { FamilyFolderBar } from "./FamilyFolderBar";
import { SyncIndicator } from "./SyncIndicator";
import { UpdateBanner } from "./UpdateBanner";

function tabClass({ isActive }: { isActive: boolean }): string {
  const base =
    "rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors max-md:flex-1";
  return isActive
    ? `${base} bg-white text-stone-900 shadow-sm`
    : `${base} text-stone-600 hover:text-stone-900`;
}

function iconLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors",
    isActive ? "bg-stone-100 text-stone-900" : "text-stone-600 hover:text-stone-900",
  );
}

/** Settings, with how many things wait in it: computers asking to join and relatives'
 *  changes, for the keeper; the keeper's answers, for a relative. Only in the app itself. */
export function SettingsLink() {
  const waiting = waitingIn(useFamilyFolder().data).all;
  return (
    <NavLink
      to="/settings"
      className={iconLinkClass}
      aria-label={waiting > 0 ? `Settings: ${waiting} waiting in Family folder` : "Settings"}
      title={waiting > 0 ? `${waiting} waiting in Settings → Family folder` : "Settings"}
    >
      <SettingsIcon className="size-4" />
      <span className="hidden 2xl:inline">Settings</span>
      {waiting > 0 && (
        <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800 tabular-nums">
          {waiting}
        </span>
      )}
    </NavLink>
  );
}

export function AppLayout() {
  const [facts, setFacts] = useState(false);
  const closeFacts = useCallback(() => setFacts(false), []);
  // The tree and the timeline share their filters: moving between them keeps them.
  const params = new URLSearchParams(useLocation().search);
  const kept = viewSearch(params);
  // A view-only copy: nothing to add, undo or set.
  const copy = useCopy();

  return (
    <TreePictureProvider>
      <div className="flex h-full flex-col bg-stone-50 text-stone-900">
        {/* On a phone: two rows, the views across the second. */}
        <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-stone-200 bg-white px-3 py-2 md:flex-nowrap md:gap-x-3 md:px-4">
          {/* Where the bar is short, the family's name leads in the desktop app, and the
              words beside the icons go first (0.4.0). */}
          <div className="group/brand flex min-w-0 items-center gap-1 max-md:flex-1">
            <span
              className={cn(
                "shrink-0 text-lg font-semibold tracking-tight",
                "group-has-[[data-family-menu]]/brand:max-xl:hidden",
                copy && "max-md:sr-only", // the copy's badge says what this is
              )}
            >
              AncesTree
            </span>
            {/* Facts about the whole family, beside its name. */}
            <button
              type="button"
              aria-expanded={facts}
              aria-label="Family facts"
              title="Family facts: the whole family at a glance"
              onClick={() => setFacts((now) => !now)}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors",
                facts ? "bg-sky-50 text-sky-800" : "text-stone-500 hover:text-stone-900",
              )}
            >
              <InfoIcon className="size-4" />
              <span className="hidden whitespace-nowrap 2xl:inline">Family facts</span>
            </button>
            {copy && <CopyBadge copy={copy} />}
            {/* Which family, of those on this computer, in the desktop app; and how it stands
                with its family folder (0.4.0). */}
            {!copy && <FamilyMenu />}
            {!copy && <SyncIndicator />}
          </div>
          <nav
            aria-label="Views"
            className="flex gap-1 rounded-lg bg-stone-100 p-1 max-md:order-last max-md:w-full"
          >
            <NavLink to={{ pathname: "/tree", search: kept }} className={tabClass}>
              Tree
            </NavLink>
            <NavLink to={{ pathname: "/timeline", search: kept }} className={tabClass}>
              Timeline
            </NavLink>
            <NavLink to={{ pathname: "/map", search: kept }} className={tabClass}>
              Map
            </NavLink>
          </nav>
          <CanEdit>
            <Button asChild size="sm">
              <Link
                to={{ pathname: "/tree", search: `?${withView(params, { new: "1" })}` }}
                title="Add person"
              >
                <PlusIcon />
                <span className="md:max-xl:sr-only">Add person</span>
              </Link>
            </Button>
          </CanEdit>
          <CanEdit>
            <UndoRedo />
          </CanEdit>
          <PeopleSearch />
          <div className="ml-auto flex items-center gap-1 md:gap-2">
            {!copy && <DatabaseWarning />}
            {/* In a copy, each viewer chooses who they are, kept in their browser. */}
            <MeButton />
            <ExportButton />
            {/* Words where the top bar has room; icons alone where it's short. */}
            <NavLink
              to="/dictionary"
              className={iconLinkClass}
              aria-label="Dictionary"
              title="Kinship words in English, Malay and Javanese"
            >
              <BookOpenIcon className="size-4" />
              <span className="hidden 2xl:inline">Dictionary</span>
            </NavLink>
            <InAppOnly>
              <SettingsLink />
            </InAppOnly>
          </div>
        </header>
        {!copy && <UpdateBanner />}
        {!copy && <FamilyFolderBar />}
        <main className="relative min-h-0 flex-1">
          <Outlet />
          {facts && <FamilyFactsPanel onClose={closeFacts} />}
        </main>
      </div>
    </TreePictureProvider>
  );
}
