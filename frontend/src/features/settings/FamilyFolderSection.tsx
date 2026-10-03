import { useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError } from "@/api/errors";
import {
  sendsToTheKeeper,
  useAdmit,
  useAnswersSeen,
  useFamilyFolder,
  useFamilyProject,
  useInvitation,
  useInvite,
  useJoinFamily,
  useLeaveFamilyFolder,
  useMoveAccount,
  useNewRecoveryCode,
  useOldFolderDeleted,
  useRebuild,
  useRecoverFamily,
  useRecoverySeen,
  useRefuse,
  useRemoveComputer,
  useSignInToGoogle,
  useSignOutOfGoogle,
  useStartFamily,
  useSyncNow,
  useTakeInvitation,
} from "@/api/familyFolder";
import type {
  FamilyFolderStatus,
  FolderAnswer,
  FolderAsking,
  FolderChanges,
  FolderMember,
} from "@/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ago } from "@/lib/ago";
import { showError } from "@/lib/notify";
import { FolderReview } from "./FolderReview";

const ROLES = {
  trusted: "Trusted: their changes come in unless they clash with yours or take something out",
  contributor: "Contributor: you look at each of their changes first",
  viewer: "Viewer: they receive the family, and change nothing",
} as const;

/** AncesTree's guide, and its releases: the same for every family. */
const GUIDE = "https://github.com/khilfi/ancestree/blob/main/GUIDE.md";
const GUIDE_PROJECT = `${GUIDE}#your-familys-google-project`;
const RELEASES = "https://github.com/khilfi/ancestree/releases/latest";

const ROLE_NAMES: Record<string, string> = {
  keeper: "Keeper",
  trusted: "Trusted",
  contributor: "Contributor",
  viewer: "Viewer",
  removed: "Removed",
  waiting: "Waiting to be let in",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

/** Where things stand: when it was last in step, or what's in the way; and Sync now. */
function InStep({ status }: { status: FamilyFolderStatus }) {
  const sync = useSyncNow();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
      {status.problem ? (
        <span className="font-medium text-amber-700">{status.problem}</span>
      ) : status.last_sync ? (
        <span className="text-stone-600">In step · {ago(status.last_sync)}</span>
      ) : (
        <span className="text-stone-500">Not in step yet</span>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => sync.mutate(undefined, { onError: showError })}
        disabled={sync.isPending}
      >
        {sync.isPending ? "Keeping in step…" : "Sync now"}
      </Button>
    </div>
  );
}

function GoogleAccount({ status }: { status: FamilyFolderStatus }) {
  const signOut = useSignOutOfGoogle();
  return (
    <p className="text-xs text-stone-500">
      Signed in to Google as {status.email}, through{" "}
      {status.project_invited ? "your keeper's" : "the family's"} Google project,{" "}
      <span className="font-mono">{status.project}</span>.{" "}
      <button
        type="button"
        className="text-sky-700 hover:underline"
        onClick={() => signOut.mutate(undefined, { onError: showError })}
      >
        Sign out
      </button>
    </p>
  );
}

function SignIn({ status }: { status: FamilyFolderStatus }) {
  const signIn = useSignInToGoogle();
  const waiting = status.signing_in || signIn.isPending;
  return (
    <Panel title="Sign in to Google">
      <p className="max-w-2xl text-sm text-stone-600">
        The family folder is in Google Drive, so AncesTree needs your Google account. Google asks
        whether AncesTree may see your Drive's files and change only the files it makes: tick both.
        AncesTree only ever looks in the family folder. It isn't verified by Google, so Google first
        says "Google hasn't verified this app": choose <strong>Advanced</strong>, then{" "}
        <strong>Go to AncesTree (unsafe)</strong>. Google says so of any app it hasn't checked.
      </p>
      {status.problem && <p className="text-sm font-medium text-amber-700">{status.problem}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => signIn.mutate(undefined, { onError: showError })} disabled={waiting}>
          {waiting ? "Waiting for Google…" : "Sign in with Google"}
        </Button>
        {waiting && signIn.data && (
          <span className="text-xs text-stone-500">
            Finish on Google's page, in your browser. No page?{" "}
            <a
              href={signIn.data}
              target="_blank"
              rel="noreferrer"
              className="text-sky-700 hover:underline"
            >
              Open it
            </a>
          </span>
        )}
      </div>
    </Panel>
  );
}

/** The family's own Google project (0.4.0): the file Google's console gives for its client.
 *  `moving`: the keeper moving the family folder into another project. */
function ChooseClientFile({
  children,
  moving = false,
}: {
  children: React.ReactNode;
  moving?: boolean;
}) {
  const project = useFamilyProject();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outline" onClick={() => input.current?.click()} disabled={project.isPending}>
        {project.isPending ? "Reading it…" : children}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="The client's file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void file.text().then((text) =>
            project.mutate(
              { client: text, moving },
              {
                onError: showError,
                onSuccess: (status) =>
                  toast.success(`The family signs in to Google through ${status.project} now.`),
              },
            ),
          );
        }}
      />
    </>
  );
}

