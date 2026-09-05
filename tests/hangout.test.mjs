#!/usr/bin/env node
/**
 * «رسّلها للربع» — the time rules and the message.
 *
 * No browser. What is under test is the part that decides what a group is
 * offered and what they end up reading in WhatsApp, and both are pure
 * functions of the clock and the place.
 *
 * The clock is the interesting half. Kuwait is UTC+3 with no daylight saving,
 * every hour here is a Kuwait wall-clock hour, and the machine running this
 * is on UTC — so a rule written against local time would pass in Kuwait and
 * fail in CI, or the reverse.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "wain-hangout-"));
const entry = join(dir, "entry.ts");
const bundle = join(dir, "hangout.mjs");
writeFileSync(
  entry,
  `export * from ${JSON.stringify(join(ROOT, "src/lib/hangout.ts"))};\n` +
    `export { places, getPlace } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};\n`
);
execSync(
  `npx esbuild ${JSON.stringify(entry)} --bundle --format=esm ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)}`,
  { stdio: "pipe", cwd: ROOT }
);
const H = await import(pathToFileURL(bundle).href);
rmSync(dir, { recursive: true, force: true });

let pass = 0;
const fails = [];
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fails.push(n); console.log(`  ✗ ${n}${d ? "\n      " + d : ""}`); } };

/** A Date whose Kuwait wall-clock hour is exactly `hour`. */
const atKuwait = (hour) => new Date(Date.UTC(2026, 7, 21, hour - 3, 30));

console.log("\n── the clock is Kuwait's, not the machine's ──");
ok("14:30 Kuwait reads as hour 14", H.kuwaitHour(atKuwait(14)) === 14, String(H.kuwaitHour(atKuwait(14))));
ok("01:30 Kuwait reads as hour 1", H.kuwaitHour(atKuwait(1)) === 1, String(H.kuwaitHour(atKuwait(1))));
// The UTC+3 offset must survive a date boundary: 01:30 in Kuwait is 22:30 the
// previous day in UTC, which a naive implementation reports as hour 22.
ok("and it does so across midnight", H.kuwaitHour(new Date("2026-08-20T22:30:00Z")) === 1,
  String(H.kuwaitHour(new Date("2026-08-20T22:30:00Z"))));

console.log("\n── an hour that has passed is not offered ──");
{
  const ids = (h) => H.whenOptions(atKuwait(h)).map((o) => o.id);
  ok("at 15:00 the whole evening is available", ids(15).includes("tonight-7") && ids(15).includes("tonight-10"), ids(15).join(","));
  ok("at 20:30 seven and eight are gone", !ids(20.5 | 0).includes("tonight-7") && !ids(20).includes("tonight-8"), ids(20).join(","));
  ok("but nine and ten remain", ids(20).includes("tonight-9") && ids(20).includes("tonight-10"), ids(20).join(","));
  ok("at 23:00 no tonight option survives", !ids(23).some((i) => i.startsWith("tonight")), ids(23).join(","));
  ok("and tomorrow and the weekend always do", ids(23).includes("tomorrow") && ids(23).includes("weekend"), ids(23).join(","));
  // With no place to judge, «الحين» cannot expire: nothing about the clock
  // alone rules it out. The place is what can — see the summer block below.
  ok("«الحين» is always offered — it cannot expire", [3, 12, 23].every((h) => ids(h).includes("now")));
}

