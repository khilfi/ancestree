/**
 * The guide's pictures, taken again: every picture of the app in public/guide/, of the
 * example family, in the journeys' engine and their page set-up, in the Google Chrome installed,
 * headless, in a profile of Playwright's own. From frontend/:
 *
 *   pnpm run guide:pictures                       build the pages, then take every picture
 *   pnpm run guide:pictures -g "app-map$"         one picture, by its name
 *
 * It needs, as the journeys do, ANCESTREE_NEO4J_RUNTIME (the Neo4j fetched for the tests); and
 * ANCESTREE_GUIDE_MAPS, a folder holding the world's map pack and places (setup.ts), which it
 * never fetches. Apart from the journeys and from check.ps1: their config takes only *.spec.ts.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /\.walk\.ts$/,
  globalSetup: "./setup.ts",
  // One engine and its family: one picture at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 180_000,
  reporter: [["list"]],
  outputDir: "../../test-results/guide",
  expect: { timeout: 10_000 },
  use: {
    channel: "chrome",
    headless: true,
    locale: "en-GB",
    timezoneId: "Asia/Kuala_Lumpur",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
  },
});
