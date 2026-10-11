/**
 * The guide's sections that places in the app open with **How does this work?**, by
 * their headings' addresses. Kept here alone, without the guide itself, so a page that links
 * to one carries nothing of the guide, and a test checks that each is still in it.
 */
export const GUIDE_AT = {
  signIn: "signing-in-to-google",
  join: "join",
  startFolder: "start-the-family-folder",
  project: "your-familys-google-project",
  letIn: "let-their-computer-in",
  computers: "change-what-a-computer-may-do",
  yourComputer: "what-your-computer-may-do",
  changesWaiting: "changes-waiting",
  answer: "your-keepers-answer",
  handOver: "hand-the-family-to-someone-else",
  takeOver: "when-your-keeper-asks-you-to-keep-the-family",
  leave: "leaving-the-family",
  invite: "invite-a-relative",
  ownComputers: "your-own-other-computers",
  moveFolder: "move-the-family-folder",
  rebuild: "when-the-family-folder-is-lost-rebuild-it",
  backups: "20-backups",
  elsewhere: "copies-in-another-place",
  import: "17-bringing-people-in-from-a-spreadsheet",
} as const;

export type GuidePlace = keyof typeof GUIDE_AT;

/** The guide, open at a place's section. */
export function guideAt(place: GuidePlace): string {
  return `/guide#${GUIDE_AT[place]}`;
}
