import type { Locator, Page } from "@playwright/test";
import { expect, findPerson, fromTopBar, test, treeStill } from "./fixtures";

/** Opened, then Esc: it closes, what was under it stays, and the focus is back on what opened
 *  it, or on its menu's button for what a menu opened. */
async function escapes(
  page: Page,
  opened: Locator,
  { under, back }: { under?: Locator; back?: Locator } = {},
): Promise<void> {
  await expect(opened).toBeVisible();
  // A menu whose choice opened it is on top until it has faded, a tenth of a second, and takes
  // Esc till then, as it would from a person that quick.
  await expect(page.locator('[role="menu"][data-state="closed"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(opened).toBeHidden();
  if (under) await expect(under).toBeVisible();
  if (back) await expect(back).toBeFocused();
}

test("Esc closes each dialog of the person panel, and only that", async ({ page }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  const under = panel.getByRole("heading", { name: "Rokiah binti Salleh" });

  await test.step("their photo", async () => {
    const back = panel.getByRole("button", { name: "Change the photo" });
    await back.click();
    await escapes(page, page.getByRole("dialog", { name: "Photo of Rokiah binti Salleh" }), {
      under,
      back,
    });
  });
  await test.step("their life story", async () => {
    const back = panel.getByRole("button", { name: "Life story", exact: true });
    await back.click();
    await escapes(page, page.getByRole("dialog", { name: /life story$/ }), { under, back });
  });
  await test.step("Move to Trash?", async () => {
    // In More, under their name.
    const back = panel.getByRole("button", { name: "More" });
    await back.click();
    await page.getByRole("menuitem", { name: "Move to Trash" }).click();
    await escapes(
      page,
      page.getByRole("alertdialog", { name: "Move Rokiah binti Salleh to the Trash?" }),
      { under, back },
    );
  });
  await test.step("More, and Same person as…", async () => {
    const back = panel.getByRole("button", { name: "More" });
    await back.click();
    await escapes(page, page.getByRole("menu", { name: "More" }), { under, back });
    await back.click();
    await page.getByRole("menuitem", { name: "Same person as…" }).click();
    await escapes(
      page,
      page.getByRole("dialog", { name: "Is Rokiah binti Salleh in the tree twice?" }),
      { under, back },
    );
  });
  await test.step("a relative added", async () => {
    await panel.getByRole("tab", { name: /^Relatives/ }).click();
    for (const relative of ["parent", "spouse", "sibling", "child"]) {
      const back = panel.getByRole("button", { name: `Add ${relative}` });
      await back.click();
      await escapes(page, page.getByRole("dialog", { name: /^Add a / }), { under, back });
    }
  });
  await test.step("a relative added from beside them on the tree", async () => {
    const beside = page.getByRole("group", { name: "Add to Rokiah" });
    for (const relative of ["+ Parent", "+ Spouse", "+ Child"]) {
      const back = beside.getByRole("button", { name: relative });
      await back.click();
      await escapes(page, page.getByRole("dialog", { name: /^Add a / }), { under, back });
    }
  });
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Nothing to undo" }),
  ).toBeDisabled();
});

// Esc closes someone's panel once nothing over it is open, by the user's answer of 19–20 Nov
// 2026: Find relationship ends first, then the panel closes, and the focus is back on
// them on the tree. Once, Esc closed neither.
test("Esc ends Find relationship, then closes the panel, back on them on the tree", async ({
  page,
}) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Find relationship" }).click();
  const finding = page.getByRole("status").filter({ hasText: "to see how they're related to" });
  await expect(finding).toBeVisible();
  await expect(page.locator('[role="menu"][data-state="closed"]')).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(finding).toBeHidden();
  await expect(panel.getByRole("heading", { name: "Rokiah binti Salleh" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/tree$/);
  await expect(
    page.getByRole("button", { name: "Rokiah binti Salleh", exact: true }),
  ).toBeFocused();
});

// What's typed in Add a relative isn't thrown away without a question, the person form's
// question, by the user's answer of 19–20 Nov 2026: once, Esc closed it, and the
// name typed went with it.
test("Esc in Add a relative asks before a typed name goes", async ({ page }) => {
  await page.goto("/tree");
  await findPerson(page, "Rokiah binti Salleh");
  await page
    .getByRole("group", { name: "Add to Rokiah" })
    .getByRole("button", { name: "+ Child" })
    .click();
  const adding = page.getByRole("dialog", { name: "Add a child of Rokiah binti Salleh" });
  await adding.getByRole("textbox", { name: "Full name" }).fill("Siti binti Yusof");
  await page.keyboard.press("Escape");
  const asking = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(asking).toBeVisible();
  await page.keyboard.press("Escape"); // Keep editing
  await expect(asking).toBeHidden();
  await expect(adding.getByRole("textbox", { name: "Full name" })).toHaveValue("Siti binti Yusof");
  await adding.getByRole("button", { name: "Cancel" }).click();
  await asking.getByRole("button", { name: "Discard" }).click();
  await expect(adding).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Nothing to undo" }),
  ).toBeDisabled();
});

test("Esc closes the top bar's dialogs and menus", async ({ page }) => {
  await page.goto("/tree");
  const top = page.getByRole("banner");

  await test.step("Search people", async () => {
    const back = top.getByRole("button", { name: "Search people" });
    await back.click();
    await escapes(page, page.getByRole("dialog", { name: "Search people" }), { back });
  });
  await test.step("the families", async () => {
    const family = top.getByRole("button", { name: /^Family: Keluarga Contoh/ });
    await family.click();
    await escapes(page, page.getByRole("menu", { name: /^Family: Keluarga Contoh/ }), {
      back: family,
    });
    await family.click();
    await page.getByRole("menuitem", { name: "Add a family…" }).click();
    await escapes(page, page.getByRole("alertdialog", { name: "Add a family" }), {
      back: family,
    });
  });
  await test.step("Me", async () => {
    const me = top.getByRole("button", { name: "Me: Danial bin Karim" });
    await me.click();
    await escapes(page, page.getByRole("menu", { name: "Me: Danial bin Karim" }), { back: me });
    await me.click();
    await page.getByRole("menuitem", { name: "I'm someone else…" }).click();
    await escapes(page, page.getByRole("dialog", { name: "Which person are you?" }), {
      back: me,
    });
  });
  await test.step("More", async () => {
    const more = top.getByRole("button", { name: /^More/ });
    await more.click();
    await escapes(page, page.getByRole("menu"), { back: more });
  });
  await test.step("Export's view-only copy", async () => {
    await fromTopBar(page, "View-only copy…");
    await escapes(page, page.getByRole("dialog", { name: "Make a view-only copy" }));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  await test.step("Family facts", async () => {
    await fromTopBar(page, "Family facts");
    await escapes(page, page.getByRole("complementary", { name: "Family facts" }));
  });
});

test("Esc closes Settings' dialogs", async ({ page }) => {
  await page.goto("/settings/kinship");
  const main = page.getByRole("main");
  const under = main.getByRole("heading", { name: "Malay birth-order titles" });
  const add = main.getByRole("button", { name: "Add kind" });
  await add.click();
  await escapes(page, page.getByRole("dialog", { name: "Add a relationship kind" }), {
    under,
    back: add,
  });
  const edit = main.getByRole("row", { name: /^Adoptive/ }).getByRole("button", { name: "Edit" });
  await edit.click();
  await escapes(page, page.getByRole("dialog", { name: /^Edit “Adoptive/ }), {
    under,
    back: edit,
  });
});

// Esc closes what's on top, the dialog, and Family facts stays open under it. Family facts
// once took Esc first and closed behind the dialog, which stayed.
test("with Family facts open, Esc closes the dialog on top, and only that", async ({ page }) => {
  await page.goto("/tree");
  await fromTopBar(page, "Family facts");
  const facts = page.getByRole("complementary", { name: "Family facts" });
  await expect(facts).toBeVisible();
  await fromTopBar(page, "View-only copy…");
  const exporting = page.getByRole("dialog", { name: "Make a view-only copy" });
  await expect(exporting).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(exporting).toBeHidden({ timeout: 2_000 });
  await expect(facts).toBeVisible({ timeout: 2_000 });
  // Then Family facts itself.
  await page.keyboard.press("Escape");
  await expect(facts).toBeHidden({ timeout: 2_000 });
});

// Esc in "Discard your changes?" is Keep editing: once, it did nothing, and the question
// stayed.
test("Esc in Discard your changes? keeps editing", async ({ page }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Occupation" }).fill("Guru");
  // Leaving the form changed asks first.
  await page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Timeline" })
    .click();
  const asking = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(asking).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(asking).toBeHidden({ timeout: 2_000 });
  await expect(panel.getByRole("textbox", { name: "Occupation" })).toHaveValue("Guru");
  await expect(page).toHaveURL(/\/tree\?/);
});

// Esc in "Is that where they live?" is Keep editing: once, it did nothing, and the
// question stayed.
test("Esc in Is that where they live? keeps editing", async ({ page }) => {
  await page.goto("/tree?new=1");
  const panel = page.getByRole("complementary", { name: "Person" });
  await panel.getByRole("textbox", { name: "Full name" }).fill("Aina binti Hassan");
  await panel.getByRole("textbox", { name: "Date of birth" }).fill("1965");
  // An address where they were born, and none where they live: a mix-up, asked about.
  await panel.getByRole("button", { name: /^Where they were born/ }).click();
  await panel
    .getByRole("textbox", { name: "Where they were born: address" })
    .fill("No. 8, Jalan Kenari 2");
  await panel.getByRole("textbox", { name: "Where they were born: town" }).fill("Kajang");
  const add = panel.getByRole("button", { name: "Add person" });
  await add.click();
  const asking = page.getByRole("alertdialog", { name: "Is that where they live?" });
  await expect(asking).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(asking).toBeHidden({ timeout: 2_000 });
  await expect(panel.getByRole("heading", { name: "Add a person" })).toBeVisible();
  await expect(add).toBeFocused();
});

// The card after dragging a link from one person onto another: it has a name and a close
// button, takes the focus, and Esc closes it, giving the focus back. It once had none of them.
// The tree's people have no name to find them by yet: they're found as `.react-flow__node`,
// by the words under their photo. Nothing is linked.
test("the card after dragging a link: named, focused, and closed by Esc", async ({ page }) => {
  await page.goto("/tree");
  // Rokiah's husband Yusof (Pak Ngah) and Lina, near her, in view at both sizes once her panel
  // is closed.
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Close the panel" }).click();
  await treeStill(page); // it glides to her first
  const person = (name: string) => page.locator(".react-flow__node").filter({ hasText: name });
  await person("Yusof bin Ismail").hover(); // his link's arrow shows
  const from = await person("Yusof bin Ismail").locator('[data-handleid="link"]').boundingBox();
  const onto = await person("Lina binti Zakaria").boundingBox();
  if (!from || !onto) throw new Error("Yusof or Lina isn't in view");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + 30, { steps: 10 });
  const before = await page.evaluateHandle(() => document.activeElement);
  await page.mouse.up();

  const card = page.getByRole("dialog", { name: "Link Pak Ngah and Lina" });
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
  await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(card.getByText("Pak Ngah is Lina's …")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  expect(await page.evaluate((element) => document.activeElement === element, before)).toBe(true);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Nothing to undo" }),
  ).toBeDisabled();
});
