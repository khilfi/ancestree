import { type CSSProperties, useState } from "react";
import { avatarAddress } from "@/api/addresses";
import type { Avatarable } from "@/api/types";
import { initials } from "@/lib/people";
import { cn } from "@/lib/utils";
import { PICTURE } from "@/styles/drawing";

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-11 text-sm",
  node: "size-14 text-base",
  lg: "size-24 text-2xl",
} as const;

/** Someone's initials as a picture, in the colours of the initials shown where there's no
 *  photo: behind their photo until it has come, so it's never an empty ring. */
export function initialsPicture(fullName: string): string {
  const letters = initials(fullName).replace(/[<>&"']/g, "");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<rect width="40" height="40" fill="${PICTURE.initialsBackground}"/>` +
    `<text x="20" y="20" dominant-baseline="central" text-anchor="middle" ` +
    `font-family="sans-serif" font-size="15" font-weight="600" fill="${PICTURE.initials}">` +
    `${letters}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** A person's photo circle, or their initials when there's no photo, and until it has come. */
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
  // The photo whose picture has come: until then, the initials show behind it.
  const [drawn, setDrawn] = useState<string | null>(null);
  const base = cn(
    "flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-card",
    SIZES[size],
    className,
  );
  if (person.placeholder) {
    return (
      <div
        role="img"
        aria-label="Unknown parent"
        className={cn(base, "border-dashed border-input text-faint")}
        style={style}
      >
        ?
      </div>
    );
  }
  if (person.photo_version !== null) {
    const pixels = size === "lg" ? 512 : 128;
    const address = avatarAddress(person.id, pixels, person.photo_version);
    const waiting = drawn !== address;
    return (
      <img
        src={address}
        alt={person.full_name}
        className={cn(base, "border-input object-cover")}
        style={
          waiting
            ? {
                ...style,
                backgroundImage: initialsPicture(person.full_name),
                backgroundSize: "cover",
              }
            : style
        }
        loading="lazy"
        draggable={false}
        onLoad={() => setDrawn(address)}
      />
    );
  }
  return (
    <div
      className={cn(base, "border-input bg-muted font-semibold text-muted-foreground")}
      style={style}
      aria-hidden="true"
    >
      {initials(person.full_name)}
    </div>
  );
}
