/**
 * حارس المساعد. يرفض الإصدار إن خالف المساعد قواعده.
 *
 * الأرقام التجارية في الموقع تقديرية موضوعة للاتساق الداخلي لا كالتزامات،
 * فقرّرنا ألّا يذكر المساعد رقمًا للزبون. لكن قرارًا مكتوبًا في تعليق يُنسى
 * بعد شهر: يضيف أحدهم جوابًا فيه «خلال ٣٠ دقيقة» بحسن نيّة، فيتحوّل تقدير
 * داخلي إلى وعد أمام زبون. الحارس يجعل نسيانه مستحيلًا.
 *
 *   node website/tools/check-assistant.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..');
const FILE = path.join(SITE, 'assistant.js');

/* الملف يُصدّر بياناته عند تحميله في Node، ويعمل كما هو في المتصفّح */
const require = createRequire(import.meta.url);
const src = fs.readFileSync(FILE, 'utf8');
const sandbox = { module: { exports: {} }, document: undefined };
new Function('module', 'document', src)(sandbox.module, undefined);
const { TOPICS, FALLBACK, match } = sandbox.module.exports;

const DIGITS = /[0-9٠-٩۰-۹]/;
const problems = [];

/* ١ — لا رقم في أي نصّ يراه الزبون */
for (const t of TOPICS) {
  for (const [field, value] of [['السؤال', t.q], ['الجواب', t.a]]) {
    const hit = value.match(DIGITS);
    if (hit) problems.push(`«${t.id}» ${field} فيه رقم «${hit[0]}»: ${value}`);
  }
}
if (DIGITS.test(FALLBACK)) problems.push('نصّ التعذّر فيه رقم');

/* ٢ — كل موضوع مكتمل: معرّف ومفاتيح وسؤال وجواب ومصدر في الصفحة */
const ids = new Set();
for (const t of TOPICS) {
  if (!t.id || ids.has(t.id)) problems.push(`معرّف مكرّر أو ناقص: ${t.id}`);
  ids.add(t.id);
  if (!t.keys?.length) problems.push(`«${t.id}» بلا مفاتيح`);
  if (!t.q || !t.a) problems.push(`«${t.id}» بلا سؤال أو جواب`);
  if (!t.src?.startsWith('#')) problems.push(`«${t.id}» بلا مصدر في الصفحة`);
}

/* ٣ — كل سؤال يجب أن يجد موضوعه: مجموعة مفاتيح لا تطابق نفسها عديمة النفع */
for (const t of TOPICS) {
  const got = match(t.q);
  if (got?.id !== t.id) problems.push(`«${t.id}» سؤاله المعروض يطابق «${got?.id ?? 'لا شيء'}»`);
}

/* ٤ — الأسئلة الرقمية يجب أن تُحال لإنسان لا أن تُجاب */
for (const id of ['price', 'time']) {
  const t = TOPICS.find((x) => x.id === id);
  if (t && !t.handoff) problems.push(`«${id}» سؤال رقمي ولا يحيل إلى واتساب`);
}

/* ٥ — ما لا يعرفه لا يخمّنه */
for (const q of ['كم عدد موظفيكم', 'هل توصلون إلى السعودية', 'من مالك الشركة', 'ما رأيك في المنافسين']) {
  if (match(q)) problems.push(`سؤال خارج المعرفة أعطى جوابًا: «${q}» ← ${match(q).id}`);
}

/* ٦ — الأسئلة المتوقّعة يجب أن تُفهم فعلًا */
const MUST = [
  ['كم السعر؟', 'price'], ['وين توصلون؟', 'coverage'], ['كم ياخذ وقت؟', 'time'],
  ['أبغى أشتغل عندكم كابتن', 'join'], ['هل عندكم توصيل مبرد؟', 'cold'],
  ['كيف أتابع طلبي', 'track'], ['ما طرق الدفع', 'pay'], ['أبغى أكلم موظف', 'contact'],
];
for (const [q, want] of MUST) {
  const got = match(q);
  if (got?.id !== want) problems.push(`«${q}» توقّعنا «${want}» فجاء «${got?.id ?? 'لا شيء'}»`);
}

if (problems.length) {
  console.error(`\nتعذّر البناء — المساعد خالف قواعده (${problems.length}):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}

const handoffs = TOPICS.filter((t) => t.handoff).length;
console.log(`✓ المساعد سليم — ${TOPICS.length} موضوعًا · ${handoffs} منها تُحال لإنسان · بلا رقم واحد`);
