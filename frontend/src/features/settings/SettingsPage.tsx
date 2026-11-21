import { CircleHelpIcon } from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { useFamilyFolder, waitingIn } from "@/api/familyFolder";
import { useTrash } from "@/api/queries";
import { useDatabaseDown } from "@/app/DatabaseWarning";
import { Hint } from "@/components/Hint";

// What's missing is Family facts' second tab, and Me in its own menu, since 0.9.0.
const SECTIONS = [
  { to: "kinship", label: "Kinship" }, // the Malay titles, and the relationship kinds
  { to: "family", label: "You and your family" }, // Families and the family folder
  { to: "import", label: "Import" },
  { to: "map", label: "Map" },
  { to: "backups", label: "Backups" },
  { to: "trash", label: "Trash" },
  { to: "/guide", label: "Help" }, // a link to the user guide, no longer a part
  { to: "about", label: "About" },
] as const;

// The part open marked by NavLink's aria-current; a string, which a hint's trigger keeps
// whole, as it can't a function.
const sectionClass =
  "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:hover:bg-muted";

/** Settings in sections, each with its own address: the words, the kinds of link, and
 *  the housekeeping that used to sit in the top bar. */
export function SettingsPage() {
  const inTrash = useTrash().data?.length ?? 0;
  const { asking, changes, answered, all } = waitingIn(useFamilyFolder().data);
  const down = useDatabaseDown();

  return (
    <div className="flex h-full">
      <nav
        aria-label="Settings"
        className="w-52 shrink-0 space-y-1 border-r border-border bg-card p-3"
      >
        <h1 className="px-3 pt-1 pb-2 text-lg font-semibold">Settings</h1>
        {SECTIONS.map((section) => (
          <Hint
            key={section.to}
            side="right"
            label={
              section.to === "family" && all > 0
                ? [
                    asking > 0 && `${asking} asking to join`,
                    changes > 0 && `${changes} with changes waiting`,
                    answered > 0 && "the keeper has answered",
                  ]
                    .filter(Boolean)
                    .join(", ")
                : section.to === "/guide"
                  ? "The guide to AncesTree"
                  : undefined
            }
          >
            <NavLink to={section.to} className={sectionClass}>
              {section.label}
              {section.to === "family" && all > 0 && (
                <span className="rounded-full bg-warning-tint px-1.5 text-xs font-medium text-warning-soft-foreground tabular-nums">
                  {all}
                </span>
              )}
              {section.to === "trash" && inTrash > 0 && (
                <span className="text-xs text-faint tabular-nums">{inTrash}</span>
              )}
              {section.to === "/guide" && (
                <CircleHelpIcon className="size-3.5 text-faint" aria-hidden />
              )}
              {section.to === "about" && down && (
                <span
                  className="size-2 rounded-full bg-destructive"
                  role="img"
                  aria-label="needs attention"
                />
              )}
            </NavLink>
          </Hint>
        ))}
      </nav>
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