console.log("\n── the summer rule reaches the plan, not just the advice ──");
/**
 * The site's most emphatic rule is that nobody is sent to an unshaded place in
 * the middle of a Kuwaiti August: شوق refuses it out loud, the search ranking
 * bends around it, and `defaultWhen` will not propose it. The share sheet did
 * it anyway. «الحين» sat in the chip row one tap away, and the message that
 * came out carried no hint the plan was a bad one — so the rule held
 * everywhere except the button that actually sends the plan to five people.
 *
 * Two halves, because the chips cannot cover it alone: «باچر» and «الويكند»
 * are days, not times, and a day in July is the sun. The message carries the
 * warning for those, and imports the sentence from voice-lines so the written
 * advice and the spoken advice cannot drift.
 */
{
  // Aug (month 7) and Dec (month 11) at a chosen Kuwait wall-clock hour.
  const at = (month, hour) => new Date(Date.UTC(2026, month, 15, hour - 3, 0));
  const bakes = H.places.find((p) => p.setting === "outdoor" && !p.summerOk);
  const roofed = H.places.find((p) => p.setting === "indoor");
  const shadedOutdoor = H.places.find((p) => p.setting === "outdoor" && p.summerOk === true);
  const ids = (p, d) => H.whenOptions(d, p).map((o) => o.id);

  ok("an unshaded place at noon in August offers no «الحين» and no «بعد ساعة»",
    !ids(bakes, at(7, 12)).includes("now") && !ids(bakes, at(7, 12)).includes("soon"),
    ids(bakes, at(7, 12)).join(","));
  ok("the same place at noon in December offers both",
    ids(bakes, at(11, 12)).includes("now") && ids(bakes, at(11, 12)).includes("soon"),
    ids(bakes, at(11, 12)).join(","));
  ok("and in August after dark offers both again",
    ids(bakes, at(7, 20)).includes("now") && ids(bakes, at(7, 20)).includes("soon"),
    ids(bakes, at(7, 20)).join(","));
  ok("an indoor place in August is untouched",
    ids(roofed, at(7, 12)).includes("now"), ids(roofed, at(7, 12)).join(","));
  // The catalogue's own escape hatch: outdoors, and fine in August, because
  // you are inside an air-conditioned car or a water park. Honoured here
  // exactly as the spoken path honours it.
  if (shadedOutdoor) {
    ok("an outdoor place marked summerOk is untouched",
      ids(shadedOutdoor, at(7, 12)).includes("now"),
      `${shadedOutdoor.nameAr}: ${ids(shadedOutdoor, at(7, 12)).join(",")}`);
  }

  const msg = (when, now) => H.hangoutMessage({ place: bakes, when, url: "u", now });
  ok("«باچر» in August carries the heat warning",
    /حر/.test(msg("tomorrow", at(7, 12))), msg("tomorrow", at(7, 12)).split("\n")[3] ?? "");
  ok("«الويكند» in August carries it too", /حر/.test(msg("weekend", at(7, 12))));
  // Redundant advice is ignored advice: «لا تروح إلا بعد المغرب» under a plan
  // that already says «الليلة الساعة ٨» trains people to skip the line.
  ok("an evening slot in August carries no warning", !/حر/.test(msg("tonight-8", at(7, 12))));
  ok("«باچر» in December carries none", !/حر/.test(msg("tomorrow", at(11, 12))));
}

console.log("\n── the default proposal suits the place and the hour ──");
{
  const outdoor = H.places.find((p) => p.setting === "outdoor" && !p.summerOk);
  const indoor = H.places.find((p) => p.setting === "indoor");
  ok("an open-air place at 09:00 is proposed for the evening",
    H.defaultWhen(outdoor, atKuwait(9)) === "tonight-8", H.defaultWhen(outdoor, atKuwait(9)));
  ok("an indoor place at 09:00 can be proposed for an hour from now",
    H.defaultWhen(indoor, atKuwait(9)) === "soon", H.defaultWhen(indoor, atKuwait(9)));
  ok("at 21:00 the default is a time still ahead",
    H.defaultWhen(indoor, atKuwait(21)) === "tonight-10", H.defaultWhen(indoor, atKuwait(21)));
  ok("after the evening is gone, the default is tomorrow",
    H.defaultWhen(indoor, atKuwait(23)) === "tomorrow", H.defaultWhen(indoor, atKuwait(23)));
  // A default that is not on the menu is a chip nobody can see selected.
  for (const h of [0, 6, 9, 13, 18, 20, 21, 22, 23]) {
    for (const p of [outdoor, indoor]) {
      const d = H.defaultWhen(p, atKuwait(h));
      if (!H.whenOptions(atKuwait(h)).some((o) => o.id === d)) {
        ok(`the default at ${h}:00 is one of the offered options`, false, `${d} not offered`);
      }
    }
  }
  ok("the default is always one of the offered options", true);

  // The small hours. `hour < 12` on its own is every hour before noon, which
  // includes two in the morning — and there it proposed «بعد ساعة» for an
  // indoor place: the group gets asked to a mall at three. The check above
  // passed it happily, because «بعد ساعة» is genuinely on the menu at 03:00;
  // being offerable and being sendable are not the same question.
  for (const h of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const d = H.defaultWhen(indoor, atKuwait(h));
    ok(`at ${String(h).padStart(2, "0")}:00 an indoor place is not proposed for an hour from now`,
      d !== "soon", d);
  }
  ok("and from 09:00 it is again — the fix is a floor, not a removal",
    H.defaultWhen(indoor, atKuwait(9)) === "soon" && H.defaultWhen(indoor, atKuwait(11)) === "soon",
    `${H.defaultWhen(indoor, atKuwait(9))} / ${H.defaultWhen(indoor, atKuwait(11))}`);
  ok("what the small hours get instead is the coming evening",
    H.defaultWhen(indoor, atKuwait(3)) === "tonight-8", H.defaultWhen(indoor, atKuwait(3)));
}

