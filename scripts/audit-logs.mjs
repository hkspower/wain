#!/usr/bin/env node
/**
 * Do the two bridges keep the same log, and keep the same promises about it?
 *   npm run audit:logs
 *
 * `/api/tts.php` and `/api/media.php` each carry their own copy of the logging
 * code, and that duplication is deliberate: each file has to stay
 * copy-installable on its own, fetched from a raw URL and run, with no include
 * path between them. The rate counter is already duplicated for the same
 * reason and says so.
 *
 * Duplication without a check is drift with a delay. The n8n voice bridge is
 * the worked example this repository keeps: its شوق voice id had become a
 * different woman entirely, every other field matched, and nothing broke —
 * because nothing compared the two tables. A log is the same shape of risk
 * with a worse failure: one endpoint quietly rotating at a different size, or
 * writing a field the other promises never to write, and nobody reading either
 * until the day they need to.
 *
 * ## Why it shells out to both rather than reading either
 *
 * Each endpoint is asked for its own `logformat` BY PHP, so a renamed
 * constant, a reformatted array or a value moved behind a function still
 * produces the truth. A regex over the source would pass the day it was
 * written — the argument `audit:tts` makes about the voice tables, applied to
 * the thing that records what the voices cost.
 *
 * ## What it cannot check
 *
 * That the promises are KEPT. `never: [request text, raw ip, …]` is a claim
 * this audit only checks both files make identically; `test:tts` and
 * `test:media` are what drive real requests through a real PHP server and read
 * the resulting file back to prove the sentence and the address are not in it.
 * A promise and its enforcement are two different checks and both exist.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let errors = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const ENDPOINTS = {
  tts: "scripts/publish/tts-endpoint.php",
  media: "scripts/publish/media-endpoint.php",
};

/** The one field that is allowed to differ: each log is named for its app. */
const PER_APP = new Set(["name"]);

console.log("\n── both bridges describe the same log ──");

const formats = {};
for (const [app, file] of Object.entries(ENDPOINTS)) {
  try {
    formats[app] = JSON.parse(
      execFileSync("php", [join(ROOT, file), "logformat"], { encoding: "utf8" })
    );
  } catch (e) {
    fail(`${app}: \`php ${file} logformat\` did not answer`, String(e.message).split("\n")[0]);
  }
}

if (Object.keys(formats).length === 2) {
  const [a, b] = Object.keys(formats);
  const keys = [...new Set([...Object.keys(formats[a]), ...Object.keys(formats[b])])].sort();
  let same = 0;
  for (const k of keys) {
    if (PER_APP.has(k)) continue;
    const av = JSON.stringify(formats[a][k]);
    const bv = JSON.stringify(formats[b][k]);
    if (av === bv) { same++; continue; }
    fail(`${k} differs between the two bridges`, `${a}: ${av}\n      ${b}: ${bv}`);
  }
  if (same && errors === 0) ok(`${same} shared field(s) agree — ${a} and ${b} keep one log format`);

  // Named for its app, or two installs would append to one file and a reader
  // could not tell whose line is whose.
  if (formats[a].name === formats[b].name) {
    fail("both logs have the same filename", formats[a].name);
  } else {
    ok(`each is named for its app (${formats[a].name}, ${formats[b].name})`);
  }

  /* The cap is the whole reason the log is safe to leave running on shared
     hosting, and it is the easiest number to raise «just for now». */
  const total = (formats[a].maxBytes ?? 0) * (1 + (formats[a].keep ?? 0));
  const CEILING = 1024 * 1024;
  if (total > CEILING) {
    fail(
      `one app's log can reach ${(total / 1024).toFixed(0)}K, over the ${CEILING / 1024}K ceiling`,
      "storage/ is the one directory deploy.php never prunes, so this is the only bound there is"
    );
  } else {
    ok(`bounded at ${(total / 1024).toFixed(0)}K per app, for ever (${formats[a].keep} rotation)`);
  }

  /* The four things a log on this account must never carry. Stated in the
     endpoints so the file that writes the line is the file that promises. */
  const MUST_REFUSE = ["request text", "raw ip", "file names", "api key"];
  const never = new Set(formats[a].never ?? []);
  const missing = MUST_REFUSE.filter((x) => !never.has(x));
  if (missing.length) fail(`the promise list dropped: ${missing.join(", ")}`);
  else ok(`both refuse ${MUST_REFUSE.length} kinds of content by declaration`);
}

console.log(`\n${errors} error${errors === 1 ? "" : "s"}\n`);
process.exit(errors ? 1 : 0);
