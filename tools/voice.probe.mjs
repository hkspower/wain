/* مِسبار الالتقاط الصوتي — يُشغَّل باليد، لا مع `test-all`.
 *
 * يحتاج ما لا يحتاجه بقيّة المستودع: متصفّحًا وplaywright وخادمين. ولذلك
 * هو مِسبارٌ منفصل على سنّة `agent-system/test/authz.probe.js`، والموقع
 * يبقى بلا اعتماديات ولا خطوة بناء.
 *
 *   cd website && python3 -m http.server 8080 &
 *   cd agent-system && PORT=4100 \
 *     MAWSOOL_SITE_ORIGINS=http://127.0.0.1:8080 node server/index.js &
 *   node tools/voice.probe.mjs      # وCHROMIUM=… إن لم يجد المتصفّح
 *
 * ── ما يقيسه ──
 *
 * لا ميكروفون هنا، ولا خدمة تعرّف. فالمقيس ليس «هل يسمع؟» — ذاك عند
 * جوجل — بل **ما تفعله الصفحة بما يعطيها المتصفّح**: السكتة، والخطأ،
 * والاستئناف، وما يُرسل في النهاية. وهذه هي مواضع العطب الحقيقية:
 * الالتقاط ينجح ثمّ يضيع نصفُه، أو يُرسل ناقصًا، أو يُبتلع ما كتبه الزبون.
 *
 * الواجهة المزيّفة تحاكي `SpeechRecognition` كما تنصّ عليها المواصفة:
 *   · `start()` يرمي `InvalidStateError` إن كانت جلسةٌ قائمة
 *   · `results` قائمةٌ تتراكم داخل الجلسة وتُصفَّر مع الجلسة التالية
 *   · `end` يقع بعد `error` أيضًا
 * وإن كانت المحاكاة خاطئة فالاختبار يقيس نفسه لا الصفحة — فتُفحص أوّلًا.
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8080/?api=http://127.0.0.1:4100';

const INIT = () => {
  window.__log = [];
  window.__sent = [];
  const REAL = window.SpeechRecognition || window.webkitSpeechRecognition;
  window.__realSR = REAL ? REAL.name || 'موجودة' : null;

  const rt = Date.now;
  window.__skew = 0;
  Date.now = () => rt() + window.__skew;

  class FakeSR {
    constructor() {
      this.lang = ''; this.interimResults = false;
      this.continuous = false; this.maxAlternatives = 1;
      this._l = {}; this.running = false;
      window.__rec = this;
    }
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
    removeEventListener() {}
    _emit(t, e) { for (const f of (this._l[t] || []).slice()) f(Object.assign({ type: t }, e)); }
    start() {
      if (this.running) { const e = new Error('already started'); e.name = 'InvalidStateError'; throw e; }
      this.running = true; window.__log.push('start');
    }
    stop() { window.__log.push('stop'); }
    abort() { window.__log.push('abort'); }
  }
  window.SpeechRecognition = FakeSR;
  window.webkitSpeechRecognition = FakeSR;

  window.__voice = {
    said(parts) {
      const results = parts.map((p) => {
        const r = [{ transcript: p.t, confidence: 0.9 }];
        r.isFinal = !!p.final;
        return r;
      });
      window.__rec._emit('result', { results });
    },
    err(name) { window.__rec._emit('error', { error: name }); },
    end() { window.__rec.running = false; window.__log.push('end'); window.__rec._emit('end', {}); },
  };

  const of = window.fetch;
  window.fetch = function (u, o) {
    const s = String(u);
    try {
      if (s.includes('/order/parse')) window.__sent.push(JSON.parse(o.body).latest);
    } catch { /* لا يُسقط الصفحة */ }
    return of.apply(this, arguments);
  };
};

let bad = 0;
const fail = (m) => { bad++; console.log('   ✗ ' + m); };
const ok = (m) => console.log('   ✓ ' + m);

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--no-sandbox'],
  });
} catch (e) {
  console.error(`تعذّر إقلاع المتصفّح: ${e.message}\n` +
    'إن لم يجد playwright متصفّحه، دُلّه عليه:  CHROMIUM=/path/to/chrome node tools/voice.probe.mjs');
  process.exit(2);
}
const ctx = await browser.newContext({ locale: 'ar-KW' });
await ctx.addInitScript(INIT);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));

