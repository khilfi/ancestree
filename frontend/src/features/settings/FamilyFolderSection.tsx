import { useState } from "react";
import { toast } from "sonner";
import {
  sendsToTheKeeper,
  useAdmit,
  useAnswersSeen,
  useFamilyFolder,
  useInvite,
  useJoinFamily,
  useLeaveFamilyFolder,
  useNewRecoveryCode,
  useRecoverFamily,
  useRecoverySeen,
  useRefuse,
  useRemoveComputer,
  useSharedFolders,
  useSignInToGoogle,
  useSignOutOfGoogle,
  useStartFamily,
  useSyncNow,
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
import { showError } from "@/lib/notify";
import { FolderReview } from "./FolderReview";

const ROLES = {
  trusted: "Trusted: their changes come in unless they clash with yours or take something out",
  contributor: "Contributor: you look at each of their changes first",
  viewer: "Viewer: they receive the family, and change nothing",
} as const;

const ROLE_NAMES: Record<string, string> = {
  keeper: "Keeper",
  trusted: "Trusted",
  contributor: "Contributor",
  viewer: "Viewer",
  removed: "Removed",
  waiting: "Waiting to be let in",
};

/** "just now", "3 minutes ago", "2 hours ago", or the day. */
function ago(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} minute${seconds < 90 ? "" : "s"} ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} hour${seconds < 5400 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

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
      Signed in to Google as {status.email}.{" "}
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

function Join() {
  const shared = useSharedFolders(true);
  const join = useJoinFamily();
  const [computer, setComputer] = useState("");
  const folders = shared.data ?? [];
  return (
    <Panel title="Join your family's AncesTree">
      {shared.isLoading ? (
        <p className="text-sm text-stone-500">Looking for family folders shared with you…</p>
      ) : folders.length === 0 ? (
        <p className="max-w-2xl text-sm text-stone-600">
          No family folder is shared with this Google account yet. Ask your family's keeper to
          invite it, then{" "}
          <button
            type="button"
            className="text-sky-700 hover:underline"
            onClick={() => void shared.refetch()}
          >
            look again
          </button>
          .
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const folder = folders[0];
            if (!folder) return;
            join.mutate({ folder: folder.id, computer }, { onError: showError });
          }}
        >
          <p className="max-w-2xl text-sm text-stone-600">
            Shared by <strong>{folders[0]?.owner}</strong>, the family's keeper. Asking to join puts
            a small folder in your own Google Drive, shared with them, for what this computer sends
            them.
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
      )}
    </Panel>
  );
}

function Start() {
  const start = useStartFamily();
  const [family, setFamily] = useState("");
  const [computer, setComputer] = useState("");
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
          start.mutate({ family, computer }, { onError: showError });
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

function Invite() {
  const invite = useInvite();
  const [email, setEmail] = useState("");
  return (
    <form
      className="flex max-w-xl flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        invite.mutate(email, {
          onError: showError,
          onSuccess: () => {
            toast.success(
              `The family folder is shared with ${email}. Google doesn't tell them, so let them know: they install AncesTree, sign in with that account, and choose Ask to join.`,
            );
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

function Keeper({ status }: { status: FamilyFolderStatus }) {
  const asking = status.asking ?? [];
  const changes = status.changes ?? [];
  return (
    <div className="space-y-5">
      <p className="text-sm">
        You keep <strong>{status.family}</strong>. What you change reaches every computer below
        within a few minutes, while it's on.
      </p>
      <InStep status={status} />
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
      {status.may_leave && <Leave keeper={false} />}
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
  } else if (!status.available) {
    body = (
      <p className="text-sm text-stone-600">
        This AncesTree was built without its Google client, so it can't keep a family folder.
      </p>
    );
  } else if (status.broken || status.replaced) {
    body = <Stuck status={status} />;
  } else if (!status.email && !status.setup) {
    body = <SignIn status={status} />;
  } else if (!status.email) {
    body = (
      <div className="space-y-4">
        <InStep status={status} />
        <SignIn status={status} />
      </div>
    );
  } else if (!status.setup) {
    body = (
      <div className="space-y-4">
        <Join />
        <Start />
        <ComeBack />
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
          folder in the keeper's Google Drive. Everything in it is encrypted on each computer:
          Google keeps the files, but can't read them.
        </p>
      </div>
      {body}
      {status?.recovery_code && <RecoverySheet code={status.recovery_code} />}
    </section>
  );
}
