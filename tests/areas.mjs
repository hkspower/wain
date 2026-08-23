// The area guide, walked round the whole lap.
//
//   npm run test:areas      (no browser, no dev server)
//
// The guide used to be a label: it named the district you were already
// in and stopped. A driver can see where they are out of the window —
// what a roadside sign is for is the road, the next place, and how far.
//
// So this walks the lap metre by metre and checks the guide at every
// point, rather than spot-checking three positions and trusting the
// table. The failures worth catching are all continuity failures, and
// they only appear if you actually walk it:
//
//   a district that never shows, because the one before it ends after
//   it does; a distance that counts UP as you approach; a boundary the
//   two lookups disagree about; a wrap that reports the lap length as
//   the distance to the next district when you are a metre from it.

import { readFileSync } from "node:fs";
import { Track } from "../src/game/track.ts";
import { AREAS, areaAt, nextAreaAt, roadAt, LOVE_STREET } from "../src/game/world.ts";
import { COAST_END_M } from "../src/game/track.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const track = new Track();
const L = track.length;
const STEP = 1;

console.log(`lap          ${L.toFixed(0)} m, ${AREAS.length} districts`);

// --- 1. Every district shows, and for a drivable span ----------------
const seen = new Map();
for (let s = 0; s < L; s += STEP) {
  const a = areaAt(track, s);
  seen.set(a.name, (seen.get(a.name) ?? 0) + STEP);
}
console.log("");
for (const a of AREAS) {
  const span = seen.get(a.name) ?? 0;
  console.log(
    `  ${a.name.padEnd(20)} ${String(span).padStart(5)} m  ${a.arabic}` +
    (span === 0 ? "   <-- never shown" : "")
  );
}
check(seen.size === AREAS.length, `${AREAS.length - seen.size} district(s) never appear on the lap`);
// A district a player passes through in under a second at speed is a
// flicker rather than a place.
for (const [name, span] of seen) {
  check(span >= 60, `${name} is only ${span} m long — it flickers past rather than reading as a district`);
}

// --- 2. The distance to the next district always counts DOWN ---------
//
// The one property that makes a distance readout trustworthy. It has to
// fall as you drive, and reset upward only at the moment the district
// actually changes.
let rises = 0;
let worstRise = null;
let prev = nextAreaAt(track, 0);
for (let s = STEP; s < L; s += STEP) {
  const now = nextAreaAt(track, s);
  if (now.area.name === prev.area.name && now.metres > prev.metres + 1e-6) {
    rises++;
    if (!worstRise) worstRise = { s, from: prev.metres, to: now.metres, area: now.area.name };
  }
  prev = now;
}
console.log(
  `\ncountdown    ${rises} place(s) where the distance to the next district rose while it stayed the same`
);
check(
  rises === 0,
  worstRise
    ? `at ${worstRise.s} m the distance to ${worstRise.area} went from ${worstRise.from.toFixed(0)} up to ${worstRise.to.toFixed(0)}`
    : "the countdown runs backwards"
);

// --- 3. The two lookups agree about where a boundary is --------------
//
// nextAreaAt says a district is N metres away; N metres later, areaAt
// has to actually be showing it. If those disagree the guide points at
// a place that never arrives.
let disagreements = 0;
let firstBad = null;
for (let s = 0; s < L; s += 7) {
  const n = nextAreaAt(track, s);
  // Step just past the boundary it is pointing at.
  const at = areaAt(track, track.wrap(s + n.metres + 2));
  if (at.name !== n.area.name) {
    disagreements++;
    if (!firstBad) firstBad = { s, promised: n.area.name, got: at.name, m: n.metres };
  }
}
console.log(
  `boundaries   ${disagreements} place(s) where the promised next district is not what arrives`
);
check(
  disagreements === 0,
  firstBad
    ? `at ${firstBad.s} m the guide promised ${firstBad.promised} in ${firstBad.m.toFixed(0)} m and ${firstBad.got} arrived`
    : "the guide points at districts that never arrive"
);

// --- 4. The road is named, and the nickname is where it belongs ------
const roads = new Map();
for (let s = 0; s < L; s += STEP) {
  const r = roadAt(track, s);
  roads.set(r.name, (roads.get(r.name) ?? 0) + STEP);
}
console.log("");
for (const [name, span] of roads) console.log(`  ${name.padEnd(20)} ${String(span).padStart(5)} m`);
check(roads.size >= 2, "the lap is not made of at least two named roads");

// The coast leg has to actually be the coast leg.
const midCoast = roadAt(track, COAST_END_M / 2);
const midRing = roadAt(track, (COAST_END_M + L) / 2);
console.log(
  `\nat ${Math.round(COAST_END_M / 2)} m  ${midCoast.name}` +
  `      at ${Math.round((COAST_END_M + L) / 2)} m  ${midRing.name}`
);
check(midCoast.name !== midRing.name, "both legs of the lap report the same road name");
// ...and the nickname only on its own stretch. A nickname is a nickname
// precisely because it is not the road's name, so it must not leak.
const inLove = roadAt(track, (LOVE_STREET.from + LOVE_STREET.to) / 2);
const outLove = roadAt(track, LOVE_STREET.from - 50);
console.log(`\nnickname     "${inLove.nick}" inside its stretch, ${JSON.stringify(outLove.nick)} outside`);
check(inLove.nick === "Love Street", "Love Street is not named on its own stretch");
check(outLove.nick === null, "the nickname leaks outside Love Street");

// --- 5. The HUD is actually wired to all of it -----------------------
//
// A field that exists on HudData and is never written to the DOM is the
// same bug this project keeps finding in other shapes.
const client = readFileSync("src/app/race/RaceClient.tsx", "utf8");
for (const f of ["roadName", "roadArabic", "nextArea", "nextArabic", "nextInM"]) {
  check(client.includes(`d.${f}`), `HudData carries ${f} and the HUD never reads it`);
}
console.log(`\nwiring       every guide field the engine emits is read by the HUD  ok`);

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nthe guide names the road, the place, and the next one");
process.exit(fail.length ? 1 : 0);
