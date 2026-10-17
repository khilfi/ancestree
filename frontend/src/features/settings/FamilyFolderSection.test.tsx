// @vitest-environment jsdom
/**
 * Settings → Family folder, with the app's answers made up here: signing in, joining or
 * starting, the keeper letting a computer in, a relative waiting with its code, the recovery
 * sheet, and a relative's computer keeping the family as the keeper sends it. Names and
 * addresses are made up.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyFolderStatus } from "@/api/types";
import { CanEdit } from "@/app/copy";
import { until } from "@/viewer/looking";
import { FamilyFolderSection } from "./FamilyFolderSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _, ...rest } = init ?? {};
      super(typeof input === "string" ? new URL(input, window.location.href) : input, rest);
    }
  };
});

const SIGNED_OUT: FamilyFolderStatus = {
  available: true,
  email: null,
  signing_in: false,
  setup: null,
  family: "",
  role: null,
  code: null,
  members: [],
  asking: [],
  last_sync: null,
  received: null,
  problem: "",
  recovery_code: null,
  pending: 0,
  sent_at: null,
  answers: [],
  changes: [],
  broken: false,
  replaced: false,
  may_leave: false,
  project: "keluarga-contoh",
  project_invited: false,
  invited: false,
  syncing: false,
  through: true,
  lost: false,
  moving: false,
  old_folder_left: false,
  trouble: "",
};
const SIGNED_IN = { ...SIGNED_OUT, email: "keeper@example.com" };
const KEEPER: FamilyFolderStatus = {
  ...SIGNED_IN,
  setup: "keeper",
  family: "Keluarga Contoh",
  role: "keeper",
  last_sync: new Date().toISOString(),
  members: [
    {
      device: "d1",
      name: "Home PC",
      role: "keeper",
      email: "keeper@example.com",
      you: true,
      own: false,
      helps: false,
    },
    {
      device: "d2",
      name: "Mak Long's laptop",
      role: "viewer",
      email: "r@example.com",
      you: false,
      own: false,
      helps: false,
    },
  ],
  asking: [{ device: "d3", name: "Pak Ngah's PC", email: "p@example.com", code: "ABCD-EFGH" }],
};
/** Another of the keeper's own computers, allowed to invite and let in for it. */
const HELPING: FamilyFolderStatus = {
  ...SIGNED_IN,
  setup: "member",
  family: "Keluarga Contoh",
  role: "trusted",
  last_sync: new Date().toISOString(),
  members: [
    {
      device: "d1",
      name: "Home PC",
      role: "keeper",
      email: "keeper@example.com",
      you: false,
      own: false,
      helps: false,
    },
    {
      device: "d4",
      name: "Travel laptop",
      role: "trusted",
      email: "keeper@example.com",
      you: true,
      own: false,
      helps: false,
    },
  ],
  asking: KEEPER.asking,
  helping: {
    keeper: "Home PC",
    running: true,
    looked: new Date().toISOString(),
    waiting: [],
    done: [],
  },
};

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];

function answer(
  status: FamilyFolderStatus,
  shared: object[] = [],
  after?: FamilyFolderStatus,
  // What other addresses answer, by their ends: or, given what was sent, what to answer.
  other: Record<string, object | Response | ((body: unknown) => object | Response)> = {},
) {
  asked = [];
  let now = status; // after a change, the app answers with what it became
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    const body =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null;
    asked.push({ method: request.method, path, body });
    if (path === "/api/family-folder/shared") return Response.json(shared);
    const ending = Object.keys(other).find((end) => path.endsWith(end));
    if (ending) {
      const given = other[ending];
      const found = typeof given === "function" ? given(body) : given;
      return found instanceof Response ? found.clone() : Response.json(found);
    }
    if (request.method === "POST" && after) now = after;
    if (path === "/api/family-folder/sign-in") return Response.json({ url: "https://example.org" });
    if (path.startsWith("/api/family-folder")) return Response.json(now);
    return new Response("{}", { status: 404 });
  });
}

