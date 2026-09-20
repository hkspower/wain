// What everything in this game is called, and what the two languages
// agree on: the cars, the rivals who drive them, and the landmarks on
// the lap.
//
//   npm run test:names      (no browser, no dev server)
//
// Every one of these carries at least two names — an English one and an
// Arabic one — and the cars carry a third, the id they are saved under.
// They drift. Two cars had names that no longer matched their own ids —
// sahara-v12 was called "Sahara GT-12" and storm-s8 was "Desert Storm
// S8" — and eight of sixteen had Arabic that said less than the
// English, dropping the model designator so a player reading Arabic saw
// "عفريت" where an English reader saw "Efreet RX". One was not a
// translation at all: "Efreet RX Kai" against "كبير العفاريت", the
// chief of the efreets.
//
// Rivals and landmarks carry the same risk and had no test watching for
// it at all — not even a check that two rivals couldn't share a name.
//
// The rules below are the naming convention, in the only form that
// survives: a test that fails when the next car, rival or landmark
// breaks it. Sections 1-5 are the cars (and the rivals' link to them,
// which was here first); 6-8 are the rivals themselves; 9-10 are the
// landmarks.
import { readFileSync } from "node:fs";
import { CARS } from "../src/game/mods.ts";
import { RIVALS, rivalCar, rivalCarName } from "../src/game/rivals.ts";
import { LANDMARKS } from "../src/game/world.ts";

const fail = [];
const check = (c, m) => { if (!c) fail.push(m); };
const AR = /[؀-ۿ]/;
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
/** Lowercase, non-alphanumerics to a single hyphen, trimmed. What every
 *  section below turns a display name into before comparing it with an
 *  id. */
const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// --- 1. Every car has all three names, and they are distinct ----------
{
  const ids = new Set(), names = new Set(), ars = new Set();
  for (const c of CARS) {
    check(!!c.id && !!c.name && !!c.ar, `${c.id}: a car needs an id, a name and an Arabic name`);
    check(!ids.has(c.id), `duplicate id ${c.id}`);
    check(!names.has(c.name), `two cars called ${c.name}`);
    check(!ars.has(c.ar), `two cars called ${c.ar} in Arabic`);
    ids.add(c.id); names.add(c.name); ars.add(c.ar);
    check(AR.test(c.ar), `${c.id}: the Arabic name has no Arabic in it`);
    check(!AR.test(c.name), `${c.id}: the English name has Arabic in it`);
  }
  console.log(`${CARS.length} cars, every id, name and Arabic name distinct`);
}

// --- 2. The id is the English name, slugged ---------------------------
// Not decoration: the id is what a save stores, so a name that has
// wandered away from its id is a car whose file says one thing and whose
// badge says another. Trim words the id legitimately drops are listed,
// because "Sahara V12" -> sahara-v12 needs V12 and "Bareed 30
// Anniversary" -> anniversary-30 reorders.
{
  for (const c of CARS) {
    const s = slug(c.name);
    // The id must be built from the words of the name — every part of the
    // id has to appear in it. That catches a rename that leaves the id
    // behind without demanding they match character for character.
    const words = new Set(s.split("-"));
    const orphans = c.id.split("-").filter((part) => !words.has(part));
    check(orphans.length === 0,
      `${c.id}: "${c.name}" has nothing to do with ${orphans.join(", ")} — the id and the badge disagree`);
  }
  console.log("every id is made of words that are still in the car's name");
}

// --- 3. The Arabic says what the English says -------------------------
// The designator — the number, the trim code — has to survive the
// crossing. A player reading Arabic should be able to tell an Efreet RX
// from an Efreet RX Kai, and before this they could not.
{
  const toArabicDigits = (s) => s.replace(/\d/g, (d) => AR_DIGITS[+d]);
  for (const c of CARS) {
    const numbers = c.name.match(/\d+/g) ?? [];
    for (const n of numbers) {
      check(c.ar.includes(toArabicDigits(n)),
        `${c.id}: the English name has ${n} and the Arabic "${c.ar}" does not`);
    }
    // Latin trim codes (GTR, RX, RS, GT, S8...) must be represented too.
    // They are transliterated rather than translated, so this checks the
    // Arabic simply got LONGER than a bare marque would be — a name with
    // a designator cannot be one word.
    const hasCode = /\b(GTR|RX|RS|GT|Kai|Turbo|Sport|Anniversary|Special|V12|S8|R)\b/.test(c.name);
    if (hasCode) {
      check(c.ar.trim().split(/\s+/).length >= 2,
        `${c.id}: "${c.name}" carries a designator and the Arabic "${c.ar}" is a single word`);
    }
  }
  console.log("every number in an English name appears in its Arabic, and no designator is dropped");
}

// --- 4. Digits are Arabic-Indic in Arabic names -----------------------
{
  for (const c of CARS) {
    check(!/[0-9]/.test(c.ar), `${c.id}: "${c.ar}" uses Western digits`);
  }
  console.log("no Western digits in any Arabic car name");
}

// --- 5. A rival's machine is joined by id, not by its label -----------
// This is the one that would have bitten. engine.ts used to find a
// rival's car with `CARS.find((c) => c.name === def.car)` — a join
// through a display string. Renaming a car returned undefined silently:
// the rival kept their lines, their crew and their colour and turned up
// in a default shell with none of the numbers they were balanced
// against. Three cars were renamed in the change that added this test.
{
  const ids = new Set(CARS.map((c) => c.id));
  let armed = 0;
  for (const r of RIVALS) {
    if (!r.carId) continue;
    armed++;
    check(ids.has(r.carId), `${r.id} drives "${r.carId}", which is not a car`);
    check(rivalCar(r) !== undefined, `${r.id}: the lookup could not resolve their machine`);
    check(rivalCarName(r) !== "Street Tuned", `${r.id}: fell back to the generic label`);
  }
  check(armed === RIVALS.filter((r) => r.carId).length, "sanity");
  // ...and nothing may go back to matching on the name.
  const eng = readFileSync("src/game/engine.ts", "utf8");
  check(!/c\.name === def\.car/.test(eng), "engine.ts must not join rivals to cars by display name");
  console.log(`${armed} rivals joined to the showroom by id; every one resolves`);
}

