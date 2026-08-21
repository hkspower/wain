// The one car money cannot buy.
//
//   npm run dev
//   node tests/gtr.mjs
//
// Rarity in this showroom used to mean exactly one thing — a bigger
// number on the price tag — so the "rarest machine on Gulf Road" was on
// sale to anybody on the first screen who had the cash. The Zeta 300
// GTR is not for sale at any price until every legend on the roster has
// been beaten, and when it is, it comes with the whole catalogue already
// bolted in.
//
// Both halves of that are easy to get wrong in ways nothing complains
// about: a lock that only greys out a button still sells the car to
// anything that calls the handler, and a car "delivered fully built"
// whose parts are owned but not EQUIPPED drives exactly like a stock one
// while its card claims otherwise.
//
//   locked     the rule refuses, not just the button
//   shown      and the showroom says why, rather than hiding it
//   earned     beat the roster and it is for sale
//   built      what arrives is fitted, not a boot full of parts
//   apex       it is the fastest thing in the game, which is the entire
//              reason to lock it behind the career
import { chromium } from "playwright-core";
import { existsSync } from "node:fs";

const C = [
  process.env.CHROME_PATH,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium/chrome-linux/chrome`,
  process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`,
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const exe = C.find((p) => existsSync(p));
if (!exe) {
  console.error("No Chromium found. Set CHROME_PATH, or run: npx playwright install chromium");
  process.exit(2);
}

const GTR = "zeta-300-gtr";
const browser = await chromium.launch({
  executablePath: exe,
  args: ["--use-gl=angle", "--enable-webgl", "--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); return c ? "ok" : "FAIL"; };

/** Reload the menu with a save that has this much money and this much
 *  career behind it, then open the showroom. */
const showroom = async (kd, beaten) => {
  await page.goto("http://localhost:3000/race", { waitUntil: "networkidle" });
  await page.evaluate(
    ([money, won]) => {
      localStorage.clear();
      localStorage.setItem("gulf-road-nights-onboarded", "2");
      localStorage.setItem("gulf-road-nights-coach", "3");
      localStorage.setItem("gulf-road-nights-progress", String(won));
      localStorage.setItem(
        "gulf-road-nights-garage",
        JSON.stringify({
          kd: money,
          cars: ["wain-special"],
          car: "wain-special",
          builds: {},
        })
      );
    },
    [kd, beaten]
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.click("text=GARAGE");
  await page.waitForSelector("text=SHOWROOM", { timeout: 30000 });
  await page.waitForTimeout(500);
};

/** The showroom card for a car, as the player sees it. */
const card = () =>
  page.evaluate((name) => {
    const b = [...document.querySelectorAll("button")].find((el) =>
      el.textContent?.includes(name)
    );
    if (!b) return null;
    return { disabled: b.disabled, text: b.textContent.replace(/\s+/g, " ").trim() };
  }, "Zeta 300 GTR");

// --- With the roster untouched -------------------------------------
await showroom(999999, 0);

const rule = await page.evaluate((id) => window.__grnShowroom.lockedBy(id), GTR);
console.log(
  `locked    ${check(
    rule === 8,
    rule === 0
      ? "the showroom will sell the GTR to a brand new save — it is only expensive, not rare"
      : `the lock says ${rule} legends, which is not the roster`
  )}  the rule asks for ${rule} legends`
);

const cold = await card();
console.log(
  `shown     ${check(
    cold && cold.disabled && /not for sale/i.test(cold.text),
    !cold
      ? "the GTR is not in the showroom at all — a car nobody can see is not rare, it is absent"
      : !cold.disabled
        ? "the GTR's card is live on a save that has beaten nobody"
        : `the card does not say why it cannot be bought: "${cold.text.slice(0, 90)}"`
  )}  ${cold?.disabled ? "greyed out" : "LIVE"}, and it says so`
);

// Money is not the missing piece, and the card must not pretend it is.
console.log(
  `not money ${check(
    cold && !/need .* more/i.test(cold.text),
    "the card tells a player with a million dinars that they need more money"
  )}  a million KD changes nothing`
);

// --- With the roster beaten ----------------------------------------
await showroom(999999, 8);
const warm = await card();
console.log(
  `earned    ${check(
    warm && !warm.disabled && /240,000/.test(warm.text),
    !warm
      ? "the GTR vanished from the showroom once the career was finished"
      : warm.disabled
        ? "the GTR is still locked after every legend has been beaten"
        : `the card does not show its price: "${warm.text.slice(0, 90)}"`
  )}  for sale at 240,000 KD`
);

await page.evaluate((name) => {
  [...document.querySelectorAll("button")]
    .find((el) => el.textContent?.includes(name))
    ?.click();
}, "Zeta 300 GTR");
await page.waitForTimeout(600);

const bought = await page.evaluate((id) => {
  // Read straight off the save. The engine's own reader is not here —
  // this is the menu, and the engine has not been started yet.
  const g = JSON.parse(localStorage.getItem("gulf-road-nights-garage") ?? "{}");
  const b = g.builds?.[id];
  return {
    owns: (g.cars ?? []).includes(id),
    driving: g.car === id,
    kd: g.kd,
    owned: b?.owned ?? [],
    equipped: b?.equipped ?? {},
  };
}, GTR);
console.log(
  `sold      ${check(
    bought.owns && bought.driving && bought.kd === 999999 - 240000,
    !bought.owns
      ? "the card was live but the car never reached the driveway"
      : `the balance went to ${bought.kd} instead of ${999999 - 240000}`
  )}  in the driveway, ${bought.kd.toLocaleString()} KD left`
);

// --- And it arrives built ------------------------------------------
//
// Owning a part and running it are different things, and this is the
// one place the difference is invisible: every part is in the list,
// every exclusive slot could still be empty, and the car would drive
// like a showroom model with a very expensive receipt.
const WANT_FITTED = {
  aspiration: "twin-turbo",
  intake: "intake",
  exhaust: "exhaust-ti",
  brakes: "brakes-carbon",
  tires: "tires-slick",
};
const WANT_OWNED = ["ecu", "lsd", "coilovers", "cage", "rack", "weight", "nos"];
const missingFitted = Object.entries(WANT_FITTED)
  .filter(([slot, id]) => bought.equipped[slot] !== id)
  .map(([slot, id]) => `${slot}=${bought.equipped[slot] ?? "stock"} not ${id}`);
const missingOwned = WANT_OWNED.filter((id) => !bought.owned.includes(id));
console.log(
  `built     ${check(
    missingFitted.length === 0 && missingOwned.length === 0,
    missingFitted.length
      ? `delivered with empty slots: ${missingFitted.join(", ")}`
      : `delivered without ${missingOwned.join(", ")}`
  )}  ${Object.keys(WANT_FITTED).length} slots fitted, ${WANT_OWNED.length} parts installed`
);

// The gearboxes are deliberately absent — both of them trade one end of
// the car's performance for the other, so neither is an upgrade on a
// machine built to do both. If one turns up here it was not a decision.
console.log(
  `factory   ${check(
    !bought.equipped.gearbox,
    `it arrived with the ${bought.equipped.gearbox} fitted — that is a trade, not an upgrade`
  )}  factory ratios, on purpose`
);

// --- The apex ------------------------------------------------------
//
// Asked of the running game rather than of the catalogue: start the
// engine on the car that was just bought and read the numbers it is
// actually racing with.
await page.click("text=DONE");
await page.waitForTimeout(400);
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /CONTINUE|START ENGINE/.test(b.textContent ?? ""))
    ?.click();
});
await page.waitForFunction(() => !!window.__grnDebug, null, { timeout: 120000 });
await page.waitForTimeout(1500);

const apex = await page.evaluate(async (id) => {
  const res = await fetch("/api/grn/v1/cars").then((r) => r.json());
  const cars = res.cars ?? res;
  const me = cars.find((c) => c.id === id);
  const tune = window.__grnTuneFor(id);
  return {
    stated: me?.topSpeedKmh,
    best: Math.max(...cars.map((c) => c.topSpeedKmh)),
    others: Math.max(...cars.filter((c) => c.id !== id).map((c) => c.topSpeedKmh)),
    locked: me?.lockedRivals,
    factory: me?.factoryBuild?.length ?? 0,
    governor: tune.topSpeedKmh,
    kit: tune.raceKit,
    grip: +tune.gripAccel.toFixed(1),
    brake: +tune.brakeForce.toFixed(1),
  };
}, GTR);
console.log(
  `apex      ${check(
    apex.stated === apex.best && apex.stated > apex.others && apex.kit,
    apex.stated !== apex.best
      ? `the GTR is governed at ${apex.stated} and something else reaches ${apex.best}`
      : "the GTR is not wearing the factory aero kit that is half of what it is"
  )}  ${apex.stated} km/h stock, ${apex.governor} built, next best ${apex.others}, full aero`
);
// The rule and the build travel to the ports as data, or the ports ship
// a game where the rarest car is on the front page for cash.
console.log(
  `data      ${check(
    apex.locked === 8 && apex.factory === 12,
    `the API publishes lockedRivals=${apex.locked} and ${apex.factory} factory parts — ` +
      `the ports build the showroom from this`
  )}  lockedRivals ${apex.locked}, ${apex.factory} parts in the API`
);

await browser.close();
if (fail.length) {
  console.log(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:`);
  for (const f of fail) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\nbeat the road, then buy the car.");
