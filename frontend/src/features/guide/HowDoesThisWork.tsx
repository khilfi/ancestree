import { CircleHelpIcon } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { type GuidePlace, guideAt } from "./places";

/** **How does this work?** beside a harder place in the app: the guide, open at its
 *  section. */
export function HowDoesThisWork({ at, className }: { at: GuidePlace; className?: string }) {
  return (
    <Link
      to={guideAt(at)}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-normal text-sky-700 hover:underline",
        className,
      )}
    >
      <CircleHelpIcon className="size-3.5" />
      How does this work?
    </Link>
  );
}
