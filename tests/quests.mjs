// The online runs, as arithmetic.
//
//   npm run test:runs      (no browser, no dev server, no hub)
//
// What is worth checking here is not that six objects exist. It is the
// three ways an objectives system usually goes wrong, none of which
// show up in a playtest until somebody has been cheated:
//
//   IT MUST PAY ONCE      A run that crossed its target pays on the
//                         frame it crossed and never again, however many
//                         times the totals are compared afterwards.
//   IT MUST NOT SKIP      A total that jumps past a target in one step —
//                         a long slide banked all at once — still pays.
//   IT MUST NOT ROT       A save with a string, a NaN or a negative in
//                         it must come back as numbers, because these
//                         totals only ever accumulate and a NaN in one
//                         would never recover.
//
// And one thing about the writing, because this is the text the request
// was actually about: every run has to be readable in both languages.

import {
  QUESTS, EMPTY_PROGRESS, newlyDone, questDone, questFraction, questLabel,
  loadProgress, saveProgress, TOGETHER_M, MET_M, MATCHED_KMH, MATCHED_FLOOR_KMH,
} from "../src/game/quests.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };

// --- 1. Every run is a run ------------------------------------------
{
  const ids = new Set();
  for (const q of QUESTS) {
    if (ids.has(q.id)) fail.push(`two runs share the id "${q.id}"`);
    ids.add(q.id);
    check(q.name.trim().length > 0, `${q.id}: no English name`);
    check(/[؀-ۿ]/.test(q.ar), `${q.id}: the Arabic name is not Arabic`);
    check(q.hint.trim().length > 0, `${q.id}: no English hint`);
    check(/[؀-ۿ]/.test(q.hintAr), `${q.id}: the Arabic hint is not Arabic`);
    // A hint that does not fit the strip is a hint nobody reads.
    check(q.hint.length <= 62, `${q.id}: the hint is ${q.hint.length} characters — too long for the HUD strip`);
    check(Object.keys(EMPTY_PROGRESS).includes(q.metric), `${q.id}: reads "${q.metric}", which nothing counts`);
    check(q.target > 0, `${q.id}: target ${q.target}`);
    check(q.reward > 0, `${q.id}: pays nothing`);
    // See the header of quests.ts: the wallet is local storage, so a run
    // that paid a car would be a lie about what the game can enforce.
    // The cheapest car in the game is well north of this.
    check(q.reward <= 1000, `${q.id}: pays ${q.reward} KD, which is farmable money`);
  }
  console.log(`${QUESTS.length} runs, ${ids.size} distinct ids, all bilingual`);
}

// --- 2. Every metric is reachable ------------------------------------
//
// A run whose metric nothing counts is a run that can never finish, and
// it would look completely fine in this file. So the engine is read as
// text and asked whether it touches each one.
{
  const { readFileSync } = await import("node:fs");
  const eng = readFileSync("src/game/engine.ts", "utf8");
  for (const q of QUESTS) {
    check(
      eng.includes(`this.runs.${q.metric}`),
      `${q.id}: nothing in engine.ts ever writes runs.${q.metric} — the run cannot be finished`
    );
  }
  console.log("every run's metric is written somewhere in the engine");
}

// --- 3. Paid once, and never skipped ---------------------------------
{
  const q = QUESTS.find((x) => x.id === "salam");
  const before = { ...EMPTY_PROGRESS };
  const crossing = { ...EMPTY_PROGRESS, metDrivers: q.target };
  const beyond = { ...EMPTY_PROGRESS, metDrivers: q.target + 40 };

  check(newlyDone(before, crossing).some((x) => x.id === q.id), "crossing the target paid nothing");
  check(newlyDone(crossing, beyond).length === 0, "a finished run paid again on the next frame");
  // The jump case: a thousand drift points banked in one slide.
  const drift = QUESTS.find((x) => x.id === "sideways");
  const leap = { ...EMPTY_PROGRESS, driftBeside: drift.target * 3 };
  check(
    newlyDone(EMPTY_PROGRESS, leap).some((x) => x.id === drift.id),
    "a total that jumped clean past its target did not pay"
  );
  // Two at once is two payments, not one.
  const both = { ...EMPTY_PROGRESS, metDrivers: 99, duelWins: 99 };
  check(newlyDone(EMPTY_PROGRESS, both).length >= 2, "two runs finishing together paid only one");
  console.log("paid on crossing, paid on a leap, never paid twice");
}