const S = {
  mic: () => page.$eval('#voMic', (e) => ({ hidden: e.hidden, pressed: e.getAttribute('aria-pressed'), label: e.getAttribute('aria-label') })),
  hint: () => page.$eval('#voHint', (e) => e.textContent.trim()),
  input: () => page.$eval('#voInput', (e) => e.value),
  sent: () => page.evaluate(() => window.__sent.slice()),
  log: () => page.evaluate(() => window.__log.slice()),
};
const drive = (fn, ...a) => page.evaluate(([f, args]) => window.__voice[f](...args), [fn, a]);
const click = () => page.click('#voMic');
const type = (t) => page.fill('#voInput', t);
const fresh = async () => {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#voMic');
};
/** ينتظر أن يبلغ عدد ما أُرسل حدًّا، أو يستسلم */
const settle = async (n, ms = 4000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if ((await S.sent()).length >= n) return true;
    await page.waitForTimeout(80);
  }
  return false;
};

/* ═════ صفر: فحص الآلة القائسة قبل الاعتماد عليها ═════ */
console.log('\n═════ ٠) الأداة نفسها ═════');
await fresh();
{
  const real = await page.evaluate(() => window.__realSR);
  console.log(`   · واجهة التعرّف الحقيقية في هذا الكروم: ${real ?? 'غير موجودة'}`);
  const wired = await page.evaluate(() => !!window.__rec);
  if (!wired) fail('الصفحة لم تُنشئ الملتقط — المزيّفة لم تُركَّب، وكل ما بعدها بلا معنى');
  else ok('الصفحة أنشأت الملتقط من الواجهة المزيّفة');
  const cfg = await page.evaluate(() => ({ lang: __rec.lang, cont: __rec.continuous, interim: __rec.interimResults }));
  if (cfg.lang !== 'ar-KW') fail(`اللغة «${cfg.lang}» لا «ar-KW»`); else ok('اللغة ar-KW');
  if (!cfg.cont) fail('continuous مطفأة — تنقطع عند أوّل سكتة'); else ok('continuous مشتعلة');
  if (!cfg.interim) fail('interimResults مطفأة — لا نصّ حيّ أثناء الكلام'); else ok('interimResults مشتعلة');
  const m = await S.mic();
  if (m.hidden) fail('زرّ الميكروفون مخفيّ رغم توفّر الواجهة والسياق الآمن');
  else ok(`الزرّ ظاهر · ${m.label}`);
}

/* ═════ ١) نطقٌ كامل ثمّ إيقاف ═════ */
console.log('\n═════ ١) يتكلّم طلبه كاملًا ثمّ يضغط الإيقاف ═════');
await fresh();
{
  await click();
  const m = await S.mic();
  if (m.pressed !== 'true') fail('الزرّ لم يُعلن أنه يستمع (aria-pressed)');
  const h = await S.hint();
  if (!h) fail('لا سطر يقول للزبون إنه مسموع'); else ok(`أثناء الاستماع: «${h}»`);

  await drive('said', [{ t: 'ابغى توصيل من السالمية', final: false }]);
  await drive('said', [{ t: 'ابغى توصيل من السالمية قطعة اربعة الى الجابرية', final: true }]);
  const live = await S.input();
  if (!live.includes('الجابرية')) fail(`النصّ الحيّ لا يظهر في المساحة: «${live}»`);
  else ok(`النصّ يظهر حيًّا: «${live}»`);

  await click();                       // إيقاف
  await drive('end');
  if (!(await settle(1))) fail('ضغط الإيقاف ولم يُرسل شيء');
  else {
    const s = (await S.sent())[0];
    if (s !== 'ابغى توصيل من السالمية قطعة اربعة الى الجابرية') fail(`أُرسل «${s}»`);
    else ok(`أُرسل ما سُمع كاملًا: «${s}»`);
  }
  const after = await S.mic();
  if (after.pressed !== 'false') fail('الزرّ بقي معلنًا الاستماع بعد الإيقاف');
  else ok('الزرّ عاد إلى السكون');
  if (await S.input()) fail('المساحة لم تُفرَّغ بعد الإرسال');
}

