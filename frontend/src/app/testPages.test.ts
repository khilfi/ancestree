/**
 * The test pages, `/sample`, `/sample/families` and `?sample=` on the timeline and
 * the map, only in a development build, Vite's own: never in a release. `vite build`
 * writes `import.meta.env.DEV` as false, which these tests stand in for; the journeys see the
 * release itself (`journeys/views.spec.ts`), and the engine's own test pages go the same way
 * (`backend/tests/unit/test_sample_pages.py`).
 */
import type { RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The app's pages, as a build with `DEV` so would have them. */
async function pages(dev: boolean): Promise<string[]> {
  vi.stubEnv("DEV", dev);
  vi.resetModules();
  const { appRoutes } = await import("./routes");
  const paths = (routes: RouteObject[] = [], at = ""): string[] =>
    routes.flatMap((route) => {
      const path = route.path ? `${at}/${route.path}`.replace("//", "/") : at;
      return [path, ...paths(route.children, path)];
    });
  return paths(appRoutes);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the test pages", () => {
  it("aren't in a release", { timeout: 60_000 }, async () => {
    const release = await pages(false);
    expect(release.filter((path) => path.includes("sample"))).toEqual([]);
    expect(release).toContain("/tree");
    const { sampleSize } = await import("@/lib/samples");
    expect(sampleSize(new URLSearchParams("sample=2000"))).toBe(0);
  });

  it("are in a development build", { timeout: 60_000 }, async () => {
    expect(await pages(true)).toEqual(expect.arrayContaining(["/sample", "/sample/families"]));
    const { sampleSize } = await import("@/lib/samples");
    expect(sampleSize(new URLSearchParams("sample=2000"))).toBe(2000);
    expect(sampleSize(new URLSearchParams("sample=99999"))).toBe(5000);
    expect(sampleSize(new URLSearchParams())).toBe(0);
  });
});
