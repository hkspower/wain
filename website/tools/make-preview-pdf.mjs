/**
 * يولّد ملف PDF عالي الجودة لمعاينة الموقع كاملًا بمقاس شاشةٍ حقيقية.
 *
 *   node website/tools/make-preview-pdf.mjs [خيارات]
 *
 *     --url=<رابط>       افتراضيًا http://localhost:8080/
 *     --out=<مسار>       افتراضيًا mawsool-website-preview.pdf
 *     --size=<اسم>       fhd (1920×1080) · laptop (1440×900) · qhd (2560×1440)
 *     --width= --height= مقاس صريح بالبكسل يتقدّم على ‎--size
 *
 * الصفحة بمقاس الشاشة لا بمقاس الورق: الغرض معاينة ما يراه الزائر، لا
 * طباعة مستند. النصّ في الملفّ الناتج متجهٌ لا صورة — يكبر بلا تحبّب
 * ويُبحث فيه ويُنسخ منه — لأنّ `page.pdf` يمرّ بمحرّك الطباعة لا بالتصوير.
 *
 * يتطلّب تشغيل الموقع على خادم HTTP (وليس file://) حتى يُحمّل الخط،
 * و Playwright مثبّتًا. مثال:
 *   cd website && python3 -m http.server 8080 &
 *   node tools/make-preview-pdf.mjs --out=preview.pdf
 */
import { chromium } from 'playwright';
import path from 'node:path';

const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

/* مقاسات شاشاتٍ فعلية. الافتراضي Full HD: أكثر دقّة شاشةٍ استعمالًا على
   سطح المكتب، وعندها يعرض الموقع تخطيطه الأوسع. */
const SIZES = {
  fhd:    { w: 1920, h: 1080 },
  laptop: { w: 1440, h: 900 },
  qhd:    { w: 2560, h: 1440 },
};

const URL = arg('url', 'http://localhost:8080/');
const OUT = path.resolve(arg('out', 'mawsool-website-preview.pdf'));
const named = SIZES[arg('size', 'fhd')];
if (!named) {
  console.error(`مقاس غير معروف. المتاح: ${Object.keys(SIZES).join(' · ')}`);
  process.exit(1);
}
const PAGE_W = +arg('width', named.w);
const PAGE_H = +arg('height', named.h);
const EXEC = process.env.CHROMIUM_PATH || undefined;

