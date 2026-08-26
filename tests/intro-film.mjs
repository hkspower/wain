// The pre-race film's timing and score, as arithmetic.
//
//   npm run test:film      (no browser, no dev server)
//
// The film is eight seconds of camera work, three headlight hits and a
// music cue, and almost everything that can go wrong with it is a
// number rather than a picture: a hit scheduled after the shot it
// belongs to has cut away, a shot whose end lands past the film's own
// length, a third music mood that silences a two-stem score. Those are
// checkable without a browser, so they are checked here; what the
// camera actually frames is checked in the browser by
// tools/shots/introfilm.mjs.

import { readFileSync } from "node:fs";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

const engine = readFileSync("src/game/engine.ts", "utf8");
const music = readFileSync("src/game/music.ts", "utf8");

/** A top-level `const NAME = <number>;` out of a module. */
const num = (src, name) => {
  const m = src.match(new RegExp(`^const ${name} = ([\\d.]+);`, "m"));
  return m ? Number(m[1]) : null;
};

const CINE_LEN = num(engine, "CINE_LEN");
const GAP = num(engine, "CINE_FLASH_GAP");
// The shot boundaries, in order. Read from the module rather than
// restated here: a test that keeps its own copy of the timeline agrees
// with itself forever and with the film never.
const CUTS = ["CINE_CHALLENGE_END", "CINE_ANSWER_END", "CINE_ORBIT_END", "CINE_FLANK_END", "CINE_TWOSHOT_END"]
  .map((n) => ({ name: n, at: num(engine, n) }));
const FLASH_END = CUTS[0].at;
const at = JSON.parse(
  engine.match(/^const CINE_FLASH_AT = (\[[^\]]+\]);/m)?.[1] ?? "null"
);

console.log(
  `film         ${CINE_LEN} s long; the challenge shot holds the first ${FLASH_END} s ` +
  `at a ${GAP} m gap`
);
check(CINE_LEN != null && FLASH_END != null && GAP != null && at != null,
  "the film's constants are not where the test looks for them");

// --- 1. Three hits, and all three inside their own shot ---------------
{
  console.log(`beams        ${at.length} hits at ${at.join(", ")} s`);
  check(at.length === 3, `${at.length} high-beam hits — the ritual is three`);
  check(at.every((x) => x > 0), "a hit is scheduled at or before the film starts");
  // The last hit must not merely START inside the shot: it has to be
  // seen. The pulse is rise+hold+fall, and a hit that begins 40 ms
  // before the cut plays its whole fall over the next shot.
  const PULSE = (40 + 150 + 190) / 1000;
  const last = at[at.length - 1];
  console.log(`             the last hit finishes at ${(last + PULSE).toFixed(2)} s, cut at ${FLASH_END} s`);
  check(
    last + PULSE <= FLASH_END,
    `the last hit is still fading ${(last + PULSE - FLASH_END).toFixed(2)} s after the shot has cut away`
  );
  // ...and they must be in order, or the film's clock fires them out of
  // sequence and the `while` that drives them spins.
  for (let i = 1; i < at.length; i++) {
    check(at[i] > at[i - 1], `hit ${i + 1} is scheduled before hit ${i}`);
  }
  // Spaced enough to read as three separate hits rather than a stutter.
  const gaps = at.slice(1).map((x, i) => +(x - at[i]).toFixed(3));
  console.log(`             spaced ${gaps.join(" then ")} s`);
  check(gaps.every((g) => g >= 0.35), `hits ${gaps.join("/")} s apart read as one long flash`);
}

// --- 2. The shots tile the film ---------------------------------------
//
// Six shots, back to back, ending exactly at the film's own length. The
// arithmetic that bites is a shot of zero or negative length: every one
// of them divides by its own duration to get its progress, so a
// boundary that runs backwards sends the camera flying through the
// world rather than easing across it.
{
  const names = ["challenge", "answer", "orbit", "flank", "two-shot", "chase"];
  const bounds = [0, ...CUTS.map((c) => c.at), CINE_LEN];
  const lens = bounds.slice(1).map((b, i) => +(b - bounds[i]).toFixed(2));
  console.log(
    `\nshots        ` + names.map((n, i) => `${n} ${lens[i]}`).join(" + ") + ` = ${CINE_LEN} s`
  );
  check(CUTS.every((c) => c.at != null), "a shot boundary is missing from the module");
  for (let i = 0; i < lens.length; i++) {
    check(lens[i] > 0.8, `the ${names[i]} shot gets ${lens[i]} s — too short to land`);
  }
  // In order, and inside the film.
  for (let i = 1; i < CUTS.length; i++) {
    check(CUTS[i].at > CUTS[i - 1].at, `${CUTS[i].name} lands before ${CUTS[i - 1].name}`);
  }
  check(CUTS[CUTS.length - 1].at < CINE_LEN, "the last cut is at or past the end of the film");
}

// --- 3. The rival's gap holds for the shots that need it -------------
//
// The challenge shot needs the gap because the beams cross it, and the
// ANSWER shot needs it because the answer IS the rival closing on you.
// A gap already shut when the answer starts has nothing to show.
{
  check(
    /\(ct - CINE_ANSWER_END\) \/ \(CINE_ORBIT_END - CINE_ANSWER_END\)/.test(engine),
    "the rival's gap no longer holds through the answer shot and closes across the orbit"
  );
  check(GAP >= 8 && GAP <= 30, `a ${GAP} m challenge gap is not a car length up the road`);
}

// --- 4. The score has a third cue, and it silences nothing ------------
{
  const moods = ["cruise", "battle", "challenge"];
  for (const table of ["PROG", "ROOT", "BPM"]) {
    const block = music.match(new RegExp(`const ${table}[^=]*= \\{([\\s\\S]*?)\\n\\};|const ${table}[^=]*= \\{([^}]*)\\}`))?.[0] ?? "";
    for (const m of moods) {
      check(block.includes(`${m}:`), `${table} has no entry for the ${m} mood — the score would read undefined`);
    }
  }
  const bpm = music.match(/const BPM[^=]*= \{([^}]*)\}/)?.[1] ?? "";
  const val = (m) => Number(bpm.match(new RegExp(`${m}: ([\\d.]+)`))?.[1]);
  console.log(
    `score        ${moods.map((m) => `${m} ${val(m)}`).join(", ")} bpm`
  );
  check(val("challenge") > val("battle"), "the film's cue is not faster than the fight it introduces");

  // The recorded-track path only has two stems. A challenge that fades
  // both to zero plays the film in silence — worse than the wrong
  // track, because nobody reports silence as a bug, they report it as
  // the music being broken.
  check(
    /const hard = mood !== "cruise"/.test(music),
    "the two-stem path does not map challenge onto a stem — the film would play silent"
  );
}

console.log(
  fail.length
    ? "\nFAILURES:\n - " + fail.join("\n - ")
    : "\nthree hits inside their own shot, six shots that tile, and a cue in every table"
);
process.exit(fail.length ? 1 : 0);
