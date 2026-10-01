import { useState } from "react";
import { usePersonJournal } from "@/api/queries";
import type { JournalEntry } from "@/api/types";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "2 Oct 2026 · Changes from Mak Long's laptop · from Mak Long's laptop, brought in on Home PC" */
function said(line: JournalEntry): string {
  const where = line.from_computer
    ? `sent from ${line.from_computer}${line.from_email ? ` (${line.from_email})` : ""}, brought in on ${line.by || "this computer"}`
    : line.by
      ? `on ${line.by}`
      : "";
  return [day(line.at), line.what, where].filter(Boolean).join(" · ");
}

/**
 * Who changed this person, and when: their last changes, as their journal keeps
 * it. The keeper's computer keeps it, and it arrives with the family on relatives' computers;
 * changes brought in from a relative's computer say which, and whose.
 */
export function WhoChanged({ personId }: { personId: string }) {
  const journal = usePersonJournal(personId);
  const [all, setAll] = useState(false);
  const lines = journal.data ?? [];
  if (lines.length === 0) return null;
  return (
    <section aria-label="Who changed this" className="space-y-1 text-xs text-stone-500">
      <h3 className="font-medium text-stone-600">Who changed this</h3>
      <ul className="space-y-0.5">
        {(all ? lines : lines.slice(0, 1)).map((line) => (
          <li key={`${line.at}-${line.what}-${line.by}`}>{said(line)}</li>
        ))}
      </ul>
      {lines.length > 1 && (
        <button
          type="button"
          className="text-sky-700 hover:underline"
          onClick={() => setAll((now) => !now)}
        >
          {all ? "Only the last" : `All ${lines.length} changes`}
        </button>
      )}
    </section>
  );
}
