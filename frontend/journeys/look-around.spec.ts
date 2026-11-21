import { expect, findPerson, fromTopBar, test } from "./fixtures";

test("look around: the tree, someone found, their relatives, the family's facts and what's missing", async ({
  page,
  picture,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/tree$/);
  await expect(page.getByRole("status").filter({ hasText: "the example family" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  await picture("tree");

  const panel = await findPerson(page, "Rokiah binti Salleh");
  await expect(panel.getByText("1944–2016 · died aged about 72")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Your great-uncle's wife" })).toBeVisible();
  await picture("person");

  await panel.getByRole("tab", { name: "Relatives (4)" }).click();
  await expect(panel.getByRole("button", { name: /^Yusof bin Ismail .*Husband/ })).toBeVisible();
  await picture("relatives");

  // From one relative to the next.
  await panel.getByRole("button", { name: /^Azman bin Yusof .*Son/ }).click();
  await expect(panel.getByRole("heading", { name: "Azman bin Yusof" })).toBeVisible();
  await panel.getByRole("button", { name: "Close the panel" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/\/tree$/);

  // Family facts, from its ⓘ beside the family's name, and What's missing its second tab.
  await fromTopBar(page, "Family facts");
  const facts = page.getByRole("complementary", { name: "Family facts" });
  await expect(facts.getByText("64 people")).toBeVisible();
  await expect(facts.getByText("Oldest recorded")).toBeVisible();
  await picture("family-facts");
  await facts.getByRole("tab", { name: "What's missing" }).click();
  await expect(facts.getByRole("heading", { name: "Not linked to anyone" })).toBeVisible();
  await picture("family-facts-missing");
  await facts.getByRole("button", { name: "Close Family facts" }).click();
  await expect(facts).toBeHidden();
});
