import { ChevronDownIcon, UserRoundIcon } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import {
  TREE_DEFAULTS,
  useMe,
  usePerson,
  useSaveTreeSettings,
  useSetMe,
  useTreeSettings,
} from "@/api/queries";
import type { TreeSettings } from "@/api/types";
import { Hint } from "@/components/Hint";
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

/**
 * "Me" in the top bar, Me's one place. Until you've chosen who you are,
 * it asks; then it shows your name, and its menu opens your panel, asks how someone is related
 * to you, colours the tree by how close everyone is to you, chooses again, and forgets who you
 * are. Someone chosen who is in the Trash now is said, with the same two last.
 */
export function MeButton() {
  const me = useMe().data?.person ?? null;
  const person = usePerson(me);
  const setMe = useSetMe();
  const [choosing, setChoosing] = useState(false);
  const navigate = useNavigate();
  const params = new URLSearchParams(useLocation().search);
  const settings = useTreeSettings();
  const save = useSaveTreeSettings();
  const current: TreeSettings = settings.data ?? TREE_DEFAULTS;

  const forget = () =>
    setMe.mutate(null, {
      onSuccess: () => toast.success("Forgotten. Nothing says “your” now."),
      onError: showError,
    });
  const again = (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => setChoosing(true)}>I'm someone else…</DropdownMenuItem>
      <DropdownMenuItem disabled={setMe.isPending} onSelect={forget}>
        Forget who I am
      </DropdownMenuItem>
    </>
  );

  if (me && person.isError) {
    // The person chosen isn't in the tree any more: "Me" is off until they're back.
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Me: not in the tree any more">
              <UserRoundIcon />
              Me
              <ChevronDownIcon className="max-md:hidden" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal text-warning">
              The person you chose isn't in the tree any more, perhaps in the Trash. "Me" is off
              until they're back or you choose again.
            </DropdownMenuLabel>
            {again}
          </DropdownMenuContent>
        </DropdownMenu>
        <MeDialog open={choosing} onOpenChange={setChoosing} />
      </>
    );
  }

  if (!me || !person.data) {
    return (
      <>
        <Hint label={"Choose which person you are: panels then say what everyone is to you"}>
          <Button variant="ghost" size="sm" onClick={() => setChoosing(true)}>
            <UserRoundIcon />
            Me
          </Button>
        </Hint>
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
            // Below 1024 pixels, no wider than leaves the family's name its first letters beside
            // In step, at 800 too: a longer name is shortened, whole in its own name.
            className="max-w-36 max-lg:max-w-28"
            aria-label={`Me: ${you.full_name}`}
          >
            <PersonAvatar person={you} size="sm" className="size-5 text-xs" />
            {/* On a phone, the photo circle alone. */}
            <span className="truncate max-md:hidden">{shortName(you)}</span>
            <ChevronDownIcon className="max-md:hidden" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal text-faint">
            You're <span className="font-medium text-foreground">{you.full_name}</span>
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
          {again}
        </DropdownMenuContent>
      </DropdownMenu>
      <MeDialog open={choosing} onOpenChange={setChoosing} />
    </>
  );
}
