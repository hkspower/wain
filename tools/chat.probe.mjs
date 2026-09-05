/* مِسبار المحادثة — يُشغَّل باليد، لا مع `test-all`.
 *
 * كسابقه `voice.probe.mjs` يحتاج متصفّحًا وplaywright وخادمين، والموقع
 * يبقى بلا اعتماديات:
 *
 *   cd website && python3 -m http.server 8080 &
 *   cd agent-system && PORT=4100 \
 *     MAWSOOL_SITE_ORIGINS=http://127.0.0.1:8080 node server/index.js &
 *   node tools/chat.probe.mjs      # وCHROMIUM=… إن لم يجد المتصفّح
 *
 * ── ما يقيسه ──
 *
 * المحادثة نفسها — لا ما يفهمه الخادم، بل ما يعيشه الزبون بين ضغطة
 * الإرسال والردّ: هل يرى أنّ شيئًا يجري؟ ماذا لو ضغط مرّتين؟ ماذا لو
 * انقطعت الشبكة وقد كتب سطرين؟ وهل يستطيع أن يصحّح ما فُهم خطأً؟
 */
import { chromium } from 'playwright';
const URL = 'http://127.0.0.1:8080/?api=http://127.0.0.1:4100';

let bad = 0, warn = 0;
const fail = (m) => { bad++; console.log('   ✗ ' + m); };
const note = (m) => { warn++; console.log('   ⚠ ' + m); };
const ok = (m) => console.log('   ✓ ' + m);

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--no-sandbox'],
  });
} catch (e) {
  console.error(`تعذّر إقلاع المتصفّح: ${e.message}\n` +
    'إن لم يجد playwright متصفّحه، دُلّه عليه:  CHROMIUM=/path/to/chrome node tools/chat.probe.mjs');
  process.exit(2);
}
const ctx = await browser.newContext({ locale: 'ar-KW', viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));

const say = async (t) => { await page.fill('#voInput', t); await page.press('#voInput', 'Enter'); };
const msgs = () => page.$$eval('.vo-msg', (ms) => ms.map((m) => ({
  who: m.className.includes('--user') ? 'زبون' : 'وكيل',
  text: m.textContent.trim().replace(/\s+/g, ' '),
})));
const show = async (n = 99) => (await msgs()).slice(-n).forEach((m) => console.log(`      ${m.who}: ${m.text.slice(0, 96)}`));
const fresh = async () => { await page.goto(URL, { waitUntil: 'networkidle' }); await page.waitForSelector('#voInput'); };

