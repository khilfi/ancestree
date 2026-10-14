import { ChevronDownIcon, ChevronRightIcon, type LucideIcon } from "lucide-react";
import type { SVGProps } from "react";
import { useFormContext } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { PlaceFields } from "./PlaceFields";
import type { PersonFormValues } from "./personSchema";
import { placeLine } from "./places";

export type PlaceKey = "residence" | "birth_place" | "death_place";
export type FormPlace = PersonFormValues["residence"];
/** Another place to fill this one in from, in one click: "Same as where they were born". */
export type Copy = { label: string; place: FormPlace };

/** A headstone: the sign for where someone died and rests. Lucide has none. */
export function StoneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6 21V10a6 6 0 0 1 12 0v11" />
      <path d="M3 21h18" />
      <path d="M10 12h4" />
      <path d="M12 9v6" />
    </svg>
  );
}

/**
 * One of someone's places in their form: titled clearly,
 * with its sign, and folded to one line, "Lot 6259-C … Klang, Selangor · pinned by hand", until
 * it's opened; one is open at a time. Open, it can be filled in from another place in one
 * click, then holds the address, its suggestions and where it is.
 */
export function PlaceBlock({
  name,
  title,
  sign: Sign,
  open,
  onOpen,
  copies,
}: {
  name: PlaceKey;
  title: string;
  sign: LucideIcon | typeof StoneIcon;
  open: boolean;
  onOpen: () => void;
  copies: Copy[];
}) {
  const { watch, setValue } = useFormContext<PersonFormValues>();
  const line = placeLine(watch(name));
  const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="rounded-lg border border-stone-200">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${name}-place`}
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-stone-50"
      >
        <Sign className="size-4 shrink-0 text-stone-500" />
        <span className="shrink-0 text-sm font-medium text-stone-800">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-stone-500">
          {line || "Not filled in"}
        </span>
        <Chevron className="size-4 shrink-0 text-stone-400" />
      </button>
      {open && (
        <div id={`${name}-place`} className="space-y-2 border-t border-stone-200 p-3">
          {copies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {copies.map((copy) => (
                <Button
                  key={copy.label}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setValue(name, { ...copy.place }, { shouldDirty: true })}
                >
                  {copy.label}
                </Button>
              ))}
            </div>
          )}
          <PlaceFields name={name} label={title} />
        </div>
      )}
    </div>
  );
}
