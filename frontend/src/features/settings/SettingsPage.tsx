import { NavLink, Outlet } from "react-router";
import { useFamilies } from "@/api/desktop";
import { useFamilyFolder, waitingIn } from "@/api/familyFolder";
import { useTrash } from "@/api/queries";
import { useDatabaseDown } from "@/app/DatabaseWarning";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { to: "kinship", label: "Kinship words" },
  { to: "me", label: "Me" },
  { to: "families", label: "Families" },
  { to: "family-folder", label: "Family folder" },
  { to: "kinds", label: "Relationship kinds" },
  { to: "missing", label: "What's missing" },
  { to: "import", label: "Import" },
  { to: "backups", label: "Backups" },
  { to: "trash", label: "Trash" },
  { to: "about", label: "About" },
] as const;

function sectionClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
    isActive
      ? "bg-stone-100 font-medium text-stone-900"
      : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
  );
}

/** Settings in sections, each with its own address: the words, the kinds of link, and
 *  the housekeeping that used to sit in the top bar. */
export function SettingsPage() {
  const inTrash = useTrash().data?.length ?? 0;
  const { asking, changes, answered, all } = waitingIn(useFamilyFolder().data);
  const down = useDatabaseDown();
  // Several families on one computer are the desktop app's alone (0.4.0).
  const desktop = Boolean(useFamilies().data);

  return (
    <div className="flex h-full">
      <nav
        aria-label="Settings"
        className="w-52 shrink-0 space-y-1 border-r border-stone-200 bg-white p-3"
      >
        <h1 className="px-3 pt-1 pb-2 text-lg font-semibold">Settings</h1>
        {SECTIONS.filter((section) => desktop || section.to !== "families").map((section) => (
          <NavLink key={section.to} to={section.to} className={sectionClass}>
            {section.label}
            {section.to === "family-folder" && all > 0 && (
              <span
                className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800 tabular-nums"
                title={[
                  asking > 0 && `${asking} asking to join`,
                  changes > 0 && `${changes} with changes waiting`,
                  answered > 0 && "the keeper has answered",
                ]
                  .filter(Boolean)
                  .join(", ")}
              >
                {all}
              </span>
            )}
            {section.to === "trash" && inTrash > 0 && (
              <span className="text-xs text-stone-500 tabular-nums">{inTrash}</span>
            )}
            {section.to === "about" && down && (
              <span
                className="size-2 rounded-full bg-red-500"
                role="img"
                aria-label="needs attention"
              />
            )}
          </NavLink>
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
