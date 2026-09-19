/**
 * يولّد أصول الصور المشتقّة من الشعار:
 *
 *   assets/og-mawsool.png       بطاقة المشاركة ١٢٠٠×٦٣٠ — معتمة بخلفية الهوية
 *   assets/apple-touch-icon.png أيقونة iOS ١٨٠×١٨٠ — معتمة
 *
 *   node website/tools/make-images.mjs
 *
 * لماذا تُولَّد بدل رسمها يدويًا: كلاهما مشتقّ من الشعار وخلفية الهوية، فلو
 * تغيّر أحدهما أُعيد التوليد بأمر واحد بدل تحرير ملفين بالعين.
 *
 * وهاتان الصورتان وحدهما ما يُبقي `logo-mawsool-light.png` و
 * `mawsool-mark-light.png` في `assets/`: الصفحة نفسها لا تعرضهما (خلفيتها
 * فاتحة)، فمن يمسح «ما لا تشير إليه الصفحة» يمسحهما ويكسر هذه الأداة.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const EXEC = process.env.CHROMIUM_PATH || undefined;

const browser = await chromium.launch({ executablePath: EXEC });

/**
 * يرسم صفحة ويصوّرها.
 *
 * الصفحة تُكتب ملفًّا مؤقتًا **داخل مجلد الموقع** ثم يُفتح بـ goto، ولا
 * تُمرَّر عبر setContent: مستند setContent أصله `about:blank`، فلا يُحمّل منه
 * مورد `file://` — تخرج الصورة بخلفيتها بلا الشعار، وهو عطب صامت لا يرفع خطأ.
 * والفتح من داخل المجلد يجعل مسارات الأصول النسبية تعمل كما في الموقع نفسه.
 */
async function shoot({ name, width, height, html, out, jpeg }) {
  const tmp = path.join(SITE, `.tmp-${name}.html`);
  fs.writeFileSync(tmp, html);
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(`file://${tmp}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    // لا نصوّر قبل اكتمال كل صورة فعلًا
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    await page.waitForTimeout(300);
    /* بطاقة المشاركة تُحفظ JPEG لا PNG: خلفيتها تدرّج، وPNG بلا فقد يخزّن كل
       درجة فيه فيخرج الملف ٤٤٨ ك.ب — ثقيل على معاين الرابط بلا مقابل. عند
       جودة ٩٠ بلا اختزال لوني (4:4:4، حفاظًا على حدّة حروف النص) يهبط إلى
       ٧٠ ك.ب ومتوسط الفرق اللوني دون ١ من ٢٥٥. الأيقونة تبقى PNG لشفافيتها
       المحتملة ولأنها مقاس صغير أصلًا. */
    await page.screenshot(jpeg
      ? { path: out, type: 'jpeg', quality: 90 }
      : { path: out });
    await page.close();
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ------------------------- بطاقة المشاركة -------------------------
 * `og:image` كان يشير إلى الشعار نفسه: ١٩٦٨×٦٠٧ بنسبة ٣٫٢٤ و٦١٪ منه شفاف.
 * بطاقة `summary_large_image` تتوقّع ١٢٠٠×٦٣٠ (نسبة ١٫٩١)، فتُحشر الصورة
 * بأشرطة، وتُركَّب الشفافية على أسود في عدّة منصّات — ومنها واتساب، وهو
 * قناة العمل الأولى. البديل: بطاقة معتمة بخلفية الهوية ونصّ مقروء.
 */
const OG_W = 1200, OG_H = 630;
await shoot({
  name: 'og', width: OG_W, height: OG_H, jpeg: true,
  out: path.join(SITE, 'assets', 'og-mawsool.jpg'),
  html: `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link rel="stylesheet" href="site.css">
<style>
  html, body { margin: 0; padding: 0; }
  .card {
    width: ${OG_W}px; height: ${OG_H}px; box-sizing: border-box;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 26px; text-align: center; padding: 0 90px;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(34,167,180,.34), transparent 62%),
      linear-gradient(120deg, #0f6b76, #06282e);
    font-family: "Alexandria", sans-serif; color: #fff;
  }
  .card img { width: 430px; height: auto; display: block; }
  .card h1 { margin: 0; font-size: 46px; font-weight: 800; line-height: 1.4; color: #fff; }
  .card p  { margin: 0; font-size: 25px; line-height: 1.75; color: #b6dde2; max-width: 24ch; }
  .rule { width: 96px; height: 4px; border-radius: 2px; background: #F69625; }
</style></head><body>
  <div class="card">
    <img src="assets/logo-mawsool-light.png" alt="">
    <div class="rule"></div>
    <h1>توصيل الطلبات بالسيارات في الكويت</h1>
    <p>كباتن بسيارات موديل ٢٠٢٢ فأحدث، وتتبّع مباشر لكل شحنة.</p>
  </div>
</body></html>`,
});
console.log(`✓ assets/og-mawsool.jpg   ${OG_W}×${OG_H}`);

/* ------------------------ أيقونة iOS ------------------------
 * أيقونة الشاشة الرئيسية في iOS تُركَّب على **أسود** إن كانت شفافة، فتظهر
 * مربّعًا أسود. النظام يقصّ الزوايا بنفسه، فتُسلَّم مربّعة معتمة بلا زوايا.
 */
const ICON = 180;
await shoot({
  name: 'icon', width: ICON, height: ICON,
  out: path.join(SITE, 'assets', 'apple-touch-icon.png'),
  html: `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; }
  .icon {
    width: ${ICON}px; height: ${ICON}px; display: grid; place-items: center;
    /* لون مسطّح لا تدرّج: التدرّج يرفع وزن PNG أضعافًا بلا فرق يُرى في مربّع
       ١٨٠ بكسل، والأيقونة المسطّحة أوضح على شاشة الهاتف. */
    background: #0f6b76;
  }
  .icon img { width: ${Math.round(ICON * 0.62)}px; height: auto; display: block; }
</style></head><body>
  <div class="icon"><img src="assets/mawsool-mark-light.png" alt=""></div>
</body></html>`,
});
console.log(`✓ assets/apple-touch-icon.png   ${ICON}×${ICON} معتمة`);

await browser.close();
