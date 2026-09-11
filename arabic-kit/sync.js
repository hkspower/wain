'use strict';
/**
 * ينسخ الحزمة إلى المشروعين اللذين يستهلكانها في المتصفح.
 * كلاهما يعمل بلا خطوة بناء، فالنسخة المباشرة أبسط من حزم الوحدات.
 *
 *   npm run sync    ← ينسخ
 *   npm test        ← يفشل إذا اختلفت أي نسخة عن الأصل
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, 'index.js');

/**
 * وجهات النسخ، بمسارات نسبية إلى مجلد الحزمة.
 *
 * الموقع كان وجهةً ثانية، لعدّادات الصفحة التعريفية وتمييز العدد فيها.
 * ولمّا صار الموقع صفحةً واحدة زال ذلك كلّه: لا رقم متحرّك ولا اسم يُميَّز،
 * والوكيل يقرأ كلام الزبون في **الخادم** لا في المتصفّح. فبقيت الوجهة هنا
 * تشير إلى ملفٍّ لا ينشئه أحد ولا يحمّله أحد — فظلّ `npm test` في هذه
 * الحزمة ساقطًا، وهو سقوطٌ لا يراه أحد لأن الاختبارات تُشغَّل من
 * `agent-system` وحدها. حُذفت الوجهة: القرار كان مكتوبًا في
 * `website/README.md` ولم يصل الشيفرة.
 */
const TARGETS = [
  path.join(__dirname, '..', 'agent-system', 'public', 'vendor', 'arabic-kit.js'),
];

function copies() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  return TARGETS.map((target) => {
    const exists = fs.existsSync(target);
    return { target, exists, matches: exists && fs.readFileSync(target, 'utf8') === src };
  });
}

function sync() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  for (const target of TARGETS) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, src);
    console.log('نُسخت ←', path.relative(path.join(__dirname, '..'), target));
  }
}

module.exports = { SOURCE, TARGETS, copies, sync };

if (require.main === module) sync();
