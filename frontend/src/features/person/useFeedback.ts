import { toast } from "sonner";
import { useLink } from "@/api/queries";
import type { Notice, Suggestion } from "@/api/types";
import { type Done, showDone, showError } from "@/lib/notify";

type Said = { notices: Notice[]; suggestions?: Suggestion[] };

/** What was done, in one note with what the server noticed about it, and "Are they married?"
 *  answered in one click. `said` is what the change answered, or each of its parts'. */
export function useFeedback() {
  const link = useLink();
  const marry = (suggestion: Suggestion) =>
    link.mutate(
      {
        person_a: suggestion.person_a,
        person_b: suggestion.person_b,
        a_is: "spouse",
        kind: "biological",
        status: "married",
      },
      { onSuccess: () => toast.success("Marriage recorded."), onError: showError },
    );
  return (
    done: string,
    said: Said | Said[],
    more: Pick<Done, "action" | "duration" | "warnings"> = {},
  ) => {
    const answers = Array.isArray(said) ? said : [said];
    showDone(done, {
      ...more,
      notices: answers.flatMap((answer) => answer.notices),
      suggestions: answers.flatMap((answer) => answer.suggestions ?? []),
      marry,
    });
  };
}
