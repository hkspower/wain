// The resolve hook itself. See ts-resolve.mjs for why this exists.
//
// Only relative specifiers, and only when the file as written is not
// there — so nothing that already resolves changes behaviour, and a
// genuine missing import still fails as a missing import rather than
// being quietly redirected somewhere.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// tsconfig's `@/*` → `src/*`, the one alias the game uses. The bundler
// honours it, so src/game/api.ts imports `@/lib/gameSite` — and from the
// day it did, every test that reached api.ts died here with "Cannot find
// package '@/lib'": Node treats `@/lib` as a scoped npm package. Rooted
// on this file's own location rather than the working directory, so a
// test run from anywhere maps to the same src/.
const SRC = new URL("../../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  const aliased = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : null;
  const relative = specifier.startsWith(".") && context.parentURL;
  if ((aliased || relative) && !/\.[a-z]+$/i.test(specifier)) {
    const base = aliased ? new URL(aliased) : new URL(specifier, context.parentURL);
    const path = fileURLToPath(base);
    for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
      if (existsSync(path + ext)) {
        return next(pathToFileURL(path + ext).href, context);
      }
    }
  }
  return next(aliased ?? specifier, context);
}
