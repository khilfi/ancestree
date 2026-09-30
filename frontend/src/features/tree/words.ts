import type { Gender, GraphPerson, KindView } from "@/api/types";

/** "Hassan" for Hassan bin Ismail; a nickname wins when there is one. */
export function shortName(person: Pick<GraphPerson, "full_name" | "nickname">): string {
  if (person.nickname) return person.nickname;
  const words = person.full_name.split(/\s+/);
  const end = words.findIndex((word, index) => index > 0 && /^(bin|binti|bte|bt)$/i.test(word));
  return (end === -1 ? words : words.slice(0, end)).join(" ");
}

/** "father", "adoptive mother", "ward": what a kind calls one side, by gender. */
export function kindWord(
  kind: KindView | undefined,
  side: "parent" | "child",
  gender: Gender,
): string {
  const label = side === "parent" ? kind?.parent_label : kind?.child_label;
  if (!label) return side;
  const gendered = gender === "male" ? label.male : gender === "female" ? label.female : null;
  return gendered || label.neutral;
}

export function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
