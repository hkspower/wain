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

/** وجهات النسخ، بمسارات نسبية إلى مجلد الحزمة. */
const TARGETS = [
  path.join(__dirname, '..', 'agent-system', 'public', 'vendor', 'arabic-kit.js'),
  path.join(__dirname, '..', 'website', 'assets', 'js', 'arabic-kit.js'),
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
