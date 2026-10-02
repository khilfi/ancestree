import { describe, expect, it } from "vitest";
import type { ImportChange } from "@/api/types";
import { carriedOut, changeNames, heldBack, tickAll, tickedIds } from "./importTicks";

const change = (id: string, more: Partial<ImportChange> = {}): ImportChange => ({
  id,
  kind: "add_person",
  row: 2,
  name: id,
  clash: false,
  unsure: false,
  removes: more.kind === "remove_person",
  ticked: true,
  ...more,
});

// Ahmad and Zainab are new and married; Latif, already in the tree, is marked Remove and
// named as Aishah's father; Hassan's occupation was changed in the app too since the export.
const ahmad = change("add:row:2", { name: "Ahmad bin Ali" });
const zainab = change("add:row:3", { name: "Zainab binti Omar" });
const marriage = change("link:spouse:new:row:2>new:row:3", {
  kind: "add_link",
  needs: [ahmad.id, zainab.id],
});
const latif = change("remove:latif", {
  kind: "remove_person",
  name: "Latif bin Omar",
  ticked: false,
});
const father = change("link:parent:tree:latif>new:row:4", {
  kind: "add_link",
  blocked_by: [latif.id],
});
const clash = change("set:hassan:occupation", { kind: "set", clash: true, ticked: false });
const all = [ahmad, zainab, marriage, latif, father, clash];

describe("ticking an import's changes", () => {
  it("starts with each change's own tick", () => {
    expect(tickedIds(all, {})).toEqual(new Set([ahmad.id, zainab.id, marriage.id, father.id]));
    expect(carriedOut(all, {})).toEqual(new Set([ahmad.id, zainab.id, marriage.id, father.id]));
  });

  it("makes a link only with the new people it joins", () => {
    const ticks = { [zainab.id]: false };
    expect(carriedOut(all, ticks).has(marriage.id)).toBe(false);
    expect(heldBack(marriage, tickedIds(all, ticks), changeNames(all))).toBe(
      "needs Zainab binti Omar, who isn't ticked",
    );
  });

  it("makes no link to someone ticked to be removed", () => {
    const ticks = { [latif.id]: true };
    expect(carriedOut(all, ticks)).toEqual(new Set([ahmad.id, zainab.id, marriage.id, latif.id]));
    expect(heldBack(father, tickedIds(all, ticks), changeNames(all))).toBe(
      "Latif bin Omar is ticked to be removed",
    );
  });

  it("ticks all but the removals and the clashes, or nothing", () => {
    expect(tickedIds(all, tickAll(all, true))).toEqual(
      new Set([ahmad.id, zainab.id, marriage.id, father.id]),
    );
    expect(carriedOut(all, tickAll(all, false)).size).toBe(0);
  });

  it("leaves whatever takes something out of a relative's changes to its own tick too", () => {
    // A link taken out, and a photo taken out, on a relative's computer; a story written.
    const unlink = change("unlink:1", { kind: "remove_link", removes: true, ticked: false });
    const photo = change("photo:siti", { kind: "photo", removes: true, ticked: false });
    const story = change("story:hassan", { kind: "story" });
    const copy = [unlink, photo, story];

    expect(tickedIds(copy, tickAll(copy, true))).toEqual(new Set([story.id]));
    expect(tickedIds(copy, { [unlink.id]: true })).toEqual(new Set([unlink.id, story.id]));
  });
});
