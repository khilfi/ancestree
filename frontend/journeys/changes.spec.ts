import { expect, findPerson, test } from "./fixtures";

test("add a person, link a relative, then Undo both", async ({ page, picture }) => {
  await page.goto("/tree");
  // The tree drawn first, at its first view, so the form opens beside it the same each time.
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Add person" }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByRole("heading", { name: "Add a person" })).toBeVisible();
  await panel.getByRole("textbox", { name: "Full name" }).fill("Aina binti Hassan");
  await panel.getByRole("combobox", { name: "Gender" }).click();
  await page.getByRole("option", { name: "Female", exact: true }).click();
  // The list gone first: as it fades, it gives the focus back to Gender, and once took it from
  // the date being typed.
  await expect(page.getByRole("listbox")).toBeHidden();
  // Typed, as it's said.
  await panel.getByRole("textbox", { name: "Date of birth" }).fill("1965");
  await picture("new-person-form");

  await panel.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByText("Added Aina binti Hassan.")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Aina binti Hassan" })).toBeVisible();
  await expect(panel.getByText("b. 1965 · about 61 years old")).toBeVisible();
  await picture("new-person");

  // Her father, already in the tree.
  await panel.getByRole("tab", { name: /^Relatives/ }).click();
  await panel.getByRole("button", { name: "Add parent" }).click();
  const adding = page.getByRole("dialog", { name: "Add a parent of Aina binti Hassan" });
  await adding.getByRole("tab", { name: "Already in the tree" }).click();
  await adding.getByPlaceholder("Search by name or nickname…").fill("Hassan bin Ismail");
  await adding.getByRole("option", { name: /^Hassan bin Ismail / }).click();
  await expect(adding.getByRole("combobox", { name: "Kind" })).toHaveText("Biological");
  await picture("link-a-parent");
  await adding.getByRole("button", { name: "Link" }).click();
  await expect(adding).toBeHidden();
  await expect(page.getByText("Linked Hassan bin Ismail.")).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Hassan bin Ismail .*Father/ })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /^Aminah binti Hassan .*Elder sister/ }),
  ).toBeVisible();
  await expect(panel.getByText("Daughter of Acan")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Your aunt" })).toBeVisible();
  // The pointer out of the way: where Link was is over the tree, and someone there would show
  // their card.
  await page.mouse.move(1, 1);
  await picture("linked");

  const top = page.getByRole("banner");
  await top
    .getByRole("button", { name: "Undo: Link Hassan bin Ismail and Aina binti Hassan" })
    .click();
  await expect(
    page.getByText("Undone: Link Hassan bin Ismail and Aina binti Hassan"),
  ).toBeVisible();
  await expect(panel.getByText("No parents recorded.")).toBeVisible();
  await top.getByRole("button", { name: "Undo: Add Aina binti Hassan" }).click();
  await expect(page.getByText("Undone: Add Aina binti Hassan")).toBeVisible();
  // She's gone, and her panel with her: it stayed, saying "That person isn't in the tree."
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/tree$/);
  await expect(top.getByRole("button", { name: "Nothing to undo" })).toBeDisabled();
  await expect(top.getByRole("button", { name: "Redo: Add Aina binti Hassan" })).toBeEnabled();
  // The view had followed her into a corner of her own, "Not linked yet": with her gone, the
  // first view again, never an empty canvas.
  await expect(page.locator(".react-flow__node").first()).toBeInViewport();
  await picture("undone");
});

test("edit, then Cancel: back to their details", async ({ page, picture }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Edit" }).click();
  await expect(panel.getByRole("textbox", { name: "Full name" })).toHaveValue(
    "Rokiah binti Salleh",
  );
  await expect(panel.getByRole("tab", { name: /^Relatives/ })).toBeDisabled();
  await picture("edit-form");
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "Full name" })).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Nothing to undo" }),
  ).toBeDisabled();
});

// Esc in the person form is Cancel: once, it did nothing there, and the form stayed open.
test("Esc in the person form is Cancel", async ({ page }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Nickname" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 2_000 });
});

// Cancel asks before throwing typed changes away, and Esc in its question means "keep
// editing": once, Cancel threw them away without a word.
test("Cancel asks before throwing typed changes away", async ({ page, picture }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Occupation" }).fill("Guru");
  const cancel = panel.getByRole("button", { name: "Cancel" });
  await cancel.click();
  const asking = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(asking).toBeVisible({ timeout: 2_000 });
  await picture("discard-your-changes");
  await page.keyboard.press("Escape");
  await expect(asking).toBeHidden();
  await expect(panel.getByRole("textbox", { name: "Occupation" })).toHaveValue("Guru");
  await expect(cancel).toBeFocused();
});

// Esc with something typed asks the same, and Discard goes back to their details, as they
// were.
test("Esc with something typed asks first, and Discard goes back", async ({ page }) => {
  await page.goto("/tree");
  const panel = await findPerson(page, "Rokiah binti Salleh");
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Occupation" }).fill("Guru");
  await page.keyboard.press("Escape");
  const asking = page.getByRole("alertdialog", { name: "Discard your changes?" });
  await expect(asking).toBeVisible();
  await asking.getByRole("button", { name: "Discard" }).click();
  await expect(asking).toBeHidden();
  await expect(panel.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(panel.getByText("Guru")).toBeHidden();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Nothing to undo" }),
  ).toBeDisabled();
});
