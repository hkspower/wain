// The one reader of src/game/rig.ts as data.
//
// The rig is a plain object literal that carries expressions —
// `Math.PI * 0.72` says ten-to-two far better than 2.26194671 does — so
// it is evaluated rather than regexed. Two exporters (the Blender
// profiles and the UE5 header) each carried this verbatim, and a test
// could import neither because both write files at top level. One
// reader, importable by anything, and a guard (tests/rigsync.mjs) that
// the copies downstream of it are current.
import { readFileSync } from "node:fs";

export function readRig(path = "src/game/rig.ts") {
  const src = readFileSync(path, "utf8");
  const body = src.match(/export const RIG = (\{[\s\S]*?\n\}) as const;/)?.[1];
  if (!body) throw new Error("rig parse failed: no `export const RIG = {...} as const;`");
  return new Function(`"use strict"; return ${body};`)();
}
