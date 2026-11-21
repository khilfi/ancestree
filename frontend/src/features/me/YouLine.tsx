import { UserRoundIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useKinship, useKinshipLanguage } from "@/api/queries";
import { Hint } from "@/components/Hint";
import { withView } from "@/features/tree/filters";
import { useMeId } from "./useMeId";

/**
 * Under a person's name, what they are to you: "Your pak long", in the chosen
 * kinship language. Nothing until you've chosen who you are. A click shows how, in the
 * relationship finder.
 */
export function YouLine({ personId }: { personId: string }) {
  const me = useMeId();
  const other = me && me !== personId ? personId : null;
  const answer = useKinship(other ? me : null, other);
  const language = useKinshipLanguage();
  const navigate = useNavigate();
  const params = new URLSearchParams(useLocation().search);

  if (!me) return null;
  if (me === personId) {
    return (
      <p className="flex items-center gap-1 text-sm font-medium text-kin-soft-foreground">
        <UserRoundIcon className="size-3.5" />
        This is you
      </p>
    );
  }
  if (answer.isPending) return <p className="text-sm text-faint">…</p>;
  const main = answer.data?.relations[0];
  if (!main) return <p className="text-sm text-faint">Not linked to you yet</p>;
  const said = main.forward.words?.[language];
  const word = said?.term ?? main.forward.term;
  return (
    <Hint label={"How you're related"}>
      <button
        type="button"
        onClick={() => navigate(`/tree?${withView(params, { person: me, relate: personId })}`)}
        className="flex items-center gap-1 text-left text-sm font-medium text-kin-soft-foreground underline-offset-2 hover:underline"
      >
        <UserRoundIcon className="size-3.5 shrink-0" />
        <span>
          Your <span lang={said && !said.english ? language : undefined}>{word}</span>
        </span>
      </button>
    </Hint>
  );
}
