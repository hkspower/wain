/**
 * حزمة اللغة العربية: نسخة الموقع تتبع الأصل، لا تعيش بجانبه.
 *
 * الموقع مستضاف ذاتيًّا بلا أدوات بناء، فهو يشحن نسخة من `arabic-kit` بدل
 * استيرادها. والنسخة تنحرف: يُصلَح تمييز عدد في الأصل، فيبقى الموقع على
 * الخطأ شهورًا بلا أن يشتكي أحد — لأن الانحراف صامت، لا يكسر شيئًا ولا
 * يظهر في المتصفّح، بل يعطي جمعًا خاطئًا لزائر لا يبلّغ عنه.
 *
 *   node website/tools/sync-kit.mjs           # ينسخ الأصل إلى الموقع
 *   node website/tools/sync-kit.mjs --check    # يتحقّق فقط (يجري في البناء)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'arabic-kit', 'index.js');
const DST = path.join(HERE, '..', 'assets', 'js', 'arabic-kit.js');

const sum = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 12);

if (!fs.existsSync(SRC)) {
  console.error(`✗ لا يوجد أصل الحزمة: ${SRC}`);
  process.exit(1);
}

const src = fs.readFileSync(SRC);
const dst = fs.existsSync(DST) ? fs.readFileSync(DST) : null;

if (process.argv.includes('--check')) {
  if (!dst) {
    console.error('✗ نسخة الموقع من حزمة اللغة مفقودة — شغّل: node website/tools/sync-kit.mjs');
    process.exit(1);
  }
  if (!src.equals(dst)) {
    console.error(`
✗ نسخة الموقع من حزمة اللغة انحرفت عن الأصل:
    الأصل  ${sum(src)}  (${src.length} بايت)
    الموقع ${sum(dst)}  (${dst.length} بايت)

  إن كان التعديل في الأصل فانسخه:  node website/tools/sync-kit.mjs
  وإن كان أحدهم عدّل نسخة الموقع مباشرةً فأعِد التعديل إلى arabic-kit/index.js
  ليستفيد منه النظام أيضًا، ثم انسخ.
`);
    process.exit(1);
  }
  console.log(`✓ حزمة اللغة متطابقة مع الأصل — ${sum(src)}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.writeFileSync(DST, src);
console.log(`✓ نُسخت حزمة اللغة إلى الموقع — ${sum(src)} (${src.length} بايت)`);
