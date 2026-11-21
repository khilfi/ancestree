import { useDesktopUpdate } from "@/api/desktop";
import { inWords } from "@/api/errors";
import { Button } from "@/components/ui/button";

/** What to do when the app can't reach its server. The desktop app's pages come from its own
 *  engine, so there it means opening the app again; in a browser, starting the server. */
export function StartAdvice() {
  const desktop = useDesktopUpdate().data;
  return desktop ? (
    <>Quit AncesTree from its icon by the clock, then open it again.</>
  ) : (
    <>
      Is the backend running? Start it with <code>scripts\dev.ps1</code>.
    </>
  );
}

/** A view that couldn't load the family: what went wrong in words, "AncesTree's
 *  engine isn't answering.", what to do, and **Try again**. */
export function CouldNotLoad({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <>
      <p className="font-medium text-foreground">Could not load {what}.</p>
      <p className="text-sm">
        {inWords(error)} <StartAdvice />
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </>
  );
}
