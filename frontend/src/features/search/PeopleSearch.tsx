import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useSearchPeople } from "@/api/queries";
import { Hint } from "@/components/Hint";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { withView } from "@/features/tree/filters";
import { lifeYears } from "@/lib/people";
import { useDebounced } from "@/lib/useDebounced";

/** Find someone by name or nickname and fly to them in the tree. Ctrl+K opens it. */
export function PeopleSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const results = useSearchPeople(useDebounced(text.trim(), 150));
  const navigate = useNavigate();
  // While finding a relationship, whoever is found is the second person. On the
  // timeline, search stays on the timeline.
  const [params] = useSearchParams();
  const path = useLocation().pathname;
  const relatingFrom = path === "/tree" && params.has("relate") ? params.get("person") : null;
  // The tree's layout and filter stay as they are.
  const go = (id: string) => {
    if (relatingFrom && id !== relatingFrom) {
      navigate(`/tree?${withView(params, { person: relatingFrom, relate: id })}`);
    } else if (path === "/timeline") {
      navigate(`/timeline?${withView(params, { person: id, focus: "1" })}`);
    } else navigate(`/tree?${withView(params, { person: id, focus: "1" })}`);
  };
  // Results arrive after typing, so point at the first one ourselves: Enter then picks it.
  const [highlighted, setHighlighted] = useState("");
  useEffect(() => setHighlighted(results.data?.[0]?.id ?? ""), [results.data]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Hint label="Search people (Ctrl+K)">
        <Button
          variant="outline"
          size="sm"
          // Its words whole from 1024 pixels across, never cut short: the family's name
          // gives way first. Narrower, the icon alone, with its hint.
          className="shrink-0 justify-start text-faint lg:w-48 xl:w-56"
          aria-label="Search people"
          onClick={() => setOpen(true)}
        >
          <SearchIcon />
          <span className="max-lg:hidden">Search people…</span>
          <kbd className="ml-auto rounded border border-border px-1 text-xs text-faint max-xl:hidden pointer-coarse:hidden">
            Ctrl K
          </kbd>
        </Button>
      </Hint>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search people"
        description="Find someone by name or nickname"
      >
        <Command shouldFilter={false} value={highlighted} onValueChange={setHighlighted}>
          <CommandInput placeholder="Name or nickname…" value={text} onValueChange={setText} />
          <CommandList>
            <CommandEmpty>{results.isFetching ? "Searching…" : "No one found."}</CommandEmpty>
            {(results.data ?? []).map((person) => (
              <CommandItem
                key={person.id}
                value={person.id}
                onSelect={() => {
                  setOpen(false);
                  setText("");
                  go(person.id);
                }}
              >
                <PersonAvatar person={person} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {person.full_name}
                  {person.nickname && <span className="text-faint"> “{person.nickname}”</span>}
                </span>
                <span className="text-xs text-faint">{lifeYears(person)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
