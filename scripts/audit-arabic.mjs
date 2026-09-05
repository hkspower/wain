#!/usr/bin/env node
/**
 * Is the Arabic right?   npm run audit:arabic
 *
 * Fifty-two thousand Arabic characters across eighty-six files, all of it
 * hand-written, most of it in a dialect that has no spell-checker. Nothing has
 * ever looked at it as a body of text — the audits check places, icons, colour,
 * padding, type, assets and the voice, and the actual words the site is made of
 * were the one thing with no pass over them.
 *
 * This checks the things a machine can check and a reader cannot:
 *
 *   - characters that are invisible or that only LOOK like Arabic letters,
 *     which is the class of fault nobody can find by reading;
 *   - Latin punctuation inside Arabic, which renders in the wrong direction
 *     and breaks the line at the wrong place;
 *   - Western digits where the site otherwise uses Arabic-Indic;
 *   - Modern Standard Arabic leaking into a site written in Kuwaiti, which is
 *     the difference between sounding local and sounding like a form.
 *
 * It does NOT check spelling or grammar — no tool can, for Kuwaiti — and it
 * says so rather than implying a clean run means the prose is good.
 *
 * Errors are the unambiguous ones: an invisible character or a Latin comma is
 * wrong in every context. Everything else is a note, listed with its line so a
 * person can decide.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "out", ".git", "public"]);
const EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".sql"]);
const ARABIC = /[؀-ۿݐ-ݿ]/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXT.has(extname(name))) out.push(path);
  }
  return out;
}

/**
 * Arabic runs, with what sits either side of them.
 *
 * Checking whole lines would flag the Latin punctuation in the CODE around a
 * string — `["قهوة", "كرك"]` has commas and quotes that are perfectly correct.
 * A run is the Arabic itself plus any punctuation and spacing embedded in it,
 * which is the text a reader actually sees.
 */
