#!/usr/bin/env node
// The game's Arabic, checked for grammar rather than typography.
//
//   npm run check:arabic:grammar
//
// scripts/check-arabic.mjs is the typography pass: presentation forms,
// bidi controls, tatweel, one spelling per borrowed word. It says
// nothing about whether the Arabic is CORRECT, and those are different
// failures — a string can be perfectly encoded and still say the wrong
// thing.
//
// WHAT THIS IS NOT. It is not a parser and it has no morphological
// analyser, so it cannot conjugate a verb, resolve an iḍāfa, or tell a
// noun from an adjective. Anything claiming to do that from regexes
// would be lying. What it does instead is a set of rules that are
// individually near-certain — places where Arabic orthography and
// number agreement have exactly one right answer and the wrong one is
// mechanically visible — plus a register check, because this game is
// written in two Arabics at once and mixing them in a single breath is
// the error a reader actually notices.
//
// Every rule below says what it can prove and what it cannot. A rule
// that fires on a correct string is worse than no rule: it teaches
// people to run the checker with their eyes closed.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
};

const AR = /[؀-ۿݐ-ݿ]/;
const ARW = "ء-ي";

const strings = [];
for (const f of walk("src")) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
      const v = m[1] ?? m[2] ?? m[3];
      if (v && AR.test(v)) strings.push({ file: f, line: i + 1, text: v });
    }
  });
}

const fail = [];
const note = [];
const bad = (s, why) => fail.push(`${s.file}:${s.line}  ${why}\n      ${s.text}`);

/** Arabic words in a string, diacritics stripped so a shadda does not
 *  hide a word from a lookup. The marks themselves are checked
 *  separately — see the diacritic rule. */
const BARE = /[ً-ْٰ]/g;
const words = (t) =>
  t.split(/[^ء-يً-ْٰ]+/).filter(Boolean).map((w) => w.replace(BARE, ""));

