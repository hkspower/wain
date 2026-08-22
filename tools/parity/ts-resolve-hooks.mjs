// The resolve hook itself. See ts-resolve.mjs for why this exists.
//
// Only relative specifiers, and only when the file as written is not
// there — so nothing that already resolves changes behaviour, and a
// genuine missing import still fails as a missing import rather than
// being quietly redirected somewhere.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base);
    for (const ext of [".ts", ".mjs", ".js"]) {
      if (existsSync(path + ext)) {
        return next(pathToFileURL(path + ext).href, context);
      }
    }
  }
  return next(specifier, context);
}
