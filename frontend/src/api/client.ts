import createClient from "openapi-fetch";
import type { paths } from "./schema";

/** Typed client for the backend. `schema.d.ts` is generated: run `pnpm gen:api`. Requests go
 *  through whatever `fetch` is at the time, so a view-only copy can answer them itself. */
export const api = createClient<paths>({
  baseUrl: "",
  fetch: (request: Request) => globalThis.fetch(request),
});