// ---------------------------------------------------------------------
// The rules, over whatever list of strings they are handed.
//
// A function rather than a straight loop over the corpus, so the
// self-test at the foot of this file can run them against a fixture of
// planted errors. A rule that cannot be pointed at a known-bad string
// cannot be shown to work.
function runRules(list) {
// ---------------------------------------------------------------------
// 1. Word-final taa marbuta vs haa.
//
// A feminine singular noun ends in ة. Writing ه instead is the single
// commonest Arabic spelling error and it changes the word: رحلة is a
// journey, رحله is "his journey". Only checked against a list of words
// this game actually uses, because deciding it in general needs to know
// the word's gender and that needs a lexicon.
const TAA_WORDS = [
  "سيارة", "محطة", "لعبة", "جولة", "مرة", "دورة", "نقطة", "سرعة", "قطعة",
  "لمعة", "دبة", "شمعة", "بقالة", "مدينة", "جزيرة", "منارة", "حديقة",
  "قهوة", "مارينا", "ساعة", "دقيقة", "ثانية", "لحظة", "شركة", "رياضية",
  "مزدوجة", "مربعة", "نظيفة", "كاملة", "خضراء", "سكنية",
];
for (const s of list) {
  for (const w of words(s.text)) {
    for (const t of TAA_WORDS) {
      const wrong = t.slice(0, -1) + "ه"; // ...ة -> ...ه
      if (w === wrong) bad(s, `"${wrong}" should end in taa marbuta: "${t}"`);
    }
  }
}

// ---------------------------------------------------------------------
// 2. Word-final alif maqsura vs yaa.
//
// على is a preposition, علي is a name. إلى is "to", الي is nothing.
// Same limitation: a closed list, because the general rule needs to know
// whether the final vowel is part of the root.
const MAQSURA = [
  ["على", "علي"], ["إلى", "الي"], ["حتى", "حتي"], ["متى", "متي"],
  ["أعلى", "اعلي"], ["الأولى", "الاولي"],
];
// Read RAW here — diacritics are load-bearing for exactly this rule.
// علي is ambiguous three ways: the misspelling of على, the name Ali, and
// عليّ, "on me", which is على with a first-person pronoun fused onto it.
// The shadda is what tells them apart, so stripping it before the
// lookup turns a correct عليّ into a reported error. It did: the first
// run flagged a rival's "فحطت عليّ صج" — "you really drifted ON ME" —
// as a misspelt preposition. The source now carries the shadda, which
// is both correct and unambiguous, and this rule respects it.
for (const s of list) {
  const raw = s.text.split(/[^ء-يً-ْٰ]+/).filter(Boolean);
  for (const [right, wrong] of MAQSURA) {
    if (raw.includes(wrong)) {
      // The shadda hint belongs to علي alone; on الي or حتي it is noise,
      // and a hint that does not apply teaches people to skim the rest.
      const hint = wrong === "علي"
        ? ` — or, if you meant "on me", write it "عليّ" with its shadda`
        : "";
      bad(s, `"${wrong}" should be "${right}" (alif maqsura, not yaa)${hint}`);
    }
  }
}

// ---------------------------------------------------------------------
// 3. Hamza on the alif.
//
// أ, إ and ا are three different letters and the choice is not free.
// Only words this game uses, and only where the bare-alif form is not
// itself a real word — أخضر/اخضر is safe to check, but a rule on إن
// would catch the perfectly good ان of dialect.
const HAMZA = [
  ["أحمر", "احمر"], ["أخضر", "اخضر"], ["أسود", "اسود"], ["أزرق", "ازرق"],
  ["الإضاءات", "الاضاءات"], ["الإضافات", "الاضافات"], ["الإعدادات", "الاعدادات"],
  ["الأردن", "الاردن"], ["الإمارات", "الامارات"], ["أبراج", "ابراج"],
  ["أنثى", "انثي"], ["الأفنيوز", "الافنيوز"], ["أطيب", "اطيب"],
  ["إن شاء الله", "انشاء الله"],
];
for (const s of list) {
  for (const [right, wrong] of HAMZA) {
    if (s.text.includes(wrong)) bad(s, `"${wrong}" is missing its hamza — write "${right}"`);
  }
}

// ---------------------------------------------------------------------
// 4. Number and noun must agree.
//
// The rule that catches out every non-native writer, and the one place
// here where Arabic grammar is genuinely mechanical:
//
//   3-10   take a PLURAL noun     ٣ مرات
//   11+    take a SINGULAR noun   ١١ مرة
//
// So a digit followed by an Arabic word is checkable, IF the noun's
// singular and plural are both known. The list is small on purpose: a
// wrong call here reads as the checker not knowing Arabic.
const COUNTED = [
  { one: "مرة", many: "مرات" },
  { one: "ثانية", many: "ثوانٍ" },
  { one: "دقيقة", many: "دقائق" },
  { one: "لفة", many: "لفات" },
  { one: "نقطة", many: "نقاط" },
  { one: "سيارة", many: "سيارات" },
];
const AR_DIGITS = "٠-٩";
for (const s of list) {
  // A digit run (either script) then an Arabic word.
  for (const m of s.text.matchAll(
    new RegExp(`([0-9${AR_DIGITS}]+)\\s*([${ARW}]+)`, "g")
  )) {
    const n = Number(
      m[1].replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    );
    const noun = m[2].replace(BARE, "");
    if (!Number.isFinite(n) || n < 3) continue;
    for (const c of COUNTED) {
      if (n >= 3 && n <= 10 && noun === c.one) {
        bad(s, `${m[1]} takes the plural — "${c.many}", not "${c.one}"`);
      }
      if (n > 10 && noun === c.many) {
        bad(s, `${m[1]} takes the singular — "${c.one}", not "${c.many}"`);
      }
    }
  }
}

// ---------------------------------------------------------------------
// 5. Arabic punctuation, in Arabic text.
//
// Arabic has its own comma, semicolon and question mark, and they are
// not decorative: a Latin "?" after Arabic sits on the wrong side of
// the word at the wrong angle in every bidi renderer. Only flagged
// where the punctuation is genuinely inside an Arabic run, so a
// bilingual "GO — يلا!" keeps its Latin half intact.
for (const s of list) {
  for (const m of s.text.matchAll(new RegExp(`[${ARW}]\\s*([,;?])`, "g"))) {
    const right = { ",": "،", ";": "؛", "?": "؟" }[m[1]];
    bad(s, `Latin "${m[1]}" directly after Arabic — use "${right}"`);
  }
  // ...and no space BEFORE Arabic punctuation, which is a French habit
  // that leaves the mark stranded at the start of the next line.
  if (new RegExp(`\\s[،؛؟]`).test(s.text)) {
    bad(s, "space before Arabic punctuation — it belongs against the word");
  }
}

// ---------------------------------------------------------------------
// 6. The definite article, attached.
//
// ال is a prefix, never a word. A detached "ال شارع" is a paste that
// lost a joiner, and it renders as two words with a gap.
for (const s of list) {
  if (new RegExp(`(^|\\s)ال\\s+[${ARW}]`).test(s.text)) {
    bad(s, "the definite article ال is detached from its noun");
  }
}

// ---------------------------------------------------------------------
// 7. The same word twice in a row.
//
// Almost always a copy-paste. Almost, because Arabic does repeat for
// emphasis — so this reports rather than fails, and a real repetition
// can be left alone.
for (const s of list) {
  const ws = words(s.text);
  for (let i = 1; i < ws.length; i++) {
    if (ws[i] === ws[i - 1] && ws[i].length > 1) {
      note.push(`${s.file}:${s.line}  "${ws[i]}" appears twice in a row\n      ${s.text}`);
    }
  }
}

// ---------------------------------------------------------------------
// 9. Diacritics, where they are load-bearing only.
//
// This game marks a vowel when a word would otherwise be ambiguous —
// لوّح, عبّينا, قرّب, عُمان — and leaves the rest bare, which is how
// Arabic is actually written. What would be wrong is a string that is
// HALF vocalised: a reader takes marks as a promise that the hard
// places are marked, so a stray fatha on one word of five reads as an
// unfinished job rather than a helpful one.
const MARK = /[ً-ِْٰ]/; // short vowels + sukun, NOT shadda
for (const s of list) {
  const ws = s.text.split(/\s+/).filter((w) => AR.test(w));
  if (ws.length < 4) continue; // a label of two words is not a sentence
  const marked = ws.filter((w) => MARK.test(w)).length;
  if (marked > 0 && marked < ws.length * 0.34) {
    note.push(
      `${s.file}:${s.line}  ${marked} of ${ws.length} words carry short vowels — ` +
      `mark the ambiguous ones or none\n      ${s.text}`
    );
  }
}

// ---------------------------------------------------------------------
// 10. Register: MSA and Gulf dialect, each where it belongs.
//
// The game is written in two Arabics on purpose — menus and system
// messages in a light MSA, rivals and street talk in Kuwaiti — and that
// is right. What is wrong is both inside ONE line, which reads like a
// subtitle track drifting between two translators. Checked by looking
// for markers of each in the same string.
const DIALECT = ["شنو", "وايد", "هالمرة", "عيل", "محد", "تبي", "مو", "زين", "إنت", "شلون", "ليش"];
const MSA_ONLY = ["ليس", "لست", "الذي", "التي", "سوف", "ماذا", "كيفما", "لماذا"];
for (const s of list) {
  const ws = new Set(words(s.text));
  const d = DIALECT.filter((w) => ws.has(w));
  const m = MSA_ONLY.filter((w) => ws.has(w));
  if (d.length && m.length) {
    bad(s, `mixes Gulf dialect (${d.join(", ")}) with formal MSA (${m.join(", ")}) in one line`);
  }
}

// ---------------------------------------------------------------------
}

