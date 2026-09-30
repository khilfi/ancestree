import { ChevronDownIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { usePerson, useSaveTreeSettings, useTreeSettings } from "@/api/queries";
import type { TreeSettings } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { withView } from "@/features/tree/filters";
import { shortName } from "@/features/tree/words";
import { showError } from "@/lib/notify";
import { MeDialog } from "./MeDialog";
import { useMeId } from "./useMeId";

/**
 * "Me" in the top bar. Until you've chosen who you are, it asks; then it shows
 * your name, and its menu opens your panel, asks how someone is related to you, and colours
 * the tree by how close everyone is to you.
 */
export function MeButton() {
  const me = useMeId();
  const person = usePerson(me);
  const [choosing, setChoosing] = useState(false);
  const navigate = useNavigate();
  const params = new URLSearchParams(useLocation().search);
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  const current: TreeSettings = settings.data ?? { centre: null, colours: "branch" };

  if (!me || !person.data) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setChoosing(true)}
          title="Choose which person you are: panels then say what everyone is to you"
        >
          <UserRoundIcon />
          Me
        </Button>
        <MeDialog open={choosing} onOpenChange={setChoosing} />
      </>
    );
  }

  const you = person.data;
  const go = (next: Record<string, string>) => navigate(`/tree?${withView(params, next)}`);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-36"
            aria-label={`Me: ${you.full_name}`}
          >
            <PersonAvatar person={you} size="sm" className="size-5 text-[9px]" />
            {/* On a phone, the photo circle alone. */}
            <span className="truncate max-md:hidden">{shortName(you)}</span>
            <ChevronDownIcon className="max-md:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal text-stone-500">
            You're <span className="font-medium text-stone-900">{you.full_name}</span>
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => go({ person: me, focus: "1" })}>
            Open my panel
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go({ person: me, relate: "pick" })}>
            How is someone related to me?
          </DropdownMenuItem>
          <DropdownMenuCheckboxItem
            checked={current.colours === "closeness"}
            onCheckedChange={(on) =>
              save.mutate(
                { ...current, colours: on ? "closeness" : "branch" },
                { onError: showError },
              )
            }
          >
            Colour by closeness to me
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChoosing(true)}>I'm someone else…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MeDialog open={choosing} onOpenChange={setChoosing} />
    </>
  );
}