/* ═════ ٢) السكتة بين جملتين ═════ */
console.log('\n═════ ٢) يسكت بين جملتين — والمتصفّح ينهي الجلسة ═════');
await fresh();
{
  await click();
  await drive('said', [{ t: 'ودي اطرش اغراض من حولي', final: true }]);
  await drive('end');                                    // المتصفّح أنهى، لا الزبون
  await page.waitForTimeout(150);
  const sentEarly = await S.sent();
  if (sentEarly.length) fail(`أُرسل الشطر الأوّل وحده: «${sentEarly[0]}» — الطلب يصل ناقصًا`);
  else ok('لم يُرسل شيء عند السكتة');
  const m = await S.mic();
  if (m.pressed !== 'true') fail('الزرّ انطفأ عند السكتة — والزبون لم يطلب ذلك');
  else ok('الاستماع مستمرّ');
  const lg = await S.log();
  if (lg.filter((x) => x === 'start').length !== 2) fail(`لم يُستأنف بصمت: ${lg.join('→')}`);
  else ok('استُؤنف بصمت');

  await drive('said', [{ t: 'للفحيحيل', final: true }]);  // جلسةٌ جديدة: القائمة صُفِّرت
  await click();
  await drive('end');
  if (!(await settle(1))) fail('لم يُرسل شيء بعد الإيقاف');
  else {
    const s = (await S.sent())[0];
    if (s !== 'ودي اطرش اغراض من حولي للفحيحيل') fail(`الشطران لم يلتئما: «${s}»`);
    else ok(`الشطران التأما مرّةً واحدة: «${s}»`);
  }
}

/* ═════ ٣) لم يُسمح بالميكروفون ═════ */
console.log('\n═════ ٣) الزبون يرفض إذن الميكروفون ═════');
await fresh();
{
  await type('اسمي بدر ورقمي ٥٥٥٠١٠٢٠');
  await click();
  await drive('err', 'not-allowed');
  await drive('end');
  await page.waitForTimeout(200);
  const h = await S.hint();
  if (!/يُسمح|الميكروفون/.test(h)) fail(`لا يُشرح سبب الصمت: «${h}»`);
  else ok(`يُشرح ويدلّ على المخرج: «${h}»`);
  if ((await S.sent()).length) fail('أُرسل طلبٌ رغم فشل الالتقاط');
  const left = await S.input();
  if (left !== 'اسمي بدر ورقمي ٥٥٥٠١٠٢٠') fail(`مُحي ما كتبه الزبون بيده — بقي «${left}»`);
  else ok('ما كتبه الزبون بيده باقٍ');
}

/* ═════ ٤) انقطاع الشبكة عن خدمة التعرّف ═════ */
console.log('\n═════ ٤) خدمة التعرّف لا تُبلَغ ═════');
await fresh();
{
  await click();
  await drive('said', [{ t: 'من السالمية الى حولي', final: true }]);
  await drive('err', 'network');
  await drive('end');
  await page.waitForTimeout(200);
  const h = await S.hint();
  if (!/تعذّر|الاتصال/.test(h)) fail(`رسالة الخطأ ضاعت: «${h}»`);
  else ok(`الرسالة باقية بعد end: «${h}»`);
  if ((await S.sent()).length) fail('أُرسل نصفُ طلبٍ بعد خطأ');
  else ok('لم يُرسل شيء بعد الخطأ');
  const kept = await S.input();
  if (kept !== 'من السالمية الى حولي') fail(`مُحي ما سُمع قبل الخطأ — بقي «${kept}»`);
  else ok(`ما سُمع باقٍ للزبون يرسله بيده: «${kept}»`);
}

/* ═════ ٥) سكتةٌ طويلة ═════ */
console.log('\n═════ ٥) سكتةٌ يعدّها المتصفّح «لا كلام» ═════');
await fresh();
{
  await click();
  await drive('said', [{ t: 'ابغى توصيل', final: true }]);
  await drive('err', 'no-speech');
  await page.waitForTimeout(150);
  const h = await S.hint();
  if (/تعذّر|خطأ/.test(h)) fail(`سكتةٌ عادية أُظهرت خطأً: «${h}»`);
  else ok('السكتة لا تُخوَّف بها الزبون');
  const m = await S.mic();
  if (m.pressed !== 'true') fail('انطفأ الالتقاط لسكتة');
  else ok('الالتقاط مستمرّ');
}

/* ═════ ٦) إيقافٌ بلا كلام ═════ */
console.log('\n═════ ٦) يضغط ثمّ يعدل — بلا كلام ═════');
await fresh();
{
  await click();
  await click();
  await drive('end');
  await page.waitForTimeout(400);
  if ((await S.sent()).length) fail(`أُرسل دورٌ فارغ إلى الوكيل: «${(await S.sent())[0]}»`);
  else ok('لا يُرسل دورٌ فارغ');
  if ((await S.hint())) console.log(`   · السطر بعده: «${await S.hint()}»`);
}

