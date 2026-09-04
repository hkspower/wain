/**
 * يشغّل اختبارات موصول كلّها — الحزمة والنظام معًا.
 *
 * ── لماذا وُجد ──────────────────────────────────────────────────────
 * الاختبارات كانت تُشغَّل من `agent-system` وحدها، وفي `arabic-kit` اختبارٌ
 * ساقطٌ منذ أن صار الموقع صفحةً واحدة: `sync.js` يحرس نسخةً من الحزمة في
 * `website/assets/js/` لم يعد أحد ينشئها ولا يحمّلها. فبقي ساقطًا ولم يره
 * أحد — لا لأنّ أحدًا تجاهله، بل لأنّ لا أمرَ يشغّله.
 *
 * واختبارٌ لا يُشغَّل ليس اختبارًا: هو ملفٌّ يوحي بحراسةٍ لا تقع. فصار في
 * المشروع أمرٌ واحد يشمل الحزمتين، ومن أضاف حزمةً ثالثة أضافها هنا سطرًا.
 *
 * وجذر المستودع مشروعٌ آخر (تطبيق Wain بـ Expo)، فلا يُوضع أمرُ موصول في
 * `package.json` الجذر ولا تُخلط سكربتات المشروعين.
 *
 *   node tools/test-all.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** الحزم التي تُشغَّل اختباراتها، بالترتيب: الأدنى أولًا */
const PACKAGES = ['arabic-kit', 'agent-system'];

let failed = 0;

for (const pkg of PACKAGES) {
  console.log(`\n═══ ${pkg} ═══`);
  const run = spawnSync('npm', ['test', '--silent'], {
    cwd: path.join(ROOT, pkg),
    encoding: 'utf8',
    /* المخرَج يُلتقط ليُلخَّص: سجلّ ‏TAP كاملًا لحزمتين يدفن السطر الوحيد
       الذي يهمّ. وما سقط يُطبع كاملًا. */
  });

  const out = (run.stdout || '') + (run.stderr || '');
  const num = (key) => (out.match(new RegExp(`^# ${key} (\\d+)`, 'm')) || [])[1];
  const pass = num('pass');
  const fail = num('fail');

  if (run.status === 0 && fail === '0') {
    console.log(`  ✓ ${pass} اختبارًا`);
    continue;
  }

  failed++;
  console.log(`  ✗ ساقط: ${fail ?? '?'} من ${Number(pass || 0) + Number(fail || 0) || '?'}`);
  for (const line of out.split('\n')) {
    if (/^not ok|^\s+error:/.test(line)) console.log('    ' + line.trim());
  }
}

console.log(failed ? `\n✗ حزمٌ فيها سقوط: ${failed}` : '\n✓ الاختبارات كلّها تمرّ.');
process.exit(failed ? 1 : 0);