/** Until the app has been asked for `path`. */
async function askedFor(path: string) {
  for (let tries = 0; tries < 200; tries++) {
    if (asked.some((ask) => ask.path === path)) return;
    await act(async () => {
      await new Promise((done) => setTimeout(done, 10));
    });
  }
  throw new Error(`never asked for ${path}`);
}

async function show(page: ReactNode, text: string) {
  const router = createMemoryRouter([{ path: "/", element: page }]);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root?.render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  );
  await until(text);
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === name,
  );
  if (!found) throw new Error(`No "${name}" button`);
  return found;
}

afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("Settings → Family folder", () => {
  it("with no Google project yet, takes an invitation or the client's file", async () => {
    const none = { ...SIGNED_OUT, available: false, project: "" };
    answer(none, [], { ...SIGNED_OUT, project_invited: true, invited: true });
    await show(<FamilyFolderSection />, "Your keeper's invitation");
    expect(document.body.textContent).toContain("Start your family's folder, as its keeper");
    expect(button("Choose the client's file…")).toBeDefined();
    const box = document.querySelector<HTMLTextAreaElement>("#invitation");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      set?.call(box, "ATI1-abc-123456");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Use this invitation").click());
    await askedFor("/api/family-folder/invitation");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/invitation",
      body: { invitation: "ATI1-abc-123456", confirm: false },
    });
  });

  it("asks before a signed invitation moves this computer to another project", async () => {
    const relative = {
      ...SIGNED_IN,
      setup: "member",
      role: "contributor",
      family: "Keluarga Contoh",
    };
    const moves = (body: unknown) =>
      (body as { confirm?: boolean }).confirm
        ? relative
        : new Response(
            JSON.stringify({
              detail: {
                code: "project_change",
                message: "Your keeper's invitation moves your family to keluarga-lain.",
                project: "keluarga-lain",
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
    answer(relative as FamilyFolderStatus, [], undefined, {
      "/api/family-folder/invitation": moves,
    });
    await show(<FamilyFolderSection />, "Your keeper sent a new invitation?");
    const box = document.querySelector<HTMLTextAreaElement>("#invitation");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      set?.call(box, "ATI1-new-123456");
      box?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Use this invitation").click());
    await until("Move to the Google project keluarga-lain?");
    act(() => button("Move, and sign in again").click());
    const takes = () => asked.filter((ask) => ask.path === "/api/family-folder/invitation");
    for (let tries = 0; tries < 100 && takes().length < 2; tries++) {
      await act(async () => {
        await new Promise((done) => setTimeout(done, 10));
      });
    }
    expect(takes().map((ask) => ask.body)).toEqual([
      { invitation: "ATI1-new-123456", confirm: false },
      { invitation: "ATI1-new-123456", confirm: true },
    ]);
  });

  it("asks to sign in, saying what Google will ask and warn", async () => {
    answer(SIGNED_OUT, [], { ...SIGNED_OUT, signing_in: true });
    vi.stubGlobal("open", vi.fn());
    await show(<FamilyFolderSection />, "Sign in with Google");
    expect(document.body.textContent).toContain("Google hasn't verified this app");
    act(() => button("Sign in with Google").click());
    await until("Waiting for Google…");
    expect(window.open).toHaveBeenCalledWith("https://example.org", "_blank", "noopener");
  });

  it("offers the keeper, through the family's own project, to start or come back", async () => {
    answer(SIGNED_IN, []);
    await show(<FamilyFolderSection />, "Start your family's folder, as its keeper");
    expect(document.body.textContent).toContain("The family's keeper, on a new computer?");
    expect(document.body.textContent).toContain("Joining your family instead?");
    expect(document.body.textContent).toContain("through the family's Google project");
    expect(document.body.textContent).not.toContain("Ask to join");
  });

  it("asks to join the family the invitation names", async () => {
    answer({ ...SIGNED_IN, project_invited: true, invited: true });
    await show(<FamilyFolderSection />, "Your keeper's invitation says which family to join");
    expect(document.body.textContent).not.toContain("Start your family's folder");
    expect(document.body.textContent).toContain("through your keeper's Google project");
    const input = document.querySelector<HTMLInputElement>("#join-computer");
    expect(input).not.toBeNull();
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "Mak Long's laptop");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Ask to join").click());
    await askedFor("/api/family-folder/join");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/join",
      body: { computer: "Mak Long's laptop" },
    });
  });

  it("starts another family's folder beside one, once asked", async () => {
    const exists = new Response(
      JSON.stringify({
        detail: { code: "family_folder_exists", message: "There's one already.", count: 1 },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
    answer(SIGNED_IN, [], undefined, { "/api/family-folder/start": exists });
    await show(<FamilyFolderSection />, "Start your family's folder, as its keeper");
    for (const [id, text] of [
      ["#start-family", "Keluarga Ibu"],
      ["#start-computer", "Home PC"],
    ] as const) {
      const input = document.querySelector<HTMLInputElement>(id);
      act(() => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        set?.call(input, text);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    act(() => button("Start the family folder").click());
    await until("Your Google Drive holds a family folder already");
    act(() => button("Start another family's folder").click());
    await until("Start your family's folder, as its keeper");
    const starts = () => asked.filter((ask) => ask.path === "/api/family-folder/start");
    for (let tries = 0; tries < 100 && starts().length < 2; tries++) {
      await act(async () => {
        await new Promise((done) => setTimeout(done, 10));
      });
    }
    expect(asked.filter((ask) => ask.path === "/api/family-folder/start")).toEqual([
      expect.objectContaining({
        body: { family: "Keluarga Ibu", computer: "Home PC", another: false },
      }),
      expect.objectContaining({
        body: { family: "Keluarga Ibu", computer: "Home PC", another: true },
      }),
    ]);
  });

  it("gives the keeper the invitation to send, once a relative is invited", async () => {
    const invitation = { invitation: "ATI1-made-up-123456", project: "keluarga-contoh" };
    answer(KEEPER, [], undefined, { "/api/family-folder/invitation": invitation });
    await show(<FamilyFolderSection />, "Invite a relative, by their Google account");
    const input = document.querySelector<HTMLInputElement>("#invite-email");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "mak.long@example.com");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Invite").click());
    await until("The family folder is shared with mak.long@example.com");
    await until("ATI1-made-up-123456");
    const message = document.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
    expect(message).toContain("https://github.com/khilfi/ancestree/releases/latest");
    expect(message).toContain("Settings → You and your family → Family folder");
  });

  it("keeps the invitation's long line inside its window, with Copy in reach", async () => {
    // The window is as wide as it asks to be, not the alert dialog's narrow default, and the
    // invitation's long line wraps anywhere: unwrapped, it widened the box past the window's
    // edge, and Copy went off the screen with it.
    const invitation = { invitation: `ATI1-${"x".repeat(300)}-123456`, project: "keluarga-contoh" };
    answer(KEEPER, [], undefined, { "/api/family-folder/invitation": invitation });
    await show(<FamilyFolderSection />, "Show the invitation");
    act(() => button("Show the invitation").click());
    await until("ATI1-xxx");
    const dialog = document.querySelector("[role=alertdialog]")?.className ?? "";
    expect(dialog).toContain("data-[size=default]:sm:max-w-xl");
    expect(dialog).not.toContain("data-[size=default]:sm:max-w-sm");
    expect(document.querySelector("textarea")?.className).toContain("wrap-anywhere");
  });

  it("asks a keeper from before each family's own project for its client file", async () => {
    answer({ ...KEEPER, available: false, project: "" });
    await show(<FamilyFolderSection />, "Your family's Google project");
    expect(button("Choose the client's file…")).toBeDefined();
    expect(document.body.textContent).toContain("the family folder carries on as it was");
  });

  it("lets the keeper let a computer in, with the role chosen, once the codes match", async () => {
    answer(KEEPER, [], { ...KEEPER, asking: [] });
    await show(<FamilyFolderSection />, "Asking to join (1)");
    expect(document.body.textContent).toContain("ABCD-EFGH");
    expect(document.body.textContent).toContain("Mak Long's laptop");
    const viewer = document.querySelector<HTMLButtonElement>("#role-d3-viewer");
    act(() => viewer?.click());
    act(() => button("Let in").click());
    await askedFor("/api/family-folder/admit");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/admit",
      body: { device: "d3", role: "viewer" },
    });
  });

  it("lets the keeper allow another of their own computers to invite and let in", async () => {
    const travel = {
      device: "d4",
      name: "Travel laptop",
      role: "trusted" as const,
      email: "keeper@example.com",
      you: false,
      own: true,
      helps: false,
    };
    answer({ ...KEEPER, asking: [], members: [...(KEEPER.members ?? []), travel] });
    await show(<FamilyFolderSection />, "Travel laptop");
    // Only beside the keeper's own other computer: not a relative's, nor this one.
    const switches = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    expect(switches.map((found) => found.id)).toEqual(["helps-d4"]);
    expect(document.querySelector('label[for="helps-d4"]')?.textContent).toBe(
      "May invite and let in for me",
    );
    act(() => switches[0]?.click());
    await askedFor("/api/family-folder/helper");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/helper",
      body: { device: "d4", allowed: true },
    });
  });

  it("tells the keeper what their other computers asked, and what came of it", async () => {
    const at = new Date().toISOString();
    answer({
      ...KEEPER,
      asking: [],
      helped: [
        {
          action: "let_in",
          name: "Pak Ngah's PC",
          done: false,
          why: "Its code isn't the one its request gives here.",
          by: "Travel laptop",
          at,
        },
        {
          action: "let_in",
          name: "Mak Long's laptop",
          done: true,
          why: "",
          by: "Travel laptop",
          at,
        },
        { action: "invited", name: "r@example.com", done: true, why: "", by: "Travel laptop", at },
        {
          action: "",
          name: "",
          done: false,
          why: "It couldn't be checked as that computer's own.",
          by: "Travel laptop",
          at,
        },
      ],
    });
    await show(<FamilyFolderSection />, "What your other computers asked");
    const text = document.body.textContent;
    expect(text).toContain(
      "Pak Ngah's PC: not let in, as Travel laptop asked. Its code isn't the one its request gives here.",
    );
    expect(text).toContain("Mak Long's laptop: let in, as Travel laptop asked");
    expect(text).toContain("r@example.com: invited, from Travel laptop");
    expect(text).toContain(
      "Something from Travel laptop was turned down. It couldn't be checked as that computer's own.",
    );
  });

  it("lets another of the keeper's own computers invite and let in, through the keeper's", async () => {
    const helping = HELPING.helping as NonNullable<FamilyFolderStatus["helping"]>;
    answer(HELPING, [], {
      ...HELPING,
      asking: [],
      helping: { ...helping, waiting: ["Pak Ngah's PC"] },
    });
    await show(<FamilyFolderSection />, "Asking to join (1)");
    const text = document.body.textContent;
    expect(text).toContain("Inviting and letting in for Home PC");
    expect(text).toContain("ABCD-EFGH");
    expect(text).toContain("Home PC lets them in at its next round.");
    expect(text).toContain("Invite a relative, by their Google account");
    expect(() => button("Not this one")).toThrow(); // turning a computer away is the keeper's
    act(() => button("Let in").click());
    await askedFor("/api/family-folder/admit");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/admit",
      body: { device: "d3", role: "contributor" },
    });
    await until("Waiting for Home PC to let them in");
    expect(document.body.textContent).not.toContain("it's not running");
  });

  it("says when the keeper's computer isn't running, so who's let in waits", async () => {
    const looked = new Date(Date.now() - 20 * 60_000).toISOString();
    answer({
      ...HELPING,
      asking: [],
      helping: {
        keeper: "Home PC",
        running: false,
        looked,
        waiting: ["Pak Ngah's PC"],
        done: [{ action: "let_in", name: "Mak Long's laptop", done: true, why: "", by: "" }],
      },
    });
    await show(<FamilyFolderSection />, "Inviting and letting in for Home PC");
    const text = document.body.textContent;
    expect(text).toContain("Home PC isn't running: last heard from");
    expect(text).toContain("Waiting for Home PC to let them in: it's not running");
    expect(text).toContain("Mak Long's laptop: let in");
  });

  it("lets the keeper change what a computer let in may do", async () => {
    answer({ ...KEEPER, asking: [] });
    await show(<FamilyFolderSection />, "Mak Long's laptop");
    act(() => button("Change role…").click());
    await until("Change what Mak Long's laptop may do");
    expect(button("Change").disabled).toBe(true); // it's a viewer already
    const contributor = document.querySelector<HTMLButtonElement>("#new-role-contributor");
    act(() => contributor?.click());
    act(() => button("Change").click());
    await askedFor("/api/family-folder/role");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/role",
      body: { device: "d2", role: "contributor" },
    });
  });

  it("holds a role change while that computer's changes wait for review", async () => {
    const sent_at = new Date().toISOString();
    const waiting = { device: "d2", name: "Mak Long's laptop", email: "r@example.com" };
    answer({
      ...KEEPER,
      asking: [],
      changes: [
        { ...waiting, role: "viewer", proposal: 2, sent_at, changed: 3, words_only: false },
      ],
    });
    await show(<FamilyFolderSection />, "Mak Long's laptop");
    act(() => button("Change role…").click());
    await until("Review its 3 changes first");
    const trusted = document.querySelector<HTMLButtonElement>("#new-role-trusted");
    act(() => trusted?.click());
    expect(button("Change").disabled).toBe(true);
  });

  it("tells a relative its keeper changed its role, and where its changes went", async () => {
    const relative: FamilyFolderStatus = {
      ...SIGNED_IN,
      email: "r@example.com",
      setup: "member",
      role: "viewer",
      family: "Keluarga Contoh",
      members: KEEPER.members,
      role_changed: { role: "viewer", backup: "ancestree-backup-2026-10-10T09-30-00.zip" },
    };
    answer(relative, [], { ...relative, role_changed: null });
    await show(<FamilyFolderSection />, "Your keeper changed what this computer may do");
    expect(document.body.textContent).toContain("Now Viewer.");
    expect(document.body.textContent).toContain("ancestree-backup-2026-10-10T09-30-00.zip");
    act(() => button("Got it").click());
    await askedFor("/api/family-folder/role-seen");
  });

  it("lets the keeper offer the family to another computer, saying what this one becomes", async () => {
    answer({ ...KEEPER, asking: [] });
    await show(<FamilyFolderSection />, "Hand the family to someone else?");
    act(() => button("Hand the family to someone else…").click());
    await until("Who keeps the family from now on");
    expect(document.body.textContent).toContain("IAM & Admin → IAM → Grant access");
    const contributor = document.querySelector<HTMLButtonElement>("#after-contributor");
    act(() => contributor?.click());
    act(() => button("Offer it").click());
    await askedFor("/api/family-folder/offer");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/offer",
      body: { device: "d2", after: "contributor" },
    });
  });

  it("shows the keeper its offer while it stands, and takes it back", async () => {
    const made = new Date().toISOString();
    answer({
      ...KEEPER,
      asking: [],
      offer_made: { device: "d2", name: "Mak Long's laptop", after: "trusted", made },
    });
    await show(<FamilyFolderSection />, "Offered to Mak Long's laptop");
    expect(document.body.textContent).toContain("this computer keeps nothing");
    for (const keepers of ["Hand the family to someone else?", "Change role…", "Invite"]) {
      expect(document.body.textContent).not.toContain(keepers); // nothing kept here meanwhile
    }
    act(() => button("Withdraw the offer").click());
    await askedFor("/api/family-folder/offer/withdraw");
  });

  it("asks a relative to keep the family, and takes its answer", async () => {
    const offered: FamilyFolderStatus = {
      ...SIGNED_IN,
      email: "r@example.com",
      setup: "member",
      role: "trusted",
      family: "Keluarga Contoh",
      members: KEEPER.members,
      offer_here: { keeper: "Home PC", made: new Date().toISOString(), own: false },
    };
    answer(offered);
    await show(<FamilyFolderSection />, "Home PC asks you to keep the family");
    expect(document.body.textContent).toContain("The family folder moves to your Google Drive.");
    expect(document.body.textContent).toContain("You get a recovery code, to keep safe.");
    act(() => button("Decline").click());
    await askedFor("/api/family-folder/offer/decline");
    act(() => button("Accept").click());
    await askedFor("/api/family-folder/offer/accept");
  });

  it("tells the old keeper whom it handed the family to, until it's seen", async () => {
    const handed: FamilyFolderStatus = {
      ...SIGNED_IN,
      setup: "member",
      role: "trusted",
      family: "Keluarga Contoh",
      members: KEEPER.members,
      handed: { to: "Mak Long's laptop", role: "trusted" },
    };
    answer(handed, [], { ...handed, handed: null });
    await show(<FamilyFolderSection />, "You handed the family to Mak Long's laptop");
    expect(document.body.textContent).toContain("This computer carries on as Trusted.");
    act(() => button("Got it").click());
    await askedFor("/api/family-folder/role-seen");
  });

  it("turns away a computer the keeper doesn't know", async () => {
    answer(KEEPER);
    await show(<FamilyFolderSection />, "Asking to join (1)");
    act(() => button("Not this one").click());
    await askedFor("/api/family-folder/refuse");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/refuse",
      body: { device: "d3" },
    });
  });

  it("gives a waiting relative the code to read to the keeper", async () => {
    answer({ ...SIGNED_IN, setup: "member", role: "waiting", code: "WXYZ-2345" });
    await show(<FamilyFolderSection />, "Waiting to be let in");
    expect(document.body.textContent).toContain("WXYZ-2345");
  });

  it("shows the recovery code once, until it's kept safe", async () => {
    answer({ ...KEEPER, asking: [], recovery_code: "ABCD EFGH IJKL MNOP QRST UVWX YZ" });
    await show(<FamilyFolderSection />, "Your recovery code");
    expect(document.body.textContent).toContain("ABCD EFGH IJKL MNOP QRST UVWX YZ");
    act(() => button("I've kept it safe").click());
    await askedFor("/api/family-folder/recovery-seen");
    expect(asked.map((ask) => ask.path)).toContain("/api/family-folder/recovery-seen");
  });

  it("changes nothing on the keeper's computer while its offer stands", async () => {
    const made = new Date().toISOString();
    answer({
      ...KEEPER,
      asking: [],
      offer_made: { device: "d2", name: "Mak Long's laptop", after: "trusted", made },
    });
    await show(
      <>
        <FamilyFolderSection />
        <CanEdit>
          <button type="button">Add person</button>
        </CanEdit>
      </>,
      "Offered to Mak Long's laptop",
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(document.body.textContent).not.toContain("Add person");
  });

  it("keeps a viewer's family as the keeper sends it: only their words to add", async () => {
    answer({ ...SIGNED_IN, setup: "member", role: "viewer", family: "Keluarga Contoh" });
    await show(
      <>
        <FamilyFolderSection />
        <CanEdit>
          <button type="button">Add person</button>
        </CanEdit>
      </>,
      "Keluarga Contoh",
    );
    await new Promise((done) => setTimeout(done, 20));
    expect(document.body.textContent).toContain(
      "Only your words about people can be added here: they go to the keeper",
    );
    expect(document.body.textContent).not.toContain("Add person");
  });

  it("shows the keeper the changes waiting, and brings in what's ticked, with a note", async () => {
    const sent = new Date().toISOString();
    const waiting: FamilyFolderStatus = {
      ...KEEPER,
      asking: [],
      changes: [
        {
          device: "d2",
          name: "Mak Long's laptop",
          email: "r@example.com",
          role: "contributor",
          proposal: 4,
          sent_at: sent,
          changed: 2,
          words_only: false,
        },
      ],
    };
    const change = {
      kind: "set" as const,
      row: null,
      person: "p1",
      name: "Hassan bin Ismail",
      clash: false,
      unsure: false,
      removes: false,
      needs: [],
      blocked_by: [],
      ticked: true,
    };
    const preview = {
      questions: [],
      changes: [
        { ...change, id: "set:p1:nickname", column: "Nickname", before: "", after: "Pak Hassan" },
        { ...change, id: "set:p1:occupation", column: "Occupation", before: "", after: "Guru" },
      ],
      left_out: [],
      second_look: [],
    };
    const done = { id: "i1", label: "", people: 0, links: 0, changed: 1, left_out: 1, backup: "b" };
    answer(waiting, [], { ...waiting, changes: [] }, { "/review": preview, "/bring-in": done });
    await show(<FamilyFolderSection />, "Changes waiting (1)");
    expect(document.body.textContent).toContain("Mak Long's laptop");
    act(() => button("Review").click());
    await until("Pak Hassan");
    const occupation = document.querySelector<HTMLButtonElement>('[id="change-set:p1:occupation"]');
    act(() => occupation?.click()); // not that one
    const note = document.querySelector<HTMLTextAreaElement>("#note-d2");
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      set?.call(note, "Which school, please?");
      note?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => button("Bring in 1 change").click());
    await askedFor("/api/family-folder/changes/d2/bring-in");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/changes/d2/bring-in",
      body: {
        proposal: 4,
        answers: {},
        chosen: ["set:p1:nickname"],
        note: "Which school, please?",
      },
    });
  });

  it("shows a viewer's words for review, theirs alone", async () => {
    const waiting: FamilyFolderStatus = {
      ...KEEPER,
      asking: [],
      changes: [
        {
          device: "d3",
          name: "Mak Long's laptop",
          email: "r@example.com",
          role: "viewer",
          proposal: 2,
          sent_at: new Date().toISOString(),
          changed: 1,
          words_only: true,
        },
      ],
    };
    const preview = {
      questions: [],
      changes: [
        {
          id: "said:p1:1a2b3c4d",
          kind: "said" as const,
          row: null,
          person: "p1",
          name: "Hassan bin Ismail",
          column: "What people say",
          before: "",
          after: "He taught me to fish.",
          detail: "written",
          by: "Mak Long",
          clash: false,
          unsure: false,
          removes: false,
          needs: [],
          blocked_by: [],
          ticked: true,
        },
      ],
      left_out: [
        {
          row: null,
          column: "Mak Long's laptop",
          written: "1 other changes",
          why: "A viewer's computer sends only its words about people, so the rest isn't taken.",
        },
      ],
      second_look: [],
    };
    answer(waiting, [], waiting, { "/review": preview });
    await show(<FamilyFolderSection />, "Changes waiting (1)");
    act(() => button("Review").click());
    await until("He taught me to fish.");
    const text = document.body.textContent ?? "";
    expect(text).toContain("only what they say about people is taken from it");
    expect(text).toContain("What people say");
    expect(text).toContain("Hassan bin Ismail · what Mak Long says, written");
    expect(text).toContain("sends only its words about people");
  });

  it("tells a relative what waits for the keeper, and the keeper's answer", async () => {
    const relative: FamilyFolderStatus = {
      ...SIGNED_IN,
      setup: "member",
      role: "contributor",
      family: "Keluarga Contoh",
      pending: 2,
      sent_at: new Date().toISOString(),
      answers: [
        { proposal: 3, left_out: ["Aminah binti Ali: Born"], note: "A source for this, please" },
      ],
    };
    answer(relative, [], { ...relative, answers: [] });
    await show(<FamilyFolderSection />, "The keeper's answer");
    expect(document.body.textContent).toContain("2 people and links wait for the keeper");
    expect(document.body.textContent).toContain("A source for this, please");
    expect(document.body.textContent).toContain("Aminah binti Ali: Born");
    act(() => button("Got it").click());
    await askedFor("/api/family-folder/answers-seen");
  });
  it("lets a relative leave the family folder, once they're sure", async () => {
    const relative: FamilyFolderStatus = {
      ...SIGNED_IN,
      setup: "member",
      role: "contributor",
      family: "Keluarga Contoh",
      may_leave: true,
    };
    answer(relative, [], SIGNED_IN);
    await show(<FamilyFolderSection />, "Leave the family folder…");
    act(() => button("Leave the family folder…").click());
    await until("Ask your keeper to remove this computer too");
    act(() => button("Leave").click());
    await askedFor("/api/family-folder/leave");
  });

  it("opens the guide from inviting, a computer of your own, and leaving", async () => {
    const guide = () =>
      [...document.querySelectorAll("a")]
        .filter((link) => link.textContent === "How does this work?")
        .map((link) => link.getAttribute("href"));
    answer({ ...KEEPER, asking: [] });
    await show(<FamilyFolderSection />, "Invite a relative, by their Google account");
    expect(guide()).toEqual(
      expect.arrayContaining(["/guide#invite-a-relative", "/guide#your-own-other-computers"]),
    );
    act(() => root?.unmount());
    document.body.replaceChildren();
    answer({
      ...SIGNED_IN,
      setup: "member",
      role: "contributor",
      family: "Keluarga Contoh",
      may_leave: true,
    });
    await show(<FamilyFolderSection />, "Leave the family folder…");
    expect(guide()).toContain("/guide#leaving-the-family");
  });

  it("makes the keeper a new recovery code, once they're sure", async () => {
    answer({ ...KEEPER, asking: [] });
    await show(<FamilyFolderSection />, "Lost your recovery code?");
    act(() => button("Make a new recovery code").click());
    await until("Your old code stops working");
    act(() => button("Make it").click());
    await askedFor("/api/family-folder/new-recovery-code");
  });

  it("shows a keeper's computer another keeps the family now, and the way out", async () => {
    const problem = "Another computer is the family's keeper now: leave it here.";
    answer({ ...KEEPER, asking: [], replaced: true, may_leave: true, problem });
    await show(<FamilyFolderSection />, "Another computer keeps the family now");
    expect(document.body.textContent).toContain(problem);
    expect(document.body.textContent).not.toContain("Invite a relative");
    act(() => button("Leave the family folder…").click());
    await until("use your recovery code afterwards");
  });

  it("lets the keeper turn down changes that can't be read", async () => {
    const waiting: FamilyFolderStatus = {
      ...KEEPER,
      asking: [],
      changes: [
        {
          device: "d2",
          name: "Mak Long's laptop",
          email: "r@example.com",
          role: "contributor",
          proposal: 5,
          sent_at: new Date().toISOString(),
          changed: 1,
          words_only: false,
        },
      ],
    };
    const unreadable = Response.json(
      {
        detail: {
          code: "unreadable_changes",
          message: "What Mak Long's laptop sent can't be read here. Take none of it.",
        },
      },
      { status: 409 },
    );
    answer(waiting, [], { ...waiting, changes: [] }, { "/review": unreadable });
    await show(<FamilyFolderSection />, "Changes waiting (1)");
    act(() => button("Review").click());
    await until("can't be read here");
    act(() => button("Take none").click());
    await askedFor("/api/family-folder/changes/d2/turn-down");
    expect(asked).toContainEqual({
      method: "POST",
      path: "/api/family-folder/changes/d2/turn-down",
      body: { proposal: 5, note: "" },
    });
  });
});
