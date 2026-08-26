/**
 * يحدّث `lastmod` في خريطة الموقع من آخر تعديل فعليّ على الصفحة في سجلّ git.
 *
 * لماذا من git لا من تاريخ اليوم: `lastmod` وعدٌ لمحرّك البحث بأن المحتوى
 * تغيّر. لو كتبناه تاريخ البناء، لادّعت كل إعادة بناء تحديثًا لم يحدث، وتعلّم
 * الزاحف أن يتجاهل الحقل. المصدر الصادق هو آخر التزام مسّ الصفحة.
 *
 *   node website/tools/make-sitemap.mjs           # يكتب
 *   node website/tools/make-sitemap.mjs --check    # يتحقّق فقط
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(HERE, '..');
const FILE = path.join(SITE, 'sitemap.xml');

/* لكل صفحة تاريخها: `lastmod` واحد لصفحتين يكذب على إحداهما — تُعدَّل
   الواجهة فتدّعي الخريطة أنّ التعريفية تغيّرت، والزاحف يتعلّم تجاهل
   الحقل. الصفحات تُحصى من المجلّد لا من قائمةٍ مكتوبة: كانت الخريطة
   تُولَّد بعنوانٍ واحد، فأُضيفت الثانية باليد إلى الملفّ المولَّد —
   وكان أوّل توليدٍ لاحق سيمحوها. */
function lastModified(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', `website/${rel}`], {
      cwd: path.join(SITE, '..'), encoding: 'utf8',
    }).trim();
    if (out) return out;
  } catch { /* خارج مستودع git — نسقط على تاريخ الملف */ }
  return fs.statSync(path.join(SITE, rel)).mtime.toISOString().slice(0, 10);
}

/* الواجهة أوّلًا وأعلى أولوية، ثم بقيّة الصفحات بترتيبها */
const PAGES = [
  { file: 'index.html', loc: '/', priority: '1.0', freq: 'weekly' },
  ...fs.readdirSync(SITE).filter((f) => f.endsWith('.html') && f !== 'index.html').sort()
    .map((f) => ({ file: f, loc: `/${f}`, priority: '0.7', freq: 'monthly' })),
];
const entries = PAGES.map((p) => `  <url>
    <loc>https://mawsool.com.kw${p.loc}</loc>
    <lastmod>${lastModified(p.file)}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  صفحتان: الواجهة (وكيل الطلب) والصفحة التعريفية. وأقسام كلٍّ منهما داخلية،
  فلا تُدرج المرابط (#fragments) — محرّكات البحث لا تفهرسها عناوين مستقلّة،
  وإدراجها يضخّم الخريطة بلا أثر.

  lastmod لكل صفحة من آخر تعديل عليها في سجلّ git لا من تاريخ البناء —
  إعادة بناء لا تغيّر المحتوى يجب ألّا تدّعي تحديثًا، وتاريخٌ واحد لصفحتين
  يكذب على إحداهما.
  يُحدَّث بـ: node website/tools/make-sitemap.mjs

  النطاق يُستبدل آليًا عند البناء: --domain=نطاقك
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;

if (process.argv.includes('--check')) {
  const now = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  /* النطاق قد يكون مُستبدلًا في نسخة موزّعة، فتُقارن العناوين والتواريخ
     بعد تجريدها من النطاق — لا النصّ كلّه. */
  const strip = (t) => [...t.matchAll(/<loc>[^<]*?(\/[^<]*)<\/loc>\s*<lastmod>([^<]+)/g)]
    .map((m) => `${m[1]}@${m[2]}`).join(' ');
  if (strip(now) !== strip(xml)) {
    console.error(`✗ خريطة الموقع لا تطابق الصفحات:`);
    console.error(`    فيها:  ${strip(now) || '—'}`);
    console.error(`    وينبغي: ${strip(xml)}`);
    console.error('    node website/tools/make-sitemap.mjs');
    process.exit(1);
  }
  console.log(`✓ خريطة الموقع محدّثة — ${PAGES.length} صفحة`);
  process.exit(0);
}

fs.writeFileSync(FILE, xml);
console.log(`✓ كُتبت خريطة الموقع — ${PAGES.map((p) => p.loc).join('، ')}`);
