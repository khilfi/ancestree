import type { CSSProperties } from "react";
import { avatarAddress } from "@/api/addresses";
import type { Avatarable } from "@/api/types";
import { initials } from "@/lib/people";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-11 text-sm",
  node: "size-14 text-base",
  lg: "size-24 text-2xl",
} as const;

/** A person's photo circle, or their initials when there's no photo. */
export function PersonAvatar({
  person,
  size = "md",
  className,
  style,
}: {
  person: Avatarable;
  size?: keyof typeof SIZES;
  className?: string;
  style?: CSSProperties;
}) {
  const base = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-white",
    SIZES[size],
    className,
  );
  if (person.placeholder) {
    return (
      <div
        className={cn(base, "border-dashed border-stone-300 text-stone-400")}
        style={style}
        title="Unknown parent"
      >
        ?
      </div>
    );
  }
  if (person.photo_version !== null) {
    const pixels = size === "lg" ? 512 : 128;
    return (
      <img
        src={avatarAddress(person.id, pixels, person.photo_version)}
        alt={person.full_name}
        className={cn(base, "border-stone-300 object-cover")}
        style={style}
        loading="lazy"
        draggable={false}
      />
    );
  }
  return (
    <div
      className={cn(base, "border-stone-300 bg-stone-100 font-semibold text-stone-600")}
      style={style}
      aria-hidden="true"
    >
      {initials(person.full_name)}
    </div>
  );
}