const browser = await chromium.launch({ executablePath: EXEC });
const page = await browser.newPage({
  viewport: { width: PAGE_W, height: PAGE_H },
  /* لا أثر له على حِدّة النصّ — النصّ متجهٌ أصلًا — لكنه يجعل الصفحة
     تختار أصول العرض العالي إن وُجدت، ويطابق ما يراه صاحب شاشةٍ دقيقة. */
  deviceScaleFactor: 2,
  locale: 'ar-KW',
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);

// تشغيل عدّادات الأرقام بالمرور على القسم ثم العودة للأعلى
await page.evaluate(() => document.getElementById('stats')?.scrollIntoView());
await page.waitForTimeout(1800);
await page.evaluate(() => window.scrollTo(0, 0));

// فكّ كل ما هو مطويّ أو مخفيّ خلف تأثير الظهور
await page.evaluate(() => {
  document.querySelectorAll('.reveal').forEach((el) => {
    el.classList.add('is-in');
    el.style.transitionDelay = '0ms';
  });
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
});
// الصور الكسولة لا تُحمّل إلا عند اقترابها من الشاشة، وفي الطباعة لا تمرّ
// عليها شاشة — فنُجبرها على التحميل ثم ننتظرها.
await page.evaluate(async () => {
  const imgs = [...document.images];
  imgs.forEach((i) => { i.loading = 'eager'; });
  await Promise.all(imgs.map((i) => (i.complete ? null : i.decode().catch(() => {}))));
});
await page.waitForTimeout(600);

// المعاينة يجب أن تطابق شكل الشاشة، لا أنماط الطباعة المبسّطة
await page.emulateMedia({ media: 'screen' });

await page.addStyleTag({ content: `
  /* عناصر تفاعلية لا معنى لها في ملف ثابت — ومنها الأزرار العائمة، وهي
     مثبّتة بـ position: fixed فيرسمها محرّك الطباعة فوق كل صفحة.
     (لا علامة اقتباس خلفية هنا: النصّ كلّه داخل قالبٍ نصّيّ.) */
  .progress, .wa-float, .to-top, .skip-link, .burger, .asst-float, .asst {
    display: none !important;
  }
  /* الفوتر يحجز أسفله ارتفاع تلك الأزرار — وقد اختفت، فلا داعي للفراغ */
  .footer { padding-block-end: clamp(2.6rem, 5vw, 4rem) !important; }

  /* الهيدر لاصق على الشاشة — نثبّته في مكانه ليظهر مرة واحدة */
  .header { position: static !important; background: #fff !important; }

  /* تجميد كل الحركات عند وضعها النهائي */
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
  .marquee__track { transform: none !important; }

  /* --- إصلاحات خاصة بمحرّك الطباعة في كروميوم --- */

  /* كان هنا التفافان: أحدهما يُبطل قصَّ الخلفية على النصّ في كلمة العنوان
     لأنّ محرّك الطباعة يترك حولها مستطيلًا مرئيًا، والآخر يُبطل حلقة
     mask-composite حول الباقة المميّزة لأنّ المحرّك لا يدعمها فيمتلئ
     الكرت بالتدرّج كلّه. أُزيلت الحيلتان من ورقة الأنماط نفسها (الكلمة
     صارت لونًا مصمتًا، والحلقة صارت حدًّا حقيقيًّا) فلم يبقَ للالتفافين
     ما يلتفّان عليه. (بلا علامات اقتباس خلفية: النصّ داخل قالبٍ نصّيّ.) */

  /* شارة «الأكثر طلبًا» تخرج خارج حدود الكرت فتُقصّ عند حافة الصفحة */
  .pricing { padding-top: 18px; }

  /* ثلاث خصائص تُجبر كروميوم على تسطيح المنطقة إلى صورة نقطية بدقّة
     الصفحة — وبعضها JPEG مفقود، فتظهر آثاره حول الحواف. الحرفُ نفسه يخرج
     مساراتٍ متجهة، فلا معنى لأن يخرج ما حوله صورةً. وكلّها زخرفية. */
  .header { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
  .marquee { -webkit-mask-image: none !important; mask-image: none !important; }
  .tmap__car { filter: none !important; }

  /* منع قطع العناصر بين الصفحات */
  .card, .step, .fleet-card, .plan, .qa, .stat, .gov,
  .coverage__panel, .art-card, .timeline, .order__form, .order__side,
  .sec-head, .hero__copy,
  .track, .why, .coverage, .order, .stats, .footer__grid {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* كلّ قسمٍ يبدأ صفحةً جديدة.
     قياس الأقسام على شاشة 1920×1080: بين ٠٫٤ و١٫٣ صفحة، ولا واحد منها
     يملأ صفحةً بالضبط. فحين يتدفّق المحتوى بلا ضابط تنكسر الصفحات في
     منتصف الأقسام، ويُقفز القسم الذي لا يتّسع بأكمله فيترك فراغًا أسفل
     الصفحة قبله — كان ذلك يهدر نحو ثلاث صفحات من أربع عشرة. وربط
     الانكسار بحدود الأقسام يجعل الفراغ حيث ينتهي القسم: مقصودًا لا
     عارضًا، والمعاينة تُقرأ صفحةً لكلّ شاشة. */
  main > .section { break-before: page; page-break-before: always; }
  /* القسم الذي يتّسع لصفحته يملأها ويتوسّط فيها — يُوسَم بالقياس أدناه */
  .pdf-fits {
    min-height: ${PAGE_H}px;
    display: flex; flex-direction: column; justify-content: center;
  }

  /* صفحة غلاف بمقاس الصفحة نفسها */
  #pdfCover {
    height: ${PAGE_H - 2}px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1.4rem; text-align: center;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(34,167,180,.26), transparent 55%),
      linear-gradient(155deg, var(--teal-900), var(--teal-950));
    color: var(--on-dark);
    break-after: page; page-break-after: always;
  }
  #pdfCover img { width: min(28vw, 420px); height: auto; }
  #pdfCover h1 { font-size: clamp(2rem, 2.6vw, 3rem); color: #fff; margin: 0; }
  #pdfCover p {
    font-size: clamp(1rem, 1.1vw, 1.25rem); color: var(--on-dark-mid);
    margin: 0; max-width: 46ch; line-height: 1.9;
  }
  #pdfCover .meta {
    margin-top: 1.2rem; font-size: .95rem; color: var(--on-dark-soft);
    border-top: 1px solid rgba(255,255,255,.25); padding-top: 1.1rem;
  }
`});

/* ضغط المسافات بقدر حاجة الصفحة لا أكثر.
   على صفحةٍ بارتفاع الورق الأفقي (٧٩٤) لا يتّسع قسمٌ واحد إلا بقصٍّ شديد.
   وعلى صفحةٍ بارتفاع شاشة يكفي قصٌّ خفيف: حشو القسم من ٦٫٥rem إلى ٣rem
   وهامش ترويسته من ٣٫٢rem إلى ١٫٥rem يُدخل «خدماتنا» (١٢١٣px) تحت
   ارتفاع الصفحة. الأسئلة الشائعة تبقى فوقه وتأخذ صفحتين، وهو حقّها. */
const tight = PAGE_H < 950;
await page.addStyleTag({ content: `
  .section { padding-block: ${tight ? '2.4rem' : '3rem'} !important; }
  .cta { padding-block: ${tight ? '2.6rem' : '3rem'} !important; }
  .sec-head { margin-bottom: ${tight ? '1.6rem' : '1.5rem'} !important; }
  ${tight ? `
    #track.section { padding-block: 1.8rem !important; }
    #track .track { padding-block: 1.2rem !important; }
    #track .timeline { margin-top: 1rem !important; padding: 1.2rem !important; }
    #track .tl { padding-bottom: .55rem !important; }` : ''}
`});

/* إسكان كل قسمٍ في صفحته — بالقياس لا بالتقدير.
   الفرضية «القسم يتّسع لصفحة» تنكسر عند أول قسمٍ يتجاوزها ببضعة بكسلات:
   يفيض إلى صفحةٍ تالية شبه فارغة. على 1440×900 أنتج ذلك صفحةً بيضاء
   تمامًا. فنقيس كل قسم، ونقلّص حشوه الرأسي درجةً درجة ما دام قريبًا من
   الاتّساع، ثم نُثبّت الذي اتّسع في صفحته. ومن يبقَ أطول — كالأسئلة
   الشائعة — يأخذ صفحتين، وهو حقّه لا عيبه. */
const fit = await page.evaluate(({ H }) => {
  const PADS = ['2.6rem', '2.1rem', '1.7rem', '1.3rem', '1rem', '.7rem'];
  const head = [...document.querySelectorAll('.topbar, .header')]
    .reduce((n, el) => n + el.getBoundingClientRect().height, 0);
  const report = [];
  const shrink = (el, avail) => {
    let h = el.getBoundingClientRect().height;
    const before = h;
    for (const pad of PADS) {
      if (h <= avail) break;
      el.style.paddingBlock = pad;
      h = el.getBoundingClientRect().height;
    }
    /* بقي القسم أطول بقليل بعد قصّ الحشو — طولُه من محتواه لا من فراغه.
       تصغيرٌ في حدود ٢٠٪ لا تكاد العين تميّزه، وهو أهون من صفحةٍ تالية
       فيها أربعون بكسلًا وبقيّتها بيضاء. والنصّ يبقى متجهًا بعد التصغير. */
    let zoom = 1;
    if (h > avail && h <= avail * 1.22) {
      zoom = (avail / h) * 0.995;
      el.style.zoom = zoom.toFixed(4);
      h = el.getBoundingClientRect().height;
    }
    return { before: Math.round(before), after: Math.round(h), fits: h <= avail, zoom };
  };
  // البطل يشارك صفحته مع الشريط العلوي والهيدر
  const hero = document.querySelector('#hero');
  if (hero) {
    const r = shrink(hero, H - head);
    if (r.fits) hero.style.minHeight = `${H - head}px`;
    report.push({ id: 'hero', ...r, avail: Math.round(H - head) });
  }
  for (const s of document.querySelectorAll('main > .section')) {
    const r = shrink(s, H);
    if (r.fits) s.classList.add('pdf-fits');
    report.push({ id: s.id || s.className.split(' ')[0], ...r, avail: H });
  }
  /* الصفحة الأخيرة تجمع نداء الطلب والفوتر، ومجموعهما أقصر من الصفحة
     فيبقى بياضٌ تحت خلفيةٍ داكنة. نُنمّي النداء بالفارق فتُغلق الصفحة. */
  const cta = document.querySelector('.cta');
  const foot = document.querySelector('.footer');
  if (cta && foot) {
    const pair = cta.getBoundingClientRect().height + foot.getBoundingClientRect().height;
    if (pair < H) {
      cta.style.minHeight = `${cta.getBoundingClientRect().height + (H - pair)}px`;
      cta.style.display = 'flex';
      cta.style.flexDirection = 'column';
      cta.style.justifyContent = 'center';
      report.push({ id: 'cta+footer', before: Math.round(pair), after: H, fits: true, zoom: 1, avail: H });
    }
  }
  return report;
}, { H: PAGE_H });

for (const s of fit) {
  const zoomed = s.zoom < 1 ? ` بتصغير ${Math.round(s.zoom * 100)}٪` : '';
  const note = s.fits
    ? (s.before === s.after ? 'يتّسع' : `قُلِّص ${s.before}→${s.after}${zoomed}`)
    : `أطول من الصفحة (${s.after}) — يأخذ صفحتين`;
  console.log(`  ${s.id.padEnd(10)} ${String(s.avail).padStart(5)}px متاح · ${note}`);
}

// إدراج صفحة الغلاف
await page.evaluate((size) => {
  const today = new Intl.DateTimeFormat('ar-KW', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kuwait',
  }).format(new Date());

  const cover = document.createElement('div');
  cover.id = 'pdfCover';
  cover.innerHTML = `
    <img src="assets/logo-mawsool-light.png" alt="موصول">
    <h1>معاينة الموقع التعريفي</h1>
    <p>وساطة توصيل الطلبات بالسيارات في دولة الكويت — الصفحة الكاملة كما تظهر
       في المتصفح على شاشة ${size}.</p>
    <div class="meta">${today}</div>`;
  document.body.insertBefore(cover, document.body.firstChild);
}, `${PAGE_W}×${PAGE_H}`);
await page.waitForTimeout(500);

await page.pdf({
  path: OUT,
  width: `${PAGE_W}px`,
  height: `${PAGE_H}px`,
  printBackground: true,
  preferCSSPageSize: false,
  scale: 1,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: `
    <div style="width:100%;padding:0 18px 6px;font-size:9px;color:#7f9ba1;
                font-family:Helvetica,Arial,sans-serif;display:flex;
                justify-content:space-between;">
      <span>MAWSOOL — ${PAGE_W}×${PAGE_H}</span>
      <span class="pageNumber"></span>
    </div>`,
});

await browser.close();
console.log(`تم إنشاء الملف: ${OUT}  (${PAGE_W}×${PAGE_H})`);
