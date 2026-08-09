/**
 * يولّد ملف PDF عالي الجودة لمعاينة الموقع كاملًا.
 *
 *   node website/tools/make-preview-pdf.mjs [رابط] [مسار الإخراج]
 *
 * يتطلّب تشغيل الموقع على خادم HTTP (وليس file://) حتى يُحمّل الخط،
 * و Playwright مثبّتًا. مثال:
 *   cd website && python3 -m http.server 8080 &
 *   node tools/make-preview-pdf.mjs http://localhost:8080/ preview.pdf
 */
import { chromium } from 'playwright';
import path from 'node:path';

const URL = process.argv[2] || 'http://localhost:8080/';
const OUT = process.argv[3] || path.resolve('mawsool-website-preview.pdf');
const EXEC = process.env.CHROMIUM_PATH || undefined;

// A4 أفقي بدقة 96 نقطة/بوصة — يحافظ على تخطيط سطح المكتب (فوق حدّ 1024 بكسل)
const PAGE_W = 1123;
const PAGE_H = 794;

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({
  viewport: { width: PAGE_W, height: PAGE_H },
  deviceScaleFactor: 2,
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// تشغيل عدّادات الأرقام بالمرور على القسم ثم العودة للأعلى
await page.evaluate(() => document.getElementById('stats')?.scrollIntoView());
await page.waitForTimeout(1800);
await page.evaluate(() => window.scrollTo(0, 0));

// إظهار خط التتبّع الزمني الذي لا يظهر إلا بعد البحث
await page.fill('#trackInput', 'MW-4821');
await page.click('#trackForm button[type=submit]');
await page.waitForTimeout(400);

// فكّ كل ما هو مطويّ أو مخفيّ خلف تأثير الظهور
await page.evaluate(() => {
  document.querySelectorAll('.reveal').forEach((el) => {
    el.classList.add('is-in');
    el.style.transitionDelay = '0ms';
  });
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
});
await page.waitForTimeout(600);

// المعاينة يجب أن تطابق شكل الشاشة، لا أنماط الطباعة المبسّطة
await page.emulateMedia({ media: 'screen' });

await page.addStyleTag({ content: `
  /* عناصر تفاعلية لا معنى لها في ملف ثابت */
  .progress, .wa-float, .to-top, .skip-link, .burger { display: none !important; }

  /* الهيدر لاصق على الشاشة — نثبّته في مكانه ليظهر مرة واحدة */
  .header { position: static !important; background: #fff !important; }

  /* تجميد كل الحركات عند وضعها النهائي */
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  .marquee__track { transform: none !important; }

  /* --- إصلاحات خاصة بمحرّك الطباعة في كروميوم --- */

  /* background-clip:text يترك مستطيلًا مرئيًا حول النص في PDF */
  .grad {
    background: none !important;
    -webkit-background-clip: border-box !important;
    background-clip: border-box !important;
    -webkit-text-fill-color: currentColor !important;
    color: var(--teal-cta) !important;
  }

  /* mask-composite غير مدعوم عند الطباعة فيمتلئ الكرت بالتدرّج كله */
  .plan--featured::before { display: none !important; }
  .plan--featured { border: 2px solid var(--teal-600) !important; }

  /* شارة «الأكثر طلبًا» تخرج خارج حدود الكرت فتُقصّ عند حافة الصفحة */
  .pricing { padding-top: 18px; }

  /* مسافات أقصر تقلّل الصفحات شبه الفارغة */
  .section { padding-block: 2.4rem !important; }
  .cta { padding-block: 2.6rem !important; }
  .sec-head { margin-bottom: 1.6rem !important; }

  /* منع قطع العناصر بين الصفحات */
  .card, .step, .fleet-card, .plan, .quote, .qa, .stat, .gov,
  .coverage__panel, .art-card, .timeline, .order__form, .order__side,
  .sec-head, .hero__copy,
  .track, .why, .coverage, .order, .stats, .footer__grid {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .section, .cta, .footer { break-before: auto; }

  /* صفحة غلاف للمعاينة */
  #pdfCover {
    height: ${PAGE_H - 2}px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1.2rem; text-align: center;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(34,167,180,.32), transparent 55%),
      linear-gradient(155deg, #0f6b76, #06282e);
    color: #eaf6f7;
    break-after: page; page-break-after: always;
  }
  #pdfCover img { width: 340px; height: auto; }
  #pdfCover h1 { font-size: 2.4rem; color: #fff; margin: 0; }
  #pdfCover p { font-size: 1.05rem; color: #b6dde2; margin: 0; max-width: 46ch; }
  #pdfCover .meta {
    margin-top: 1rem; font-size: .92rem; color: #8fc2c9;
    border-top: 1px solid rgba(255,255,255,.25); padding-top: 1rem;
  }
`});

// إدراج صفحة الغلاف
await page.evaluate(() => {
  const today = new Intl.DateTimeFormat('ar-KW', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kuwait',
  }).format(new Date());

  const cover = document.createElement('div');
  cover.id = 'pdfCover';
  cover.innerHTML = `
    <img src="assets/logo-mawsool-light.png" alt="موصول">
    <h1>معاينة الموقع التعريفي</h1>
    <p>خدمة توصيل الطلبات بالسيارات في دولة الكويت — الصفحة الكاملة كما تظهر في المتصفح.</p>
    <div class="meta">${today}</div>`;
  document.body.insertBefore(cover, document.body.firstChild);
});
await page.waitForTimeout(500);

await page.pdf({
  path: OUT,
  width: `${PAGE_W}px`,
  height: `${PAGE_H}px`,
  printBackground: true,
  preferCSSPageSize: false,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `
    <div style="width:100%;padding:0 14px;font-size:8px;color:#7f9ba1;
                font-family:Helvetica,Arial,sans-serif;display:flex;
                justify-content:space-between;">
      <span>MAWSOOL</span>
      <span class="pageNumber"></span>
    </div>`,
});

await browser.close();
console.log('تم إنشاء الملف:', OUT);
