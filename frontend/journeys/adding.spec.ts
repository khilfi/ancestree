import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * Adding people faster: someone new, then her parents, her husband and three
 * children, each from beside her on the tree, with Add and add another, and each date typed as
 * it's said, in every form of the plan: "12/3/1950", "about 1950", "kira-kira 1950",
 * "before 1960", "March 1950" and "1950–1955". Done in under 2 minutes. The people are made
 * up, from the test family's given names.
 */

type Someone = { name: string; gender?: "Male" | "Female"; born: string; reading: string };

/** One relative typed into Add a relative: what it understood shown beside the date, then
 *  added, and said. */
async function add(
  page: Page,
  dialog: Locator,
  someone: Someone,
  then: "Add" | "Add and add another",
): Promise<void> {
  await dialog.getByRole("textbox", { name: "Full name" }).fill(someone.name);
  if (someone.gender) {
    await dialog.getByRole("combobox", { name: "Gender" }).click();
    await page.getByRole("option", { name: someone.gender, exact: true }).click();
    // Gone first: as it fades, the list gives the focus back to Gender, which once took it
    // from the date being typed.
    await expect(page.getByRole("listbox")).toBeHidden();
  }
  await dialog.getByRole("textbox", { name: "Date of birth" }).fill(someone.born);
  await expect(dialog.getByText(someone.reading, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: then, exact: true }).click();
  await expect(page.getByText(`Added ${someone.name}.`)).toBeVisible();
}

test("a new person with parents, a spouse and three children, in under 2 minutes", async ({
  page,
  picture,
}) => {
  const started = Date.now();
  await page.goto("/tree");
  // The tree drawn first, at its first view, so the form opens beside it the same each time.
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Add person" }).click();
  const panel = page.getByRole("complementary", { name: "Person" });
  await panel.getByRole("textbox", { name: "Full name" }).fill("Aina binti Johari");
  await panel.getByRole("combobox", { name: "Gender" }).click();
  await page.getByRole("option", { name: "Female", exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden(); // as in `add`, above
  // The day first, as in Malaysia: what it understood, beside it.
  await panel.getByRole("textbox", { name: "Date of birth" }).fill("12/3/1950");
  await expect(panel.getByText("12 March 1950", { exact: true })).toBeVisible();
  await picture("typed-date");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Added Aina binti Johari.")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Aina binti Johari", level: 2 })).toBeVisible();
  await expect(panel.getByText("12 March 1950", { exact: true })).toBeVisible();

  // Beside her on the tree: + Parent, + Spouse and + Child.
  const beside = page.getByRole("group", { name: "Add to Aina" });
  await expect(beside).toBeVisible();
  await picture("add-beside");

  await test.step("her parents, one after the other", async () => {
    await beside.getByRole("button", { name: "+ Parent" }).click();
    const parents = page.getByRole("dialog", { name: "Add a parent of Aina binti Johari" });
    await add(
      page,
      parents,
      { name: "Johari bin Latif", gender: "Male", born: "about 1920", reading: "about 1920" },
      "Add and add another",
    );
    // Emptied for the next, likely her mother.
    await expect(parents.getByRole("textbox", { name: "Full name" })).toHaveValue("");
    await expect(parents.getByRole("textbox", { name: "Full name" })).toBeFocused();
    await expect(parents.getByRole("combobox", { name: "Gender" })).toHaveText("Female");
    await picture("add-another");
    await add(
      page,
      parents,
      { name: "Hawa binti Omar", born: "kira-kira 1925", reading: "about 1925" },
      "Add",
    );
    await expect(parents).toBeHidden();
  });

  await test.step("her husband", async () => {
    await beside.getByRole("button", { name: "+ Spouse" }).click();
    const spouse = page.getByRole("dialog", { name: "Add a husband or wife of Aina binti Johari" });
    await expect(spouse.getByRole("combobox", { name: "Gender" })).toHaveText("Male");
    await add(
      page,
      spouse,
      { name: "Hafiz bin Kassim", born: "before 1950", reading: "before 1950" },
      "Add",
    );
    await expect(spouse).toBeHidden();
  });

  await test.step("their three children", async () => {
    await beside.getByRole("button", { name: "+ Child" }).click();
    const children = page.getByRole("dialog", { name: "Add a child of Aina binti Johari" });
    await expect(children.getByRole("combobox", { name: "Other parent" })).toHaveText(
      "Hafiz bin Kassim",
    );
    await add(
      page,
      children,
      { name: "Iman binti Hafiz", gender: "Female", born: "March 1975", reading: "March 1975" },
      "Add and add another",
    );
    await add(
      page,
      children,
      {
        name: "Adam bin Hafiz",
        gender: "Male",
        born: "1976–1978",
        reading: "between 1976 and 1978",
      },
      "Add and add another",
    );
    await expect(children.getByRole("combobox", { name: "Other parent" })).toHaveText(
      "Hafiz bin Kassim",
    );
    await add(
      page,
      children,
      { name: "Sarah binti Hafiz", gender: "Female", born: "1980", reading: "1980" },
      "Add",
    );
    await expect(children).toBeHidden();
  });

  await panel.getByRole("tab", { name: "Relatives (6)" }).click();
  await expect(panel.getByRole("button", { name: /^Johari bin Latif .*Father/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Hawa binti Omar .*Mother/ })).toBeVisible();
  await expect(panel.getByRole("button", { name: /^Hafiz bin Kassim .*Husband/ })).toBeVisible();
  for (const child of [/^Iman binti Hafiz .*Daughter/, /^Adam bin Hafiz .*Son/]) {
    await expect(panel.getByRole("button", { name: child })).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: /^Sarah binti Hafiz .*Daughter/ })).toBeVisible();
  await picture("added-family");
  expect(Date.now() - started, "the whole family added in under 2 minutes").toBeLessThan(120_000);

  // Each date kept as it was read.
  await panel.getByRole("button", { name: /^Adam bin Hafiz / }).click();
  await expect(panel.getByRole("heading", { name: "Adam bin Hafiz", level: 2 })).toBeVisible();
  await expect(panel.getByText("between 1976 and 1978", { exact: true })).toBeVisible();
});