console.log('\n═══ ١) هل يرى الزبون أنّ شيئًا يجري؟ ═══');
await fresh();
{
  /* تأخيرٌ متعمَّد على التحليل — كما تفعل شبكة الجوّال فعلًا */
  await page.route('**/order/parse', async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await say('ابغى توصيل من السالمية');
  await page.waitForTimeout(900);          // في وسط الانتظار
  const mid = await page.evaluate(() => ({
    msgs: document.querySelectorAll('.vo-msg').length,
    pending: !!document.querySelector('.vo-msg--waiting, .vo-dots, .vo-msg--pending, .is-thinking, .vo-typing'),
    lastText: document.querySelector('.vo-msg:last-child')?.textContent.trim().slice(0, 40),
    inputDisabled: document.getElementById('voInput').disabled,
    busy: document.querySelector('.vo-chat')?.getAttribute('aria-busy'),
  }));
  console.log(`      بعد ٩٠٠ مللي: ${mid.msgs} فقاعة · آخرها «${mid.lastText}»`);
  if (!mid.pending && mid.busy !== 'true') fail('لا شيء يقول إنّ الوكيل يعمل — صمتٌ ٢٫٥ ثانية بعد كلام الزبون');
  else ok('ثمّة إشارةُ انتظار');
  await page.waitForTimeout(2400);
  await page.unroute('**/order/parse');
}

console.log('\n═══ ٢) ضغطتان متتاليتان ═══');
await fresh();
{
  await page.route('**/order/parse', async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  const calls = [];
  page.on('request', (r) => { if (r.url().includes('order/parse')) calls.push(r.postDataJSON?.() ?? null); });
  await page.fill('#voInput', 'من السالمية');
  await page.press('#voInput', 'Enter');
  await page.fill('#voInput', 'الى الجابرية');
  await page.press('#voInput', 'Enter');          // قبل أن يردّ الأوّل
  await page.waitForTimeout(3500);
  await page.unroute('**/order/parse');
  const m = await msgs();
  await show(6);
  const f = await page.evaluate(() => window.__state ?? null);
  const heard = await page.$$eval('#voHeard li', (ls) => ls.map((l) => l.textContent.trim()));
  console.log(`      البطاقة: ${heard.join(' · ') || '—'}`);
  if (!heard.some((h) => /الجابرية/.test(h)) || !heard.some((h) => /السالمية/.test(h))) {
    fail('ضغطتان متتاليتان أضاعتا إحدى الجملتين — سباقٌ على الحديث');
  } else ok('الجملتان وصلتا رغم التسابق');
}

console.log('\n═══ ٣) الشبكة تنقطع وقد كتب ═══');
await fresh();
{
  await page.route('**/order/parse', (route) => route.abort('failed'));
  await say('اسمي بدر ورقمي ٥٥٥٠١٠٢٠ من حولي الى السالمية');
  await page.waitForTimeout(1500);
  await page.unroute('**/order/parse');
  const m = await msgs();
  await show(3);
  const left = await page.$eval('#voInput', (e) => e.value);
  if (left) ok(`النصّ محفوظٌ في المساحة: «${left.slice(0, 40)}»`);
  else fail('ضاع ما كتبه الزبون — عليه أن يكتب طلبه كلّه من جديد');
  const hasRetry = await page.evaluate(() => !!document.querySelector('.vo-retry, [data-retry]'));
  if (!hasRetry) note('لا زرّ «أعد المحاولة» — على الزبون أن يعيد الكتابة بنفسه');
  /* وبعد أن تعود الشبكة: هل يستأنف؟ */
  await say('اسمي بدر ورقمي ٥٥٥٠١٠٢٠ من حولي الى السالمية');
  await page.waitForTimeout(1500);
  const heard = await page.$$eval('#voHeard li', (ls) => ls.map((l) => l.textContent.trim()));
  heard.length ? ok(`تعافى بعد عودة الشبكة: ${heard.length} سطورًا في البطاقة`) : fail('لم يتعافَ بعد عودة الشبكة');
}

console.log('\n═══ ٤) هل يستطيع تصحيح ما فُهم؟ ═══');
await fresh();
{
  await say('اسمي بدر من السالمية الى الجابرية ورقمي ٥٥٥٠١٠٢٠');
  await page.waitForTimeout(1400);
  const affordance = await page.evaluate(() => ({
    editable: document.querySelectorAll('#voHeard [contenteditable], #voHeard button, #voHeard a').length,
    heard: [...document.querySelectorAll('#voHeard li')].map((l) => l.textContent.trim()),
    submitShown: !document.getElementById('voSubmit').hidden,
  }));
  console.log(`      البطاقة: ${affordance.heard.join(' · ')}`);
  if (!affordance.editable) note('لا سبيل لتعديل حقلٍ في البطاقة — التصحيح بالكلام وحده');
  /* والتصحيح بالكلام: هل يعمل؟ وهل يقرّ الوكيل به؟ */
  await say('لا، اسمي فهد');
  await page.waitForTimeout(1400);
  await show(2);
  const after = await page.$$eval('#voHeard li', (ls) => ls.map((l) => l.textContent.trim()));
  if (!after.some((h) => /فهد/.test(h))) fail(`التصحيح لم يصل البطاقة: ${after.join(' · ')}`);
  else ok('التصحيح بالكلام يصل البطاقة');
  const said = (await msgs()).slice(-3).map((m) => m.text).join(' ⏎ ');
  if (!/فهد/.test(said)) note(`ولم يقرّ به الوكيل في الحوار: «${said.slice(0, 80)}»`);
  else ok('ويُقرّ به في الحوار');
}

console.log('\n═══ ٥) حوارٌ طويل — هل يبقى المهمّ مرئيًّا؟ ═══');
await fresh();
{
  for (const t of ['مرحبا', 'كم سعر التوصيل؟', 'توصلون الجهراء؟', 'ابغى توصيل', 'من حولي', 'الى السالمية', 'اسمي بدر', '٥٥٥٠١٠٢٠']) {
    await say(t); await page.waitForTimeout(950);
  }
  const m = await msgs();
  console.log(`      ${m.length} فقاعة`);
  await show(4);
  const v = await page.evaluate(() => {
    const btn = document.getElementById('voSubmit');
    const r = btn.getBoundingClientRect();
    const comp = document.getElementById('voComposer').getBoundingClientRect();
    return { hidden: btn.hidden, top: Math.round(r.top), bottom: Math.round(r.bottom), compTop: Math.round(comp.top), vh: innerHeight };
  });
  if (v.hidden) fail('اكتمل الطلب ولم يظهر زرّ الإرسال');
  else if (v.bottom > v.compTop) fail(`زرّ الإرسال تحت الملتقط (${v.bottom} > ${v.compTop}) — يُقال «اضغط» وهو غير مرئيّ`);
  else ok(`زرّ الإرسال مرئيّ فوق الملتقط (${v.top}–${v.bottom} · الملتقط عند ${v.compTop})`);
}

console.log('\n═══ ٦) ما يقوله الوكيل حين لا يفهم ═══');
await fresh();
{
  for (const t of ['ابغى توصيل', 'اممم', 'لا ادري', 'شنو؟']) { await say(t); await page.waitForTimeout(950); }
  await show(8);
  const texts = (await msgs()).filter((m) => m.who === 'وكيل').map((m) => m.text);
  const dup = texts.filter((t, i) => texts.indexOf(t) !== i);
  if (dup.length) note(`ردٌّ يتكرّر حرفيًّا ${dup.length} مرّة: «${dup[0].slice(0, 60)}»`);
  else ok('لا ردَّ يتكرّر حرفيًّا');
}

console.log(errs.length ? `\n   ✗ أخطاء متصفّح: ${errs.join(' | ')}` : '\n   · صفر أخطاء متصفّح');
console.log(bad ? `\n════ إخفاقات: ${bad} · ملحوظات: ${warn} ════` : `\n════ لا إخفاق · ملحوظات: ${warn} ════`);
await browser.close();
process.exit(bad ? 1 : 0);
