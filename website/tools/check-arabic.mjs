/**
 * حارس العربية: لا حرف لاتيني في نصّ يقرؤه الزائر.
 *
 * الموقع عربي لجمهور كويتي، والاختصارات الإنجليزية (API، COD، SLA) تُكتب
 * عادةً بحسن نيّة لتوضيح مصطلح — لكنها توضّح لقارئ ثنائي اللغة لا لقارئ
 * عربي. والمصطلح العربي كان حاضرًا بجانبها في أكثرها أصلًا، فبقاؤها زينة
 * لا إفادة.
 *
 * ── ما يبقى لاتينيًّا، ولماذا ────────────────────────────────────────
 * ليس كل لاتيني دخيلًا. ثلاثة أنواع تبقى لأنها **تُنسخ وتُستعمل** لا تُقرأ:
 *   • الهاتف — يُلصق في المُهاتِف، وأرقامه العربية-الهندية تكسر ذلك.
 *   • البريد والروابط — عناوين، وتغييرها يجعلها لا تعمل.
 *   • رمز الطلب (MW-….) واسم العلامة MAWSOOL — معرّفان يُبحث بهما.
 * وهذه ليست ثغرة في القاعدة بل حدّها: العربية للقراءة، واللاتيني للآلة.
 *
 *   node website/tools/check-arabic.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, '..', 'index.html');

let html = fs.readFileSync(FILE, 'utf8');

/* لا نفحص ما لا يراه الزائر */
html = html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<head[\s\S]*?<\/head>/, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ');

/* النصّ بين الوسوم فقط — لا السمات (href، alt، class…) */
const texts = [];
html.replace(/>([^<>]+)</g, (_, t) => { texts.push(t); return ''; });

/* ما يبقى لاتينيًّا لأنه يُنسخ لا يُقرأ */
const ALLOWED = [
  /\+?\s*965[\s\d]*/g,                        // هاتف كويتي
  /[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // بريد
  /https?:\/\/\S+/g,                          // رابط
  /MW-\d+/g,                                  // رمز طلب
  /MAWSOOL/g,                                 // اسم العلامة لاتينيًّا
];

const problems = [];
for (const raw of texts) {
  let t = raw.replace(/&[a-z]+;|&#\d+;/gi, ' ');
  for (const re of ALLOWED) t = t.replace(re, ' ');
  const hit = t.match(/[A-Za-z]{2,}/g);
  if (hit) problems.push({ kind: 'latin', found: [...new Set(hit)].join('، '), ctx: raw.trim().replace(/\s+/g, ' ').slice(0, 72) });
}

/* ── وحدة المصطلح ──────────────────────────────────────────────────────
   الموقع كان يسمّي الشخص نفسه «سائقًا» في سبعة عشر موضعًا و«كابتن» في تسعة
   عشر — والتناقض يظهر داخل الشاشة الواحدة: زرّ «اطلب سائق» فوق فقرة تبدأ
   بـ«كباتن معتمدون». ونموذج العمل يقول «كابتن» حصرًا، فوُحّد عليه.

   وهذا يخصّ المعروض فقط: مفاتيح المطابقة في المساعد تُبقي «سائق» لأن الزبون
   يكتبها، وفهم ما يكتبه الزائر شيء وما نعرضه عليه شيء آخر. */
const BANNED = [
  [/سائق|سائقون|سائقين|كسائق/, 'سائق', 'كابتن — وهو مصطلح نموذج العمل'],
];
for (const raw of texts) {
  for (const [re, word, want] of BANNED) {
    if (re.test(raw)) problems.push({ kind: 'term', found: `${word} ← ${want}`, ctx: raw.trim().replace(/\s+/g, ' ').slice(0, 72) });
  }
}

if (problems.length) {
  const latin = problems.filter((p) => p.kind === 'latin');
  const term  = problems.filter((p) => p.kind === 'term');
  console.error('');
  if (latin.length) {
    console.error(`تعذّر البناء — نصّ لاتيني يقرؤه الزائر (${latin.length}):\n`);
    for (const p of latin) console.error(`  • «${p.found}» في: ${p.ctx}`);
    console.error(`
اكتبه بالعربية، أو — إن كان معرّفًا يُنسخ (هاتف، بريد، رابط، رمز طلب) —
أضفه إلى ALLOWED في هذا الملف مع سبب بقائه.
`);
  }
  if (term.length) {
    console.error(`تعذّر البناء — مصطلح غير موحّد (${term.length}):\n`);
    for (const p of term) console.error(`  • ${p.found}  في: ${p.ctx}`);
    console.error(`
الموقع يسمّي الشخص الواحد باسم واحد. عدّل النصّ، أو — إن تغيّر القرار —
عدّل BANNED في هذا الملف.
`);
  }
  process.exit(1);
}

console.log(`✓ نصّ الزائر عربي وموحّد المصطلح — ${texts.length} مقطعًا نصّيًّا`);