console.log("\n── how long until the offer changes ──");
{
  // Every expiry is on the hour, so this is what the panel sleeps for. It has
  // to be Kuwait's hour: a device in Tehran or Delhi sits on a half-hour
  // offset, and rounding to the next LOCAL hour would wake it thirty minutes
  // early or late every single time.
  const ms = (h, m) => H.msToNextKuwaitHour(new Date(Date.UTC(2026, 7, 21, h - 3, m)));
  ok("half past leaves half an hour", ms(19, 30) === 30 * 60_000, String(ms(19, 30) / 60_000));
  ok("a minute to leaves a minute", ms(19, 59) === 60_000, String(ms(19, 59) / 60_000));
  ok("on the hour leaves a full hour, never zero", ms(19, 0) === 3600_000, String(ms(19, 0)));
  ok("it is never zero or negative at any minute",
    [...Array(60).keys()].every((m) => ms(21, m) > 0 && ms(21, m) <= 3600_000));
  // The half-hour zone this exists for: the same instant, read from a device
  // whose own clock says :00, still has to answer with Kuwait's remainder.
  const tehranish = new Date(Date.UTC(2026, 7, 21, 16, 30)); // 19:30 in Kuwait
  ok("a half-hour offset does not shift the answer",
    H.msToNextKuwaitHour(tehranish) === 30 * 60_000, String(H.msToNextKuwaitHour(tehranish) / 60_000));
}

console.log("\n── the message a group actually receives ──");
{
  const place = H.getPlace("kuwait-towers");
  const url = "https://www.wainkw.com/places/kuwait-towers/";
  const msg = H.hangoutMessage({ place, when: "tonight-8", url });
  console.log("      " + msg.replace(/\n/g, "\n      "));
  ok("it names the place", msg.includes(place.nameAr));
  ok("and the area", msg.includes(place.areaAr));
  ok("it says when, in words", msg.includes("الليلة الساعة ٨"));
  ok("it carries a map link to the coordinates",
    msg.includes(`destination=${place.lat},${place.lng}`));
  ok("and the page link, last", msg.trim().endsWith(url), msg.slice(-60));
  ok("it says why the place is worth going to", msg.includes(place.taglineAr));
  // A message half in ٨ and half in 8 reads like it came from software.
  const digitsOutsideLinks = msg
    .split("\n")
    .filter((l) => !l.includes("http"))
    .join("");
  ok("no Western digits outside the links", !/[0-9]/.test(digitsOutsideLinks), digitsOutsideLinks);
}

console.log("\n── every option produces a sentence ──");
{
  const place = H.getPlace("kuwait-towers");
  const empty = [];
  for (const o of H.whenOptions(atKuwait(10))) {
    const p = H.phraseFor(o.id);
    if (!p || !p.trim()) empty.push(o.id);
  }
  ok("no option has a blank phrase", empty.length === 0, empty.join(","));
  ok("an unknown id yields an empty phrase rather than throwing", H.phraseFor("nonsense") === "");
  // …and that empty phrase must not silently produce a message with a blank
  // line where the time should be, which would ship a plan with no time in it.
  const broken = H.hangoutMessage({ place, when: "nonsense", url: "x" });
  ok("a message with no valid time is visibly missing it, not silently wrong",
    broken.split("\n")[1] === "", JSON.stringify(broken.split("\n")[1]));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
