import { useEffect } from "react";
import { usePerson } from "@/api/queries";
import { answeredSamePerson, hostSamePerson, useSamePersonAsked } from "@/lib/samePerson";
import { MergeDialog } from "./MergeDialog";

/** Where Same person as… opens when it's asked from a warning or What's missing: once
 *  in the app, where the family can be changed. */
export function SamePersonHost() {
  const asked = useSamePersonAsked();
  const person = usePerson(asked?.person ?? null);
  useEffect(hostSamePerson, []);
  if (!asked || !person.data) return null;
  return (
    <MergeDialog
      key={`${asked.person}>${asked.other}`}
      person={person.data}
      other={asked.other}
      open
      onOpenChange={(open) => {
        if (!open) answeredSamePerson();
      }}
    />
  );
}
