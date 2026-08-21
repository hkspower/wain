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
  const smaller = [...after.matchAll(/([.#][\w-]+(?:\s+[\w.#-]+)*)\s*\{[^}]*font-size:\s*(0?\.\d+)rem/g)]
    .filter(([, sel]) => /input|select|textarea/.test(sel));
  assert.deepEqual(smaller.map((m) => m[1]), [],
    'قاعدة بعد استعلام اللمس تعيد حقلًا إلى ما دون ١٦ بكسل');
});
