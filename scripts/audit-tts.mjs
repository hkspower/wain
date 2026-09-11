#!/usr/bin/env node
/**
 * Does the live bridge speak in the same voice as the recorded clips?
 *   npm run audit:tts
 *
 * It did not, and nothing said so.
 *
 * صوت وين plays pre-rendered clips for every sentence that could be written
 * down in advance, and sends the rest — the ones assembled at runtime — to a
 * bridge that renders them on demand. resolveClips() is all-or-nothing per
 * utterance, so a visitor hears both paths in one session and often inside one
 * answer. Any difference between them is heard as the speaker changing
 * mid-sentence, which is far more noticeable than either voice on its own.
 *
 * The bridge used to be an n8n workflow on an instance shared with another
 * project. Nothing in `npm run scan` could see it — it is not in this
 * repository — and it drifted: its شوق voice id had become
 * w0uhBAmNIG5kUDeaFEsA (Maryam Essa) while the repository and the live agent
 * were both on rh16DBXwtscjdPFeMBYf (Talya). Every other field matched. The
 * voice id is the hardest one to catch precisely because nothing breaks: the
 * bridge answers 200 with perfectly good audio of the wrong woman.
 *
 * The bridge is `scripts/publish/tts-endpoint.php` now, which means the two
 * tables are both in this repository and this check is possible at all.
 *
 * ## Why it shells out to both instead of parsing either
 *
 * A regex over the sources would pass the day it was written. Each side is
 * asked for its own values BY ITS OWN INTERPRETER — `gen-voice.mjs
 * --rendition` and `php tts-endpoint.php table` — so renaming a constant,
 * reformatting the object, or moving a value behind an environment variable
 * all still produce the truth rather than a false green.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "scripts/publish/tts-endpoint.php";

let errors = 0;
let notes = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);
const note = (m) => { notes++; console.log(`  · ${m}`); };

console.log("\n── does the live bridge match the recorded clips? ──");

const read = (cmd, args) => {
  try {
    return JSON.parse(execFileSync(cmd, args, {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000,
    }));
  } catch (e) {
    return { __error: e.message };
  }
};

const clips = read("node", ["scripts/gen-voice.mjs", "--rendition"]);
if (clips.__error) {
  fail("could not ask gen-voice.mjs for its voice table", clips.__error);
  console.log(`\n${errors} errors, ${notes} notes`);
  process.exit(1);
}

const bridge = read("php", [ENDPOINT, "table"]);
if (bridge.__error) {
  /* PHP is not a build dependency of this site — it is the host's, and
     `test:api` already needs it. A machine without it must not be able to turn
     this check red, because a red check people cannot run is a check people
     stop reading. It says loudly that it did not run. */
  note(`php is not available here, so the bridge's table was NOT compared (${ENDPOINT})`);
  console.log(`\n${errors} errors, ${notes} notes`);
  process.exit(0);
}

/* Compared field by field rather than by stringifying both, so a mismatch says
   WHICH field — «shouq.settings.stability 0.35 vs 0.5» is a fix; «the objects
   differ» is a hunt. */
const walk = (a, b, path = "") => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const here = path ? `${path}.${k}` : k;
    const x = a?.[k];
    const y = b?.[k];
    if (x !== null && typeof x === "object" && y !== null && typeof y === "object") {
      walk(x, y, here);
    } else if (x !== y) {
      fail(`${here} differs`, `gen-voice.mjs: ${JSON.stringify(x)}   bridge: ${JSON.stringify(y)}`);
    }
  }
};

walk(clips, bridge);

if (errors === 0) {
  const names = Object.keys(clips.voices).join(", ");
  ok(`${ENDPOINT} renders ${names} with the same voices, settings, model and format as the clips`);
  ok(`${clips.model} · ${clips.format}`);
} else {
  console.log("\n    A clip and a live sentence are heard back to back inside ONE answer.");
  console.log("    Whichever of the two is right, fix the other — do not pick by which");
  console.log("    file was edited more recently.");
}

console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
