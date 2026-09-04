'use strict';
/**
 * المشروعان يحمّلان الحزمة في المتصفح عبر نسخة مباشرة (بلا خطوة بناء)،
 * وهذا الاختبار يمنع النسخ من الانحراف عن الأصل بصمت.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { TARGETS, copies } = require('../sync.js');

test('نسخ المتصفح مطابقة للأصل', () => {
  for (const c of copies()) {
    const name = path.basename(path.dirname(path.dirname(c.target))) + '/' + path.basename(c.target);
    assert.ok(c.exists, `النسخة مفقودة: ${name} — شغّل npm run sync`);
    assert.ok(c.matches, `النسخة قديمة: ${name} — شغّل npm run sync`);
  }
});

test('كل الوجهات معرّفة بمسارات مطلقة', () => {
  /* العدد لا يُثبَّت: كان الشرط «وجهتان فأكثر»، فلمّا زالت حاجة الموقع
     إلى نسخةٍ في المتصفّح صار الشرط يطالب بوجهةٍ ميتة. المقصود أن تكون
     ثمّة وجهةٌ واحدة على الأقلّ وأن تكون مطلقة، لا أن يبقى العدد كما كان. */
  assert.ok(TARGETS.length >= 1, 'بلا وجهة نسخ: من يحمّل الحزمة في المتصفّح؟');
  for (const t of TARGETS) assert.ok(path.isAbsolute(t));
});
