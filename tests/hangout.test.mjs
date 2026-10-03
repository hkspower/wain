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
    `export { parseDay, addDays, weekday, SUNSET_KW, WEEKDAY_AR } from ${JSON.stringify(join(ROOT, "src/lib/plan-date.ts"))};\n` +
    `export { calendarEntry, icsEscape, foldLine, kuwaitToUtcStamp, hasCalendarEntry, icsUid } from ${JSON.stringify(join(ROOT, "src/lib/hangout-calendar.ts"))};\n` +
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

console.log("\n── the invitation survives being forwarded ──");
/**
 * This module opens by saying that «شرايكم؟» with a link is a new thread, and
 * that what ends the argument is a proposal: this place, at this time. The
 * message was built that way — and the URL inside it was the bare place page.
 * So the first person to forward just the link sent the group straight back to
 * «شرايكم؟» with the one thing that made it a plan stripped off, and forwarding
 * a link is one gesture, so that is the common case rather than the odd one.
 */
{
  const place = H.getPlace("kuwait-towers");
  const url = H.inviteUrl(place, "tonight-8", "https://www.wainkw.com");
  ok("the invite link carries the time", /[?&]when=tonight-8$/.test(url), url);
  ok("and points at the place", url.includes("/places/kuwait-towers/"), url);

  // Built from the slug, not the address bar. Sharing onward from a page that
  // was itself opened through an invitation used to compound the parameter —
  // or, worse, keep the first time on a share of the second.
  ok("a forwarded-on invite does not compound the parameter",
    H.inviteUrl(place, "tomorrow", "https://www.wainkw.com").match(/when=/g).length === 1,
    H.inviteUrl(place, "tomorrow", "https://www.wainkw.com"));
  ok("a trailing slash on the origin does not double up",
    !H.inviteUrl(place, "now", "https://www.wainkw.com/").includes("com//"),
    H.inviteUrl(place, "now", "https://www.wainkw.com/"));

  ok("a time in the query is read back", H.readInvite("?when=tonight-9") === "tonight-9");
  ok("no parameter is not an invitation", H.readInvite("") === null);
  // Whatever is in the query arrived from whatever anyone pasted, and it is
  // about to be rendered. An unknown value is not an error to report — it is
  // simply not an invitation, and the page carries on as a place page.
  for (const junk of ["?when=<script>", "?when=tonight-99", "?when=", "?other=1"]) {
    ok(`«${junk}» is not an invitation`, H.readInvite(junk) === null, String(H.readInvite(junk)));
  }

  // Only the fixed evening slots can be known to have passed. «الحين» is
  // relative to a moment the link does not carry, so claiming it had expired
  // would be inventing a fact.
  ok("an eight o'clock invite has not passed at 17:00", !H.invitePassed("tonight-8", atKuwait(17)));
  ok("and has passed at 21:00", H.invitePassed("tonight-8", atKuwait(21)));
  ok("«باچر» is never claimed to have passed", !H.invitePassed("tomorrow", atKuwait(23)));
  ok("«الحين» is never claimed to have passed", !H.invitePassed("now", atKuwait(23)));

  const reply = H.inviteAcceptMessage(place, "tonight-8");
  ok("the reply names the place and the time",
    reply.includes(place.nameAr) && reply.includes("الليلة الساعة ٨"), reply);
  // A confirmation that restates the whole proposal is a second proposal.
  ok("and stays short", reply.length < 70, `${reply.length} chars`);
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
  // A market that is over by noon was told «لا تروح إلا بعد المغرب»: the
  // group would have driven to an empty lot. The morning places get the line
  // شوق says about them out loud (summerKey in voice-lines, 3 October).
  const market = H.places.find((p) => p.slug === "friday-market");
  const early = H.hangoutMessage({ place: market, when: "tomorrow", url: "u", now: at(7, 12) });
  ok("a morning market's «باچر» in August says go early, not after sunset",
    early.includes("بدري الصبح") && !early.includes("المغرب"), early.split("\n")[4] ?? "");
}