/** A keeper's invitation, pasted on a relative's computer (0.4.0). */
function PasteInvitation({ label }: { label: string }) {
  const take = useTakeInvitation();
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        take.mutate(text, { onError: showError, onSuccess: () => setText("") });
      }}
    >
      <Label htmlFor="invitation">{label}</Label>
      <Textarea
        id="invitation"
        className="max-w-xl font-mono text-xs"
        rows={3}
        placeholder="ATI1-…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        required
      />
      <Button type="submit" disabled={take.isPending || !text.trim()}>
        {take.isPending ? "Reading it…" : "Use this invitation"}
      </Button>
    </form>
  );
}

/** Before the family has a Google project to sign in through (0.4.0): a relative pastes their
 *  keeper's invitation; a keeper gives AncesTree the project's client file. */
function NoProject() {
  return (
    <div className="space-y-4">
      <Panel title="Join your family's AncesTree">
        <p className="max-w-2xl text-sm text-stone-600">
          Your family's keeper sends you an invitation: a line of text that starts with{" "}
          <span className="font-mono">ATI1-</span>. Paste it here, then sign in to Google with the
          account they invited, and ask to join.
        </p>
        <PasteInvitation label="Your keeper's invitation" />
      </Panel>
      <Panel title="Start your family's folder, as its keeper">
        <p className="max-w-2xl text-sm text-stone-600">
          The family folder signs in to Google through a Google Cloud project of your own family's:
          free, and set up once, in about 20 minutes.{" "}
          <a href={GUIDE_PROJECT} target="_blank" rel="noreferrer" className="text-sky-700">
            The guide shows each step
          </a>
          . Then choose the file Google gives you for its client.
        </p>
        <ChooseClientFile>Choose the client's file…</ChooseClientFile>
        <p className="max-w-2xl text-xs text-stone-500">
          The family's keeper on a new computer? Choose the same project's client file, sign in,
          then be the keeper again with your recovery code.
        </p>
      </Panel>
    </div>
  );
}

/** The project's client, or the invitation, changed for another before signing in. */
function OtherProject({ status }: { status: FamilyFolderStatus }) {
  return (
    <details className="rounded-lg border border-stone-200 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">
        {status.project_invited ? "Another invitation?" : "Joining your family instead?"}
      </summary>
      <div className="mt-3 space-y-4">
        <PasteInvitation label="The invitation from your family's keeper" />
        {status.project_invited && (
          <div className="space-y-2">
            <p className="max-w-2xl text-stone-600">
              Starting your own family's folder instead? Choose your own Google project's client
              file.
            </p>
            <ChooseClientFile>Choose the client's file…</ChooseClientFile>
          </div>
        )}
      </div>
    </details>
  );
}

/** A relative's computer with an invitation pasted (0.4.0): it asks to join the family the
 *  invitation names. */
