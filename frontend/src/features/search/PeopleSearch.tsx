import { SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useSearchPeople } from "@/api/queries";
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
      <Button
        variant="outline"
        size="sm"
        // It gives way first when the top bar is short of room; on a phone, the icon alone.
        className="w-56 min-w-28 shrink justify-start text-stone-500 max-md:w-auto max-md:min-w-0"
        aria-label="Search people"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="truncate max-md:hidden">Search people…</span>
        <kbd className="ml-auto rounded border border-stone-200 px-1 text-[10px] text-stone-400 max-md:hidden pointer-coarse:hidden">
          Ctrl K
        </kbd>
      </Button>
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
                  {person.nickname && <span className="text-stone-500"> “{person.nickname}”</span>}
                </span>
                <span className="text-xs text-stone-500">{lifeYears(person)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
