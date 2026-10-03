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
    { device: "d1", name: "Home PC", role: "keeper", email: "keeper@example.com", you: true },
    { device: "d2", name: "Mak Long's laptop", role: "viewer", email: "r@example.com", you: false },
  ],
  asking: [{ device: "d3", name: "Pak Ngah's PC", email: "p@example.com", code: "ABCD-EFGH" }],
};

let root: Root | undefined;
let asked: { method: string; path: string; body: unknown }[] = [];

function answer(
  status: FamilyFolderStatus,
  shared: object[] = [],
  after?: FamilyFolderStatus,
  other: Record<string, object | Response> = {}, // what other addresses answer, by their ends
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
      const found = other[ending];
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
      body: { invitation: "ATI1-abc-123456" },
    });
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
    expect(message).toContain("Settings → Family folder");
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

  it("keeps a relative's family as the keeper sends it: nothing to change it with", async () => {
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
    expect(document.body.textContent).toContain("can't be changed on this computer");
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
