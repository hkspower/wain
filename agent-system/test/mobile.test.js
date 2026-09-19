'use strict';
/**
 * الكتابة على الجوال.
 *
 * كانت حقول النظام كلّها دون ١٦ بكسل، فكان iPhone يكبّر الصفحة عند لمس أي
 * حقل ولا يعيدها. وهذا النوع من العيوب **يعود صامتًا**: يضيف أحدهم حقلًا
 * جديدًا بعد شهر بلا `inputmode`، فتُفتح للزبون لوحة حروف مكان لوحة أرقام،
 * ولا يكسر ذلك اختبارًا ولا يظهر على شاشة المطوّر.
 *
 * فالفحص هنا على المصدر نفسه: كل حقل مكتوب في الواجهة يُقرأ ويُسأل عمّا
 * يلزمه. لا يغني هذا عن التجربة على جهاز، لكنه يمنع النكوص.
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
/* الشرح داخل التعليق ليس تنسيقًا يُرسم. حارسان سقطا على هذا: أحدهما قرأ
   لونًا مذكورًا في تعليق يشرح حذفه، والآخر قرأ اسم رمزٍ في تعليق يشرح
   إزالته. ما يُفحص هو ما يُرسل إلى المتصفّح، لا ما يُقرأ عنه. */
const readCss = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');

const SOURCES = ['app.js', 'link.js', 'index.html', 'link.html'];

/** كل وسم إدخال مكتوب في الواجهة، ومعه ملفّه */
function inputs() {
  const out = [];
  for (const file of SOURCES) {
    const src = read(file);
    for (const m of src.matchAll(/<(input|textarea)\b[^>]*>/gs)) {
      const tag = m[0];
      const name = (tag.match(/\bname="([^"]+)"/) || tag.match(/\bid="([^"]+)"/) || [, '?'])[1];
      out.push({
        file, tag, name,
        /* السمة المجرّدة (`data-money`) موجودة بلا «=» فتُقبل كما هي */
        has: (a) => new RegExp(`\\b${a}(=|[\\s>])`).test(tag),
        val: (a) => (tag.match(new RegExp(`\\b${a}="([^"]*)"`)) || [, ''])[1],
      });
    }
  }
  return out;
}

test('كل حقل هاتف يفتح لوحة الأرقام لا لوحة الحروف', () => {
  const phones = inputs().filter((i) => /phone|tel/i.test(i.name));
  assert.ok(phones.length >= 2, `لم يُعثر على حقول هاتف (${phones.length})`);
  for (const i of phones) {
    assert.ok(i.val('type') === 'tel' || i.val('inputmode') === 'tel',
      `«${i.name}» في ${i.file} بلا لوحة هاتف`);
  }
});

test('حقول المال بلوحة عشرية، وليست type=number', () => {
  const money = inputs().filter((i) => /amount|fee/i.test(i.name));
  assert.ok(money.length >= 2, `لم يُعثر على حقول مال (${money.length})`);
  for (const i of money) {
    assert.equal(i.val('inputmode'), 'decimal', `«${i.name}» بلا لوحة عشرية`);
    /* `type=number` يغيّر قيمته إن مرّ الإصبع فوقه، ويخفي الفاصلة في لغات */
    assert.notEqual(i.val('type'), 'number', `«${i.name}» رجع إلى type=number`);
    assert.ok(i.has('data-money'), `«${i.name}» بلا تطبيع الأرقام العربية`);
  }
});

test('اسم المستخدم لا يُكبَّر أوّله ولا يُصحَّح تلقائيًّا', () => {
  const users = inputs().filter((i) => i.name === 'username');
  assert.ok(users.length >= 2, `لم يُعثر على حقول اسم المستخدم (${users.length})`);
  for (const i of users) {
    assert.equal(i.val('autocapitalize'), 'off', `«${i.name}» في ${i.file} يُكبَّر أوّله على iOS`);
    assert.equal(i.val('autocorrect'), 'off', `«${i.name}» في ${i.file} يُصحَّح تلقائيًّا`);
  }
});

test('حقل القطعة بلوحة أرقام ويقبل الأرقام العربية', () => {
  const blocks = inputs().filter((i) => /_block$/.test(i.name));
  assert.equal(blocks.length, 2, `عدد حقول القطعة ${blocks.length}`);
  for (const i of blocks) {
    assert.equal(i.val('inputmode'), 'numeric', `«${i.name}» بلا لوحة أرقام`);
    assert.ok(i.has('data-block'), `«${i.name}» بلا تطبيع الأرقام العربية`);
  }
});

test('عتبة سفاري مكتوبة في التنسيق — ١٦ بكسل تحت اللمس', () => {
  const css = read('app.css');
  const at = css.indexOf('@media (pointer: coarse), (max-width: 900px)');
  assert.ok(at > 0, 'لا قاعدة للّمس في app.css');
  const block = css.slice(at, css.indexOf('\n}', at));
  assert.match(block, /font-size:\s*16px/, 'قاعدة اللمس بلا ١٦ بكسل');
  for (const sel of ['.field input', '.field select', '.field textarea', '.filters input', '.availability select']) {
    assert.ok(block.includes(sel), `قاعدة اللمس لا تشمل ${sel}`);
  }
  assert.match(block, /min-height:\s*44px/, 'قاعدة اللمس بلا هدف لمس ٤٤ بكسل');
});

