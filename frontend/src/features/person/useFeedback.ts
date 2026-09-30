import { toast } from "sonner";
import { useLink } from "@/api/queries";
import type { Notice, Suggestion } from "@/api/types";
import { showError, showNotices, showSuggestions } from "@/lib/notify";

/** Show what the server noticed about a change, and answer "Are they married?" in one click. */
export function useFeedback() {
  const link = useLink();
  return ({ notices, suggestions = [] }: { notices: Notice[]; suggestions?: Suggestion[] }) => {
    showNotices(notices);
    showSuggestions(suggestions, (suggestion) =>
      link.mutate(
        {
          person_a: suggestion.person_a,
          person_b: suggestion.person_b,
          a_is: "spouse",
          kind: "biological",
          status: "married",
        },
        { onSuccess: () => toast.success("Marriage recorded."), onError: showError },
      ),
    );
  };
}
