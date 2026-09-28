/**
 * حارس التباين: يقرأ الألوان **من الصفحة المرسومة** في الثيمتين.
 *
 * ── لماذا من الصفحة لا من ورقة الأنماط ───────────────────────────────
 * الرمز في `site.css` لا يقول ما يراه الزبون: قيمته تمرّ على `light-dark`
 * وعلى الوراثة وعلى الشفافية، وقد يقع على سطحٍ غير الذي قُدّر له. وقد
 * وقع هذا فعلًا في تاريخ هذا الملفّ: لونٌ صحيحٌ في الرمز ظهر ١٫٣٧ على
 * الأرضيّة الداكنة لأنّه كُتب ثابتًا لا رمزًا. فالمقياس على البكسل.
 *
 * ── ما يفحصه ─────────────────────────────────────────────────────────
 * كلّ نصٍّ يقرؤه الزبون ≥ ٤٫٥، وكلّ حدٍّ لما يُنقر ويُكتب فيه ≥ ٣
 * (WCAG 1.4.3 و1.4.11)، في الفاتحة والداكنة معًا — لأنّ اللوحتين
 * مستقلّتان، ولونٌ يمرّ في إحداهما قد يسقط في الأخرى.
 *
 *   node website/tools/check-contrast.mjs [http://127.0.0.1:8080/?api=…]
 *
 * يحتاج متصفّحًا: `CHROMIUM_PATH` أو ما يجده Playwright. ويخرج بحالة
 * غير صفرية إن سقط زوجٌ واحد، فيصلح أن يُوضع في مسار نشرٍ آليّ.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:8080/';
const EXEC = process.env.CHROMIUM_PATH || undefined;

const lum = (c) => {
  const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const nums = (s) => (s.match(/[\d.]+/g) || []).map(Number);
/* السطح الشفّاف يُسطَّح على ما تحته قبل القياس — وإلّا قِيس لونٌ لا يُرى */
const flatten = (fg, bg) => {
  const a = fg.length > 3 ? fg[3] : 1;
  return fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
};

/* الحوار يُساق إلى الحالات التي تُظهر كلّ لونٍ في الصفحة: النواقص،
   واقتراح «هل تقصد؟»، والبطاقة المكتملة، وشاشة التأكيد. */
const SCRIPT = [
  'ابغى توصيل من السالمي',
  'الاستلام من السالمية قطعة ٤ والتسليم في الجابرية',
  'اسمي نورة ورقمي ٩٩٠٠١١٢٢',
];

async function sample(page) {
  return page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const q = (s) => document.querySelector(s);
    const out = [];
    const text = (name, sel, bgSel) => {
      const el = q(sel); if (!el) return;
      out.push({ name, fg: cs(el).color, bg: cs(bgSel ? q(bgSel) : el).backgroundColor, min: 4.5 });
    };
    const edge = (name, sel, bgSel) => {
      const el = q(sel); if (!el) return;
      out.push({ name, fg: cs(el).borderTopColor, bg: cs(q(bgSel)).backgroundColor, min: 3 });
    };
    text('متن الوكيل', '.vo-msg--agent');
    text('فقاعة الزبون', '.vo-msg--user');
    text('بنود البطاقة', '.vo-card__list li', '.vo-card');
    text('النواقص', '.vo-card__missing li', '.vo-card');
    text('الإقرار تحت البطاقة', '.vo-card__note', '.vo-card');
    text('زرّ الإرسال الأساسيّ', '.vo-card__send');
    text('زرّ الاقتراح', '.vo-hintbtn');
    text('رمز الطلب', '.vo-done__code', '.vo-done');
    text('نصّ التأكيد', '.vo-done p', '.vo-done');
    text('سطر التلميح', '.vo-composer__hint', '.vo-composer');
    text('روابط الترويسة', '.vo-top__nav a', '.vo-top');
    text('زرّ الثيمة', '.vo-top__theme', '.vo-top');
    text('الميكروفون', '.vo-mic');
    text('زرّ الإرسال في الملتقط', '.vo-typebar__send');
    edge('حدّ مساحة الكتابة', '.vo-typebar', '.vo-composer');
    edge('حدّ زرّ الاقتراح', '.vo-hintbtn', '.vo-msg--agent');
    return out;
  });
}

const browser = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
let failed = 0;
let checked = 0;

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ locale: 'ar-KW', viewport: { width: 390, height: 844 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });

  const rows = [];
  /* تُلتقط الحالة بعد كلّ جملة: بعضُ الألوان لا يظهر إلّا في حالةٍ واحدة
     (النواقص تختفي حين يكتمل الطلب، والتأكيد لا يظهر قبل الإرسال). */
  for (const line of SCRIPT) {
    await page.fill('#voInput', line);
    await page.press('#voInput', 'Enter');
    await page.waitForTimeout(1500);
    rows.push(...await sample(page));
  }
  const send = await page.$('#voSubmit:not([hidden])');
  if (send) {
    await send.click();
    await page.waitForSelector('#voDone:not([hidden])', { timeout: 10000 }).catch(() => {});
    rows.push(...await sample(page));
  }

  console.log(`\n══ ${scheme === 'light' ? 'الثيمة الفاتحة' : 'الثيمة الداكنة'} ══`);
  const seen = new Set();
  for (const r of rows) {
    const key = r.name + r.fg + r.bg;
    if (seen.has(key)) continue;
    seen.add(key);
    const bg = nums(r.bg).slice(0, 3);
    if (bg.length < 3) continue;                       // سطحٌ شفّاف بلا أب مرسوم
    const value = ratio(flatten(nums(r.fg), bg), bg);
    const ok = value >= r.min;
    checked += 1;
    if (!ok) failed += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${r.name}: ${value.toFixed(2)} (الحدّ ${r.min})`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${failed ? `✗ ${failed} من ${checked} دون الحدّ` : `✓ ${checked} زوجًا كلّها فوق الحدّ`}`);
process.exit(failed ? 1 : 0);
