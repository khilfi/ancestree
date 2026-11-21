import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, fromTopBar, test } from "./fixtures";

/** A file saved in this run's Downloads, as the engine said. */
function saved(name: string): boolean {
  return existsSync(join(process.env.JOURNEYS_RUN ?? "", "Downloads", name));
}

test("Settings, part by part", async ({ page, picture }) => {
  await page.goto("/tree");
  await fromTopBar(page, "Settings");
  await expect(page).toHaveURL(/\/settings\/kinship$/);
  const parts = page.getByRole("navigation", { name: "Settings" });
  const main = page.getByRole("main");
  // The Malay titles alone: the language is set where the words are seen.
  await expect(main.getByRole("heading", { name: "Malay birth-order titles" })).toBeVisible();
  await expect(main.getByRole("radio")).toHaveCount(0);
  await picture("settings-kinship");

  // The families and the family folder: Me is in its own menu.
  await parts.getByRole("link", { name: "You and your family" }).click();
  await expect(page).toHaveURL(/\/settings\/family$/);
  await expect(main.getByRole("heading", { name: "Family folder" })).toBeVisible();
  await expect(main.getByRole("heading", { name: "Me", exact: true })).toHaveCount(0);
  await picture("settings-family");

  // What's missing is Family facts', and Help a link to the guide.
  await expect(parts.getByRole("link", { name: "What's missing" })).toHaveCount(0);
  await expect(parts.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/guide");

  // Backups come and go with the clock: one is made a minute after the engine starts, and one
  // each time a journey's changes are taken back. Their folder is this run's, which names the
  // computer's user, and is as long as its path. Neither goes in the picture: both are hidden
  // while it's taken, the rows checked by their headings instead.
  await parts.getByRole("link", { name: "Backups" }).click();
  await expect(page).toHaveURL(/\/settings\/backups$/);
  await expect(main.getByRole("button", { name: "Back up now" })).toBeVisible();
  await expect(main.getByRole("columnheader", { name: "Made" })).toBeVisible();
  await expect(main.getByRole("row", { name: /ancestree-backup-.*\.zip/ }).first()).toBeVisible();
  const hidden = await page.addStyleTag({
    content: "main p:has(> code) code, main table tbody { display: none; }",
  });
  await picture("settings-backups");
  await hidden.evaluate((style) => style.parentNode?.removeChild(style));

  await parts.getByRole("link", { name: "Trash" }).click();
  await expect(page).toHaveURL(/\/settings\/trash$/);
  await picture("settings-trash");
});

test("Export: a view-only copy, and a picture of the tree", async ({ page, picture }) => {
  test.setTimeout(180_000);
  await page.goto("/tree");
  await expect(page.getByRole("img", { name: "Hassan bin Ismail" })).toBeVisible();
  // Export's two, in More where the bar has no room for Export itself.
  const more = page.getByRole("banner").getByRole("button", { name: /^More/ });
  await more.click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText([
    "View-only copy…",
    "Picture of the tree",
    "Dictionary",
    "Guide",
    /^Settings/,
  ]);
  await picture("export");

  await menu.getByRole("menuitem", { name: "View-only copy…" }).click();
  const copying = page.getByRole("dialog", { name: "Make a view-only copy" });
  await expect(copying).toBeVisible();
  await picture("export-copy");
  await copying.getByRole("button", { name: "Make the copy" }).click();
  // The copy's app is built first if the pages changed since it last was: up to a minute.
  const note = page.getByText(/^Saved to Downloads: ancestree-.*\.html$/);
  await expect(note).toBeVisible({ timeout: 90_000 });
  const copy = (await note.textContent())?.replace("Saved to Downloads: ", "") ?? "";
  expect(saved(copy), `${copy} in Downloads`).toBe(true);

  await more.click();
  await page.getByRole("menuitem", { name: "Picture of the tree" }).click();
  await page.getByRole("menuitem", { name: /^PNG/ }).click();
  const drawn = page.getByText(/^Saved to Downloads: .*\.png$/);
  await expect(drawn).toBeVisible({ timeout: 30_000 });
  const png = (await drawn.textContent())?.replace("Saved to Downloads: ", "") ?? "";
  expect(saved(png), `${png} in Downloads`).toBe(true);
});
