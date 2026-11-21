import { BookOpenIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { Hint } from "@/components/Hint";
import { openLifeStory } from "@/lib/lifeStory";
import { cn } from "@/lib/utils";

/**
 * The small book mark on the photo of anyone with a life story,
 * on the tree, the timeline and the map: a click opens it. Inside something that's a button
 * already (a timeline's row, a map's photo), it's a mark a click still opens, and their panel
 * has **Life story** for the keyboard.
 */
export function StoryMark({
  person,
  inside = false,
  className,
  style,
}: {
  person: { id: string; full_name: string; has_story?: boolean };
  inside?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  if (!person.has_story) return null;
  const look = cn(
    "nodrag absolute flex size-[18px] items-center justify-center rounded-full bg-story-mark text-story-mark-foreground shadow ring-2 ring-card hover:brightness-90 [&_svg]:size-2.5",
    className,
  );
  const open = (event: { stopPropagation: () => void; preventDefault: () => void }) => {
    event.stopPropagation();
    event.preventDefault();
    openLifeStory(person.id);
  };
  if (inside) {
    return (
      <Hint label="Life story">
        <span aria-hidden className={look} style={style} onClick={open}>
          <BookOpenIcon />
        </span>
      </Hint>
    );
  }
  return (
    <Hint label="Life story">
      <button
        type="button"
        className={look}
        style={style}
        aria-label={`${person.full_name}'s life story`}
        onClick={open}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <BookOpenIcon />
      </button>
    </Hint>
  );
}
