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
  const ALLOWED_PX = ['15px', '16px', '14.5px'];   // الجذر، وعتبة اللمس، وجوال
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
    for (const m of read(file).matchAll(/(#[0-9a-fA-F]{3,6}\b|rgba?\([^)]+\))/g)) {
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
