import { useState } from "react";
import { toast } from "sonner";
import { useFillIn, useSearchPeople } from "@/api/queries";
import type { Gender, GraphPerson, RelativeAdded } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFeedback } from "@/features/person/useFeedback";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { useDebounced } from "@/lib/useDebounced";
import { FloatingCard } from "./FloatingCard";
import type { Point } from "./rings";
import { shortName } from "./words";

function listed(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** An unknown parent joins brothers and sisters until the real one is known. */
export function UnknownParentCard({
  id,
  kids,
  at,
  bounds,
  onClose,
}: {
  id: string;
  kids: GraphPerson[];
  at: Point;
  bounds: { width: number; height: number };
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"menu" | "new" | "existing">("menu");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [text, setText] = useState("");
  const results = useSearchPeople(useDebounced(text.trim(), 200));
  const fill = useFillIn(id);
  const feedback = useFeedback();
  const names = listed(kids.map(shortName));

  const done = {
    onSuccess: (added: RelativeAdded) => {
      feedback(added);
      toast.success(`${added.person.full_name} is now the parent of ${names}.`);
      onClose();
    },
    onError: showError,
  };

  return (
    <FloatingCard at={at} bounds={bounds} width={320}>
      <p className="font-medium">An unknown parent of {names}</p>
      {mode === "menu" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setMode("new")}>
            Someone new
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("existing")}>
            Someone in the tree
          </Button>
        </div>
      )}
      {mode === "new" && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) fill.mutate({ person: { full_name: name.trim(), gender } }, done);
          }}
        >
          <Input
            autoFocus
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-2">
            <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
              <SelectTrigger className="flex-1" aria-label="Gender">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={!name.trim() || fill.isPending}>
              Fill in
            </Button>
          </div>
        </form>
      )}
      {mode === "existing" && (
        <Command shouldFilter={false} className="rounded-lg border">
          <CommandInput
            autoFocus
            placeholder="Search by name…"
            value={text}
            onValueChange={setText}
          />
          <CommandList className="max-h-52">
            <CommandEmpty>{results.isFetching ? "Searching…" : "No one found."}</CommandEmpty>
            {(results.data ?? []).map((found) => (
              <CommandItem
                key={found.id}
                value={found.id}
                onSelect={() => fill.mutate({ existing: found.id }, done)}
              >
                <PersonAvatar person={found} size="sm" />
                <span className="min-w-0 flex-1 truncate">{found.full_name}</span>
                <span className="text-xs text-stone-500">{lifeYears(found)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      )}
    </FloatingCard>
  );
}
