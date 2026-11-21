/**
 * The journeys: the app's main journeys in a browser, on the example family in an engine
 * of their own, at 800 × 600 and 1366 × 768. From frontend/:
 *
 *   pnpm run journeys            build the pages, then run them
 *   pnpm run journeys:pictures   the same, taking the pictures again, after a change on purpose
 *
 * On Windows they drive the Google Chrome installed, headless, in a profile of Playwright's own,
 * and compare each picture with the one kept in journeys/pictures. Elsewhere, as in CI on the Mac
 * and Linux, they drive Playwright's Chromium, and compare no pictures: each system draws text
 * its own way.
 */

import { defineConfig } from "@playwright/test";
import type { Options } from "./journeys/fixtures";

const WINDOWS = process.platform === "win32";
const CI = Boolean(process.env.CI);
// A busy computer, as journeys/fixtures.ts makes it: the time limits as many times longer.
const SLOW = Math.max(1, Number(process.env.ANCESTREE_JOURNEYS_SLOW) || 1);

export default defineConfig<Options>({
  testDir: "journeys",
  testMatch: /\.spec\.ts$/,
  globalSetup: "./journeys/setup.ts",
  // One engine and its family: one journey at a time, each starting from the family fresh.
  workers: 1,
  fullyParallel: false,
  forbidOnly: CI,
  retries: 0,
  timeout: 90_000 * SLOW,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  snapshotPathTemplate: "{testDir}/pictures/{arg}{ext}",
  ignoreSnapshots: !WINDOWS,
  expect: {
    timeout: 10_000 * SLOW,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      stylePath: "./journeys/pictures.css",
    },
  },
  use: {
    channel: WINDOWS ? "chrome" : undefined,
    headless: true,
    locale: "en-GB",
    timezoneId: "Asia/Kuala_Lumpur",
    colorScheme: "light",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // A new install, then Look around first: once, its pictures at both sizes.
    {
      name: "start",
      testMatch: /start\.spec\.ts$/,
      use: { viewport: { width: 1366, height: 768 }, example: false },
    },
    {
      name: "1366x768",
      testIgnore: /start\.spec\.ts$/,
      dependencies: ["start"],
      use: { viewport: { width: 1366, height: 768 } },
    },
    {
      name: "800x600",
      testIgnore: /start\.spec\.ts$/,
      dependencies: ["start"],
      use: { viewport: { width: 800, height: 600 } },
    },
  ],
});
