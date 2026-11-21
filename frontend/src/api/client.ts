import createClient from "openapi-fetch";
import { reach } from "./errors";
import type { paths } from "./schema";

/** Typed client for the backend. `schema.d.ts` is generated: run `pnpm gen:api`. Requests go
 *  through whatever `fetch` is at the time, so a view-only copy can answer them itself;
 *  one that never reaches the engine says so in words. */
export const api = createClient<paths>({
  baseUrl: "",
  fetch: (request: Request) => reach(request),
});