/* ═════ ٧) حدّ الاستئناف ═════ */
console.log('\n═════ ٧) لا تدور الحلقة أبدًا ═════');
await fresh();
{
  await click();
  await drive('said', [{ t: 'من الجهراء الى الفروانية', final: true }]);
  for (let i = 0; i < 25; i++) await drive('end');
  await page.waitForTimeout(500);
  const starts = (await S.log()).filter((x) => x === 'start').length;
  if (starts > 21) fail(`استُؤنف ${starts} مرّة — بلا حدّ`);
  else ok(`توقّف الاستئناف عند ${starts} بدءًا`);
  const s = await S.sent();
  if (!s.length) fail('بلغ الحدّ فضاع ما سُمع');
  else if (s[0] !== 'من الجهراء الى الفروانية') fail(`أُرسل مضاعفًا: «${s[0]}»`);
  else ok(`ما سُمع أُرسل عند الحدّ مرّةً واحدة: «${s[0]}»`);
}

/* ═════ ٨) الميكروفون المنسيّ ═════ */
console.log('\n═════ ٨) ميكروفونٌ مفتوحٌ منسيّ ═════');
await fresh();
{
  await click();
  await drive('said', [{ t: 'من الشرق الى المنقف', final: true }]);
  await page.evaluate(() => { window.__skew = 95_000; });   // مضت دقيقةٌ ونصف
  await drive('end');
  await page.waitForTimeout(400);
  const m = await S.mic();
  if (m.pressed !== 'false') fail('بقي الميكروفون مفتوحًا بعد ٩٠ ثانية');
  else ok('أُغلق عند المهلة');
  const h = await S.hint();
  const s = await S.sent();
  if (!s.length) fail('انتهت المهلة فضاع ما سُمع');
  else ok(`أُرسل ما سُمع: «${s[0]}»  ·  «${h}»`);
}

/* ═════ ٩) كتابةٌ ثمّ كلام ═════ */
console.log('\n═════ ٩) يكتب نصفًا ثمّ يُكمل نطقًا ═════');
await fresh();
{
  await type('اسمي فهد');
  await click();
  await drive('said', [{ t: 'ورقمي ٩٩٠٠١١٢٢', final: true }]);
  const live = await S.input();
  if (live !== 'اسمي فهد ورقمي ٩٩٠٠١١٢٢') fail(`المكتوب والمنطوق لم يلتئما: «${live}»`);
  else ok(`التأما: «${live}»`);
  await click();
  await drive('end');
  await settle(1);
  const s = (await S.sent())[0];
  if (s !== 'اسمي فهد ورقمي ٩٩٠٠١١٢٢') fail(`أُرسل «${s}»`);
  else ok('أُرسل مرّةً واحدة بلا تكرار');
}

/* ═════ ١٠) واجهةٌ غائبة ═════ */
console.log('\n═════ ١٠) متصفّحٌ بلا تعرّفٍ على الكلام ═════');
{
  const p2 = await (await browser.newContext({ locale: 'ar-KW' })).newPage();
  await p2.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
  });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  const hidden = await p2.$eval('#voMic', (e) => e.hidden);
  const hint = await p2.$eval('#voHint', (e) => e.textContent.trim());
  if (!hidden) fail('زرٌّ يَعِد بما لا يستطيع: ظاهرٌ بلا واجهة');
  else ok('الزرّ يُخفى');
  if (!/لا يدعم|اكتب/.test(hint)) fail(`لا يُقال للزبون ماذا يفعل: «${hint}»`);
  else ok(`ويُقال البديل: «${hint}»`);
  const typed = await p2.$eval('#voInput', (e) => !e.disabled);
  if (!typed) fail('والكتابة معطّلة أيضًا — لا طريق'); else ok('الكتابة تبقى الطريق الكامل');
  await p2.context().close();
}

console.log(errs.length ? `\n· أخطاء متصفّح: ${errs.join(' | ')}` : '\n· صفر أخطاء متصفّح');
console.log(bad ? `\n════ إخفاقات: ${bad} ════` : '\n════ لا إخفاق ════');
await browser.close();
process.exit(bad ? 1 : 0);
