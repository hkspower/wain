// The names the game offers, and the cleaning it does to the one typed.
//
//   npm run test:handles      (no browser, no dev server)
//
// A join form's whole job is to not be in the way, and the two ways this
// one could still be in the way are both checkable without a browser:
//
//   THE BUTTON MUST NEVER LIE   The enabled state and the join both go
//                               through cleanHandle. If cleaning can
//                               turn a non-empty box into an empty name,
//                               the button is live for a name that will
//                               be refused — which is worse than a dead
//                               button, because the player presses it
//                               and has no idea what happened.
//   A SUGGESTION MUST BE USABLE Every name the game offers has to fit
//                               the box, survive the cleaning unchanged,
//                               and not be somebody else's — a player
//                               handed a rival's name is being told a
//                               lie about who they are.

import { HANDLES, MAX_HANDLE, rollHandle, cleanHandle } from "../src/game/handles.ts";
import { RIVALS } from "../src/game/rivals.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- 1. Every suggestion is a usable name ----------------------------
{
  const seen = new Set();
  for (const h of HANDLES) {
    if (seen.has(h.en)) fail.push(`"${h.en}" is offered twice`);
    seen.add(h.en);
    check(h.en.length <= MAX_HANDLE, `"${h.en}" is ${h.en.length} chars — the box caps at ${MAX_HANDLE}`);
    // The one that matters: a suggestion the form's own cleaning would
    // alter is a name that changes under the player after they accepted
    // it.
    check(cleanHandle(h.en) === h.en, `"${h.en}" is not what cleanHandle makes of it ("${cleanHandle(h.en)}")`);
    check(/[؀-ۿ]/.test(h.ar), `"${h.en}" has no Arabic reading`);
    check(h.ar === h.ar.trim(), `"${h.en}": the Arabic has stray whitespace`);
    // Latin in the Arabic half means a part was never translated.
    check(!/[A-Za-z]/.test(h.ar), `"${h.en}": the Arabic side still has Latin in it — "${h.ar}"`);
  }
  console.log(`${HANDLES.length} handles, all distinct, all inside ${MAX_HANDLE} characters, all bilingual`);
}

// --- 2. Nobody is handed a rival's name ------------------------------
{
  const taken = new Set();
  for (const r of RIVALS) {
    taken.add(r.name.toLowerCase());
    taken.add(r.arabicName);
  }
  for (const h of HANDLES) {
    check(!taken.has(h.en.toLowerCase()), `"${h.en}" is a rival's name`);
    check(!taken.has(h.ar), `"${h.ar}" is a rival's Arabic name`);
  }
  console.log(`none of them collides with the ${RIVALS.length} rivals`);
}

// --- 3. The reroll actually rerolls ----------------------------------
//
// A button that can return what is already in the box looks broken: the
// player presses it, nothing moves, and the reasonable conclusion is
// that it does nothing.
{
  let same = 0;
  for (let i = 0; i < 400; i++) {
    const first = rollHandle();
    const second = rollHandle(first.en);
    if (second.en === first.en) same++;
  }
  check(same === 0, `the reroll returned the name it was told to avoid ${same} times in 400`);
  // ...and it must actually reach the whole list, not orbit three names.
  const hit = new Set();
  for (let i = 0; i < 4000; i++) hit.add(rollHandle().en);
  check(
    hit.size === HANDLES.length,
    `rolling 4000 times only ever produced ${hit.size} of the ${HANDLES.length} handles`
  );
  console.log(`the reroll never repeats, and reaches all ${hit.size} of them`);
}

// --- 4. Cleaning: what the button promises is what the join sends ----
{
  const cases = [
    ["  Bu Turbo  ", "Bu Turbo", "outer whitespace"],
    ["Bu   Turbo", "Bu Turbo", "a run of spaces inside"],
    ["\tBu Turbo\r\n", "Bu Turbo", "tabs and newlines"],
    ["", "", "an empty box"],
    ["     ", "", "a box holding only spaces"],
    ["أبو تيربو", "أبو تيربو", "an Arabic name, untouched"],
    // Written as escapes rather than pasted: a test file carrying
    // literal control characters is a file nobody can review.
    ["Bu\u0007 Turbo", "Bu Turbo", "a bell character in the middle"],
    ["Bu\u0000Turbo", "BuTurbo", "a NUL in the middle"],
  ];
  for (const [raw, want, what] of cases) {
    const got = cleanHandle(raw);
    check(
      got === want,
      `${what}: cleanHandle(${JSON.stringify(raw)}) gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`
    );
  }
  // The length cap is the hub's, and the hub truncates silently — so the
  // form has to do it first, where the player can watch it happen.
  const long = "B".repeat(MAX_HANDLE + 20);
  check(
    cleanHandle(long).length === MAX_HANDLE,
    `a ${long.length}-character name cleaned to ${cleanHandle(long).length}`
  );

  // The property that makes the button honest: cleaning settles after
  // one pass, so what the disabled check saw is what the join sends.
  for (const h of HANDLES) {
    check(
      cleanHandle(cleanHandle(h.en)) === cleanHandle(h.en),
      `cleaning "${h.en}" twice differs from cleaning it once`
    );
  }
  console.log("cleaning is idempotent, keeps Arabic, and caps at the hub's own limit");
}

// --- 5. The server would accept what the form sends ------------------
//
// The hub caps names at MAX_NAME. If the form let a longer one through,
// the name on the leaderboard would silently stop being the name the
// player chose, and nothing anywhere would say so.
{
  const { readFileSync } = await import("node:fs");
  const server = readFileSync("server/hub-server.mjs", "utf8");
  const m = server.match(/const MAX_NAME = (\d+)/);
  check(!!m, "could not find MAX_NAME in the hub server");
  if (m) {
    const serverMax = Number(m[1]);
    check(
      MAX_HANDLE <= serverMax,
      `the form allows ${MAX_HANDLE} characters and the hub cuts at ${serverMax} — names would be silently shortened`
    );
    console.log(`the form caps at ${MAX_HANDLE}, the hub at ${serverMax}`);
  }
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthe form arrives with a name, and it is one the hub will take"
);
process.exit(fail.length ? 1 : 0);
