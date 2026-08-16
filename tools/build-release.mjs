#!/usr/bin/env node
/**
 * يبني حزمة إصدار جاهزة للرفع.
 *
 *   node tools/build-release.mjs
 *   node tools/build-release.mjs --domain=mawsool.com.kw
 *
 * ينتج مجلد `dist/` فيه:
 *   website/                 ملفات الموقع الثابتة — ارفعها كما هي لأي استضافة
 *   mawsool-system/          النظام: agent-system + arabic-kit بجانبه
 *   mawsool-website.zip
 *   mawsool-system.zip
 *
 * لا يُنسخ إلى الحزمة: node_modules، وقاعدة البيانات، والتسجيلات الصوتية،
 * وأدوات التطوير، وملفات .env الحقيقية.
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const DOMAIN = arg('domain', 'mawsool.com.kw').replace(/^https?:\/\//, '').replace(/\/$/, '');
const PLACEHOLDER = 'mawsool.com.kw';

/* ------------------------------- أدوات ------------------------------- */

/** ينسخ شجرة مع استبعاد ما لا يُوزَّع */
function copyTree(from, to, skip = []) {
  const shouldSkip = (rel) => skip.some((s) =>
    rel === s || rel.startsWith(s + path.sep) || path.basename(rel) === s);

  let files = 0;
  (function walk(dir, rel = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (shouldSkip(childRel)) continue;
      const src = path.join(dir, entry.name);
      const dst = path.join(to, childRel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        walk(src, childRel);
      } else {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        files++;
      }
    }
  })(from);
  return files;
}

/** يستبدل النطاق التجريبي في ملفات نصّية محدّدة */
function applyDomain(dir, relPaths) {
  if (DOMAIN === PLACEHOLDER) return 0;
  let n = 0;
  for (const rel of relPaths) {
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = before.split(PLACEHOLDER).join(DOMAIN);
    if (after !== before) { fs.writeFileSync(file, after); n++; }
  }
  return n;
}

const sizeOf = (dir) => {
  let bytes = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size;
    }
  })(dir);
  return bytes;
};
const mb = (b) => (b / 1024 / 1024).toFixed(2) + ' م.ب';

function zip(folder, outFile) {
  execFileSync('zip', ['-rq', outFile, path.basename(folder)], { cwd: path.dirname(folder) });
  return fs.statSync(outFile).size;
}

const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

/* --------------------------- حارس القيم المؤقتة --------------------------- */

/**
 * يمنع البناء ما دامت قيمة مؤقتة في الموقع. أرقام هاتف وبريد ونطاق تجريبية
 * تبدو حقيقية تمامًا في الصفحة، فلا يكتشفها أحد إلا بعد الرفع وفقدان عميل
 * اتصل برقم لا يملكه أحد. الحارس يجعل ذلك مستحيلًا لا مجرد موثّق.
 *
 * التجاوز للتجربة المحلية فقط:  --allow-placeholders
 */
const PLACEHOLDERS = [
  { needle: '+96522220000',        what: 'رقم الهاتف' },
  { needle: '96590000000',          what: 'رقم واتساب' },
  { needle: 'hello@mawsool.com.kw', what: 'البريد الإلكتروني' },
  { needle: 'شارع الخليج العربي، مدينة الكويت', what: 'العنوان' },
];

