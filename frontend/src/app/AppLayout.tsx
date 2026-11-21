import {
  CircleHelpIcon,
  EllipsisIcon,
  InfoIcon,
  LanguagesIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { useFamilyFolder, waitingIn } from "@/api/familyFolder";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ViewHeadKeeper } from "@/components/ViewToolbar";
import { LifeStoryHost } from "@/features/biography/LifeStory";
import { CopyDialog } from "@/features/export/CopyDialog";
import { ExportItems, ExportMenu } from "@/features/export/ExportMenu";
import { TreePictureProvider } from "@/features/export/treePicture";
import { FamilyFactsPanel } from "@/features/facts/FamilyFactsPanel";
import { ExampleBar, FamilyMenu } from "@/features/families/FamilyMenu";
import { UndoRedo } from "@/features/history/UndoRedo";
import { MeButton } from "@/features/me/MeButton";
import { SamePersonHost } from "@/features/person/SamePerson";
import { PeopleSearch } from "@/features/search/PeopleSearch";
import { viewSearch, withView } from "@/features/tree/filters";
import { closeFamilyFacts, openFamilyFacts, useFamilyFactsOpen } from "@/lib/familyFacts";
import { cn } from "@/lib/utils";
import { CopyBadge } from "./CopyBadge";
import { CanEdit, InAppOnly, useCopy } from "./copy";
import { DatabaseWarning } from "./DatabaseWarning";
import { FamilyFolderBar } from "./FamilyFolderBar";
import { LeafMark } from "./LeafMark";
import { SyncIndicator } from "./SyncIndicator";
import { UpdateBanner } from "./UpdateBanner";

function tabClass({ isActive }: { isActive: boolean }): string {
  const base =
    "rounded-md px-2 py-1.5 text-center text-sm font-medium transition-colors max-md:flex-1 lg:px-3";
  return isActive
    ? `${base} bg-card text-foreground shadow-sm`
    : `${base} text-muted-foreground hover:text-foreground`;
}

/*
 * The top bar names Tree, Timeline, Map, Add person and Search people from 1024
 * pixels across, and Add person at every width. The rest, Export, the Dictionary, the Guide and
 * Settings, have their words in the bar from 1760 pixels (`min-[1760px]:`, written whole:
 * Tailwind finds a class only so), where there's room for them all; narrower, they're in
 * **More**, with their words there, Export's two items among them. Family facts has one place,
 * its ⓘ beside the family's name, at every width. Nothing is cut short: the family's
 * name gives way first, its whole name in its hint. Below 1024 pixels, the bar's parts stand
 * closer, as they do on a phone, and the views' tabs are narrower, so the family's name is
 * still read there with the family folder's state beside it.
 */
// A link of the bar's, the page it opens marked by NavLink's aria-current. A string, not
// NavLink's function: under a hint, Radix's Slot joins classes as words, and a function's came
// through as its own source.
const iconLinkClass =
  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground";

/** Settings, with how many things wait in it: computers asking to join and relatives'
 *  changes, for the keeper; the keeper's answers, for a relative. Only in the app itself. */
export function SettingsLink() {
  const waiting = waitingIn(useFamilyFolder().data).all;
  return (
    <Hint
      label={
        waiting > 0
          ? `${waiting} waiting in Settings → You and your family → Family folder`
          : "Settings"
      }
    >
      <NavLink
        to="/settings"
        className={iconLinkClass}
        aria-label={waiting > 0 ? `Settings: ${waiting} waiting in Family folder` : "Settings"}
      >
        <SettingsIcon className="size-4" />
        <span>Settings</span>
        {waiting > 0 && (
          <span className="rounded-full bg-warning-tint px-1.5 text-xs font-medium text-warning-soft-foreground tabular-nums">
            {waiting}
          </span>
        )}
      </NavLink>
    </Hint>
  );
}

/** **? Guide**: the user guide, inside the app. Only in the app itself: a copy
 *  carries no guide. */
export function GuideLink() {
  return (
    <Hint label="The guide to AncesTree">
      <NavLink to="/guide" className={iconLinkClass} aria-label="Guide">
        <CircleHelpIcon className="size-4" />
        <span>Guide</span>
      </NavLink>
    </Hint>
  );
}

/** How many things wait in Settings, said on **More** and its Settings. Only in the app itself. */
function Waiting({ said = false }: { said?: boolean }) {
  const waiting = waitingIn(useFamilyFolder().data).all;
  if (waiting === 0) return null;
  return (
    <span className="rounded-full bg-warning-tint px-1.5 text-xs font-medium text-warning-soft-foreground tabular-nums">
      {said && <span className="sr-only">: </span>}
      {waiting}
      {said && <span className="sr-only"> waiting in Settings</span>}
    </span>
  );
}

/** **More**: what the bar has no room to name, each with its words; Export's own
 *  two, a view-only copy and the tree's picture, first. */