// --- 6. Every rival has a name and an Arabic name, and they are distinct
// The cars have had this since the section above was written; the
// rivals never did — not even a check that two of the eight bosses
// couldn't be given the same name by mistake.
{
  const names = new Set(), ars = new Set();
  for (const r of RIVALS) {
    check(!!r.name && !!r.arabicName, `${r.id}: a rival needs a name and an Arabic name`);
    check(!names.has(r.name), `two rivals called ${r.name}`);
    check(!ars.has(r.arabicName), `two rivals called ${r.arabicName} in Arabic`);
    names.add(r.name); ars.add(r.arabicName);
    check(AR.test(r.arabicName), `${r.id}: the Arabic name has no Arabic in it`);
    check(!AR.test(r.name), `${r.id}: the English name has Arabic in it`);
  }
  console.log(`${RIVALS.length} rivals, every name and Arabic name distinct`);
}

// --- 7. A rival's id is their name, hyphens aside ----------------------
// Not section 2's algorithm unmodified: two rivals compound an "Al-"
// word straight into the id with no hyphen where a car id never does —
// bint-aldeera is "Bint Al-Deera" and shabah-alkhaleej is "Shabah
// Al-Khaleej". Splitting into words and checking membership, the way
// cars are checked, reports both as false failures — "aldeera" is not a
// word in "bint-al-deera". So this compares id and slugged name with
// every hyphen stripped instead: order-preserving, and still catches a
// rename that leaves the id behind.
{
  const bare = (s) => s.replace(/-/g, "");
  for (const r of RIVALS) {
    check(bare(r.id) === bare(slug(r.name)),
      `${r.id}: "${r.name}" does not match it — the id and the name disagree`);
  }
  console.log("every rival's id is their name, hyphens aside");
}

// --- 8. The rivals' Arabic carries their digits and designators, in
//        Arabic-Indic digits only -------------------------------------
// The same rule cars get in sections 3 and 4, run once rather than
// twice: no current rival name has a number or a recognised designator,
// so this fires on nothing today and starts protecting the day one does.
{
  const toArabicDigits = (s) => s.replace(/\d/g, (d) => AR_DIGITS[+d]);
  for (const r of RIVALS) {
    const numbers = r.name.match(/\d+/g) ?? [];
    for (const n of numbers) {
      check(r.arabicName.includes(toArabicDigits(n)),
        `${r.id}: the English name has ${n} and the Arabic "${r.arabicName}" does not`);
    }
    const hasCode = /\b(GTR|RX|RS|GT|Kai|Turbo|Sport|Anniversary|Special|V12|S8|R)\b/.test(r.name);
    if (hasCode) {
      check(r.arabicName.trim().split(/\s+/).length >= 2,
        `${r.id}: "${r.name}" carries a designator and the Arabic "${r.arabicName}" is a single word`);
    }
    check(!/[0-9]/.test(r.arabicName), `${r.id}: "${r.arabicName}" uses Western digits`);
  }
  console.log("every rival's Arabic name carries its digits and designators, and none use Western digits");
}

// --- 9. Every landmark has all three names, and they are distinct -----
// world.ts's LANDMARKS feeds the road map (roadmap.ts) and had never
// been read by a test at all — no duplicate check, no bilingual check,
// nothing.
{
  const ids = new Set(), names = new Set(), ars = new Set();
  for (const l of LANDMARKS) {
    check(!!l.id && !!l.name && !!l.arabic, `${l.id ?? l.name}: a landmark needs an id, a name and an Arabic name`);
    check(!ids.has(l.id), `duplicate landmark id ${l.id}`);
    check(!names.has(l.name), `two landmarks called ${l.name}`);
    check(!ars.has(l.arabic), `two landmarks called ${l.arabic} in Arabic`);
    ids.add(l.id); names.add(l.name); ars.add(l.arabic);
    check(AR.test(l.arabic), `${l.id}: the Arabic name has no Arabic in it`);
    check(!AR.test(l.name), `${l.id}: the English name has Arabic in it`);
    check(!/[0-9]/.test(l.arabic), `${l.id}: "${l.arabic}" uses Western digits`);
  }
  console.log(`${LANDMARKS.length} landmarks, every id, name and Arabic name distinct`);
}

// --- 10. A landmark's id is made of words from its name ----------------
// Unlike the rivals, landmark ids follow section 2's own convention —
// al-hamra drops "Tower" from "Al Hamra Tower" exactly the way a car id
// drops a trim word — so this reuses that algorithm rather than a third
// variant.
{
  for (const l of LANDMARKS) {
    const s = slug(l.name);
    const words = new Set(s.split("-"));
    const orphans = l.id.split("-").filter((part) => !words.has(part));
    check(orphans.length === 0,
      `${l.id}: "${l.name}" has nothing to do with ${orphans.join(", ")} — the id and the name disagree`);
  }
  console.log("every landmark id is made of words that are still in its name");
}

console.log(fail.length ? `\nFAILURES:\n  ${fail.join("\n  ")}` : "\nall green");
process.exit(fail.length ? 1 : 0);
