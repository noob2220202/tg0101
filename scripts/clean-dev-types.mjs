import { rmSync } from "node:fs";

/**
 * Removes `.next/dev`, the type artifacts the dev server generates.
 *
 * `tsconfig.json` includes `.next/dev/types/**` (Next adds it), and those files
 * name every route that existed when the dev server last ran. Delete a route
 * and the next production build fails type checking on a module that is gone:
 *
 *   .next/dev/types/validator.ts: error TS2307:
 *     Cannot find module '../../../src/app/login/page.js'
 *
 * `next build` writes to `.next` proper and never reads `.next/dev`, so
 * clearing it before a build is safe and leaves the build cache intact.
 */
rmSync(new URL("../.next/dev", import.meta.url), { recursive: true, force: true });