console.log("\n── the default proposal suits the place and the hour ──");
{
  const outdoor = H.places.find((p) => p.setting === "outdoor" && !p.summerOk);
  const indoor = H.places.find((p) => p.setting === "indoor");
  // `atKuwait` is an August day: an open-air place is proposed for after
  // sunset — the words شوق uses for every summer plan, and until 3 October the
  // one time this panel could not send. In December the evening hour is back.
  ok("an open-air place at 09:00 in August is proposed for after sunset",
    H.defaultWhen(outdoor, atKuwait(9)) === "sunset", H.defaultWhen(outdoor, atKuwait(9)));
  ok("and in December for the evening",
    H.defaultWhen(outdoor, new Date(Date.UTC(2026, 11, 15, 6, 30))) === "tonight-8",
    H.defaultWhen(outdoor, new Date(Date.UTC(2026, 11, 15, 6, 30))));
  ok("after seven in August the present tense takes over — no «عقب المغرب» to propose",
    H.defaultWhen(outdoor, atKuwait(19)) !== "sunset" && !H.whenOptions(atKuwait(19)).some((o) => o.id === "sunset"),
    H.defaultWhen(outdoor, atKuwait(19)));
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

console.log("\n── the link carries the day it was sent ──");
/**
 * «باچر» on its own means a different day to each reader, and the module
 * said so: «an invite for الحين opened three hours later is stale and
 * nothing here can know it». The day travels in the link now (plan-date.ts).
 * Everything below is on Kuwait's clock; the machine running this is on UTC.
 */
{
  const place = H.getPlace("kuwait-towers");
  const sent = new Date(Date.UTC(2026, 9, 3, 12, 0)); // Sat 3 Oct 2026, 15:00 Kuwait
  ok("the day is Kuwait's, not UTC's: 23:30Z is already the 4th", H.kuwaitDay(new Date("2026-10-03T23:30:00Z")) === "2026-10-04");
  const url = H.inviteUrl(place, "tomorrow", "https://www.wainkw.com", H.kuwaitDay(sent));
  ok("the invite link carries the sending day", /[?&]d=2026-10-03$/.test(url), url);
  ok("a link built without a day is exactly the old link",
    H.inviteUrl(place, "tomorrow", "https://www.wainkw.com") === "https://www.wainkw.com/places/kuwait-towers/?when=tomorrow");
  ok("the day is read back", H.readInviteDay("?when=tomorrow&d=2026-10-03") === "2026-10-03");
  ok("and the time still is, unchanged", H.readInvite("?when=tomorrow&d=2026-10-03") === "tomorrow");
  for (const junk of ["?d=2026-02-30", "?d=2026-13-01", "?d=2026-2-3", "?d=<script>", "?d=", "?when=now"]) {
    ok(`«${junk}» carries no day`, H.readInviteDay(junk) === null, String(H.readInviteDay(junk)));
  }
  ok("a leap day is a real day", H.parseDay("2028-02-29") === "2028-02-29");
  ok("a shortlist link carries it too and reads it back",
    /&d=2026-10-03$/.test(H.shortlistUrl([place, H.getPlace("marina-beach")], "weekend", "https://www.wainkw.com", "2026-10-03")) &&
      H.readShortlist("?p=kuwait-towers,marina-beach&when=weekend&d=2026-10-03", () => true).day === "2026-10-03");
  ok("and without one reads null, not undefined", H.readShortlist("?p=kuwait-towers,marina-beach", () => true).day === null);
}

console.log("\n── what a dated plan means, and when it has gone ──");
{
  const at = (iso) => new Date(iso);
  const r = (when, day, now) => H.resolvePlan(when, day, at(now));
  // tonight-8 sent today: the hour decides, exactly as the undated rule did.
  ok("tonight-8, same day, 19:59 Kuwait: not passed", !r("tonight-8", "2026-10-03", "2026-10-03T16:59:00Z").passed);
  ok("tonight-8, same day, 20:00 Kuwait: passed", r("tonight-8", "2026-10-03", "2026-10-03T17:00:00Z").passed);
  // The defect this fixes: an eight o'clock invite from yesterday, opened at
  // ten in the morning, used to read as a plan still ahead.
  ok("tonight-8 sent yesterday has passed at 10:00 today", r("tonight-8", "2026-10-02", "2026-10-03T07:00:00Z").passed);
  ok("…and the undated rule still says it has not", !H.invitePassed("tonight-8", at("2026-10-03T07:00:00Z")));
  ok("while the dated one, through invitePassed, says it has", H.invitePassed("tonight-8", at("2026-10-03T07:00:00Z"), "2026-10-02"));
  // «باچر» is the day after the SENDING day, on Kuwait's calendar.
  const tm = r("tomorrow", "2026-10-03", "2026-10-03T12:00:00Z");
  ok("«باچر» sent on the 3rd is the 4th", tm.date === "2026-10-04", tm.date);
  ok("…a Sunday", tm.weekdayAr === "الأحد", tm.weekdayAr);
  ok("it carries the calendar's default hour, marked as a default", tm.hour === 20 && tm.hourKind === "default");
  ok("not passed at 23:59 Kuwait on the 4th (20:59Z)", !r("tomorrow", "2026-10-03", "2026-10-04T20:59:00Z").passed);
  ok("passed at 00:00 Kuwait on the 5th (21:00Z on the 4th)", r("tomorrow", "2026-10-03", "2026-10-04T21:00:00Z").passed);
  ok("month rollover: «باچر» on 31 Oct is 1 Nov", r("tomorrow", "2026-10-31", "2026-10-31T12:00:00Z").date === "2026-11-01");
  ok("year rollover: «باچر» on 31 Dec is 1 Jan", r("tomorrow", "2026-12-31", "2026-12-31T12:00:00Z").date === "2027-01-01");
  ok("leap year: «باچر» on 28 Feb 2028 is the 29th", r("tomorrow", "2028-02-28", "2028-02-28T12:00:00Z").date === "2028-02-29");
  // «الويكند»: the coming Friday — except on a Friday, where it means this
  // weekend and resolves to Saturday; on Saturday it is next Friday.
  const wk = (day) => r("weekend", day, `${day}T12:00:00Z`);
  ok("«الويكند» on Wed 30 Sep is Fri 2 Oct", wk("2026-09-30").date === "2026-10-02" && wk("2026-09-30").weekdayAr === "الجمعة", wk("2026-09-30").date);
  ok("on Thu 1 Oct it is Fri 2 Oct", wk("2026-10-01").date === "2026-10-02");
  ok("on Fri 2 Oct it is Sat 3 Oct — this weekend, not next", wk("2026-10-02").date === "2026-10-03" && wk("2026-10-02").weekdayAr === "السبت");
  ok("on Sat 3 Oct it is Fri 9 Oct", wk("2026-10-03").date === "2026-10-09");
  ok("on Sun 4 Oct it is Fri 9 Oct", wk("2026-10-04").date === "2026-10-09");
  ok("a weekend has passed once its Saturday has", r("weekend", "2026-09-30", "2026-10-04T12:00:00Z").passed && !r("weekend", "2026-09-30", "2026-10-03T12:00:00Z").passed);
  // «الحين» has a day and no hour; it has gone once the day has.
  ok("«الحين» sent yesterday has passed", r("now", "2026-10-02", "2026-10-03T07:00:00Z").passed && r("now", "2026-10-02", "2026-10-03T07:00:00Z").hour === null);
  ok("«الحين» sent today has not", !r("now", "2026-10-03", "2026-10-03T07:00:00Z").passed);
  // The phrase gains the weekday only where a day-word needs one.
  ok("«باچر» is printed with its weekday", H.planPhrase("tomorrow", "2026-10-03") === "باچر الأحد", H.planPhrase("tomorrow", "2026-10-03"));
  ok("so is «الويكند»", H.planPhrase("weekend", "2026-10-03") === "الويكند — الجمعة", H.planPhrase("weekend", "2026-10-03"));
  ok("«الليلة الساعة ٨» is not", H.planPhrase("tonight-8", "2026-10-03") === "الليلة الساعة ٨");
  ok("and without a day the phrase is the bare one", H.planPhrase("tomorrow", null) === "باچر");
  const msg = H.hangoutMessage({ place: H.getPlace("kuwait-towers"), when: "tomorrow", url: "u", now: at("2026-10-03T12:00:00Z") });
  ok("the message itself says which day «باچر» is", msg.split("\n")[1] === "باچر الأحد", msg.split("\n")[1]);
}

console.log("\n── «عقب المغرب» ──");
{
  const ids = (h) => H.whenOptions(atKuwait(h)).map((o) => o.id);
  ok("it is offered in the afternoon", ids(15).includes("sunset"), ids(15).join(","));
  ok("first among the evening options", ids(15).indexOf("sunset") < ids(15).indexOf("tonight-7"), ids(15).join(","));
  ok("and gone from seven, like the seven o'clock slot", !ids(19).includes("sunset"), ids(19).join(","));
  ok("its phrase is the words, with no clock time in them", H.phraseFor("sunset") === "عقب المغرب");
  const bakes = H.places.find((p) => p.setting === "outdoor" && !p.summerOk);
  const msg = H.hangoutMessage({ place: bakes, when: "sunset", url: "u", now: new Date(Date.UTC(2026, 6, 15, 9, 0)) });
  ok("a July plan for after sunset carries no heat warning — it IS the advice", !/حر/.test(msg), msg);
  ok("the sunset table has twelve months, all between 16:55 and 18:55",
    H.SUNSET_KW.length === 12 && H.SUNSET_KW.every(([h, m]) => h * 60 + m >= 16 * 60 + 55 && h * 60 + m <= 18 * 60 + 55));
  ok("latest in June and July, earliest in December",
    H.SUNSET_KW[5][0] * 60 + H.SUNSET_KW[5][1] === Math.max(...H.SUNSET_KW.map(([h, m]) => h * 60 + m)) &&
      H.SUNSET_KW[11][0] * 60 + H.SUNSET_KW[11][1] === Math.min(...H.SUNSET_KW.map(([h, m]) => h * 60 + m)));
  const plan = H.resolvePlan("sunset", "2026-07-15", new Date(Date.UTC(2026, 6, 15, 9, 0)));
  ok("a July sunset plan resolves to an approximate hour, marked as such", plan.hour === 18 && plan.minute === 55 && plan.hourKind === "approx");
}

console.log("\n── the shortlist says enough to choose from ──");
{
  const list = [H.getPlace("kuwait-towers"), H.getPlace("souq-al-mubarakiya"), H.getPlace("marina-beach")];
  const now = new Date(Date.UTC(2026, 6, 15, 9, 0)); // July, noon Kuwait
  const msg = H.shortlistMessage({ places: list, when: "tomorrow", url: "VOTE", now });
  console.log("      " + msg.replace(/\n/g, "\n      "));
  ok("every place is numbered", /١\. /.test(msg) && /٢\. /.test(msg) && /٣\. /.test(msg));
  ok("every place says why it is worth it", list.every((p) => msg.includes(p.taglineAr)));
  ok("and where it is, as a map link each", list.every((p) => msg.includes(`destination=${p.lat},${p.lng}`)));
  ok("the heading says which day «باچر» is", msg.startsWith("وين نروح باچر الخميس؟"), msg.split("\n")[0]);
  // July, a daytime plan: every open-air place on the list gets its line, the
  // indoor one gets none — the warning sits in the block of the place it is
  // about, not once under the whole list.
  const blocks = msg.split("\n\n").slice(1, -1);
  const hot = list.map((p) => p.setting !== "indoor" && !p.summerOk);
  ok("the heat line is in each hot place's own block and in no other",
    blocks.every((b, i) => /حر|المغرب|الصبح/.test(b) === hot[i]), blocks.map((b, i) => `${i}:${/حر|المغرب|الصبح/.test(b)}/${hot[i]}`).join(" "));
  ok("the vote link is last", msg.trim().endsWith("صوّتوا هني: VOTE"));
  const vote = H.shortlistVoteMessage(list[1], 1, "tomorrow", "https://www.wainkw.com/places/souq-al-mubarakiya/?when=tomorrow&d=2026-07-15", "2026-07-15");
  ok("a vote names its number, the place and the day", vote.startsWith("أنا مع ٢: ") && vote.includes("باچر الخميس"), vote);
  ok("and carries the place's link under it", vote.split("\n")[1]?.startsWith("https://www.wainkw.com/places/souq-al-mubarakiya/"), vote);
  ok("without a link it is one line, as before", !H.shortlistVoteMessage(list[1], 1, "tomorrow").includes("\n"));
  ok("five choices, everywhere", H.CHOICE_MAX === 5);
}

console.log("\n── the calendar entry ──");
/**
 * RFC 5545 is picky in ways a reader never sees: CRLF ends, lines of 75
 * OCTETS (an Arabic letter is two), commas escaped. A file that breaks one
 * of them opens as nothing on a phone, with no error anybody can read.
 */
{
  const place = H.getPlace("kuwait-towers");
  const now = new Date("2026-10-03T12:00:00Z");
  const url = "https://www.wainkw.com/places/kuwait-towers/?when=tonight-8&d=2026-10-03";
  const entry = H.calendarEntry({ place, when: "tonight-8", day: "2026-10-03", phrase: "الليلة الساعة ٨", url, mapsUrl: "https://www.google.com/maps/dir/?api=1&destination=1,2", now });
  const lines = entry.ics.split("\r\n");
  ok("CRLF line ends and no bare newline", !/[^\r]\n/.test(entry.ics) && entry.ics.endsWith("\r\n"));
  const enc = new TextEncoder();
  ok("no line longer than 75 octets", lines.every((l) => enc.encode(l).length <= 75), String(Math.max(...lines.map((l) => enc.encode(l).length))));
  ok("continuation lines start with one space", lines.filter((l) => l.startsWith(" ")).length > 0);
  // Unfold and read the fields back.
  const unfolded = entry.ics.replace(/\r\n /g, "").split("\r\n");
  const field = (k) => unfolded.find((l) => l.startsWith(k + ":") || l.startsWith(k + ";"))?.slice(k.length + 1);
  ok("8 pm Kuwait on 3 Oct is 17:00Z", field("DTSTART") === "20261003T170000Z", field("DTSTART"));
  ok("two hours long", field("DTEND") === "20261003T190000Z", field("DTEND"));
  ok("stamped with the moment it was made", field("DTSTAMP") === "20261003T120000Z", field("DTSTAMP"));
  ok("the id is deterministic", field("UID") === "2026-10-03-tonight-8-kuwait-towers@wainkw.com" && H.icsUid("x", "now", "2026-01-01") === "2026-01-01-now-x@wainkw.com");
  ok("the summary names the place", field("SUMMARY").includes(place.nameAr));
  ok("the Arabic comma in the location is untouched, the ASCII ones in the map link are escaped",
    field("LOCATION").includes("،") && field("DESCRIPTION").includes("destination=1\\,2"), field("DESCRIPTION"));
  ok("GEO carries the pin with a raw semicolon", field("GEO") === `${place.lat};${place.lng}`);
  ok("the wain link is in URL", field("URL") === url);
  ok("BEGIN and END are balanced", unfolded.filter((l) => l.startsWith("BEGIN:")).length === 2 && unfolded.filter((l) => l.startsWith("END:")).length === 2);
  ok("the Google link carries the same dates and the Kuwait zone",
    entry.google.includes("dates=20261003T170000Z%2F20261003T190000Z") && entry.google.includes("ctz=Asia%2FKuwait") && entry.google.includes("action=TEMPLATE"), entry.google);
  ok("the file is named for the place and the day", entry.filename === "wain-kuwait-towers-2026-10-03.ics");
  // Folding must never split a letter: every line decodes as whole UTF-8.
  const long = H.foldLine("SUMMARY:" + "طلعة مع الربع على البحر ".repeat(8));
  ok("a long Arabic line folds without splitting a letter",
    long.split("\r\n").every((l) => enc.encode(l).length <= 75 && !/�/.test(new TextDecoder("utf-8", { fatal: false }).decode(enc.encode(l)))) &&
      long.replace(/\r\n /g, "") === "SUMMARY:" + "طلعة مع الربع على البحر ".repeat(8));
  ok("escaping: backslash, semicolon, comma, newline", H.icsEscape("a\\b;c,d\ne") === "a\\\\b\\;c\\,d\\ne");
  // A 01:00 Kuwait start is 22:00Z the day before.
  ok("a one o'clock start lands on the previous UTC day", H.kuwaitToUtcStamp("2026-10-04", 1, 0) === "20261003T220000Z");
  // Which plans get an entry at all.
  ok("«باچر» with a day gets an entry, at the default evening hour, flagged",
    H.hasCalendarEntry("tomorrow", "2026-10-03") &&
      H.calendarEntry({ place, when: "tomorrow", day: "2026-10-03", phrase: "باچر", url, mapsUrl: "m", now }).ics.includes("DTSTART:20261004T170000Z") &&
      H.calendarEntry({ place, when: "tomorrow", day: "2026-10-03", phrase: "باچر", url, mapsUrl: "m", now }).ics.replace(/\r\n /g, "").includes("افتراضية"));
  ok("«عقب المغرب» says the hour is approximate",
    H.calendarEntry({ place, when: "sunset", day: "2026-10-03", phrase: "عقب المغرب", url, mapsUrl: "m", now }).ics.replace(/\r\n /g, "").includes("تقريبي"));
  ok("«الحين» and «بعد ساعة» get none, nor does a link with no day",
    !H.hasCalendarEntry("now", "2026-10-03") && !H.hasCalendarEntry("soon", "2026-10-03") && !H.hasCalendarEntry("tonight-8", null));
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log("FAILED: " + fails.join(" | ")); process.exit(1); }
