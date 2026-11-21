import { expect, test } from "./fixtures";

/*
 * The test pages aren't in a release: the journeys see the pages as
 * `vite build` makes them, as every release is built. `/sample` and `/sample/families` are no
 * page of the app's, `?sample=` on the timeline and the map is read as nothing, and no page asks
 * for the made-up families. (The engine here is run from the code, which has them; a packed
 * engine's app hasn't: `backend/tests/unit/test_sample_pages.py`.)
 */

test("the test pages aren't in the app", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "1366x768", "the same pages at any size");
  const asked: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/sample")) asked.push(request.url());
  });

  for (const address of ["/sample", "/sample/families?people=50"]) {
    await page.goto(address);
    await expect(page.getByText("404 Not Found")).toBeVisible();
    await expect(page.getByText("A made-up family of")).toHaveCount(0);
  }

  await page.goto("/timeline?sample=50");
  await expect(
    page.getByRole("button", { name: "Hassan bin Ismail “Acan”, 1938–2011" }),
  ).toBeVisible();
  await page.goto("/map?sample=50");
  await expect(page.getByText("64 of 64 on the map")).toBeVisible();
  expect(asked).toEqual([]);
});
