// Let Node import the game's TypeScript the way the bundler does.
//
// `node --experimental-strip-types` will happily run a .ts file, but it
// resolves imports the way ESM does: `./handling` is a path, not a hint,
// and there is no file called that. Every module in src/game imports its
// neighbours without an extension because that is what tsconfig and the
// bundler expect, so a test importing one of them dies on the first
// relative import.
//
// This is the whole fix: when a relative specifier does not exist as
// written, try it with `.ts` on the end. Registered with
//   node --experimental-strip-types --import ./tools/parity/ts-resolve.mjs
// which is what `npm run test:parity` does.
//
// A loader hook rather than a build step on purpose: the point of the
// parity test is to run the code the WEB BUILD SHIPS against the code
// Unreal compiles. Anything that transforms one of them first is a third
// artifact, and a third artifact is a third thing that can be wrong.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-resolve-hooks.mjs", pathToFileURL("./tools/parity/"));
