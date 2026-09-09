// Every crew that has a name has an emblem, and the one that does not, does not.
//
//   npm run test:crests
//
// The roster has had eight crews since it was written — Salmiya Street
// Kings, Hawally Night Hawks, Jahra Junoon — and their names are printed
// in nine places: the challenge card, the dossier, the VS splash, the
// results screen, both cinematic plates, the roster, the website and the
// API. All nine printed text. Meanwhile teams.ts had been drawing crests
// since the crew feature landed, so the only crew in the game with an
// emblem was the player's own, and the seven you actually fight had
// none.
//
// These crests are DATA — four fields on the rival record, the same four
// a player picks in the garage — which is why this file can check them
// without a browser. What it cannot check here is that they REACH the
// screen; tools/shots/crests.mjs renders the sheet through the game's
// own routine and is the proof of that.

import { RIVALS } from "../src/game/rivals.ts";
import { LOGO_SHAPES, LOGO_SYMBOLS, crewInitials, sanitizeTag } from "../src/game/teams.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

// A crew with no NAME is the one crew with no crest. "???" is not a name.
const named = RIVALS.filter((r) => r.crew && r.crew !== "???");
const anon = RIVALS.filter((r) => !r.crew || r.crew === "???");
// Everything below check 1 reads r.crest.shape and r.crest.bg. Check 1
// is the one that catches a MISSING crest, so the checks after it have
// to work on the ones that exist — otherwise the first crestless crew
// throws a TypeError inside check 2 and the run dies having reported one
// finding out of five. A test that stops at the first problem is a test
// you have to run five times to see the damage.
const drawn = named.filter((r) => r.crest);

// ---- 1. Named crews carry one, the nameless crew does not -----------
{
  const missing = named.filter((r) => !r.crest);
  const surplus = anon.filter((r) => r.crest);
  console.log(
    `${named.length} named crews, ${anon.length} without a name  ` +
      check(missing.length === 0, `named and crestless: ${missing.map((r) => r.crew).join(", ")}`) +
      // The Ghost of the Gulf answers "???" to country and to crew and
      // runs a black flag. An emblem is what a crew paints on itself to
      // be recognised, and that is the one thing this driver is not for.
      check(surplus.length === 0, `a crew with no name was given an emblem anyway: ${surplus.map((r) => r.name).join(", ")}`)
  );
}

// ---- 2. Drawn from the vocabulary the player draws from -------------
//
// Not decoration. teams.ts's shapePath only knows four shapes and falls
// through to `shield` for anything else, silently — so a typo in a shape
// name is a crest that renders as somebody else's shape and never says
// so. The symbol list is checked for a softer reason: a crest built from
// a glyph the crew builder does not offer is one a player cannot answer.
{
  const badShape = drawn.filter((r) => !LOGO_SHAPES.includes(r.crest.shape));
  const offMenu = drawn.filter((r) => !LOGO_SYMBOLS.includes(r.crest.symbol));
  console.log(
    `${LOGO_SHAPES.length} shapes and ${LOGO_SYMBOLS.length} symbols in the crew builder  ` +
      check(badShape.length === 0, `shape not in LOGO_SHAPES (renders as a shield and says nothing): ${badShape.map((r) => `${r.crew}=${r.crest.shape}`).join(", ")}`) +
      check(offMenu.length === 0, `symbol a player could not choose: ${offMenu.map((r) => `${r.crew}=${r.crest.symbol}`).join(", ")}`)
  );
}

// ---- 3. The crest is the car -----------------------------------------
//
// The colours are not chosen for the emblem. They are the rival's own
// body and accent, so the crest on the card is the machine that turns up
// and the two teach each other. Checked because it is the kind of link
// that is easy to write once and then quietly break by restyling one
// side of it.
{
  const drift = drawn.filter(
    (r) => r.crest.bg !== hex(r.bodyColor) || r.crest.fg !== hex(r.accentColor)
  );
  console.log(
    `every crest wears its own car's colours  ` +
      check(drift.length === 0, drift.map((r) =>
        `${r.crew}: crest ${r.crest.bg}/${r.crest.fg} vs car ${hex(r.bodyColor)}/${hex(r.accentColor)}`).join("; "))
  );
  // A field and a border that are the same colour is an emblem with no
  // edge — legible in the data, invisible on the card.
  const flat = drawn.filter((r) => r.crest.bg.toLowerCase() === r.crest.fg.toLowerCase());
  console.log(
    `and none of them is edgeless  ` +
      check(flat.length === 0, `field and border the same colour: ${flat.map((r) => r.crew).join(", ")}`)
  );
}

// ---- 4. Seven crests, seven different marks --------------------------
//
// A roster where two crews share a crest is a roster the player cannot
// read at a glance, which is the entire job of a crest.
{
  const key = (r) => `${r.crest.shape}/${r.crest.symbol}/${r.crest.bg}`;
  const seen = new Map();
  for (const r of drawn) {
    const k = key(r);
    if (seen.has(k)) fail.push(`${r.crew} and ${seen.get(k)} are the same emblem`);
    seen.set(k, r.crew);
  }
  const symbols = new Set(drawn.map((r) => r.crest.symbol));
  const shapes = new Set(drawn.map((r) => r.crest.shape));
  console.log(
    `${seen.size} distinct emblems from ${symbols.size} symbols across ${shapes.size} shapes  ` +
      check(seen.size === drawn.length, `two crews share an emblem`) +
      check(symbols.size === drawn.length, `a symbol is used twice`) +
      // Not one shape for everybody: shape is the thing that reads first
      // at the size these are drawn on a card.
      check(shapes.size >= 3, `only ${shapes.size} shape(s) across the whole roster`)
  );
}

// ---- 5. The initials the crest stamps --------------------------------
//
// The rival crews have names and never had tags — the player's crew has
// both — so the tag under the emblem is derived. It has to survive
// sanitizeTag, which is what the hub applies before it will store a crew
// at all: a tag that sanitizes to nothing is a crew the server throws
// away without a word.
{
  const tags = named.map((r) => ({ crew: r.crew, tag: crewInitials(r.crew) }));
  const empty = tags.filter((t) => !t.tag);
  const unstable = tags.filter((t) => sanitizeTag(t.tag) !== t.tag);
  const dupes = tags.filter((t, i) => tags.findIndex((o) => o.tag === t.tag) !== i);
  console.log(
    `${tags.map((t) => t.tag).join(" ")}  ` +
      check(empty.length === 0, `no initials for: ${empty.map((t) => t.crew).join(", ")}`) +
      check(unstable.length === 0, `initials the hub would rewrite: ${unstable.map((t) => `${t.crew}=${t.tag}`).join(", ")}`) +
      check(dupes.length === 0, `two crews stamp the same tag: ${dupes.map((t) => t.tag).join(", ")}`)
  );
}

if (fail.length) {
  console.error(`\n${fail.length} failed:\n`);
  for (const f of fail) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nseven crews wear their colours; the eighth wears nothing, on purpose.`);
