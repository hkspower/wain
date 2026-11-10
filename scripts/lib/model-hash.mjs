// build.json's `hash` for one model file: the first 16 hex digits of its
// SHA-256. tools/blender/build_assets.py (file_hash) writes the same sum.
//
// The game fingerprints build.json and puts the result in every model's
// URL (src/game/models.ts), and the files are served immutable for a
// year. So build.json has to change whenever a file's bytes do, and a
// triangle count and a size do not guarantee that: a shell can be re-cut
// to the same count and the same size, byte for byte different. Anything
// that rewrites a file in public/models writes this beside it, and
// tests/rigsync.mjs checks every entry against the file on disk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const modelHash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);
