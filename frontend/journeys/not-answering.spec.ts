import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Rokiah's own details, and nothing else of hers or anyone's: what her panel and her form ask
 *  for. */
async function rokiah(page: Page): Promise<RegExp> {
  const found = await page.request.get("/api/persons", {
    params: { q: "Rokiah binti Salleh", limit: 1 },
  });
  const [her] = (await found.json()) as { id: string }[];
  if (!her) throw new Error("Rokiah isn't in the example family");
  return new RegExp(`/api/persons/${her.id}$`);
}

/** The engine stops answering, for the requests that match, as when it has stopped: each is
 *  refused as a connection is when nothing is there. */
async function notAnswering(page: Page, url: RegExp, method?: string): Promise<void> {
  await page.route(url, (route) =>
    method && route.request().method() !== method
      ? route.fallback()
      : route.abort("connectionrefused"),
  );
}

/** Someone chosen in Search people, as findPerson does, without waiting for their panel. */
async function choose(page: Page, fullName: string): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Search people" }).click();
  const search = page.getByRole("dialog", { name: "Search people" });
  await search.getByPlaceholder("Name or nickname…").fill(fullName);
  await search.getByRole("option", { name: new RegExp(`^${fullName} `) }).click();
  // The pointer out of the way, as findPerson moves it: someone on the tree under where the list
  // was would show their card.
  await page.mouse.move(1, 1);
}

// The engine not answering, said in words with Try again, never "Failed to fetch".
test("someone's panel while the engine isn't answering: words, and Try again", async ({
  page,
  picture,
}) => {
  await page.goto("/tree");
  const details = await rokiah(page);
  await notAnswering(page, details);
  await choose(page, "Rokiah binti Salleh");
  const panel = page.getByRole("complementary", { name: "Person" });
  await expect(panel.getByText("AncesTree's engine isn't answering.")).toBeVisible();
  await expect(panel.getByText("Failed to fetch")).toBeHidden();
  await picture("not-answering");

  await page.unroute(details);
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByRole("heading", { name: "Rokiah binti Salleh", level: 2 })).toBeVisible();
});

test("a save while the engine isn't answering: words, and Try again saves it", async ({ page }) => {
  await page.goto("/tree");
  await choose(page, "Rokiah binti Salleh");
  const panel = page.getByRole("complementary", { name: "Person" });
  await panel.getByRole("button", { name: "Edit" }).click();
  await panel.getByRole("textbox", { name: "Occupation" }).fill("Guru");
  const details = await rokiah(page);
  await notAnswering(page, details, "PUT");
  await panel.getByRole("button", { name: "Save" }).click();

  const note = page
    .getByRole("listitem")
    .filter({ hasText: "AncesTree's engine isn't answering." });
  await expect(note).toBeVisible();
  // Still the form, as typed: nothing lost.
  await expect(panel.getByRole("textbox", { name: "Occupation" })).toHaveValue("Guru");

  await page.unroute(details);
  await note.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(panel.getByText("Guru")).toBeVisible();
});
