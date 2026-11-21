import { KindsSection } from "./KindsSection";
import { KinshipSection } from "./KinshipSection";
import { Parts } from "./Parts";

/** Settings → Kinship: the Malay birth-order titles, then the relationship kinds.
 *  The kinship words' language is set where they're seen since 0.9.0. /settings/kinds
 *  leads to the kinds. */
export function KinshipPage() {
  return (
    <Parts
      parts={[
        { id: "titles", label: "Malay birth-order titles", element: <KinshipSection /> },
        { id: "kinds", label: "Relationship kinds", element: <KindsSection /> },
      ]}
    />
  );
}
