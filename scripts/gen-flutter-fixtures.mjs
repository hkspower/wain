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
F.acceptsOrders = ps.map((p) => [K.acceptsOrders(p), K.takesQueue(p)]).filter((x) => x[0] || x[1]).length;

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
        ["now", "soon", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow", "weekend"].map((w) => [
          w,
          K.hangoutMessage({ place: p, when: w, url: K.inviteUrl(p, w, "https://www.wainkw.com/"), now }),
        ])
      ),
      passed: Object.fromEntries(["now", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow"].map((w) => [w, K.invitePassed(w, now)])),
    })),
  })),
  phrases: Object.fromEntries(["now", "soon", "tonight-7", "tonight-8", "tonight-9", "tonight-10", "tomorrow", "weekend"].map((w) => [w, K.phraseFor(w)])),
  accept: sample.slice(0, 2).map((p) => K.inviteAcceptMessage(p, "tonight-8")),
  title: sample.slice(0, 2).map((p) => K.hangoutTitle(p)),
  readInvite: ["?when=tonight-8", "when=now", "?when=bogus", "", "?x=1&when=weekend", "?when=", "?when=tonight-8&when=now"].map((s) => ({ s, out: K.readInvite(s) })),
};

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