function guardPlaceholders() {
  const file = path.join(ROOT, 'website', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const found = PLACEHOLDERS.filter((p) => html.includes(p.needle));
  if (DOMAIN === PLACEHOLDER) found.push({ needle: PLACEHOLDER, what: 'النطاق (--domain)' });
  if (!found.length) return;

  if (process.argv.includes('--allow-placeholders')) {
    console.log('⚠ قيم مؤقتة باقية (سُمح بها صراحةً):');
    for (const f of found) console.log(`    ${f.what}: ${f.needle}`);
    console.log('');
    return;
  }

  console.error(`
تعذّر البناء — قيم مؤقتة ما زالت في الموقع:
`);
  for (const f of found) console.error(`  • ${f.what.padEnd(22)} ${f.needle}`);
  console.error(`
استبدلها في website/index.html ببياناتكم الحقيقية، ومرّر --domain=نطاقكم،
ثم أعد البناء. للتجربة المحلية فقط: --allow-placeholders
`);
  process.exit(1);
}

/**
 * البيانات المنظّمة وخريطة الموقع يجب أن تطابقا الصفحة.
 *
 * جوجل يشترط أن يطابق ما في `FAQPage` ما يراه الزائر، ويعاقب على الاختلاف؛
 * و`lastmod` كاذب يعلّم الزاحف تجاهل الحقل. وكلاهما يخرب بصمت: تُعدَّل فقرة
 * في الصفحة ويبقى توأمها في السكيما، فلا يظهر الخلل حتى تُخفَّض الصفحة.
 * فالبناء يرفض بدل أن يوزّع نسخة مخالفة.
 */
function guardSeo() {
  const checks = [
    ['website/tools/make-jsonld.mjs', 'البيانات المنظّمة'],
    ['website/tools/make-sitemap.mjs', 'خريطة الموقع'],
  ];
  for (const [script, what] of checks) {
    const r = spawnSync(process.execPath, [path.join(ROOT, script), '--check'], {
      cwd: ROOT, encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.error(`\nتعذّر البناء — ${what}:\n`);
      console.error((r.stderr || r.stdout || '').trim());
      console.error('');
      process.exit(1);
    }
  }
}

/* ------------------------------- البناء ------------------------------- */

guardPlaceholders();
guardSeo();

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

console.log(`النطاق: ${DOMAIN}${DOMAIN === PLACEHOLDER ? '  (افتراضي — مرّر --domain=نطاقك)' : ''}`);
console.log('');

/* ١ — الموقع */
const siteOut = path.join(DIST, 'website');
fs.mkdirSync(siteOut, { recursive: true });
const siteFiles = copyTree(path.join(ROOT, 'website'), siteOut, [
  'tools',        // مولّد الـPDF أداة تطوير لا تُرفع
  'README.md',    // توثيق داخلي
  '.DS_Store',
]);
const siteDomainEdits = applyDomain(siteOut, ['index.html', 'robots.txt', 'sitemap.xml']);
console.log(`✓ الموقع            ${siteFiles} ملفًا · ${mb(sizeOf(siteOut))}`);

/* ٢ — النظام: agent-system مع arabic-kit بجانبه ليبقى `file:../arabic-kit` صالحًا */
const sysOut = path.join(DIST, 'mawsool-system');
fs.mkdirSync(sysOut, { recursive: true });

const appFiles = copyTree(path.join(ROOT, 'agent-system'), path.join(sysOut, 'agent-system'), [
  'node_modules',
  'data',              // قاعدة البيانات والتسجيلات — لا تُوزَّع
  '.env',              // إن وُجد محليًا
  'package-lock.json', // يُعاد توليده عند التركيب على الخادم
  '.DS_Store',
]);
const kitFiles = copyTree(path.join(ROOT, 'arabic-kit'), path.join(sysOut, 'arabic-kit'), [
  'node_modules', '.DS_Store',
]);
console.log(`✓ النظام            ${appFiles + kitFiles} ملفًا · ${mb(sizeOf(sysOut))}`);

/* ٣ — دليل النشر داخل الحزمة */
for (const doc of ['DEPLOY.md']) {
  const src = path.join(ROOT, doc);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(DIST, doc));
    applyDomain(DIST, [doc]);
  }
}

/* ٤ — الأرشيفات */
const siteZip = path.join(DIST, 'mawsool-website.zip');
const sysZip = path.join(DIST, 'mawsool-system.zip');
const siteZipSize = zip(siteOut, siteZip);
const sysZipSize = zip(sysOut, sysZip);

console.log('');
console.log(`✓ mawsool-website.zip   ${mb(siteZipSize)}   sha256:${sha256(siteZip)}`);
console.log(`✓ mawsool-system.zip    ${mb(sysZipSize)}   sha256:${sha256(sysZip)}`);
if (siteDomainEdits) console.log(`\n(استُبدل النطاق في ${siteDomainEdits} ملفات من ملفات الموقع)`);

console.log(`
تمّ البناء في dist/

  mawsool-website.zip   ← فُكّه وارفع محتواه إلى جذر الاستضافة
  mawsool-system.zip    ← فُكّه على الخادم ثم:
                            cd agent-system && npm install --omit=dev
                            cp .env.example .env   ثم املأه
                            npm run setup && npm start

التفاصيل كاملة في DEPLOY.md`);