function Join() {
  const join = useJoinFamily();
  const [computer, setComputer] = useState("");
  return (
    <Panel title="Join your family's AncesTree">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          join.mutate({ computer }, { onError: showError });
        }}
      >
        <p className="max-w-2xl text-sm text-stone-600">
          Your keeper's invitation says which family to join. Asking to join puts a small folder in
          your own Google Drive, shared with your keeper, for what this computer sends them.
        </p>
        <div className="max-w-sm space-y-1">
          <Label htmlFor="join-computer">This computer's name, as the family will see it</Label>
          <Input
            id="join-computer"
            placeholder="e.g. Mak Long's laptop"
            value={computer}
            onChange={(event) => setComputer(event.target.value)}
            required
            maxLength={60}
          />
        </div>
        <Button type="submit" disabled={join.isPending || !computer.trim()}>
          {join.isPending ? "Asking…" : "Ask to join"}
        </Button>
      </form>
    </Panel>
  );
}

function Start() {
  const start = useStartFamily();
  const [family, setFamily] = useState("");
  const [computer, setComputer] = useState("");
  // This Google account's Drive holds another family folder already (0.4.0): how many.
  const [others, setOthers] = useState(0);
  const begin = (another: boolean) =>
    start.mutate(
      { family, computer, another },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === "family_folder_exists") {
            const detail = error.detail as { count?: number } | undefined;
            setOthers(detail?.count ?? 1);
          } else {
            showError(error);
          }
        },
      },
    );
  return (
    <Panel title="Start your family's folder, as its keeper">
      <p className="max-w-2xl text-sm text-stone-600">
        Your family, as it is in AncesTree here, goes into a new folder in your Google Drive,
        encrypted. You then invite relatives, and let each of their computers in.
      </p>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          begin(false);
        }}
      >
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="start-family">The family's name</Label>
            <Input
              id="start-family"
              placeholder="e.g. Keluarga Contoh"
              value={family}
              onChange={(event) => setFamily(event.target.value)}
              required
              maxLength={60}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="start-computer">This computer's name</Label>
            <Input
              id="start-computer"
              placeholder="e.g. Home PC"
              value={computer}
              onChange={(event) => setComputer(event.target.value)}
              required
              maxLength={60}
            />
          </div>
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={start.isPending || !family.trim() || !computer.trim()}
        >
          {start.isPending ? "Starting…" : "Start the family folder"}
        </Button>
      </form>
      <AlertDialog open={others > 0} onOpenChange={(open) => !open && setOthers(0)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {others === 1
                ? "Your Google Drive holds a family folder already"
                : `Your Google Drive holds ${others} family folders already`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              If one is this family's, don't start another: be its keeper again, below, with your
              recovery code. If this is another family, such as the other side of yours, start its
              own folder beside it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => begin(true)}>
              Start another family's folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Panel>
  );
}

function ComeBack() {
  const recover = useRecoverFamily();
  const [code, setCode] = useState("");
  return (
    <details className="rounded-lg border border-stone-200 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">
        The family's keeper, on a new computer?
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          recover.mutate({ code }, { onError: showError });
        }}
      >
        <p className="max-w-2xl text-stone-600">
          Sign in with the Google account that started the family folder, and type the recovery code
          from your sheet.
        </p>
        <div className="max-w-md space-y-1">
          <Label htmlFor="recovery-code">Recovery code</Label>
          <Input
            id="recovery-code"
            className="font-mono"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={recover.isPending || !code.trim()}>
          {recover.isPending ? "Coming back…" : "Be the keeper again"}
        </Button>
      </form>
    </details>
  );
}

/** What the keeper sends a relative (0.4.0): a few lines on installing AncesTree, and the
 *  invitation, which holds the family's Google project and says which family it is. */
function invitationMessage(invitation: string): string {
  return [
    "You're invited to our family's AncesTree.",
    `1. Install AncesTree: ${RELEASES}`,
    `   The guide shows each step: ${GUIDE}`,
    "2. In AncesTree, open Settings → Family folder, and paste this invitation:",
    invitation,
    "3. Sign in to Google with the account I invited, and ask to join. Then read me the code it shows.",
  ].join("\n");
}

