import { KindsSection } from "./KindsSection";
import { KinshipSection } from "./KinshipSection";
import { Parts } from "./Parts";

/** Settings → Kinship: the kinship words, their language and the Malay titles, then
 *  the relationship kinds. /settings/kinds leads to the kinds. */
export function KinshipPage() {
  return (
    <Parts
      parts={[
        { id: "words", label: "Kinship words", element: <KinshipSection /> },
        { id: "kinds", label: "Relationship kinds", element: <KindsSection /> },
      ]}
    />
  );
}
