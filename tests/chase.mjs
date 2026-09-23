// Race past a patrol car and it comes after you.
//
//   npm run test:chase           (no browser, no dev server)
//
// The pursuit law is pure and lives in src/game/police.ts for exactly
// this reason — the same reason policeLamps was lifted out of cars.ts.
// A rule that decides whether the player is being chased should be
// checkable without standing up a renderer, and this drives it through
// the situations that matter instead of asserting its constants back at
// it.
//
// What the behaviour has to be, and what it has to NOT be:
//
//   provoked     racing past a patrol car starts a chase
//   ignored      driving past one at traffic speed does not, and
//                neither does being passed BY one, and neither does
//                being fast two hundred metres away
//   patient      it keeps coming while you are close and quick
//   losable      it gives up when you are gone, and when you slow down
//   winnable     its top speed is under the player's, so the way out is
//                the road and not a timer
//   recoverable  a chase that ends leaves the car able to start another
//
// The last one matters more than it looks. Patience that drains to zero
// and a flag that never resets is a patrol car that notices once per
// session, which would read as the system being broken rather than as
// it having let you go.
import {
  provokes, patienceAfter, pursuitSpeed,
  PROVOKE_SPEED, PROVOKE_AHEAD, PROVOKE_LAT,
  PATIENCE, LOSE_M, CALM_SPEED, CHASE_TOP, CHASE_MARGIN,
} from "../src/game/police.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };
const look = (gap, lat, speed) => ({ gap, lat, speed });
const DT = 1 / 60;

// --- 1. Racing past one starts a chase -------------------------------
{
  const passing = look(12, 1.8, 46);
  console.log(`provoked  ${check(provokes(passing), "racing past a patrol car does not provoke it")}  12 m ahead, one lane over, 46 m/s (166 km/h)`);
  console.log(`          ${check(provokes(look(2, 0, PROVOKE_SPEED + 0.5)), "a pass just over the speed does not provoke")}  and just over the line provokes too`);
}

// --- 2. What must NOT provoke ----------------------------------------
{
  const cases = [
    ["driving past at traffic speed", look(12, 1.8, 28)],
    ["sitting in traffic beside one", look(4, 1.8, 12)],
    ["being overtaken BY the patrol car", look(-12, 1.8, 46)],
    ["fast, but two hundred metres up the road", look(200, 1.8, 60)],
    ["fast, but all the way across the road", look(12, PROVOKE_LAT + 1, 60)],
    ["exactly level", look(0, 1.8, 60)],
  ];
  for (const [why, l] of cases) {
    console.log(`ignored   ${check(!provokes(l), `${why} provoked a chase`)}  ${why}`);
  }
}

// --- 3. It keeps coming while you are close and quick -----------------
{
  let p = PATIENCE;
  for (let i = 0; i < 60 * 30; i++) p = patienceAfter(p, look(40, 1.8, 50), DT);
  console.log(`patient   ${check(p === PATIENCE, `patience fell to ${p.toFixed(1)} s while the racer was right there`)}  thirty seconds of being chased does not run the clock down`);
}

// --- 4. You lose it by getting away ----------------------------------
{
  let p = PATIENCE, t = 0;
  while (p > 0 && t < 60) { p = patienceAfter(p, look(LOSE_M + 50, 1.8, 60), DT); t += DT; }
  console.log(`losable   ${check(p === 0 && t < PATIENCE + 0.5, `still chasing after ${t.toFixed(1)} s at ${LOSE_M + 50} m`)}  gone for ${t.toFixed(1)} s at ${LOSE_M + 50} m and it drops off`);
}

// --- 5. ...or by not giving it a reason ------------------------------
{
  let p = PATIENCE, t = 0;
  while (p > 0 && t < 60) { p = patienceAfter(p, look(20, 1.8, CALM_SPEED - 4), DT); t += DT; }
  console.log(`calms     ${check(p === 0 && t < PATIENCE + 0.5, `still chasing after ${t.toFixed(1)} s at ${CALM_SPEED - 4} m/s`)}  slow down for ${t.toFixed(1)} s, right beside it, and it lets you go`);
  // And the gap between the two thresholds is real, so easing off a
  // little does not flip the pursuit on and off.
  console.log(`hysteresis ${check(CALM_SPEED < PROVOKE_SPEED - 4, `calm ${CALM_SPEED} and provoke ${PROVOKE_SPEED} are too close — the chase will chatter`)}  ${PROVOKE_SPEED - CALM_SPEED} m/s between "starts a chase" and "ends one"`);
}

// --- 6. A corner does not shake it off -------------------------------
// The gap opens and closes through a bend; patience refills rather than
// merely pausing, or a long chase would die of a two-second glimpse.
{
  let p = PATIENCE, min = PATIENCE;
  for (let i = 0; i < 60 * 40; i++) {
    const gap = 120 + Math.sin(i / 90) * 140; // −20 to 260 m
    p = patienceAfter(p, look(gap, 2, 52), DT);
    min = Math.min(min, p);
  }
  console.log(`corners   ${check(p > 0, "a chase died in a corner where the gap opened for a moment")}  forty seconds of the gap swinging to ${(260).toFixed(0)} m and back, still coming (low water ${min.toFixed(1)} s)`);
}

// --- 7. The way out is the road --------------------------------------
{
  const PLAYER_TOP = 92; // engine.ts caps the player near here
  console.log(`winnable  ${check(CHASE_TOP < PLAYER_TOP - 8, `a patrol car tops out at ${CHASE_TOP} against the player's ${PLAYER_TOP} — that is a timer, not a chase`)}  patrol ${CHASE_TOP} m/s against the player's ~${PLAYER_TOP}`);
  console.log(`          ${check(pursuitSpeed(200, 50) === CHASE_TOP, "the pursuit speed is not capped")}  and it cannot be outrun by simply being fast enough to break the cap`);
  console.log(`closes    ${check(pursuitSpeed(50, 40) === 50 + CHASE_MARGIN, `behind by 40 m it wants ${pursuitSpeed(50, 40)}, not ${50 + CHASE_MARGIN}`)}  behind, it runs ${CHASE_MARGIN} m/s quicker to close`);
  console.log(`no ram    ${check(pursuitSpeed(50, 2) === 50, `level with the racer it wants ${pursuitSpeed(50, 2)} — it will drive through the back of them`)}  level, it matches instead of closing`);
  console.log(`          ${check(pursuitSpeed(0, 2) === 0, "a stopped racer is still being closed on")}  and a stopped racer is not rammed`);
}

// --- 8. A chase that ends can start again ----------------------------
{
  let p = PATIENCE;
  for (let i = 0; i < 60 * 30; i++) p = patienceAfter(p, look(400, 1.8, 20), DT);
  const escaped = p === 0;
  const again = provokes(look(10, 1.8, 50));
  console.log(`again     ${check(escaped && again, "a patrol car that let you go cannot be provoked a second time")}  it let go, and the next pass provokes it again`);
  console.log(`          ${check(patienceAfter(0, look(10, 1.8, 60), DT) === 0, "patience climbs on a car that is not chasing anybody")}  a car with no chase running stays at zero until something starts one`);
}

console.log(fail.length ? "\nFAILURES:\n - " + fail.join("\n - ") : "\nrace past a patrol car and it comes after you, and you can lose it");
process.exit(fail.length ? 1 : 0);
