import { CLOSENESS_COLOURS } from "@/lib/closeness";

function Swatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden="true"
        className="inline-block size-3 rounded-full border-2 bg-white"
        style={{ borderColor: colour }}
      />
      {label}
    </span>
  );
}

/** What the colours say when the tree is coloured by closeness to you. */
export function ClosenessKey({ chosen }: { chosen: boolean }) {
  if (!chosen) {
    return (
      <p className="text-[11px] text-stone-600">
        Choose who you are (the <span className="font-medium">Me</span> button) to colour everyone
        by how close they are to you.
      </p>
    );
  }
  const { you, degrees, linked } = CLOSENESS_COLOURS;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-stone-600"
      title="Degrees of kinship: a parent or child 1; a brother, sister or grandparent 2; an uncle, aunt, nephew or niece 3; a first cousin 4"
    >
      <Swatch colour={you} label="You" />
      {degrees.map((colour, index) => (
        <Swatch
          key={colour}
          colour={colour}
          label={index === degrees.length - 1 ? `${index + 1}+` : String(index + 1)}
        />
      ))}
      <span className="text-stone-400">degrees by blood ·</span>
      <Swatch colour={linked} label="by marriage or adoption" />
    </div>
  );
}
