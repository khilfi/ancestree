import {
  ChevronDownIcon,
  CircleDotIcon,
  FanIcon,
  HourglassIcon,
  LayoutGridIcon,
  MinusIcon,
  NetworkIcon,
  PlusIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Layout, layoutsFor, type TreeView } from "./filters";

const NAMES: Record<Layout, string> = {
  rings: "Rings",
  tree: "Family tree",
  hourglass: "Hourglass",
  fan: "Fan chart",
};

const ICONS: Record<Layout, ReactNode> = {
  rings: <CircleDotIcon />,
  tree: <NetworkIcon />,
  hourglass: <HourglassIcon />,
  fan: <FanIcon />,
};

function hint(layout: Layout, name: string): string {
  switch (layout) {
    case "rings":
      return "The whole family, a ring per generation around the oldest ancestor";
    case "tree":
      return "Top to bottom, a row per generation";
    case "hourglass":
      return `${name}'s ancestors above, descendants below`;
    case "fan":
      return `${name}'s ancestors in a half-circle, father's side on the left`;
  }
}

export const DEFAULT_DEPTH: Record<"hourglass" | "fan", number> = { hourglass: 3, fan: 4 };

/**
 * The Layout menu: the rings and the other fits, those that suit the filter
 * first; and Tidy up, which was Rearrange, for the rings.
 */
export function LayoutMenu({
  view,
  onView,
  focusName,
  onTidyUp,
}: {
  view: TreeView;
  onView: (view: TreeView) => void;
  focusName: string; // whom an hourglass or fan chart would be around
  onTidyUp?: () => void; // none in read-only trees, or away from the rings
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" aria-label={`Layout: ${NAMES[view.layout]}`}>
          {ICONS[view.layout]}
          {NAMES[view.layout]}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Layout</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={view.layout}
          onValueChange={(layout) => onView({ ...view, layout: layout as Layout, depth: null })}
        >
          {layoutsFor(view.filter).map((layout) => (
            <DropdownMenuRadioItem key={layout} value={layout} className="items-start py-1.5">
              <span className="flex flex-col">
                <span className="font-medium">{NAMES[layout]}</span>
                <span className="text-xs text-stone-500">{hint(layout, focusName)}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onTidyUp && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onTidyUp} className="items-start py-1.5">
              <LayoutGridIcon className="mt-0.5" />
              <span className="flex flex-col">
                <span className="font-medium">Tidy up</span>
                <span className="text-xs text-stone-500">
                  Put everyone you moved back in their place on the rings
                </span>
              </span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How many generations an hourglass or fan chart reaches: − 3 +. */
export function DepthStepper({
  view,
  onView,
}: {
  view: TreeView;
  onView: (view: TreeView) => void;
}) {
  if (view.layout !== "hourglass" && view.layout !== "fan") return null;
  const depth = view.depth ?? DEFAULT_DEPTH[view.layout];
  const most = view.layout === "fan" ? 6 : 8;
  return (
    <span className="flex items-center gap-1 text-stone-600">
      Generations
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="One generation fewer"
        disabled={depth <= 1}
        onClick={() => onView({ ...view, depth: depth - 1 })}
      >
        <MinusIcon />
      </Button>
      <span className="w-4 text-center font-medium text-stone-800 tabular-nums">{depth}</span>
      <Button
        variant="outline"
        size="icon-xs"
        aria-label="One generation more"
        disabled={depth >= most}
        onClick={() => onView({ ...view, depth: depth + 1 })}
      >
        <PlusIcon />
      </Button>
    </span>
  );
}