test('الشريط السفلي يختفي أثناء الكتابة ويعود بعدها', () => {
  const css = read('app.css');
  assert.match(css, /body\.is-typing \.tabbar\s*\{\s*display:\s*none/, 'الشريط لا يختفي أثناء الكتابة');

  /* والصنف يُوضع ويُنزع في مكان واحد يصعد إليه الحدث من أي حقل */
  const js = read('app.js');
  assert.match(js, /focusin[\s\S]{0,200}is-typing/, 'لا يُوضع الصنف عند بدء الكتابة');
  assert.match(js, /focusout[\s\S]{0,200}is-typing/, 'لا يُنزع الصنف بعد الكتابة');
});

test('لا حقل مرئي بقياس أصغر من العتبة في التنسيق الأساسي', () => {
  /* القاعدة الأساسية تبقى بالـrem للشاشات الكبيرة — المهم ألّا يُستثنى
     حقلٌ من قاعدة اللمس بقاعدة أخصّ منها داخل استعلام الجوال. */
  const css = read('app.css');
  const touchAt = css.indexOf('@media (pointer: coarse), (max-width: 900px)');
  const after = css.slice(touchAt);
  /* يُلتقط الرقم الصريح والتوكن معًا: بعد توحيد المقياس صارت الأحجام
     `var(--t-…)`، وكلّها دون ١٦ بكسل، فقاعدةٌ بها على حقلٍ تنقض العتبة. */
  const smaller = [...after.matchAll(/([.#][\w-]+(?:\s+[\w.#-]+)*)\s*\{[^}]*font-size:\s*(0?\.\d+rem|var\(--t-[\w-]+\))/g)]
    .filter(([, sel]) => /input|select|textarea/.test(sel));
  assert.deepEqual(smaller.map((m) => m[1]), [],
    'قاعدة بعد استعلام اللمس تعيد حقلًا إلى ما دون ١٦ بكسل');
});

/* --------------------------- تنسيق سطح الوكيل --------------------------- */

test('صندوق اللصق عمودان على العريض وعمود على الضيّق', () => {
  const css = read('app.css');
  assert.match(css, /\.vo__grid \{[^}]*grid-template-columns:\s*1fr 1fr/, 'لا عمودين على العريض');
  assert.match(css, /@media \(max-width: 720px\) \{ \.vo__grid \{ grid-template-columns: 1fr; \} \}/,
    'لا يعود عمودًا واحدًا على الضيّق');
  /* وقبل اللصق لا شيء في العمود الثاني، فلا يجلس الصندوق في نصف البطاقة */
  assert.match(css, /\.vo__grid:has\(\.vo__out:empty\) \{ grid-template-columns: 1fr; \}/,
    'الصندوق يبقى نصفًا قبل اللصق');
});

test('بطاقات الجواب تملأ العرض بأعمدة لا بعمود واحد', () => {
  const css = read('app.css');
  assert.match(css, /\.ask__answer \.orders \{ grid-template-columns: repeat\(auto-fill, minmax\(/, 'طلبات الجواب عمود واحد');
  assert.match(css, /\.ask__agents \{ grid-template-columns: repeat\(auto-fill, minmax\(/, 'كباتن الجواب عمود واحد');
});

test('السؤال يظهر فوق جوابه، وصفّ رقائق واحد لا صفّان', () => {
  const js = read('app.js');
  assert.match(js, /class="ask__q"/, 'الجواب بلا سؤاله');
  assert.match(js, /r\.asked = text/, 'السؤال لا يُحفظ مع الجواب');
  assert.match(js, /chips\.hidden = !!out\.querySelector\('\.ask__chips'\)/, 'صفّا رقائق معًا');
});

/* ----------------------------- المقياس الطباعي ----------------------------- */

test('الأحجام من المقياس لا أرقامًا متناثرة', () => {
  /* كانت في الملفّين تسعة وعشرون حجمًا: ‎.84‎ و‎.85‎ و‎.86‎ لا تفرّقها عين
     لكنها ثلاث قيم تتكاثر. القيم الصريحة الباقية مقصودة ومعدودة. */
  /* عتبة سفاري وحدها بالبكسل. «15px» للجسم و«14.5px» للجوال كانتا قيمتين
     خام تصغّران ما لا رمز له وحده، فأُزيلتا وأُغلق الباب خلفهما. */
  const ALLOWED_PX = ['16px'];
  for (const file of ['app.css', 'link.css']) {
    const loose = [...read(file).matchAll(/font-size:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      /* «rem» تنتهي بـ«em» — فيُستثنى النسبيّ الحقيقي وحده لا كل وحدة */
      .filter((v) => !v.startsWith('var(--t-') && !/^[\d.]+em$/.test(v) && !ALLOWED_PX.includes(v));
    assert.deepEqual(loose, [], `${file} فيه أحجام خارج المقياس`);
  }
});

test('عناصر النماذج لها ارتفاع سطر مصرَّح به — العربية تُقصّ بلا ذلك', () => {
  /* المتصفّح يفرض `normal` (نحو ١٫٢) على الأزرار والحقول، وهو يكفي
     اللاتينية ويقصّ الضمّة فوق الشدّة في «لم يُسلَّم». */
  assert.match(read('app.css'),
    /button, input, select, textarea, optgroup \{ line-height: var\(--lh-/,
    'عناصر النماذج بلا ارتفاع سطر مصرَّح به');
});

test('لا تباعد بين الحروف على نصّ عربيّ — يفصل الحرف عن أخيه', () => {
  for (const file of ['app.css', 'link.css']) {
    for (const m of read(file).matchAll(/([^{}]+)\{[^}]*letter-spacing:\s*([^;]+);/g)) {
      const [, sel, val] = m;
      const positive = parseFloat(val) > 0;
      /* الموجب يُقبل على اللاتينيّ وحده — ورمز الطلب لاتينيّ */
      if (positive) {
        assert.match(sel, /lk-code/, `${file}: تباعد موجب على «${sel.trim()}»`);
      }
    }
  }
});

/* ----------------------------- نظام اللون ----------------------------- */

/** درجة اللون (٠–٣٦٠) لأي لون في التنسيق، أو null للرماديّ */
function hueOf(css) {
  const hex = css.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i);
  const rgb = css.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  let r, g, b;
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else if (rgb) { [r, g, b] = [1, 2, 3].map((i) => +rgb[i]); } else return null;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 12) return null;                            // رماديّ: لا درجة له
  let h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return (h * 60 + 360) % 360;
}

test('درجتان لا قوس قزح — الهوية والتنبيه، ولا ذهب ولا برونز', () => {
  /* كل لون في الملفّين يجب أن يقع في إحدى نافذتين: الأزرق المخضرّ
     (١٦٠–٢١٠) أو الصدئ (٣٤٠–٢٠). وما بينهما — الذهبيّ والبرونزيّ
     والأخضر والأزرق والبنفسجيّ — خارج النظام. */
  const stray = [];
  for (const file of ['app.css', 'link.css']) {
    for (const m of readCss(file).matchAll(/(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]+\))/g)) {
      const h = hueOf(m[1]);
      if (h === null) continue;                       // رماديّ مقبول
      const brand = h >= 160 && h <= 210;
      const alert = h >= 340 || h <= 20;
      if (!brand && !alert) stray.push(`${file}: ${m[1]} (درجة ${Math.round(h)}°)`);
    }
  }
  assert.deepEqual(stray, [], 'ألوان خارج الدرجتين');
});

test('بلا تدرّجات لونية على الأسطح — الصلب هو النظام', () => {
  /* التدرّجات الباقية تقنيات رسم لا ألوان: سهم القائمة، وخطوط الخريطة،
     وهيكل التحميل. وما عداها يُمنع. */
  const ALLOWED = ['#cfe7ea', '--mute-bg', '#eaf4f5', '--teal-100'];
  const bad = [];
  for (const file of ['app.css', 'link.css']) {
    for (const m of read(file).matchAll(/linear-gradient\([^;]*/g)) {
      if (!ALLOWED.some((a) => m[0].includes(a))) bad.push(`${file}: ${m[0].slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, [], 'تدرّج لونيّ على سطح');
});

test('بلا رموز تعبيرية في ما يراه المستخدم', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  for (const file of ['app.js', 'link.js', 'index.html', 'link.html']) {
    /* التعليقات تُنزع: بعضها يشرح لماذا رُسمت الأيقونة متجهةً لا محرفًا */
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const hit = code.match(EMOJI);
    assert.equal(hit, null, `${file} فيه رمز تعبيريّ «${hit && hit[0]}»`);
  }
});

test('الظلّ للطبقات العائمة لا للأسطح المستوية', () => {
  const css = read('app.css');
  /* البطاقة والإحصاءة والطلب مستوية: حدُّها يكفي. والنافذة والتنبيه
     والشريط السفلي تعلو الصفحة فظلّها يقول ذلك. */
  for (const sel of ['.card {', '.stat {', '.order {']) {
    const at = css.indexOf(sel);
    assert.ok(at > 0, `لا قاعدة ${sel}`);
    const block = css.slice(at, css.indexOf('}', at));
    /* `transition: … box-shadow …` ليست ظلًّا بل إعلانُ انتقال — يُستثنى */
    const decl = block.replace(/transition:[^;]*;/g, '');
    assert.ok(!/box-shadow\s*:/.test(decl), `${sel} ما زال يحمل ظلًّا`);
  }
});

/* ----------------------------- مقياس التباعد ----------------------------- */

test('التباعد من المقياس لا أرقامًا متناثرة', () => {
  /* كانت أكثر من عشرين قيمة: ‎.32‎ و‎.35‎ و‎.38‎ و‎.45‎ و‎.55‎ و‎.62‎ —
     اختيرت كلٌّ في لحظتها فلا إيقاع بينها. */
  const PROPS = /\b(padding|margin|gap|row-gap|column-gap|(?:padding|margin)-(?:top|bottom|left|right|block|inline)(?:-(?:start|end))?):\s*([^;]+);/g;
  const loose = [];
  for (const file of ['app.css', 'link.css']) {
    for (const m of read(file).matchAll(PROPS)) {
      /* ما فيه calc أو env أو max متروك: قيمٌ محسوبة لا خطوات سلّم */
      if (/calc|env\(|max\(|min\(/.test(m[2])) continue;
      for (const part of m[2].trim().split(/\s+/)) {
        if (/^[\d.]+rem$/.test(part)) loose.push(`${file}: ${m[1]}: ${m[2].trim()}`);
      }
    }
  }
  assert.deepEqual([...new Set(loose)], [], 'تباعد خارج المقياس');
});

test('لا عمود شبكة أعرض من الشاشة الضيّقة', () => {
  /* `minmax(26rem, 1fr)` يفرض أدنى مطلقًا فيخرج عن شاشة ٣٩٠ بكسل بدل أن
     ينكمش. و`min(26rem, 100%)` يجعله يملأ ما وُجد. */
  const bad = [];
  for (const file of ['app.css', 'link.css']) {
    for (const m of read(file).matchAll(/minmax\(\s*([^,]+?)\s*,/g)) {
      const v = m[1].trim();
      if (v.startsWith('min(') || v === 'auto' || v === '0') continue;
      const px = /^([\d.]+)rem$/.test(v) ? parseFloat(v) * 16 : /^([\d.]+)px$/.test(v) ? parseFloat(v) : 0;
      if (px > 340) bad.push(`${file}: minmax(${v}, …)`);
    }
  }
  assert.deepEqual(bad, [], 'عمود لا ينكمش على الشاشة الضيّقة');
});

/* --------------------------- الحواف والحدود والأوزان --------------------------- */

test('الحواف من الرموز، ولا اسمَ يَعِد بما لا يعطي', () => {
  for (const file of ['app.css', 'link.css']) {
    const css = read(file);
    const loose = [...css.matchAll(/border-radius:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => v.split(/\s+/).some((part) => /^[\d.]+(px|rem)$/.test(part)));
    assert.deepEqual(loose, [], `${file}: حافّة خارج الرموز`);
    /* `--radius-pill` كان يعطي ٦ بكسل — اسمٌ يَعِد بكبسولة ولا يعطيها.
       والتعليقات تُنزع: أحدها يشرح لماذا أُزيل الاسم. */
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!code.includes('--radius-pill'), `${file}: اسم حافّة مضلِّل`);
  }
});

test('عرض الحدود عددٌ صحيح — ‎1.5px‎ تخرج ضبابية على شاشة ١×', () => {
  for (const file of ['app.css', 'link.css']) {
    /* الفحص على إعلانات الحدود وحدها: ‎14.5px‎ في قياس الخطّ على الجوال
       كسريّة عن قصد ولا علاقة لها بشبكة البكسل في الحدود. */
    const css = read(file);
    const loose = [...css.matchAll(/\bborder(?:-(?:top|bottom|left|right|inline|block)(?:-(?:start|end))?)?(?:-width)?:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => /^[\d.]+px\b/.test(v));
    assert.deepEqual(loose, [], `${file}: عرض حدّ خارج الرموز`);
  }
});

test('الأوزان من الرموز الأربعة لا خمسة أرقام متناثرة', () => {
  for (const file of ['app.css', 'link.css']) {
    const loose = [...read(file).matchAll(/font-weight:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      /* مدى `@font-face` («100 900») ليس وزنًا بل إعلانُ محور */
      .filter((v) => /^\d+$/.test(v));
    assert.deepEqual(loose, [], `${file}: وزن خارج الرموز`);
  }
});

test('العناوين ٧٠٠ لا ٨٠٠ — عيون الحروف العربية تضيق عند الأثقل', () => {
  assert.match(read('app.css'),
    /h1, h2, h3 \{[^}]*font-weight: var\(--w-bold\)/,
    'العناوين رجعت إلى الأثقل');
});

/* ------------------------------- دلالات HTML ------------------------------- */

test('النافذة عنصر <dialog> لا <div> — الحبس والتعطيل من المتصفّح', () => {
  const html = read('index.html');
  assert.match(html, /<dialog\b[^>]*id="modal"/, 'النافذة ليست <dialog>');
  assert.ok(!/class="modal__backdrop"/.test(html), 'ما زال ظهر النافذة عنصرًا مرسومًا بيدنا');

  const js = read('app.js');
  assert.match(js, /el\.modal\.showModal\(\)/, 'تُفتح بلا showModal فلا حبسَ للتنقّل');
  assert.match(js, /el\.modal\.close\(\)/, 'تُغلق بلا close');
  /* Esc تغلقها من المتصفّح، فالتنظيف يكون على `close` لا في دالّة الإغلاق */
  assert.match(js, /addEventListener\('close'/, 'التنظيف لا يقع عند الإغلاق بـEsc');

  assert.match(read('app.css'), /\.modal::backdrop/, 'الظهر بلا ::backdrop');
});

test('بطاقة الطلب <article> ووقتها <time> بتاريخ مقروء آليًّا', () => {
  const js = read('app.js');
  assert.match(js, /<article class="order/, 'البطاقة ليست <article>');
  assert.match(js, /<time class="order__time" datetime="/, 'الوقت بلا <time datetime>');
  assert.match(js, /<a class="order__code num" href="#\/orders\//, 'الرمز ليس رابطًا');
});

test('الرابط الممدود يُقاس على البطاقة لا على نفسه', () => {
  const css = read('app.css');
  assert.match(css, /\.order \{[^}]*position: relative/, 'البطاقة غير موضوعة فلا يمتدّ عليها شيء');
  assert.match(css, /\.order__code::after \{[^}]*position: absolute;\s*inset: 0/, 'لا طبقة ممدودة');
  /* لو وُضع الرابط نفسه لامتدّت الطبقة عليه هو، فلا تُضغط البطاقة */
  const rule = css.match(/\.order__code \{([^}]*)\}/);
  assert.ok(rule && !/position:\s*(relative|absolute)/.test(rule[1]),
    'الرابط موضوع، فالطبقة تمتدّ عليه لا على البطاقة');
});

/* ------------------------- اللوحة المباشرة ------------------------- */

test('نسبة المخطّط محسوبة من الحدود بجيب تمام العرض لا رقمًا مكتوبًا', () => {
  const js = read('app.js');
  assert.match(js, /const KW_RATIO =/, 'لا نسبة محسوبة');
  assert.match(js, /Math\.cos\(/, 'النسبة بلا تصحيح جيب التمام، فالمسافات شرقًا-غربًا مغلوطة');
  assert.match(js, /aspect-ratio:\$\{KW_RATIO/, 'المخطّط لا يستعمل النسبة المحسوبة');

  /* نتحقّق من القيمة نفسها: درجة الطول عند وسط الكويت ٠٫٨٧ من درجة العرض */
  const kw = { minLat: 28.45, maxLat: 30.15, minLng: 46.5, maxLng: 48.5 };
  const want = ((kw.maxLng - kw.minLng) * Math.cos((((kw.minLat + kw.maxLat) / 2) * Math.PI) / 180))
             / (kw.maxLat - kw.minLat);
  assert.ok(Math.abs(want - 1.026) < 0.01, 'حدود الكويت تغيّرت — راجع النسبة');
});

test('النقطة لا تتحرّك عن موضعها، والاسم وحده هو ما يُزاح', () => {
  const js = read('app.js');
  /* لو أُزيحت النقطة نفسها لتفادي التزاحم صار المخطّط كذبًا مرتّبًا */
  assert.match(js, /pin\.dataset\.side = side/, 'إزاحة الاسم غير قائمة');
  /* أي كتابة على نمط النقطة إزاحةٌ لها مهما كُتبت: `dot.style` أو
     `querySelector('.pin__dot').style`. الأول وحده لا يمسك الثاني. */
  assert.ok(!/(\bdot|pin__dot['"]\))\s*\.style\b/.test(js),
    'شيء ما يحرّك النقطة عن موضعها الحقيقي');
});

test('تفادي التراكب يقيس المستطيلات المرسومة لا أنصاف أقطار مقدَّرة', () => {
  const js = read('app.js');
  assert.match(js, /function separateMarks/, 'لا فصل بين العلامات');
  assert.match(js, /getBoundingClientRect\(\)/, 'الفصل بلا قياس فعلي');
  /* دائرة من خانتين أعرض من دائرة من خانة، والتقدير يخفي تراكبًا حقيقيًّا */
  assert.match(js, /hits\(marks\[i\], marks\[j\]\)/, 'الفصل لا يختبر تقاطع المستطيلات');
});

test('القائمة مرتّبة بما يحتاجه المدير أوّلًا لا أبجديًّا', () => {
  const js = read('app.js');
  assert.match(js, /const LIVE_RANK = \{/, 'لا رتب للحالات');
  assert.match(js, /sort\(\(x, y\) => rankOf\(x\) - rankOf\(y\)\)/, 'اللوحة غير مرتّبة بالحالة');
});

test('التحديث الدوري يقرأ open لا hidden — <dialog> لا يخفى بـhidden', () => {
  const js = read('app.js');
  /* `el.modal.hidden` على <dialog> false دائمًا، فالشرط المعكوس يقتل
     كل تحديث دوري في التطبيق لا في هذه الصفحة وحدها */
  assert.ok(!/!el\.modal\.hidden/.test(js), 'الشرط يقرأ hidden على <dialog> فيوقف التحديث أبدًا');
  assert.match(js, /el\.modal\.open/, 'لا فحص لحالة النافذة قبل التحديث');
  assert.match(js, /refreshLiveBoard\(\)/, 'اللوحة «المباشرة» تنتظر ضغطة زر');
});

/* --------------------- لوحة المدير على الجوال --------------------- */

test('جدول المندوبين يصير بطاقات على الجوال — لا تمرير جانبيّ يخفي الأزرار', () => {
  const css = read('app.css');
  /* عشرة أعمدة على شاشة ٣٩٠ تحتاج ١١٥٣ بكسلًا جانبيًّا، فيبقى زرّا الاعتماد
     والتعديل خارج الشاشة: لا يعتمد المدير كابتنًا من هاتفه. */
  /* العتبة مقيسة لا مُخمَّنة: أدنى عرض للجدول ١١٥٣، والحاوية
     `min(1240, 100% - 2rem)`، فيلزم ١١٨٥ ليسع نفسه. عتبةٌ أضيق تترك
     الجدول جدولًا وزرّاه خارج الشاشة بين العتبتين. */
  assert.match(css, /@media \(max-width: 1184px\) \{\s*\.table-wrap/,
    'عتبة البطاقات لا تطابق أدنى عرض يحتاجه الجدول');
  assert.match(css, /\.table-wrap tr \{[^}]*border-radius/, 'الصفّ ليس بطاقة على الضيّق');
  assert.match(css, /\.table-wrap td::before \{\s*content: attr\(data-label\)/, 'الخليّة بلا اسم عمودها');
  /* `clip-path` يمنع الرسم ولا يمنع التخطيط، فتمتدّ خلايا الرأس خارج الشاشة */
  assert.match(css, /\.table-wrap thead \{ display: none/, 'رأس الجدول يُخفى إخفاءً لا يمنع التخطيط');

  const js = read('app.js');
  assert.match(js, /<td data-label="الاسم"/, 'الخلايا بلا `data-label` فلا اسم لها في البطاقة');
  assert.match(js, /data-label="الهاتف"/, 'عمود الهاتف بلا تسمية');
});

test('لا مقاس خطّ خارج السلّم: `<small>` و`em` تُضاعف بلا حدّ', () => {
  const css = read('app.css');
  /* `small` بلا قاعدة يأخذ `0.8em` من المتصفّح، ويتضاعف مع كل تداخل */
  assert.match(css, /^small \{ font-size: var\(--t-xs\); \}/m, '`<small>` متروك لـ0.8em المتصفّح');
  /* `body { font-size: 14.5px }` كانت تصغّر ما لا رمز له وحده */
  assert.ok(!/body \{ font-size: 1[0-9.]+px/.test(css), 'حجم الجسم رقم خام لا رمز');
  assert.match(css, /body \{[^}]*font-size: var\(--t-base\)/, 'الجسم بلا رمز من السلّم');

  /* `em` نسبيّة فتتضاعف: يُسمح بها للتصحيح البصريّ في `code` وحدها */
  const ems = [...css.matchAll(/font-size:\s*(\.?\d[\d.]*)em/g)].map((m) => m[0]);
  assert.deepEqual(ems, ['font-size: .92em'], `مقاسات em خارج الاستثناء: ${ems.join(', ')}`);
});

test('شريط التنقّل السفلي: ستّ وجهات لا سبع، وأسماء لا تُقصّ', () => {
  const js = read('app.js');
  /* «طلب جديد» فعلٌ لا مكان، وسبعة عناصر لا تسع ٣٢٠ */
  assert.match(js, /label: 'طلب جديد', topOnly: true/, '«طلب جديد» ما زال في الشريط السفلي');
  assert.match(js, /el\.tabbar\.innerHTML = items\.filter\(\(i\) => !i\.topOnly\)/, 'الشريط السفلي يعرض كل شيء');

  const css = read('app.css');
  assert.match(css, /\.tabbar a \{[^}]*white-space: nowrap/, 'الأسماء تلتفّ على سطرين');
  /* الأساس `0` يوزّع بالتساوي فيُقصّ أطولها؛ `auto` يعطي كلًّا قدرها */
  assert.match(css, /\.tabbar a \{[^}]*flex: 1 1 auto/, 'التوزيع بالتساوي يقصّ أطول اسم');
});

test('كل زرّ هدف لمس على المؤشّر الخشن', () => {
  const css = read('app.css');
  const block = css.match(/@media \(pointer: coarse\), \(max-width: 900px\) \{([\s\S]*?)\n\}/);
  assert.ok(block, 'كتلة المؤشّر الخشن غير موجودة');
  assert.match(block[1], /\.btn, \.chip \{ min-height: 44px; \}/, 'الأزرار الصغيرة دون العتبة');
  assert.match(block[1], /\.live-row__meta a[^{]*\{[^}]*min-height: 44px/, 'الروابط القائمة بذاتها دون العتبة');
});

/* ------------------------- سطوح سادة لا صناديق ملوّنة ------------------------- */

test('لا حشوة ملوّنة على سطح محتوى — المعنى في النصّ ولونه وحدّه', () => {
  const css = readCss('app.css');
  /* رموز الحشوة حُذفت من أصلها، فلا تعود بلا قصد */
  for (const dead of ['--ok-bg', '--warn-bg', '--bad-bg', '--info-bg', '--alert-100']) {
    assert.ok(!css.includes(dead), `${dead} رجع — الحشوة الملوّنة تعود معه`);
  }
  /* الشارة حدُّها من لونها وحشوتُها لا شيء */
  assert.match(css, /\.badge \{[^}]*border: var\(--bw\) solid currentColor/, 'الشارة بلا حدّ من لونها');
  assert.ok(!/\.badge--[\w-]+ \{[^}]*background:/.test(css), 'شارةٌ عادت إلى حشوة ملوّنة');

  /* المتصفّح يلوّن الأزرار بـ`buttonface` ما لم نصرّح، فالزرّ المسطّح يعود
     كتلةً رمادية بلا سطر واحد في الملفّ */
  assert.match(css, /\.btn \{ background: var\(--card\); \}/, 'الزرّ متروك لرماديّ المتصفّح');
});

test('لا لون في نمطٍ سطريّ داخل الشيفرة — حارس الألوان يقرأ CSS وحده', () => {
  /* هكذا نجا أخضرٌ خارج الدرجتين شهورًا: كان مكتوبًا في `style="…"` داخل
     app.js، والحارس يفحص app.css. */
  for (const file of ['app.js', 'link.js']) {
    const inline = [...read(file).matchAll(/style="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((v) => /(background|border-color)\s*:/.test(v)
                  || /:\s*#[0-9a-fA-F]{3,8}/.test(v)
                  || /:\s*(rgb|hsl)a?\(/.test(v));
    assert.deepEqual(inline, [], `${file}: لون في نمط سطريّ`);
  }
});

/* ------------------- الاتّساع عبر الأجهزة والمتصفّحات ------------------- */

test('الصفحة تُفسح للشريط الثابت مسافةَ الأمان — لا رقمًا ثابتًا', () => {
  const css = readCss('app.css');
  /* الشريط ثابت وارتفاعه على آيفون ذي شقّ = ٥٤ + نحو ٣٤ بكسلًا لمؤشّر
     الرجوع. حشوةٌ ثابتة لا تعرف المسافة تترك آخر زرّ تحت الشريط على كل
     آيفون من ١٠ فما فوق — قِيس بمحاكاة الشقّ: ٤٢ موضعًا محجوبًا. */
  assert.match(css, /--tabbar-h:/, 'ارتفاع الشريط غير مكتوب رمزًا فينفصل عن حشوة الصفحة');
  /* `[^)]*` يقف عند أوّل قوس مغلق — وهو داخل `var(--s-5)` لا بعده */
  const pageRule = css.match(/\.page \{ padding-bottom: ([^;]+);/);
  assert.ok(pageRule, 'لا حشوة سفلية للصفحة على الجوال');
  assert.match(pageRule[1], /var\(--tabbar-h\)/, 'الحشوة لا تحسب ارتفاع الشريط');
  assert.match(pageRule[1], /env\(safe-area-inset-bottom/, 'الحشوة لا تحسب مسافة الأمان');
  assert.match(css, /\.tabbar \{[\s\S]{0,300}?env\(safe-area-inset-bottom\)/,
    'الشريط نفسه لا يحترم مسافة الأمان');
});

test('احتياط لما قبل سفاري ١٥٫٤: <dialog> غير مدعومة', () => {
  const js = read('app.js');
  /* بلا احتياط: `showModal` غير معرَّف فترمي الدالّة، فلا يقع شيء عند
     الضغط — لا اعتماد ولا إسناد ولا رابط، وبلا رسالة. قِيس على متصفّح
     محاكًى بلا `HTMLDialogElement`: النافذة فارغة غير ظاهرة مع رمية. */
  assert.match(js, /const NATIVE_DIALOG =/, 'لا فحص لدعم <dialog>');
  assert.match(js, /if \(NATIVE_DIALOG\) el\.modal\.showModal\(\);/, 'الفتح بلا احتياط');
  assert.match(js, /el\.modal\.setAttribute\('open', ''\)/, 'الاحتياط لا يفتح النافذة');
  /* والقاعدة التي تُخفيها قبل الفتح: بدونها يظهر العنصر المجهول دائمًا */
  assert.match(readCss('app.css'), /\.modal:not\(\[open\]\) \{ display: none; \}/,
    'بلا هذه القاعدة تظهر النافذة أبدًا على متصفّح لا يعرف <dialog>');
  /* و`::backdrop` لا وجود لها في الاحتياط، فيُرسم الظهر على النافذة */
  assert.match(readCss('app.css'), /body\.is-modal \.modal \{ background:/, 'الاحتياط بلا ظهر');
});

test('كل قياس بـdvh له احتياط بـvh — القاعدة تُسقَط كلّها قبل ١٥٫٤', () => {
  for (const file of ['app.css', 'link.css']) {
    const css = readCss(file);
    for (const m of css.matchAll(/([\w-]+):\s*([\d.]+)dvh/g)) {
      const prop = m[1];
      const before = css.slice(0, m.index);
      /* الاحتياط يسبقه مباشرةً بالخاصّية نفسها ووحدة vh */
      assert.match(before.slice(-120), new RegExp(`${prop}:\\s*[\\d.]+vh`),
        `${file}: «${prop}: ${m[2]}dvh» بلا احتياط vh قبله`);
    }
  }
});

/* --------------------------- الشيفرة تُصرَّف --------------------------- */

test('ملفّات الواجهة تُصرَّف — خطأ نحويّ فيها يُعطّل التطبيق كلّه', () => {
  /*
   * الحُرّاس كلّها تقرأ هذه الملفّات **نصًّا** ولا تُصرّفها، فمرّت ٢٧٩
   * اختبارًا وفيها خطأ نحويّ واحد يمنع التطبيق من الإقلاع أصلًا: علامة
   * خلفية داخل تعليق HTML داخل قالب نصّيّ تُنهي القالب.
   */
  const vm = require('node:vm');
  for (const file of ['app.js', 'link.js']) {
    const src = read(file);
    assert.doesNotThrow(() => new vm.Script(src, { filename: file }),
      `${file}: خطأ نحويّ — التطبيق لا يُقلع`);
  }
});

test('لا علامة خلفية داخل تعليق HTML — تُنهي القالب النصّيّ حولها', () => {
  for (const file of ['app.js', 'link.js']) {
    const bad = [...read(file).matchAll(/<!--[\s\S]*?-->/g)]
      .filter((m) => m[0].includes('`'))
      .map((m) => m[0].slice(0, 60));
    assert.deepEqual(bad, [], `${file}: علامة خلفية في تعليق HTML`);
  }
});

/* ------------------------ تجربة الكتابة ------------------------ */

test('المؤشّر يبقى مكانه بعد تنقية ما كُتب', () => {
  const js = read('app.js');
  /* إعادة رقم المؤشّر تصحّ ما دام الطول لم يتغيّر، وتخطئ متى حُذف حرف:
     يقف المؤشّر **بعد الحرف التالي**، فما يُكتب بعده يقع في غير موضعه.
     الصواب عدُّ ما بقي ممّا كان قبله. قِيس: المتوقّع ١ والواقع كان ٢. */
  assert.match(js, /function normalise\(box, clean\)/, 'لا دالّة تنقية موحّدة');
  assert.match(js, /const kept = clean\(AR\.toLatin\(raw\.slice\(0, at\)\)\)\.length;/,
    'المؤشّر يُعاد برقمه لا بعدّ ما بقي قبله');
  /* ولا يبقى في الملفّ ربطٌ قديم يعيد الرقم كما كان */
  assert.ok(!/setSelectionRange\(at, at\)/.test(js), 'ما زال موضع المؤشّر يُعاد برقمه');
});

test('تطبيع الأرقام مفوَّض على المستند — لا يُنسى في شاشة', () => {
  const js = read('app.js');
  /* كان مربوطًا داخل «طلب جديد» وحدها، فحقل نسبة العمولة يحمل السمة
     **بلا مستمع**: تُكتب فيه «٢٥» فتبقى عربية وتُرسل كما هي. */
  assert.match(js, /document\.addEventListener\('input'[\s\S]{0,400}data-money/,
    'التطبيع ليس مفوَّضًا على المستند');
  assert.ok(!/querySelectorAll\('\[data-money\]'\)/.test(js), 'ما زال يُربط لكل شاشة');
});

test('حقل نسبة العمولة كبقيّة المبالغ — لا type=number', () => {
  const js = read('app.js');
  const tag = js.match(/<input name="commission_rate"[^>]*>/s);
  assert.ok(tag, 'حقل النسبة غير موجود');
  /* `type=number` **يرفض «٢٥» بصمت**: يفرغ الحقل ولا يقول لماذا. قِيس. */
  assert.ok(!/type="number"/.test(tag[0]), 'رجع إلى type=number فيرفض الأرقام العربية');
  assert.match(tag[0], /inputmode="decimal"/, 'بلا لوحة عشرية');
  assert.match(tag[0], /data-money/, 'بلا تطبيع الأرقام العربية');
});

test('مفتاح الإدخال يُحسب ويفي بما يعد — والسطر الجديد يبقى للنصّ', () => {
  const js = read('app.js');
  assert.match(js, /function hintEnterKeys\(form\)/, 'لا حساب لمفتاح الإدخال');
  assert.match(js, /i === fields\.length - 1 \? 'send' : 'next'/, 'المفتاح لا يعرف موضع الحقل');
  /* الوسم بلا انتقال وعدٌ لا وفاء له: يُكتب «التالي» ولا تالي */
  assert.match(js, /if \(at < 0 \|\| at === fields\.length - 1\) return;[\s\S]{0,120}fields\[at \+ 1\]\.focus\(\)/,
    'Enter لا ينقل التركيز');
  /* والسطر الجديد داخل مربّع النصّ حقٌّ لكاتبه */
  assert.match(js, /if \(f\.tagName === 'TEXTAREA'\) return;/, 'مربّع النصّ يأخذ وسمًا لا يليق به');
  assert.match(js, /el\.tagName === 'TEXTAREA'\) return;/, 'Enter يُختطف من مربّع النصّ');
});