/** The family's invitation, to copy and send to a relative, or to a computer of your own. */
function InvitationDialog({ to, onClose }: { to: string | null; onClose: () => void }) {
  const invitation = useInvitation(to !== null);
  const message = invitation.data ? invitationMessage(invitation.data.invitation) : "";
  return (
    <AlertDialog open={to !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>The invitation to send</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-stone-600">
              <p>
                {to
                  ? `The family folder is shared with ${to}. Google doesn't tell them, so send them this, by message or email.`
                  : "Send this to a relative you've invited, or paste it on a computer of your own."}{" "}
                It holds the family's Google project, not the family: only the Google accounts you
                invite can open the folder, and you check each computer's code.
              </p>
              {invitation.isError ? (
                <p className="text-amber-700">{(invitation.error as Error).message}</p>
              ) : (
                <Textarea
                  readOnly
                  aria-label="The invitation, with how to use it"
                  className="font-mono text-xs"
                  rows={8}
                  value={message || "…"}
                  onFocus={(event) => event.target.select()}
                />
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <Button
            disabled={!message}
            onClick={() =>
              void navigator.clipboard.writeText(message).then(
                () => toast.success("Copied: paste it into a message or an email."),
                () => toast.error("It couldn't be copied: select the text and copy it."),
              )
            }
          >
            Copy
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Invite() {
  const invite = useInvite();
  const [email, setEmail] = useState("");
  // Whom the invitation is for: "" for any relative, or a computer of the keeper's own.
  const [sending, setSending] = useState<string | null>(null);
  return (
    <>
      <form
        className="flex max-w-xl flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          invite.mutate(email, {
            onError: showError,
            onSuccess: () => {
              setSending(email);
              setEmail("");
            },
          });
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <Label htmlFor="invite-email">Invite a relative, by their Google account</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="name@gmail.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <Button type="submit" variant="outline" disabled={invite.isPending || !email.trim()}>
          Invite
        </Button>
      </form>
      <p className="max-w-xl text-xs text-stone-500">
        A computer of your own joins with your own Google account: no need to invite it.{" "}
        <button
          type="button"
          className="text-sky-700 hover:underline"
          onClick={() => setSending("")}
        >
          Show the invitation
        </button>{" "}
        to paste on it, or to send again.
      </p>
      <InvitationDialog to={sending} onClose={() => setSending(null)} />
    </>
  );
}

function Asking({ ask }: { ask: FolderAsking }) {
  const admit = useAdmit();
  const refuse = useRefuse();
  const [role, setRole] = useState<keyof typeof ROLES>("contributor");
  return (
    <li className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="font-medium">{ask.name}</div>
          <div className="text-xs text-stone-500">
            {ask.email || "Google account not known yet"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-stone-500">Their code</div>
          <div className="font-mono text-lg tracking-wider">{ask.code}</div>
        </div>
      </div>
      <p className="text-xs text-stone-600">
        Let them in only if they read you the same code, by phone or message.
      </p>
      <RadioGroup
        value={role}
        onValueChange={(value) => setRole(value as keyof typeof ROLES)}
        className="gap-1.5"
        aria-label={`${ask.name}'s role`}
      >
        {Object.entries(ROLES).map(([key, text]) => (
          <div key={key} className="flex items-center gap-2">
            <RadioGroupItem value={key} id={`role-${ask.device}-${key}`} />
            <Label htmlFor={`role-${ask.device}-${key}`} className="text-sm font-normal">
              {text}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => admit.mutate({ device: ask.device, role }, { onError: showError })}
          disabled={admit.isPending}
        >
          Let in
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refuse.mutate(ask.device, { onError: showError })}
          disabled={refuse.isPending}
        >
          Not this one
        </Button>
      </div>
    </li>
  );
}

function Members({ members, keeper }: { members: FolderMember[]; keeper: boolean }) {
  const remove = useRemoveComputer();
  const [leaving, setLeaving] = useState<FolderMember | null>(null);
  return (
    <>
      <ul className="divide-y divide-stone-100 text-sm">
        {members.map((member) => (
          <li key={member.device} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className={member.role === "removed" ? "text-stone-400 line-through" : ""}>
                {member.name}
                {member.you && <span className="text-stone-500"> · this computer</span>}
              </div>
              <div className="truncate text-xs text-stone-500">{member.email}</div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-stone-600">{ROLE_NAMES[member.role]}</span>
              {keeper && !member.you && member.role !== "removed" && (
                <Button size="sm" variant="ghost" onClick={() => setLeaving(member)}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <AlertDialog open={leaving !== null} onOpenChange={(open) => !open && setLeaving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {leaving?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It can't read anything the family adds after this: everyone else gets a new family
              key. It keeps what it already has.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => leaving && remove.mutate(leaving.device, { onError: showError })}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RecoverySheet({ code }: { code: string }) {
  const seen = useRecoverySeen();
  return (
    <AlertDialog open>
      <AlertDialogContent className="recovery-sheet">
        <AlertDialogHeader>
          <AlertDialogTitle>Your recovery code</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm text-stone-600">
              <p>
                With this code, and the Google account that started the family folder, you can be
                the family's keeper again on a new computer. Without it, no one can.
              </p>
              <p className="rounded-md bg-stone-100 p-3 text-center font-mono text-lg tracking-wider text-stone-900">
                {code}
              </p>
              <p>
                Print this, or write the code down, and keep it apart from this computer. It won't
                be shown again.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => window.print()}>
            Print
          </Button>
          <AlertDialogAction onClick={() => seen.mutate(undefined, { onError: showError })}>
            I've kept it safe
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A new recovery code, for the keeper who lost theirs, or fears someone saw it (0.3.1). */
function NewRecoveryCode() {
  const make = useNewRecoveryCode();
  const [asking, setAsking] = useState(false);
  return (
    <details className="rounded-lg border border-stone-200 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">Lost your recovery code?</summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-2xl text-stone-600">
          Make a new one, and keep it as you kept the old. Once it's in your Google Drive, the old
          code opens nothing. Make one too if someone else may have seen your code.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAsking(true)}
          disabled={make.isPending}
        >
          {make.isPending ? "Making it…" : "Make a new recovery code"}
        </Button>
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make a new recovery code?</AlertDialogTitle>
            <AlertDialogDescription>
              Your old code stops working. Have a pen and paper, or a printer, ready: the new code
              is shown until you say you've kept it safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => make.mutate(undefined, { onError: showError })}>
              Make it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </details>
  );
}

/** This computer out of its family folder (0.3.1): it keeps the family as it is. */
function Leave({ keeper }: { keeper: boolean }) {
  const leave = useLeaveFamilyFolder();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setAsking(true)}
        disabled={leave.isPending}
      >
        {leave.isPending ? "Leaving…" : "Leave the family folder…"}
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave the family folder?</AlertDialogTitle>
            <AlertDialogDescription>
              {keeper
                ? "This computer stops keeping the family folder. The family stays here, as it is now. To be the family's keeper on this computer again, use your recovery code afterwards."
                : "The family stays here, as it is now, as this computer's own: nothing new arrives, and nothing you change goes to the keeper. Ask your keeper to remove this computer too. You can ask to join again later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => leave.mutate(undefined, { onError: showError })}>
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** When this computer can't take part as it did (0.3.1): its part can't be opened here, or
 *  another computer keeps the family now. What happened, and the way out. */
function Stuck({ status }: { status: FamilyFolderStatus }) {
  return (
    <div className="space-y-4">
      <Panel
        title={
          status.replaced
            ? "Another computer keeps the family now"
            : "This computer's part can't be opened here"
        }
      >
        <p className="max-w-2xl text-sm text-amber-700" role="status">
          {status.problem}
        </p>
        {status.may_leave && <Leave keeper={status.setup === "keeper"} />}
      </Panel>
      {status.email && <GoogleAccount status={status} />}
    </div>
  );
}

/** The keeper's inbox: the changes waiting from relatives' computers, each to review. */
function ChangesWaiting({ changes }: { changes: FolderChanges[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = changes.find((item) => item.device === open) ?? null;
  return (
    <Panel title={`Changes waiting (${changes.length})`}>
      <p className="max-w-2xl text-sm text-stone-600">
        What relatives changed on their computers, for you to look at. Nothing comes in until you
        bring it in; what you don't take goes back to them, with your note.
      </p>
      <ul className="space-y-2">
        {changes.map((item) => (
          <li key={item.device} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>
              <strong>{item.name}</strong>
              {item.email && <span className="text-stone-500"> · {item.email}</span>}
              <span className="text-stone-500">
                {" "}
                · {ROLE_NAMES[item.role] ?? item.role} · sent {ago(item.sent_at)}
              </span>
            </span>
            <Button
              size="sm"
              variant={open === item.device ? "secondary" : "outline"}
              onClick={() => setOpen(open === item.device ? null : item.device)}
            >
              {open === item.device ? "Close" : "Review"}
            </Button>
          </li>
        ))}
      </ul>
      {shown && (
        <FolderReview
          key={`${shown.device}-${shown.proposal}`}
          changes={shown}
          onClose={() => setOpen(null)}
        />
      )}
    </Panel>
  );
}

/** The family folder made again in Drive from this computer (0.4.0): when it's lost, or to
 *  move it. Relatives' computers follow it by themselves. */
function RebuildButton({ label }: { label: string }) {
  const rebuild = useRebuild();
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button onClick={() => setAsking(true)} disabled={rebuild.isPending}>
        {rebuild.isPending ? "Rebuilding…" : label}
      </Button>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild the family folder?</AlertDialogTitle>
            <AlertDialogDescription>
              A new family folder is made in your Google Drive from this computer's copy, every file
              as it was, and shared again with each relative's Google account. Their computers find
              it and carry on by themselves: nobody joins again. If the old folder is still in
              Drive, it goes to Drive's bin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                rebuild.mutate(undefined, {
                  onError: showError,
                  onSuccess: () =>
                    toast.success("The family folder is rebuilt: relatives' computers follow it."),
                })
              }
            >
              Rebuild it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Moving the family folder to another Google account or project (0.4.0). */
function Move({ status }: { status: FamilyFolderStatus }) {
  const move = useMoveAccount();
  if (status.moving) {
    return (
      <Panel title="Moving the family folder">
        <p className="max-w-2xl text-sm text-stone-600">
          Signed in as {status.email}, through <span className="font-mono">{status.project}</span>.
          Rebuild the family folder here: relatives' computers follow it. If the family's Google
          project changed, send relatives the new invitation too, once they're asked for it.
        </p>
        <RebuildButton label="Rebuild it here" />
      </Panel>
    );
  }
  return (
    <details className="rounded-lg border border-stone-200 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">
        Move the family folder to another Google account or project?
      </summary>
      <div className="mt-3 space-y-3">
        <p className="max-w-2xl text-stone-600">
          The family folder is made again from this computer, in the account or project you choose,
          and relatives' computers follow it. The old one goes to Drive's bin.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={move.isPending}
            onClick={() => move.mutate(undefined, { onError: showError })}
          >
            Another Google account…
          </Button>
          <ChooseClientFile moving>Another Google project's client file…</ChooseClientFile>
        </div>
      </div>
    </details>
  );
}

function Keeper({ status }: { status: FamilyFolderStatus }) {
  const asking = status.asking ?? [];
  const changes = status.changes ?? [];
  const deleted = useOldFolderDeleted();
  return (
    <div className="space-y-5">
      <p className="text-sm">
        You keep <strong>{status.family}</strong>. What you change reaches every computer below
        within a few minutes, while it's on.
      </p>
      <InStep status={status} />
      {status.lost && (
        <Panel
          title={
            status.trouble === "foreign"
              ? "The family folder was made through another Google project"
              : "The family folder is gone from Google Drive"
          }
        >
          <p className="max-w-2xl text-sm text-stone-600">
            {status.trouble === "foreign"
              ? "Your family's Google project can read it, not change it. Rebuild it through your project, from this computer, which holds every one of its files: relatives' computers follow it."
              : "If it's in Drive's bin, take it out there. If it's gone for good, rebuild it from this computer, which holds every one of its files."}
          </p>
          <RebuildButton label="Rebuild the family folder" />
        </Panel>
      )}
      {status.old_folder_left && (
        <Panel title="The old family folder is still in Google Drive">
          <p className="max-w-2xl text-sm text-stone-600">
            AncesTree couldn't put it in Drive's bin. Delete it in Google Drive, so relatives'
            computers move to the new one, then say so here.
          </p>
          <Button
            variant="outline"
            disabled={deleted.isPending}
            onClick={() => deleted.mutate(undefined, { onError: showError })}
          >
            I've deleted it
          </Button>
        </Panel>
      )}
      {status.moving && <Move status={status} />}
      {changes.length > 0 && <ChangesWaiting changes={changes} />}
      {asking.length > 0 && (
        <Panel title={`Asking to join (${asking.length})`}>
          <ul className="space-y-3">
            {asking.map((ask) => (
              <Asking key={ask.device} ask={ask} />
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="The family's computers">
        <Members members={status.members ?? []} keeper />
        <Invite />
      </Panel>
      <NewRecoveryCode />
      {!status.moving && <Move status={status} />}
      <GoogleAccount status={status} />
    </div>
  );
}

/** The keeper's answers to what this computer sent: what wasn't taken, and their note. */
function Answers({ answers }: { answers: FolderAnswer[] }) {
  const seen = useAnswersSeen();
  return (
    <Panel title="The keeper's answer">
      {answers.map((answer) => (
        <div key={answer.proposal} className="space-y-1 text-sm">
          {answer.note && <p className="whitespace-pre-line">“{answer.note}”</p>}
          {answer.left_out.length > 0 && (
            <>
              <p className="text-stone-600">Not taken, so no longer shown here:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-stone-600">
                {answer.left_out.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => seen.mutate(undefined, { onError: showError })}
        disabled={seen.isPending}
      >
        Got it
      </Button>
    </Panel>
  );
}

/** On a relative's computer that sends its changes: how many wait for the keeper. */
function Sending({ status }: { status: FamilyFolderStatus }) {
  const pending = status.pending ?? 0;
  return (
    <p className="text-sm text-stone-600" role="status">
      {pending === 0
        ? "Nothing of yours is waiting for the keeper."
        : `Your changes to ${pending === 1 ? "1 person or link" : `${pending} people and links`} wait for the keeper${status.sent_at ? `: sent ${ago(status.sent_at)}` : ""}.`}
    </p>
  );
}

function Relative({ status }: { status: FamilyFolderStatus }) {
  const members = status.members ?? [];
  const keeper = members.find((member) => member.role === "keeper");
  if (status.role === "waiting") {
    return (
      <div className="space-y-4">
        <Panel title="Waiting to be let in">
          <p className="max-w-2xl text-sm text-stone-600">
            Read this code to your family's keeper, by phone or message. Once they let this computer
            in, the family arrives here by itself.
          </p>
          <p className="font-mono text-2xl tracking-wider">{status.code}</p>
        </Panel>
        <InStep status={status} />
        <GoogleAccount status={status} />
        {status.may_leave && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
            <span>Asked the wrong family, or turned away? Leave, then ask again.</span>
            <Leave keeper={false} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-sm">
        {status.role === "removed" ? (
          <>This computer was removed from the family: nothing new reaches it.</>
        ) : (
          <>
            <strong>{status.family || "Your family"}</strong> arrives here from its keeper
            {keeper ? `, ${keeper.name}` : ""}, and is kept in step while AncesTree is on.{" "}
            {sendsToTheKeeper(status)
              ? "What you change here goes to the keeper, who looks at it first. Until then, you see it here."
              : "It can't be changed on this computer."}
          </>
        )}
      </p>
      {sendsToTheKeeper(status) && <Sending status={status} />}
      {(status.answers ?? []).length > 0 && <Answers answers={status.answers ?? []} />}
      <InStep status={status} />
      <Panel title="The family's computers">
        <Members members={members} keeper={false} />
      </Panel>
      <GoogleAccount status={status} />
      <details className="rounded-lg border border-stone-200 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">
          Your keeper sent a new invitation?
        </summary>
        <div className="mt-3 space-y-3">
          <p className="max-w-2xl text-stone-600">
            When your keeper moves the family to another Google project, they send a new invitation.
            Paste it here, then sign in to Google again.
          </p>
          <PasteInvitation label="The new invitation" />
        </div>
      </details>
      {status.may_leave && <Leave keeper={false} />}
    </div>
  );
}

/** A computer in a family folder with no Google project to sign in through (0.4.0): one that
 *  kept its family folder before each family had its own project, or whose project can't be
 *  opened here. The keeper gives the project's client file; a relative pastes the invitation. */
function ProjectNeeded({ status }: { status: FamilyFolderStatus }) {
  const keeper = status.setup === "keeper";
  return (
    <div className="space-y-4">
      <Panel title={keeper ? "Your family's Google project" : "Your keeper's invitation"}>
        <p className="max-w-2xl text-sm text-stone-600">
          {keeper ? (
            <>
              Each family signs in to Google through its own Google project. Choose the file Google
              gives for your project's client, then sign in again: the family folder carries on as
              it was.{" "}
              <a href={GUIDE_PROJECT} target="_blank" rel="noreferrer" className="text-sky-700">
                The guide shows how
              </a>
              .
            </>
          ) : (
            <>
              Each family signs in to Google through its keeper's own Google project. Ask your
              keeper for the family's invitation, paste it here, then sign in again: the family
              carries on as it was.
            </>
          )}
        </p>
        {keeper ? (
          <ChooseClientFile>Choose the client's file…</ChooseClientFile>
        ) : (
          <PasteInvitation label="Your keeper's invitation" />
        )}
      </Panel>
      {status.problem && (
        <p className="text-sm font-medium text-amber-700" role="status">
          {status.problem}
        </p>
      )}
    </div>
  );
}

/** Settings → Family folder: the family on invited relatives' computers, kept in
 *  step through a private folder in the keeper's Google Drive, encrypted on each computer. */
export function FamilyFolderSection() {
  const folder = useFamilyFolder();
  const status = folder.data;
  let body: React.ReactNode;
  if (!status) {
    body = <p className="text-sm text-stone-500">{folder.isError ? "Can't be reached." : "…"}</p>;
  } else if (status.broken || status.replaced) {
    body = <Stuck status={status} />;
  } else if (!status.available) {
    body = status.setup ? <ProjectNeeded status={status} /> : <NoProject />;
  } else if (!status.email && !status.setup) {
    body = (
      <div className="space-y-4">
        <SignIn status={status} />
        <OtherProject status={status} />
      </div>
    );
  } else if (!status.email) {
    body = (
      <div className="space-y-4">
        {status.moving ? (
          <p className="max-w-2xl text-sm font-medium text-stone-700">
            Moving the family folder: sign in with the Google account that's to hold it. Then
            rebuild the family folder there.
          </p>
        ) : (
          <InStep status={status} />
        )}
        <SignIn status={status} />
      </div>
    );
  } else if (!status.setup) {
    body = (
      <div className="space-y-4">
        {status.invited ? (
          <Join />
        ) : (
          !status.project_invited && (
            <>
              <Start />
              <ComeBack />
            </>
          )
        )}
        <OtherProject status={status} />
        <GoogleAccount status={status} />
      </div>
    );
  } else {
    body = status.setup === "keeper" ? <Keeper status={status} /> : <Relative status={status} />;
  }
  return (
    <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">Family folder</h2>
        <p className="max-w-2xl text-sm text-stone-500">
          Your family's AncesTree on invited relatives' computers, kept in step through a private
          folder in the keeper's Google Drive, reached through the family's own Google project.
          Everything in it is encrypted on each computer: Google keeps the files, but can't read
          them.
        </p>
      </div>
      {body}
      {status?.recovery_code && <RecoverySheet code={status.recovery_code} />}
    </section>
  );
}
