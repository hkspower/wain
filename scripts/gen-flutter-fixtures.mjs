#!/usr/bin/env node
/**
 * Records the web's own answers for the helpers the Flutter app re-implements
 * by hand — count agreement, distances, place variants, speech preparation,
 * and the whole hangout planner — so the Dart ports are checked against the
 * originals instead of against the porter's reading of them.
 *   npm run flutter:fixtures     (add --check to diff without writing)
 *
 * Search has its own oracle (gen-flutter-search.mjs). This one covers the rest
 * of the logic that is written twice on purpose, because Dart cannot import
 * TypeScript.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "flutter_app/test/fixtures/kit_parity.json");
const CHECK = process.argv.includes("--check");

const tmp = mkdtempSync(join(tmpdir(), "wain-flutter-fixtures-"));
const entry = join(tmp, "entry.ts");
writeFileSync(
  entry,
  [
    `export * from ${JSON.stringify(join(ROOT, "src/lib/place-kit.ts"))};`,
    `export * from ${JSON.stringify(join(ROOT, "src/lib/voice-lines.ts"))};`,
    `export * from ${JSON.stringify(join(ROOT, "src/lib/hangout.ts"))};`,
    `export { parseDay, addDays, weekday, hasCalendarEntry } from ${JSON.stringify(join(ROOT, "src/lib/plan-date.ts"))};`,
    `export { calendarEntry } from ${JSON.stringify(join(ROOT, "src/lib/hangout-calendar.ts"))};`,
    `export * from ${JSON.stringify(join(ROOT, "src/lib/find-moment.ts"))};`,
    `export { formatKwd, parseKwd, timeAr, pickupSlots, orderReference, normalisePhone, validateOrder, buildOrderMessage, whatsappOrderUrl, cancelOrderMessage, MAX_NOTE_CHARS } from ${JSON.stringify(join(ROOT, "src/lib/order-kit.ts"))};`,
    `export { places } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};`,
  ].join("\n")
);
const bundle = join(tmp, "entry.mjs");
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm --platform=node ` +
    `--alias:@=${JSON.stringify(join(ROOT, "src"))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: "pipe" }
);
const K = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

const F = {};

// count agreement: every n that matters, for every form set
const forms = { places: K.PLACES_COUNT, minutes: K.MINUTES_COUNT, hours: K.HOURS_COUNT, results: K.RESULTS_COUNT };
F.countAr = {};
for (const [name, f] of Object.entries(forms))
  F.countAr[name] = Array.from({ length: 126 }, (_, n) => K.countAr(n, f));

F.toArabicNumber = [4.7, 0.05, 12.35, 1.005, 2.5, 0.35, 4.44, 4.45, 9.99, 0, 100].flatMap((v) => [
  { v, d: 1, out: K.toArabicNumber(v) },
  { v, d: 2, out: K.toArabicNumber(v, 2) },
]);

const kms = [0, 0.04, 0.05, 0.149, 0.15, 0.25, 0.3, 0.35, 0.95, 0.999, 1, 1.04, 1.05, 1.25, 1.5, 1.75, 2, 2.449, 2.95, 7.3, 12.05, 25, 40.6];
F.distanceAr = kms.flatMap((km) => [
  { km, rough: false, out: K.distanceAr(km) },
  { km, rough: true, out: K.distanceAr(km, true) },
]);

const ps = K.places;
F.distanceKm = ps.slice(0, 10).map((a, i) => {
  const b = ps[(i * 7 + 3) % ps.length];
  return { a: [a.lat, a.lng], b: [b.lat, b.lng], km: K.distanceKm(a, b) };
});
F.placeVariant = Object.fromEntries(ps.map((p) => [p.slug, K.placeVariant(p.slug)]));
// Counts, not a zero: the catalogue decides, and the Dart port has to agree
// with it whichever way it reads (3 October — menus are on their way).
F.orders = {
  orders: ps.filter((p) => K.acceptsOrders(p)).length,
  queue: ps.filter((p) => K.takesQueue(p)).length,
  whatsapp: ps.filter((p) => K.acceptsOrders(p) && !!p.orderWhatsApp).length,
};

// speech preparation
const lines = { shouq: K.buildClipLines("shouq", ps), salem: K.buildClipLines("salem", ps) };
F.clipLines = lines;
F.forSpeech = [...Object.values(lines.shouq), "٣٦٠ درجة", "٤٫٨ نجمة", "چاي — مچبوس", "  سمچ   و\u067eيتزا \u06a4يلا  ", "\u06a9 \u06cc \u06af", ""].map((t) => ({ t, out: K.forSpeech(t) }));

// the hangout planner, across hours and seasons
const setting = (s) => ps.filter((p) => p.setting === s);
const sample = [...setting("outdoor").slice(0, 2), ...setting("mixed").slice(0, 2), ...setting("indoor").slice(0, 2), ps.find((p) => p.summerOk)].filter(Boolean);
const instants = [];
for (const [month, hours] of [[0, [1, 8, 10, 14, 19, 23]], [6, [0, 3, 8, 9, 10, 11, 12, 15, 17, 18, 19, 20, 21, 22, 23]], [4, [13]], [5, [9, 18]], [8, [12, 18]], [9, [12]]])
  for (const h of hours) instants.push(new Date(Date.UTC(2026, month, 15, (h - 3 + 24) % 24, 5)));
instants.push(new Date(Date.UTC(2026, 5, 30, 22, 30))); // 01:30 Kuwait, next month
F.hangout = {
  instants: instants.map((d) => d.toISOString()),
  cases: instants.map((now) => ({
    now: now.toISOString(),
    hour: K.kuwaitHour(now),
    month: K.kuwaitMonth(now),
    msToNext: K.msToNextKuwaitHour(now),
    options: K.whenOptions(now).map((o) => o.id),
    perPlace: sample.map((p) => ({
      slug: p.slug,
      options: K.whenOptions(now, p).map((o) => o.id),
      default: K.defaultWhen(p, now),
      messages: Object.fromEntries(
        ["now", "soon", "sunset", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow", "weekend"].map((w) => [
          w,
          K.hangoutMessage({ place: p, when: w, url: K.inviteUrl(p, w, "https://www.wainkw.com/"), now }),
        ])
      ),
      passed: Object.fromEntries(["now", "sunset", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow"].map((w) => [w, K.invitePassed(w, now)])),
    })),
  })),
  phrases: Object.fromEntries(["now", "soon", "sunset", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow", "weekend"].map((w) => [w, K.phraseFor(w)])),
  accept: sample.slice(0, 2).map((p) => K.inviteAcceptMessage(p, "tonight-8")),
  title: sample.slice(0, 2).map((p) => K.hangoutTitle(p)),
  readInvite: ["?when=tonight-8", "when=now", "?when=bogus", "", "?x=1&when=weekend", "?when=", "?when=tonight-8&when=now"].map((s) => ({ s, out: K.readInvite(s) })),
};

// «خلّهم يختارون»: the shortlist, at the same instants, for lists that mix
// what the summer rule treats differently (and one longer than three).
const lists = [
  [setting("outdoor")[0], setting("indoor")[0], setting("mixed")[0]],
  [setting("indoor")[0], setting("indoor")[1]],
  [setting("mixed")[1], setting("outdoor")[1]],
  [setting("outdoor")[0], setting("outdoor")[1], setting("mixed")[0], setting("indoor")[0]],
];
const known = new Set(ps.map((p) => p.slug));
const ws = ["now", "soon", "tonight-8", "tonight-10", "tomorrow", "weekend"];
F.shortlist = {
  cases: instants.map((now) => ({
    now: now.toISOString(),
    lists: lists.map((list) => ({
      slugs: list.map((p) => p.slug),
      options: K.whenOptionsFor(list, now).map((o) => o.id),
      default: K.defaultWhenFor(list, now),
      messages: Object.fromEntries(
        ws.map((w) => [w, K.shortlistMessage({ places: list, when: w, url: K.shortlistUrl(list, w, "https://www.wainkw.com/"), now })])
      ),
    })),
  })),
  urls: [
    ...lists.map((list) => K.shortlistUrl(list, "tonight-8", "https://www.wainkw.com//")),
    // With a poll (7 October), and with one that is not a poll id.
    K.shortlistUrl(lists[0], "tomorrow", "https://www.wainkw.com", "2026-10-07", "abc123def456"),
    K.shortlistUrl(lists[0], "tomorrow", "https://www.wainkw.com", "2026-10-07", "NOT-a-poll"),
  ],
  read: [
    `?p=${lists[0].map((p) => p.slug).join(",")}&when=tonight-8`,
    `?p=${ps[0].slug},${ps[0].slug},${ps[1].slug}`,
    `?p=${ps[0].slug}`,
    `?p=${ps[0].slug},not-a-place,${ps[2].slug}&when=bogus`,
    `?p=${ps[0].slug},${ps[1].slug},${ps[2].slug},${ps[3].slug}`,
    `?p=${ps[0].slug}, ${ps[1].slug}&p=${ps[2].slug},${ps[3].slug}`,
    `?p=${ps[0].slug},UPPER,../x,${ps[1].slug}&when=now`,
    `?p=${ps[0].slug}%2C${ps[1].slug}`,
    "", "?p=", "?when=tonight-8",
    `?p=${ps[0].slug},${ps[1].slug}&when=tomorrow&d=2026-10-07&v=abc123def456`,
    `?p=${ps[0].slug},${ps[1].slug}&v=short`,
    `?p=${ps[0].slug},${ps[1].slug}&v=UPPER123456`,
  ].map((q) => ({ q, out: K.readShortlist(q, (s) => known.has(s)) })),
  votes: [0, 1, 2, 3].flatMap((i) => [null, "tonight-8", "now"].map((w) => K.shortlistVoteMessage(ps[i], i, w))),
  // A vote with the place's link and day under it (3 October).
  datedVotes: [0, 1].flatMap((i) =>
    ["tonight-8", "tomorrow", "weekend"].map((w) => K.shortlistVoteMessage(ps[i], i, w, K.inviteUrl(ps[i], w, "https://www.wainkw.com", "2026-10-02"), "2026-10-02"))
  ),
  title: K.shortlistTitle(),
  max: K.SHORTLIST_MAX,
  choiceMax: K.CHOICE_MAX,
};

// The day in the link (plan-date.ts): what a dated plan means, when it has
// gone, and the phrase it is printed with. Send-days chosen for the edges —
// month, year and leap rollover, and every weekday for «الويكند».
const sendDays = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-31", "2026-12-31", "2028-02-28"];
const readAt = ["2026-10-02T07:00:00Z", "2026-10-03T16:59:00Z", "2026-10-03T17:00:00Z", "2026-10-04T20:59:00Z", "2026-10-04T21:00:00Z", "2026-10-10T12:00:00Z"];
const whens = ["now", "soon", "sunset", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow", "weekend"];
F.plan = {
  readDay: ["2026-10-03", "2026-02-30", "2026-13-01", "2026-2-3", "2028-02-29", "<script>", ""].map((s) => ({ s, out: K.parseDay(s) })),
  addDays: [["2026-10-31", 1], ["2026-12-31", 1], ["2028-02-28", 1], ["2026-01-01", -1], ["2026-03-01", 5]].map(([d, n]) => ({ d, n, out: K.addDays(d, n) })),
  weekday: sendDays.map((d) => ({ d, out: K.weekday(d) })),
  resolve: sendDays.flatMap((day) =>
    whens.flatMap((when) =>
      readAt.map((at) => {
        const r = K.resolvePlan(when, day, new Date(at));
        return { when, day, at, out: { date: r.date, hour: r.hour, minute: r.minute, kind: r.hourKind, weekdayAr: r.weekdayAr, passed: r.passed } };
      })
    )
  ),
  phrase: sendDays.flatMap((day) => whens.map((when) => ({ when, day, out: K.planPhrase(when, day) }))),
  bare: whens.map((when) => ({ when, out: K.planPhrase(when, null) })),
  urls: [
    K.inviteUrl(ps[0], "tomorrow", "https://www.wainkw.com", "2026-10-03"),
    K.inviteUrl(ps[0], "tomorrow", "https://www.wainkw.com"),
    K.shortlistUrl([ps[0], ps[1]], "weekend", "https://www.wainkw.com/", "2026-10-03"),
  ],
  readDayFromLink: ["?when=tomorrow&d=2026-10-03", "?d=2026-02-30&when=now", "?when=now", "?d=2026-10-03&d=2026-10-04"].map((s) => ({ s, out: K.readInviteDay(s) })),
  passed: [["tonight-8", "2026-10-02", "2026-10-03T07:00:00Z"], ["tonight-8", null, "2026-10-03T07:00:00Z"], ["tomorrow", "2026-09-25", "2026-10-03T07:00:00Z"], ["tomorrow", null, "2026-10-03T07:00:00Z"]]
    .map(([when, day, at]) => ({ when, day, at, out: K.invitePassed(when, new Date(at), day) })),
  hasEntry: whens.flatMap((when) => [["2026-10-03"], [null]].map(([day]) => ({ when, day, out: K.hasCalendarEntry(when, day) }))),
};

// «أضفها للتقويم»: the entry, byte for byte, for three places at the whens
// that get one, at two instants (the stamp is the instant).
F.calendar = [ps[0], setting("outdoor")[0], setting("indoor")[0]].flatMap((p) =>
  ["sunset", "tonight-8", "tomorrow", "weekend"].flatMap((when) =>
    ["2026-07-15T09:00:00Z", "2026-12-20T15:30:00Z"].map((at) => {
      const day = K.kuwaitDay(new Date(at));
      const url = K.inviteUrl(p, when, "https://www.wainkw.com", day);
      const e = K.calendarEntry({ place: p, when, day, phrase: K.planPhrase(when, day), url, mapsUrl: K.mapsUrl(p), now: new Date(at) });
      return { slug: p.slug, when, day, at, url, ics: e.ics, google: e.google, filename: e.filename };
    })
  )
);

// /find's greeting at every hour of every month, for both names.
F.findMoment = [];
for (let month = 0; month < 12; month++)
  for (let hour = 0; hour < 24; hour++) {
    const m = K.findMoment(hour, month);
    F.findMoment.push({ hour, month, part: m.part, shouq: K.findGreeting("شوق", m), salem: K.findGreeting("سالم", m) });
  }

// The order kit: money, slots, the reference, the phone shape, validation and
// the WhatsApp message — `lib/orders/order_kit.dart` replays every answer.
{
  const O = {};
  O.formatKwd = [0, 5, 250, 1000, 2750, 12345, 50000, -250, 999].map((fils) => ({ fils, out: K.formatKwd(fils) }));
  O.parseKwd = ["0.250", "1.5", "2", "٢٫٧٥٠", "1.2345", "abc", "", "-1.000", "3.125", " 1,250 ", "٠٫٠٠٥", "12345.999", "123456"]
    .map((s) => ({ s, out: K.parseKwd(s) }));
  O.timeAr = ["18:30", "09:00", "00:30", "12:00", "23:59", "7:05", "soon", ""].map((t) => ({ t, out: K.timeAr(t) }));
  O.orderReference = ["3f8a1c2d-4e5b-6789-abcd-ef0123456789", "00000000-0000-4000-8000-000000000000", "abcdef12-3456-4789-8abc-def012345678"]
    .map((id) => ({ id, out: K.orderReference(id) }));
  O.normalisePhone = ["51234567", "+965 5123 4567", "00965-66112233", "٩٩٨٨٧٧٦٦", "22345678", "5123456", "512345678", "call me", "96551234567", "9651234567", " 6 1 2 3 4 5 6 7 "]
    .map((s) => ({ s, out: K.normalisePhone(s) }));
  // Wall-clock components, built as a LOCAL date on both sides, so the
  // fixture does not depend on the zone the generator ran in.
  const clocks = [[2026, 8, 20, 18, 5], [2026, 8, 20, 18, 0], [2026, 8, 20, 18, 30], [2026, 1, 1, 23, 45], [2026, 12, 31, 9, 59], [2026, 6, 15, 0, 0]];
  O.pickupSlots = clocks.flatMap(([y, mo, d, h, mi]) =>
    [undefined, 5, 15, 30, 90, 240, 1, 9999].map((prep) => ({
      at: [y, mo, d, h, mi], prep: prep ?? null, count: 4,
      out: K.pickupSlots(new Date(y, mo - 1, d, h, mi), 4, prep),
    })));
  O.maxNoteChars = K.MAX_NOTE_CHARS;
  const baskets = [
    [{ id: "m1", nameAr: "چاي كرك", priceFils: 250, qty: 2 }, { id: "m2", nameAr: "قهوة عربية", priceFils: 500, qty: 1 }],
    [{ id: "m3", nameAr: "كيك اليوم", priceFils: 1750, qty: 1 }],
    [{ id: "a", nameAr: "شاورما لحم (كبير)", priceFils: 1250, qty: 3 }, { id: "b", nameAr: "عصير برتقال", priceFils: 750, qty: 2 }, { id: "c", nameAr: "ماي", priceFils: 100, qty: 20 }],
  ];
  const notes = [undefined, "", "  بدون سكر  ", "ملاحظة فيها رموز: 100% + 'اقتباس' & (قوس) / شرطة-مائلة"];
  O.messages = baskets.flatMap((lines, i) => notes.map((noteAr) => {
    const reference = ["3F2B1C", "9A8B7C", "FD4195"][i];
    const text = K.buildOrderMessage({
      placeNameAr: ["مقاهي المباركية", "سوق المباركية", "مطعم تجريبي"][i], reference, lines,
      pickupAt: ["18:30", "09:00", "00:30"][i], customerName: [" سالم ", "نورة", "أبو خالد"][i], noteAr,
      url: `https://www.wainkw.com/places/${["mubarakiya-tea-houses", "souq-al-mubarakiya", "x-y"][i]}/`,
    });
    return { basket: i, noteAr: noteAr ?? null, text, url: K.whatsappOrderUrl("51234567", text), cancel: K.cancelOrderMessage(reference) };
  }));
  const good = { placeSlug: "deera-cafe", placeNameAr: "مقهى الديرة", lines: baskets[0], pickupAt: "18:30", customerName: "سالم", customerPhone: "51234567", noteAr: "" };
  const cases = [
    good,
    { ...good, lines: [] },
    { ...good, customerPhone: "123" },
    { ...good, customerPhone: "" },
    { ...good, customerName: "" },
    { ...good, customerName: " ن " },
    { ...good, pickupAt: "" },
    { ...good, pickupAt: "6:30" },
    { ...good, lines: [{ ...baskets[0][0], qty: 0 }] },
    { ...good, lines: [{ ...baskets[0][0], qty: 21 }] },
    { ...good, lines: [{ ...baskets[0][0], priceFils: -100 }] },
    { ...good, lines: Array.from({ length: 21 }, (_, n) => ({ id: `x${n}`, nameAr: "x", priceFils: 1, qty: 1 })) },
    { ...good, noteAr: "ن".repeat(K.MAX_NOTE_CHARS) },
    { ...good, noteAr: "ن".repeat(K.MAX_NOTE_CHARS + 1) },
    { ...good, lines: [], customerName: "", customerPhone: "", pickupAt: "" },
  ];
  O.validate = cases.flatMap((input) => [true, false].map((phoneRequired) => ({
    input, phoneRequired, out: K.validateOrder(input, { phoneRequired }),
  })));
  F.orderKit = O;
}

const text = JSON.stringify(F, null, 1) + "\n";
if (CHECK) {
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== text) {
    console.error("flutter kit fixtures are stale — run `npm run flutter:fixtures`");
    process.exit(1);
  }
  console.log("flutter kit fixtures current");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT} (${(text.length / 1024).toFixed(0)}K, ${instants.length} instants × ${sample.length} places)`);
}
