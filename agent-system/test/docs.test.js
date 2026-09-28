'use strict';
/**
 * التوثيق يتقادم بصمت.
 *
 * هذا المستودع يصف نفسه في `README` وصفًا دقيقًا — عدد الاختبارات في كل
 * باب، ومتغيّرات البيئة وما تفعله — ولا شيء يمنع الوصف من الانحراف عن
 * الشيفرة. قِيس ذلك في مسحٍ واحد: ثلاثة أعداد قديمة، وخمسة متغيّرات
 * يقرؤها الخادم ولا يعرفها أحد إلّا من قرأ الشيفرة.
 *
 * والانحراف هنا ليس تجميلًا: من يقرأ «٤٧ اختبارًا» ويجد ٤٩ يشكّ في الباقي،
 * ومن ينشر النظام ولا يعرف بمتغيّرٍ يضبط توقيت الخطّافات يكتشفه يوم يقف.
 *
 * فالوصف يُفحص كما تُفحص الشيفرة.
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s) => Number([...s].map((d) => AR_DIGITS.indexOf(d)).join(''));

/** عدد الاختبارات في ملفّ: كلّ سطرٍ يبدأ بـ`test(` */
const countIn = (file) =>
  (fs.readFileSync(path.join(__dirname, file), 'utf8').match(/^test\(/gm) || []).length;

/* كلّ بابٍ في جدول README وملفُّه. الجدول مكتوبٌ هنا صراحةً لا مستنتَجًا:
   بابٌ يُضاف بلا ملفّ، أو ملفٌّ يُضاف بلا باب، كلاهما انحراف يجب أن يُرى. */
const CHAPTERS = {
  'الطلبات': 'api.test.js',
  'الاعتماد': 'approval.test.js',
  'العمولة': 'settings.test.js',
  'رابط المهمّة': 'links.test.js',
  'البريد': 'mail.test.js',
  'الموقع': 'location.test.js',
  'أقرب كابتن': 'nearest.test.js',
  'المناطق': 'areas.test.js',
  'وكيل الطلب': 'voice-order.test.js',
  'وكيل الصفحة الرئيسية': 'agent.test.js',
  'مجموعات الصلاحيات': 'perms.test.js',
  'معرفة الوكيل': 'faq.test.js',
  'خادم MCP': 'mcp.test.js',
  'الخطّافات': 'hooks.test.js',
  'التوثيق': 'docs.test.js',
};
/* بابٌ عنوانه طويل يُطابَق ببدايته */
const LONG = { 'الجوال والتنسيق والطباعة واللون والدلالات': 'mobile.test.js' };

test('أعداد الاختبارات في README هي أعدادها الحقيقية', () => {
  const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js'));
  const total = files.reduce((n, f) => n + countIn(f), 0);

  const stated = README.match(/([٠-٩]+) اختبارًا تعمل على قاعدة بيانات مؤقتة/);
  assert.ok(stated, 'README لا يذكر عدد الاختبارات أصلًا');
  assert.equal(toLatin(stated[1]), total, 'العدد الكلّي في README لا يطابق الحقيقة');

  const all = { ...CHAPTERS, ...LONG };
  /* وكلُّ ملفٍّ له بابٌ: اختباراتٌ لا يذكرها الوصف تبقى خارج ما يُقرأ */
  const claimed = new Set(Object.values(all));
  for (const f of files) assert.ok(claimed.has(f), `لا بابَ في README لـ${f}`);

  let sum = 0;
  for (const [chapter, file] of Object.entries(all)) {
    const m = README.match(new RegExp(`- \\*\\*${chapter}[^*]*\\*\\* \\(([٠-٩]+)\\)`));
    assert.ok(m, `الباب «${chapter}» ليس في README`);
    const said = toLatin(m[1]);
    const real = countIn(file);
    assert.equal(said, real, `الباب «${chapter}» يقول ${said} و${file} فيه ${real}`);
    sum += real;
  }
  assert.equal(sum, total, 'مجموع الأبواب لا يساوي العدد الكلّي');
});

test('كلّ متغيّر بيئة يقرؤه الخادم موصوفٌ لمن ينشره', () => {
  /* الوصف قد يكون في `README` أو في `DEPLOY.md` أو في `.env.example` —
     المهمّ ألّا يبقى متغيّرٌ لا يعرفه إلّا من قرأ الشيفرة. */
  const docs = [
    README,
    fs.readFileSync(path.join(ROOT, '..', 'DEPLOY.md'), 'utf8'),
    fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8'),
  ].join('\n');

  const read = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.js')) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/process\.env\.(MAWSOOL_[A-Z0-9_]+)/g)) {
        read.add(m[1]);
      }
    }
  };
  walk(path.join(ROOT, 'server'));
  walk(path.join(ROOT, 'mcp'));

  const undocumented = [...read].filter((v) => !docs.includes(v)).sort();
  assert.deepEqual(undocumented, [], `متغيّرات بلا وصف: ${undocumented.join('، ')}`);
});