const RUN = /[؀-ۿݐ-ݿ][؀-ۿݐ-ݿ\s.,،؛؟!:()«»"'\-–—…0-9٠-٩%]*[؀-ۿݐ-ݿ٠-٩.،؟!»]/gu;

const files = [];
for (const dir of ["src", "scripts", "supabase"]) {
  try {
    walk(join(ROOT, dir), files);
  } catch {
    /* directory not in this checkout */
  }
}

/**
 * Two files are excluded, and both for the same reason: they are ABOUT these
 * faults. lib/arabic is the table of letters that need folding and this script
 * is the list of patterns that find them, so auditing either is auditing the
 * description of the problem rather than the problem.
 */
const SELF = new Set(["src/lib/arabic.ts", "scripts/audit-arabic.mjs"]);

/**
 * Comments out, strings in.
 *
 * The first version read whole lines, and most of what it found was Arabic
 * prose inside `//` comments — where a Latin comma is not a fault, because
 * nobody reads it on a screen in an RTL paragraph. What this audit is for is
 * the copy: the strings a visitor sees. Blanking comments before extraction is
 * cruder than parsing and it cannot be fooled by anything in this codebase,
 * where every Arabic string is a plain literal.
 */
function stripComments(source, sql) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => {
      const cut = sql ? line.indexOf("--") : line.indexOf("//");
      // Not inside a string: a `//` after an odd number of quotes is a URL.
      if (cut < 0) return line;
      const before = line.slice(0, cut);
      const quotes = (before.match(/["'`]/g) || []).length;
      return quotes % 2 === 1 ? line : before;
    })
    .join("\n");
}

/**
 * Two views of the same text, because one is not enough.
 *
 * A `run` is Arabic plus the punctuation and spacing embedded in it — the
 * right unit for spacing, register and spelling, and the wrong one for the
 * character checks. The run's own character class decides what can appear in
 * it, and it excludes Latin `?` and the zero-width controls: exactly the
 * characters two of the checks below exist to find. Planting a fault proved
 * it — a zero-width space and a Latin question mark, dropped into real copy,
 * were reported clean.
 *
 * So those checks read the comment-stripped LINE instead, and each pattern
 * carries its own «next to Arabic» requirement. A comma inside `["قهوة",
 * "كرك"]` is separated from the Arabic by a quote and does not match; a comma
 * inside a sentence does.
 */
const lines = [];

/** Every Arabic run in the tree's copy, with where it came from. */
const runs = [];
for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (SELF.has(rel)) continue;
  stripComments(readFileSync(file, "utf8"), rel.endsWith(".sql"))
    .split("\n")
    .forEach((line, i) => {
      if (!ARABIC.test(line)) return;
      lines.push({ file: rel, line: i + 1, text: line.trim() });
      for (const m of line.matchAll(RUN)) runs.push({ file: rel, line: i + 1, text: m[0] });
    });
}

let errors = 0;
let notes = 0;
const seen = new Set();

/** Report a class of finding once, with up to `show` examples. */
function report({ level, name, hits, why, show = 6 }) {
  if (hits.length === 0) return;
  const mark = level === "error" ? "✗" : "⚠";
  console.log(`  ${mark} ${name} — ${hits.length}`);
  if (why) console.log(`      ${why}`);
  for (const h of hits.slice(0, show)) {
    const key = `${h.file}:${h.line}`;
    console.log(`      ${key}  ${h.text.replace(/\s+/g, " ").slice(0, 88)}`);
    seen.add(key);
  }
  if (hits.length > show) console.log(`      … and ${hits.length - show} more`);
  if (level === "error") errors += hits.length;
  else notes += hits.length;
}

const find = (re) => runs.filter((r) => re.test(r.text));
/** The same, over whole lines — for characters a run cannot contain. */
const findLine = (re) => lines.filter((r) => re.test(r.text));

console.log("\n── characters you cannot see, and characters that lie ──");

report({
  level: "error",
  name: "zero-width or bidi control characters",
  // Escapes, not literals: a zero-width character typed into this line
  // would be a bug hiding inside its own detector.
  hits: findLine(/[؀-ۿ][\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]|[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF][؀-ۿ]/),
  why: "invisible in every editor; they break search tokens and text-to-speech alike",
});

report({
  level: "error",
  name: "Arabic presentation forms",
  hits: findLine(/[\uFB50-\uFDFF\uFE70-\uFEFF]/),
  why: "pre-shaped glyphs from a legacy encoding — they look right and match nothing",
});

report({
  level: "error",
  name: "Persian look-alike letters",
  hits: findLine(/[یکھ]/),
  why: "ی and ك's twin ک are the same glyph as ي and ك: identical on screen, different everywhere else",
});

report({
  level: "note",
  name: "tatweel (a stretched letter)",
  hits: find(/[؀-ۿ]ـ[؀-ۿ]/),
  why: "elongation inside a word. «الـ» before a Latin word is correct and is not flagged",
});

/* چ and its neighbours are DELIBERATE in the catalogue — «چاي», «مچبوس» — and
   lib/arabic folds them for search and for speech. Anything outside that set is
   a letter nobody has taught the pipeline about. */
report({
  level: "note",
  name: "non-standard Arabic letters outside the known set",
  hits: find(/[ٹ-څڇ-ڢڤ-ڨڪ-ڿہ-ۋۍ-ۿ]/),
  why: "lib/arabic knows چ پ ڤ ژ گ ی ک ھ ٱ; a letter outside it reaches the voice raw",
});

console.log("\n── punctuation that faces the wrong way ──");

report({
  level: "error",
  name: "Latin comma inside Arabic",
  hits: findLine(/[؀-ۿ] ?, ?[؀-ۿ]/),
  why: "«،» is the Arabic comma; the Latin one hangs on the wrong side of the word",
});

report({
  level: "error",
  name: "Latin question mark after Arabic",
  hits: findLine(/[؀-ۿ] ?\?/),
  why: "«؟» is the Arabic one, and it is mirrored",
});

report({
  level: "error",
  name: "Latin semicolon inside Arabic",
  hits: findLine(/[؀-ۿ] ?; ?[؀-ۿ]/),
  why: "«؛» is the Arabic semicolon",
});

report({
  level: "note",
  name: "a space before the punctuation rather than after it",
  hits: find(/[؀-ۿ] +[،؟!:.]/),
});

report({
  level: "note",
  name: "no space after a comma",
  hits: find(/،[؀-ۿ]/),
});

report({
  level: "note",
  name: "two spaces in a row",
  hits: find(/[؀-ۿ] {2,}[؀-ۿ]/),
});

console.log("\n── digits ──");

report({
  level: "note",
  name: "Western digits in Arabic text",
  hits: find(/[؀-ۿ][ ]?[0-9]/).filter((r) => !/^\s*\/\//.test(r.text)),
  why: "the site renders numbers Arabic-Indic (toArabicDigits); a raw 5 next to Arabic is a mixed line",
});

console.log("\n── register: this site is written in Kuwaiti, not in MSA ──");

/**
 * Markers of Modern Standard Arabic in copy a visitor reads.
 *
 * Not wrong Arabic — wrong REGISTER, which is the difference between a friend
 * telling you where to go and a government form. «قول لي» over «قل لي» is
 * already called out by name in wain-ai.ts; these are the rest of the family.
 */
/**
 * Word boundaries, the hard way.
 *
 * `\b` is useless here: Arabic letters are not \w, so /\bهل\s/ matched inside
 * «أهل الديرة», «يستاهل», «سهل» — eight hits, every one of them a false alarm
 * and every one of them a reason to stop reading the audit. A boundary in
 * Arabic is «not an Arabic letter».
 */
const edge = (word) => new RegExp(`(?<![؀-ۿ])${word}(?![؀-ۿ])`);

const MSA = [
  [edge("هل"), "«هل» — Kuwaiti asks without it"],
  [edge("ماذا"), "«ماذا» → «شنو»"],
  [edge("لماذا"), "«لماذا» → «ليش»"],
  [edge("يمكنك|بإمكانك"), "«يمكنك» → «تقدر»"],
  [edge("سوف"), "«سوف» → «راح» / «بـ»"],
  [edge("يرجى|الرجاء"), "«يرجى» is form-Arabic"],
  [edge("انقر"), "«انقر» → «دوس» / «اضغط»"],
  [edge("الذي|التي"), "«اللي» is the Kuwaiti relative"],
  [edge("لديك"), "«لديك» → «عندك»"],
  [edge("يتم|سيتم"), "«يتم» is a form's passive — Kuwaiti drops it"],
];

/**
 * The agent brief is exempt, and only from THIS check.
 *
 * It carries a dialect glossary — «**شنو** ماذا · **وين** أين» — which has to
 * name the Modern Standard word in order to define the Kuwaiti one. Flagging
 * it here would be flagging the one place MSA is doing its job.
 */
const REGISTER = (r) => r.file !== "scripts/wain-ai-brief.mjs";
for (const [re, why] of MSA) {
  report({ level: "note", name: why, hits: find(re).filter(REGISTER), show: 4 });
}

console.log("\n── consistency: one word, one spelling ──");

/**
 * The same word written two ways in one codebase.
 *
 * Folding is blunt on purpose and it costs a couple of false pairs: «حقة» (the
 * shisha pipe) folds onto «حقه» (his), and «فأي» onto «فاي». Two real words
 * that fold together are worth reading past; a real inconsistency that folding
 * would have hidden is not.
 *
 * Hamza and ة are where this happens: «أحلى»/«احلى», «قهوة»/«قهوه». The search
 * index folds both (normalise strips hamza and turns ة into ه) so retrieval is
 * unaffected — this is about the page, where a visitor sees one word spelled
 * two ways on two screens.
 */
const bare = (w) => w.replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

/**
 * search.ts is excluded, and it is not an oversight.
 *
 * Its synonym table is written in the index's own normalised form — «قهوه»,
 * «اكل», «طلعه» — because normalise() strips hamza and folds ة to ه, and a key
 * written «قهوة» would never be reached. Those are not misspellings of copy;
 * they are the vocabulary of a lookup nobody reads. Counting them buried the
 * handful of real ones in a page of noise.
 */
const COPY = (r) =>
  r.file !== "src/lib/search.ts" &&
  // audit-search's Arabic is not copy either: it is a list of the different
  // ways a visitor might type the same word — «نرجيلة» AND «نرجيله» — which is
  // the whole point of it. Two spellings there is the test passing.
  r.file !== "scripts/audit-search.mjs";
const spellings = new Map();
for (const r of runs.filter(COPY)) {
  for (const word of r.text.split(/[^؀-ۿ]+/)) {
    if (word.length < 3) continue;
    const key = bare(word);
    if (!spellings.has(key)) spellings.set(key, new Map());
    const forms = spellings.get(key);
    if (!forms.has(word)) forms.set(word, r);
  }
}
const split = [...spellings.entries()].filter(([, forms]) => forms.size > 1);
if (split.length) {
  console.log(`  ⚠ ${split.length} word(s) appear with more than one spelling in the copy`);
  console.log("      the index folds hamza and ة, so this is about the page, not retrieval:");
  for (const [, forms] of split) {
    for (const [w, r] of forms) console.log(`      ${w.padEnd(14)} ${r.file}:${r.line}`);
    console.log("");
  }
  notes += split.length;
}

console.log(
  `\n${runs.length} Arabic runs across ${new Set(runs.map((r) => r.file)).size} files.\n` +
    "Spelling and grammar are NOT checked — no tool can, for Kuwaiti. What is\n" +
    "green here is the mechanical half: nothing invisible, nothing mis-encoded,\n" +
    "and punctuation that faces the right way."
);
console.log(`\n${errors} errors, ${notes} notes`);
process.exit(errors ? 1 : 0);
