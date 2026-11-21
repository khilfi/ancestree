import { canTryAgain, inWords } from "@/api/errors";
import { Button } from "@/components/ui/button";

/**
 * What couldn't be read, said in words where it would have been: "AncesTree's
 * engine isn't answering." and **Try again**, never "Failed to fetch" or a code. Try again
 * shows only where trying again may work: not for someone who isn't in the tree.
 */
export function Failed({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry: () => void;
  /** The words' own look, as the place they stand in has it. */
  className?: string;
}) {
  return (
    <div role="alert" className="space-y-2">
      <p className={className}>{inWords(error)}</p>
      {canTryAgain(error) && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
