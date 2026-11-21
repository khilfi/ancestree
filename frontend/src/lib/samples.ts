/**
 * How many made-up people `?sample=` asks for on the timeline or the map: one of the
 * test pages, with `/sample` and `/sample/families` (`app/routes.tsx`), only in a development
 * build, Vite's own (`pnpm dev`), never in a release. `vite build` writes `DEV` as
 * false, so a release reads no `?sample=`: 0, the family's own.
 */
export function sampleSize(params: URLSearchParams): number {
  if (!import.meta.env.DEV) return 0;
  return Math.min(5000, Math.max(0, Number(params.get("sample")) || 0));
}
