/**
 * Zod, set for the pages' policy (0.4.1, platform guide 12.6): the engine's pages may run no
 * code made from text, so Zod checks forms without compiling code of its own, and never tries
 * to, which the policy would report as blocked. Import `z` from here, never from "zod" itself.
 */
import { z } from "zod";

z.config({ jitless: true });

export { z };