function More({ onCopy }: { onCopy: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="min-[1760px]:hidden">
          <EllipsisIcon />
          More
          <InAppOnly>
            <Waiting said />
          </InAppOnly>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <ExportItems onCopy={onCopy} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dictionary">
            <LanguagesIcon />
            Dictionary
          </Link>
        </DropdownMenuItem>
        <InAppOnly>
          <DropdownMenuItem asChild>
            <Link to="/guide">
              <CircleHelpIcon />
              Guide
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <SettingsIcon />
              Settings
              <span className="ml-auto">
                <Waiting />
              </span>
            </Link>
          </DropdownMenuItem>
        </InAppOnly>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  // Family facts, opened from its ⓘ, or at What's missing from anywhere.
  const facts = useFamilyFactsOpen();
  const [copying, setCopying] = useState(false); // Export → View-only copy…
  const [head, setHead] = useState<HTMLElement | null>(null); // the open view's toolbar and bars
  // The tree and the timeline share their filters: moving between them keeps them.
  const params = new URLSearchParams(useLocation().search);
  const kept = viewSearch(params);
  // A view-only copy: nothing to add, undo or set.
  const copy = useCopy();

  return (
    <TreePictureProvider>
      <div className="flex h-full flex-col bg-background text-foreground">
        {/* On a phone: two rows, the views across the second. */}
        <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border bg-card px-3 py-2 md:flex-nowrap md:px-4 lg:gap-x-3">
          {/* Where the bar is short, the family's name leads in the desktop app, and the
              words beside the icons go first (0.4.0); the leaf says AncesTree there. */}
          <div className="group/brand flex min-w-0 items-center gap-1 max-md:flex-1">
            {/* The family leaf, the app's icon: there even where the name gives way. */}
            <LeafMark className="mr-0.5 h-7 w-[19px] shrink-0" />
            <span
              className={cn(
                "shrink-0 text-lg font-semibold tracking-tight",
                "group-has-[[data-family-menu]]/brand:max-2xl:hidden",
                copy && "max-md:sr-only", // the copy's badge says what this is
              )}
            >
              AncesTree
            </span>
            {/* Facts about the whole family, and what's missing, beside its name:
                their one place, at every width. */}
            <Hint label={copy ? "Family facts" : "Family facts, and what's missing"}>
              <button
                type="button"
                aria-expanded={facts !== null}
                aria-label="Family facts"
                onClick={() => (facts ? closeFamilyFacts() : openFamilyFacts())}
                className={cn(
                  "flex shrink-0 items-center rounded-md p-1 transition-colors",
                  facts
                    ? "bg-highlight-soft text-highlight-soft-foreground"
                    : "text-faint hover:text-foreground",
                )}
              >
                <InfoIcon className="size-4" />
              </button>
            </Hint>
            {copy && <CopyBadge copy={copy} />}
            {/* Which family, of those on this computer, in the desktop app; and how it stands
                with its family folder (0.4.0). */}
            {!copy && <FamilyMenu />}
            {!copy && <SyncIndicator />}
          </div>
          <nav
            aria-label="Views"
            className="flex gap-1 rounded-lg bg-muted p-1 max-md:order-last max-md:w-full"
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
            <Hint label="Add person">
              <Button asChild size="sm">
                <Link to={{ pathname: "/tree", search: `?${withView(params, { new: "1" })}` }}>
                  <PlusIcon />
                  Add person
                </Link>
              </Button>
            </Hint>
          </CanEdit>
          <CanEdit>
            <UndoRedo />
          </CanEdit>
          <PeopleSearch />
          <div className="ml-auto flex items-center gap-1 lg:gap-2">
            {!copy && <DatabaseWarning />}
            {/* In a copy, each viewer chooses who they are, kept in their browser. */}
            <MeButton />
            {/* Their words where the bar has room for them all; in More where it hasn't. */}
            <div className="hidden items-center gap-2 min-[1760px]:flex">
              <ExportMenu onCopy={() => setCopying(true)} />
              <Hint label="Kinship words in English, Malay and Javanese">
                <NavLink to="/dictionary" className={iconLinkClass} aria-label="Dictionary">
                  <LanguagesIcon className="size-4" />
                  <span>Dictionary</span>
                </NavLink>
              </Hint>
              <InAppOnly>
                <GuideLink />
                <SettingsLink />
              </InAppOnly>
            </div>
            <More onCopy={() => setCopying(true)} />
          </div>
        </header>
        {!copy && <UpdateBanner />}
        {!copy && <ExampleBar />}
        {!copy && <FamilyFolderBar />}
        {/* Same person as…, asked from a warning or What's missing. */}
        <CanEdit>
          <InAppOnly>
            <SamePersonHost />
          </InAppOnly>
        </CanEdit>
        {/* A life story, opened from a panel or a book mark on a photo; in a copy too. */}
        <LifeStoryHost />
        {copying && <CopyDialog open onOpenChange={(next) => !next && setCopying(false)} />}
        <main className="relative min-h-0 flex-1">
          {/* The view's head, its toolbar and the bars under it: Family facts starts below it,
              covering none of its controls. */}
          <ViewHeadKeeper.Provider value={setHead}>
            <Outlet />
          </ViewHeadKeeper.Provider>
          {facts && (
            <FamilyFactsPanel
              tab={facts}
              onTab={openFamilyFacts}
              onClose={closeFamilyFacts}
              below={head}
            />
          )}
        </main>
      </div>
    </TreePictureProvider>
  );
}