// --- 4. The labels say something true --------------------------------
{
  const conv = QUESTS.find((x) => x.id === "convoy");
  const half = { ...EMPTY_PROGRESS, togetherM: conv.target / 2 };
  const lbl = questLabel(conv, half);
  check(lbl === "5.0 / 10 km", `half of the convoy run reads "${lbl}"`);
  check(Math.abs(questFraction(conv, half) - 0.5) < 1e-9, "half is not half");
  // Overshoot must not read "14.7 / 10 km" or fill past the bar.
  const over = { ...EMPTY_PROGRESS, togetherM: conv.target * 1.47 };
  check(questLabel(conv, over) === "10.0 / 10 km", `overshoot reads "${questLabel(conv, over)}"`);
  check(questFraction(conv, over) === 1, "the bar fills past its end");
  check(questDone(conv, over), "overshoot is not done");
  console.log(`convoy at half reads "${lbl}"; overshoot clamps`);
}

// --- 5. The thresholds are physical ----------------------------------
//
// Not the engine's arithmetic restated — the design law. Two cars are
// "together" at a distance a driver would call the next lane, you have
// "met" somebody from further away than you have driven with them, and
// "matched" is a speed difference small enough that neither car is
// visibly gaining.
{
  check(TOGETHER_M > 3 && TOGETHER_M < 20, `TOGETHER_M is ${TOGETHER_M} m, which is not a lane and a half`);
  check(MET_M > TOGETHER_M, `MET_M (${MET_M}) is not looser than TOGETHER_M (${TOGETHER_M})`);
  check(MATCHED_KMH > 0 && MATCHED_KMH <= 10, `${MATCHED_KMH} km/h apart is not "the same speed"`);
  check(MATCHED_FLOOR_KMH >= 100, `${MATCHED_FLOOR_KMH} km/h is not a speed worth matching at`);
  console.log(
    `together ${TOGETHER_M} m, met ${MET_M} m, matched within ${MATCHED_KMH} km/h above ${MATCHED_FLOOR_KMH}`
  );
}

// --- 6. A rotten save does not rot the totals ------------------------
//
// There is no localStorage in node, so it is stubbed. That is the whole
// surface loadProgress touches, and stubbing it is the difference
// between testing the validation and not testing it at all.
{
  let cell = null;
  globalThis.localStorage = {
    getItem: () => cell,
    setItem: (_k, v) => { cell = v; },
  };

  cell = null;
  check(
    Object.values(loadProgress()).every((v) => v === 0),
    "a save that does not exist did not come back empty"
  );

  cell = "{ this is not json";
  check(
    Object.values(loadProgress()).every((v) => v === 0),
    "a corrupt save threw or came back with junk in it"
  );

  cell = JSON.stringify({
    metDrivers: "seven",
    togetherM: NaN,          // JSON turns this into null, which is the point
    towSeconds: -50,
    duelWins: 3,
    matchedSeconds: Infinity,
    driftBeside: 900,
  });
  const p = loadProgress();
  for (const [k, v] of Object.entries(p)) {
    check(typeof v === "number" && Number.isFinite(v) && v >= 0, `${k} came back as ${v}`);
  }
  // The good fields survive; only the bad ones are dropped.
  check(p.duelWins === 3, `a valid field was thrown away with the invalid ones (duelWins ${p.duelWins})`);
  check(p.driftBeside === 900, `driftBeside came back as ${p.driftBeside}`);
  check(p.towSeconds === 0, `a negative total survived as ${p.towSeconds}`);

  // Round trip.
  const written = { ...EMPTY_PROGRESS, metDrivers: 5, togetherM: 1234.5 };
  saveProgress(written);
  const read = loadProgress();
  check(read.metDrivers === 5 && Math.abs(read.togetherM - 1234.5) < 1e-9, "the totals did not survive a save");
  console.log("a rotten save comes back as numbers, and the good fields survive");
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nsix runs, countable, payable once, and legible in both languages"
);
process.exit(fail.length ? 1 : 0);