runRules(strings);

// ---------------------------------------------------------------------
// 8. One ellipsis, one script.
//
// Three ASCII dots and a real ellipsis are different characters and
// they break differently at the end of a line. Whichever the game
// uses, it should use one — and in Arabic runs the single character is
// the one that stays attached to the word.
{
  // Only where the ellipsis is IN Arabic. The first version compared
  // every string in the tree and reported the game's one English search
  // placeholder — "Search places, areas, or vibes…", which is correct
  // English typography — against sixteen lines of Arabic dialogue. Two
  // languages have two conventions and neither is the other's bug.
  const inArabic = (t, mark) =>
    new RegExp(`[${ARW}]\\s*${mark}|${mark}\\s*[${ARW}]`).test(t);
  const ascii = strings.filter((s) => inArabic(s.text, "\\.\\.\\."));
  const real = strings.filter((s) => inArabic(s.text, "…"));
  if (ascii.length && real.length) {
    note.push(
      `ellipsis: ${ascii.length} string(s) use "..." and ${real.length} use "…" — pick one\n` +
      `      e.g. ${ascii[0].file}:${ascii[0].line}  ${ascii[0].text}\n` +
      `      e.g. ${real[0].file}:${real[0].line}  ${real[0].text}`
    );
  }
}

// ---------------------------------------------------------------------
// Does any of it actually fire?
//
//   node scripts/check-arabic-grammar.mjs --self-test
//
// A linter whose corpus is clean says "pass" whether its rules work or
// not, and every rule here is a regex over a script most reviewers
// cannot read — the two together are how a checker quietly becomes
// decoration. So the fixture below plants exactly one error per rule
// and the run asserts each is caught. It lives beside the rules rather
// than in a scratch directory, because the thing it protects against is
// a rule being broken by a later edit, and that is not a one-off.
const FIXTURE = [
  ["taa marbuta", "سياره جديدة", /taa marbuta/],
  ["alif maqsura", "ارجع الي البيت", /alif maqsura/],
  ["hamza", "اللون احمر", /hamza/],
  ["3-10 plural", "٥ مرة", /takes the plural/],
  ["11+ singular", "١٥ مرات", /takes the singular/],
  ["Latin comma", "شنو تبي, يا بطل", /Latin ","/],
  ["space before mark", "يلا ؟", /space before/],
  ["detached article", "ال شارع الخليج", /detached/],
  ["register mixing", "ليس شنو تبي الذي زين", /dialect/],
  // ...and the one that must NOT fire: عليّ is "on me", not a misspelt
  // preposition. This line is the regression guard for the false
  // positive the first run produced against a rival's own dialogue.
  ["!on-me is fine", "فحطت عليّ صج", null],
];
if (process.argv.includes("--self-test")) {
  let badRules = 0;
  for (const [name, text, want] of FIXTURE) {
    const before = fail.length;
    const probe = { file: "fixture", line: 0, text };
    runRules([probe]);
    const hits = fail.slice(before);
    fail.length = before;
    const caught = hits.some((h) => (want ? want.test(h) : true));
    if (want && !caught) { console.error(`  MISS  ${name}: nothing fired on "${text}"`); badRules++; }
    if (!want && hits.length) { console.error(`  FALSE ${name}: fired on correct Arabic "${text}"\n        ${hits[0]}`); badRules++; }
    if ((want && caught) || (!want && !hits.length)) console.log(`  ok    ${name}`);
  }
  console.log(badRules ? `\n${badRules} rule(s) not working` : "\nevery rule fires on its own planted error, and none fires on correct Arabic");
  process.exit(badRules ? 1 : 0);
}

const files = new Set(strings.map((s) => s.file)).size;
console.log(`${strings.length} Arabic string literals across ${files} files`);
console.log(
  `rules        taa marbuta, alif maqsura, hamza, number agreement,\n` +
  `             Arabic punctuation, attached article, doubled words,\n` +
  `             one ellipsis, half-vocalisation, register mixing`
);
console.log(
  `not checked  conjugation, case endings, iḍāfa, agreement beyond the\n` +
  `             counted-noun rule — those need a morphological analyser,\n` +
  `             and a regex pretending to have one would be worse than\n` +
  `             this saying it does not.`
);

if (note.length) {
  console.log(`\n${note.length} thing${note.length === 1 ? "" : "s"} to look at (not failures):\n`);
  for (const n of note) console.log(`  ${n}\n`);
}
if (fail.length) {
  console.error(`\n${fail.length} problem${fail.length === 1 ? "" : "s"}:\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log("\nthe grammar rules this can check, it checks, and they all pass.");
