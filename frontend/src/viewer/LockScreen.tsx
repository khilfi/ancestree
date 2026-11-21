import { LockIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A copy locked with a password: nothing of the family shows until it's given. */
export function LockScreen({ onOpen }: { onOpen: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [opening, setOpening] = useState(false);

  async function open(event: FormEvent) {
    event.preventDefault();
    setOpening(true);
    setProblem("");
    try {
      await onOpen(password);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The copy couldn't be opened.");
      setOpening(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <form
        onSubmit={open}
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <LockIcon className="size-4 text-faint" aria-hidden />
            AncesTree
          </h1>
          <p className="text-sm text-muted-foreground">
            This copy of a family tree is locked. Ask whoever gave it to you for its password.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="copy-password">Password</Label>
          <Input
            id="copy-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={!password || opening}>
          {opening ? "Opening…" : "Open"}
        </Button>
      </form>
    </div>
  );
}
