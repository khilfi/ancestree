import { CheckIcon, ChevronDownIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import {
  type DesktopFamily,
  useAddFamily,
  useAddFamilyFromBackup,
  useFamilies,
  useOpenFamily,
} from "@/api/desktop";
import { ApiError } from "@/api/errors";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ago } from "@/lib/ago";
import { showError } from "@/lib/notify";

const PLACES: Record<DesktopFamily["role"], string> = {
  keeper: "You keep its family folder",
  member: "From its keeper's family folder",
  "": "On this computer only",
};

/** A family's place in its family folder, and when it was last in step with it. */
export function familyPlace(family: DesktopFamily): string {
  const place = PLACES[family.role] ?? PLACES[""];
  return family.role && family.in_step ? `${place} · in step ${ago(family.in_step)}` : place;
}

/** While AncesTree starts again on another family: the shell shows its loading page soon. */
export function Opening({ name }: { name: string }) {
  return (
    <div
      role="status"
      className="fixed inset-0 z-50 grid place-items-center bg-stone-50/90 text-stone-700 backdrop-blur-sm"
    >
      <p className="text-lg">Opening {name}…</p>
    </div>
  );
}

/** Open another family (0.4.0): the open one keeps in step a last time, then AncesTree starts
 *  again on the other's folders. */
export function useOpenAnother() {
  const open = useOpenFamily();
  const [opening, setOpening] = useState<string | null>(null);
  const choose = (family: { id: string; name: string }) => {
    setOpening(family.name);
    open.mutate(family.id, {
      onError: (error) => {
        setOpening(null);
        showError(error);
      },
    });
  };
  return { choose, opening };
}

/** A new family on this computer, empty or from a backup, then opened (0.4.0). */
export function AddFamilyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const add = useAddFamily();
  const fromBackup = useAddFamilyFromBackup();
  const another = useOpenAnother();
  const [name, setName] = useState("");
  // A backup locked with a password, waiting for it (0.4.0).
  const [locked, setLocked] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const busy = add.isPending || fromBackup.isPending;
  const addFrom = (file: File, password?: string) =>
    fromBackup.mutate(
      { file, password },
      {
        onSuccess: (listed) => {
          setLocked(null);
          setPassword("");
          opened(listed);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "locked_backup") setLocked(file);
          else showError(error);
        },
      },
    );
  const opened = (listed: { added?: string; families: DesktopFamily[] } | null) => {
    const family = listed?.families.find((found) => found.id === listed.added);
    if (family) another.choose(family);
  };
  return (
    <>
      <AlertDialog open={open} onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add a family</AlertDialogTitle>
            <AlertDialogDescription>
              Each family is kept apart, with its own database, photos, backups and family folder:
              nothing of one ever shows in another. Switch between them from the family's name at
              the top.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              add.mutate(name, { onError: showError, onSuccess: opened });
            }}
          >
            <Label htmlFor="family-name">Its name, as this computer shows it</Label>
            <Input
              id="family-name"
              placeholder="e.g. Mother's side"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              required
            />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="submit" disabled={busy || !name.trim()}>
                {add.isPending ? "Adding…" : "Add and open it"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
              >
                {fromBackup.isPending ? "Reading it…" : "Add one from a backup…"}
              </Button>
            </div>
          </form>
          <input
            ref={input}
            type="file"
            accept=".zip,.locked,application/zip"
            className="hidden"
            aria-label="A backup to add as a family"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) addFrom(file);
            }}
          />
          {locked && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                addFrom(locked, password);
              }}
            >
              <Label htmlFor="backup-password">
                That backup is locked: the password it was locked with
              </Label>
              <div className="flex gap-2">
                <Input
                  id="backup-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="off"
                  autoFocus
                />
                <Button type="submit" disabled={!password || busy}>
                  Open it
                </Button>
              </div>
            </form>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {another.opening && <Opening name={another.opening} />}
    </>
  );
}

/**
 * The family's name at the top, in the desktop app (0.4.0, D44): the families on this computer,
 * each kept apart, to open one; Add a family; and Settings → Families. Nothing in a browser or
 * a copy, which hold one family.
 */
export function FamilyMenu() {
  const families = useFamilies().data;
  const another = useOpenAnother();
  const [adding, setAdding] = useState(false);
  if (!families) return null;
  const current = families.families.find((family) => family.open);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            // The last to give way: its name shortened, where the top bar is short of room.
            className="max-w-48 min-w-0 shrink gap-1 px-2 text-stone-700"
            data-family-menu
            aria-label={`Family: ${current?.name ?? ""}. Families on this computer`}
            title="Families on this computer"
          >
            <span className="truncate">{current?.name}</span>
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel>Families on this computer</DropdownMenuLabel>
          {families.families.map((family) => (
            <DropdownMenuItem
              key={family.id}
              disabled={family.open}
              onSelect={() => another.choose(family)}
              className="items-start"
            >
              {family.open ? (
                <CheckIcon className="mt-0.5" />
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <span className="min-w-0">
                <span className="block truncate">{family.name}</span>
                <span className="block text-xs text-stone-500">{familyPlace(family)}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {!families.single && (
            <DropdownMenuItem onSelect={() => setAdding(true)}>
              <PlusIcon />
              Add a family…
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link to="/settings/families">
              <SettingsIcon />
              Manage families…
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddFamilyDialog open={adding} onClose={() => setAdding(false)} />
      {another.opening && <Opening name={another.opening} />}
    </>
  );
}
