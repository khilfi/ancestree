import { useFamilies } from "@/api/desktop";
import { FamiliesSection } from "./FamiliesSection";
import { FamilyFolderSection } from "./FamilyFolderSection";
import { type Part, Parts } from "./Parts";

/** Settings → You and your family: the families on this computer (the desktop app's
 *  alone, 0.4.0), then the family folder. /settings/families and /settings/family-folder lead
 *  to their parts. Who you are is in the Me menu, its one place since 0.9.0. */
export function FamilyPage() {
  const desktop = Boolean(useFamilies().data);
  const parts: Part[] = [
    ...(desktop ? [{ id: "families", label: "Families", element: <FamiliesSection /> }] : []),
    { id: "family-folder", label: "Family folder", element: <FamilyFolderSection /> },
  ];
  return <Parts parts={parts} />;
}
