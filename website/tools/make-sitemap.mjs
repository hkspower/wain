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

function lastModified() {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'website/index.html'], {
      cwd: path.join(SITE, '..'), encoding: 'utf8',
    }).trim();
    if (out) return out;
  } catch { /* خارج مستودع git — نسقط على تاريخ الملف */ }
  return fs.statSync(path.join(SITE, 'index.html')).mtime.toISOString().slice(0, 10);
}

const date = lastModified();
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  صفحة واحدة بأقسام داخلية، فالخريطة تحوي العنوان الجذر فقط: محرّكات البحث
  لا تفهرس المرابط (#fragments) كعناوين مستقلّة، فإدراجها يضخّم الخريطة بلا أثر.

  lastmod يُشتقّ من آخر تعديل على الصفحة في سجلّ git لا من تاريخ البناء —
  إعادة بناء لا تغيّر المحتوى يجب ألّا تدّعي تحديثًا.
  يُحدَّث بـ: node website/tools/make-sitemap.mjs

  النطاق يُستبدل آليًا عند البناء: --domain=نطاقك
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://mawsool.com.kw/</loc>
    <lastmod>${date}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

if (process.argv.includes('--check')) {
  const now = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  // النطاق قد يكون مُستبدلًا في نسخة موزّعة — نقارن التاريخ وحده
  const have = (now.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
  if (have !== date) {
    console.error(`✗ lastmod في الخريطة ${have || '—'} وآخر تعديل على الصفحة ${date}`);
    console.error('    node website/tools/make-sitemap.mjs');
    process.exit(1);
  }
  console.log(`✓ خريطة الموقع محدّثة — آخر تعديل ${date}`);
  process.exit(0);
}

fs.writeFileSync(FILE, xml);
console.log(`✓ كُتبت خريطة الموقع — آخر تعديل ${date}`);
