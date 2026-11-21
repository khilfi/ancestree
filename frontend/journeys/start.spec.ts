import { exampleOpened, expect, test } from "./fixtures";

const SIZES = [
  { width: 1366, height: 768 },
  { width: 800, height: 600 },
];

test("a new install, then Look around first opens the example family", async ({
  page,
  picture,
  request,
}) => {
  await page.goto("/");
  const welcome = page.getByRole("status").filter({ hasText: "Welcome to AncesTree" });
  await expect(welcome).toBeVisible();
  await expect(page.getByText("No one here yet.")).toBeVisible();
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await picture("new-install");
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  await welcome.getByRole("button", { name: "Look around first" }).click();
  await expect(page.getByText("Opening Keluarga Contoh…")).toBeVisible();
  // The app starts again on the example family, which fills itself as it first opens; the
  // desktop app's window then loads it afresh, as this does.
  await exampleOpened(request);
  await page.goto("/");
  await expect(page.getByRole("status").filter({ hasText: "the example family" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Family: Keluarga Contoh/ })).toBeVisible();
  await expect(page.getByText("Welcome to AncesTree")).toBeHidden();
});
