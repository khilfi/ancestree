import { useFamilies } from "@/api/desktop";
import { FamiliesSection } from "./FamiliesSection";
import { FamilyFolderSection } from "./FamilyFolderSection";
import { MeSection } from "./MeSection";
import { type Part, Parts } from "./Parts";

/** Settings → You and your family: who you are, the families on this computer (the
 *  desktop app's alone, 0.4.0), then the family folder. /settings/me, /settings/families and
 *  /settings/family-folder lead to their parts. */
export function FamilyPage() {
  const desktop = Boolean(useFamilies().data);
  const parts: Part[] = [
    { id: "me", label: "Me", element: <MeSection /> },
    ...(desktop ? [{ id: "families", label: "Families", element: <FamiliesSection /> }] : []),
    { id: "family-folder", label: "Family folder", element: <FamilyFolderSection /> },
  ];
  return <Parts parts={parts} />;
}
