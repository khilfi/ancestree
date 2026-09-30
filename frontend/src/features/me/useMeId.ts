import { useMe, usePerson } from "@/api/queries";

/** Who you are, for "Me": null until you've chosen, or while the person you chose is in
 *  the Trash. */
export function useMeId(): string | null {
  const me = useMe().data?.person ?? null;
  const person = usePerson(me);
  return me && !person.isError ? me : null;
}
