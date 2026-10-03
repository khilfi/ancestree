/**
 * The family folder's state at the top of the window (0.4.0, D47): each state it can be in,
 * as the indicator says it, from the status the app gives.
 */
import { describe, expect, it } from "vitest";
import type { FamilyFolderStatus } from "@/api/types";
import { at, inStep } from "./SyncIndicator";

const NOW = new Date("2026-10-03T14:10:00+08:00").getTime();
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const KEEPING: FamilyFolderStatus = {
  available: true,
  email: "keeper@example.com",
  signing_in: false,
  setup: "keeper",
  family: "Keluarga Contoh",
  role: "keeper",
  code: null,
  members: [],
  asking: [],
  last_sync: minutesAgo(2),
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
  tried: minutesAgo(2),
  through: true,
  trouble: "",
  lost: false,
  moving: false,
  old_folder_left: false,
  published: null,
};

describe("the family folder's state at the top", () => {
  it("says nothing with no family folder", () => {
    expect(inStep({ ...KEEPING, setup: null }, NOW)).toBeNull();
    expect(inStep(undefined, NOW)).toBeNull();
  });

  it("says when the family was last in step", () => {
    expect(inStep(KEEPING, NOW)).toEqual({
      tone: "good",
      text: "In step · 2 minutes ago",
      why: "",
    });
  });

  it("is in step with a note, when the round went through", () => {
    const note = "Photos and stories are still arriving: the family comes when they have.";
    expect(inStep({ ...KEEPING, problem: note }, NOW)).toEqual({
      tone: "good",
      text: "In step · 2 minutes ago",
      why: note,
    });
  });

  it("says it's keeping in step while a round is under way", () => {
    expect(inStep({ ...KEEPING, syncing: true }, NOW)?.text).toBe("Keeping in step…");
  });

  it("says it's offline, and since when it was in step", () => {
    const offline = { ...KEEPING, through: false, trouble: "offline", last_sync: minutesAgo(180) };
    const state = inStep({ ...offline, problem: "No internet just now." }, NOW);
    expect(state).toEqual({
      tone: "warn",
      text: "Offline · in step 3 hours ago",
      why: "No internet just now.",
    });
  });

  it("warns after a day without a round going through", () => {
    const stale = {
      ...KEEPING,
      through: false,
      trouble: "offline",
      last_sync: minutesAgo(26 * 60),
    };
    expect(inStep(stale, NOW)?.text).toBe("Not in step since yesterday");
    expect(inStep({ ...stale, through: true }, NOW)?.tone).toBe("warn"); // a day is a day
  });

  it("asks to sign in once the sign-in has ended", () => {
    expect(inStep({ ...KEEPING, email: null }, NOW)).toMatchObject({
      tone: "warn",
      text: "Sign in to Google",
    });
  });

  it("says the family folder is gone, and anything else in the way", () => {
    const lost = { ...KEEPING, through: false, trouble: "lost", lost: true, problem: "Gone." };
    expect(inStep(lost, NOW)).toEqual({ tone: "warn", text: "Family folder gone", why: "Gone." });
    const other = { ...KEEPING, through: false, trouble: "problem", problem: "Drive said no." };
    expect(inStep(other, NOW)?.text).toBe("Not in step");
  });

  it("says what a family folder with no Google project needs", () => {
    expect(inStep({ ...KEEPING, available: false }, NOW)?.text).toBe("Needs its Google project");
  });

  it("says the day as people say it", () => {
    expect(at(minutesAgo(8), NOW)).toMatch(/^today at \d\d:\d\d$/);
    expect(at(minutesAgo(24 * 60), NOW)).toMatch(/^yesterday at /);
    expect(at(minutesAgo(3 * 24 * 60), NOW)).toMatch(/^[A-Z][a-z]{2} \d+ [A-Z][a-z]{2,3} at /);
  });
});
