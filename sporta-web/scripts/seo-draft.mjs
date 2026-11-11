// DRAFT SEO text for the shop's pages and products (owner: "update seo data", 2026-11-11). Deterministic templates, no
// network, no AI. Output: seo-draft/seo-draft.json (the shape /backends -> SEO saves: title_en, title_ar, description_en,
// description_ar per page path or product slug) and seo-draft/seo-draft.md (review table). It is a DRAFT: nothing here is
// live until it is applied in /backends -> SEO (admin.php seo_save). Facts used are the live ones (measured 2026-11-11):
// delivery within 24 hours for 1 KWD, returns within 14 days, cash on delivery. Prices are NOT written into text (they
// change; the product page shows them) and no brand is claimed unless the product row carries one.
//   node scripts/seo-draft.mjs            write both files
//   node scripts/seo-draft.mjs --check    fail on any limit break (title <=60 target / 120 hard, description 70-160 / 320 hard)
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = join(dirname(fileURLToPath(import.meta.url)), '..', 'seo-draft')
const rows = readFileSync(join(HERE, 'products.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'))
const BRAND = { vanquish: ['Vanquish', 'فانكويش'], gymshark: ['Gymshark', 'جيم شارك'], nba: ['NBA', 'إن بي إيه'] }
// English type word -> [English noun phrase for a sentence, Arabic noun phrase]. The type is the last word(s) of the name before the colour.
const KIND = [
  [/Sports Bra/, ['sports bra', 'برا رياضية'], 'women'],
  [/Phone Strap/, ['phone strap', 'حزام هاتف'], 'any'],
  [/Backpack/, ['backpack', 'حقيبة ظهر'], 'any'],
  [/Sweatshirt/, ['sweatshirt', 'سويت شيرت'], 'any'],
  [/Stringer Vest/, ['stringer vest', 'ستراينجر'], 'men'],
  [/Leggings/, ['leggings', 'ليقنز'], 'women'],
  [/Jacket/, ['jacket', 'جاكيت'], 'any'],
  [/Shorts/, ['shorts', 'شورت'], 'men'],
  [/Pants/, ['pants', 'بنطال'], 'men'],
  [/T-Shirt/, ['T-shirt', 'تيشيرت'], 'men'],
  [/Tank/, ['tank top', 'تانك'], 'men'],
  [/Cap/, ['cap', 'كاب'], 'any'],
  [/Top/, ['top', 'توب'], 'women'],
]
const FOR = { men: ['for men', 'رجالي'], women: ['for women', 'نسائي'], outerwear: ['', ''], accessories: ['', ''] }
const GAP = ' — '
const out = { pages: {}, products: {} }
// ---- pages: same paths store_seo uses (STORE_SEO_PAGE_PATHS). Arabic is the default language of the shop.
out.pages['/'] = { title_en: 'Sporta — Sportswear & Gym Clothing in Kuwait', title_ar: 'سبورتا — ملابس رياضية وملابس جيم في الكويت',
  description_en: 'Premium sportswear and gym clothing in Kuwait. Delivery within 24 hours for 1 KWD, easy 14-day returns and cash on delivery.',
  description_ar: 'ملابس رياضية وملابس جيم فاخرة في الكويت. توصيل خلال ٢٤ ساعة بدينار واحد، إرجاع سهل خلال ١٤ يومًا، والدفع عند الاستلام.' }
out.pages['/shop'] = { title_en: 'Shop Sportswear in Kuwait — Men, Women, Outerwear | Sporta', title_ar: 'تسوّق ملابس رياضية في الكويت — رجالي، نسائي | سبورتا',
  description_en: 'Shop leggings, tops, jackets, T-shirts, shorts and accessories. Prices in Kuwaiti Dinar, delivery within 24 hours, 14-day returns.',
  description_ar: 'تسوّق ليقنز وتوبات وجاكيتات وتيشيرتات وشورتات وإكسسوارات. الأسعار بالدينار الكويتي، توصيل خلال ٢٤ ساعة، وإرجاع خلال ١٤ يومًا.' }
out.pages['/about'] = { title_en: 'About Sporta — Premium Sportswear in Kuwait', title_ar: 'عن سبورتا — ملابس رياضية فاخرة في الكويت',
  description_en: 'Sporta is a Kuwait sportswear store with performance gear from Vanquish, Gymshark and NBA. Fast delivery, easy returns, authentic products.',
  description_ar: 'سبورتا متجر ملابس رياضية في الكويت بمعدات أداء من فانكويش وجيم شارك وإن بي إيه. توصيل سريع، إرجاع سهل، ومنتجات أصلية.' }
out.pages['/contact'] = { title_en: 'Contact Sporta Kuwait — Orders, Sizes, Delivery', title_ar: 'تواصل مع سبورتا الكويت — الطلبات والمقاسات والتوصيل',
  description_en: 'Contact Sporta about an order, a size, delivery or a return. Reach us by phone, WhatsApp or email and we will reply quickly.',
  description_ar: 'تواصل مع سبورتا بخصوص طلب أو مقاس أو توصيل أو إرجاع. اتصل بنا أو راسلنا على واتساب أو البريد وسنرد عليك بسرعة.' }
out.pages['/support'] = { title_en: 'Sporta Support — Help With Your Order', title_ar: 'دعم سبورتا — مساعدة بخصوص طلبك',
  description_en: 'Get help with your Sporta order: delivery, sizes, payment, returns and exchanges. Open a support request and we will follow up.',
  description_ar: 'احصل على مساعدة بخصوص طلبك من سبورتا: التوصيل والمقاسات والدفع والإرجاع والاستبدال. افتح طلب دعم وسنتابع معك.' }
out.pages['/track'] = { title_en: 'Track Your Sporta Order — Delivery Status', title_ar: 'تتبّع طلبك من سبورتا — حالة التوصيل',
  description_en: 'Track your Sporta order with your order number and see its payment and delivery status.',
  description_ar: 'تتبّع طلبك من سبورتا برقم الطلب، وتعرّف على حالة الدفع وحالة التوصيل لحظة بلحظة.' }
out.pages['/returns'] = { title_en: 'Returns & Exchanges — 14 Days | Sporta Kuwait', title_ar: 'الإرجاع والاستبدال خلال ١٤ يومًا | سبورتا الكويت',
  description_en: 'Return or exchange eligible Sporta items within 14 days of delivery. See the conditions and how to request a return.',
  description_ar: 'أرجع أو استبدل المنتجات المستوفية للشروط من سبورتا خلال ١٤ يومًا من التوصيل. تعرّف على الشروط وطريقة طلب الإرجاع.' }
out.pages['/terms'] = { title_en: 'Terms & Conditions | Sporta Kuwait', title_ar: 'الشروط والأحكام | سبورتا الكويت',
  description_en: 'The terms for ordering from Sporta Kuwait: prices, payment, delivery, returns and exchanges.',
  description_ar: 'شروط الطلب من سبورتا الكويت: الأسعار والدفع والتوصيل والإرجاع والاستبدال.' }
out.pages['/privacy'] = { title_en: 'Privacy Policy | Sporta Kuwait', title_ar: 'سياسة الخصوصية | سبورتا الكويت',
  description_en: 'How Sporta Kuwait collects, uses and protects your personal data when you shop with us.',
  description_ar: 'كيف تجمع سبورتا الكويت بياناتك الشخصية وتستخدمها وتحميها عند التسوق معنا.' }
// ---- products
for (const [slug, cat, brandKey, nameEn, nameAr] of rows) {
  const [baseEn, colourEn] = nameEn.split(GAP), [baseAr, colourAr] = nameAr.split(GAP)
  const kind = KIND.find(([re]) => re.test(baseEn))
  const nounEn = kind ? kind[1][0] : 'sportswear', nounAr = kind ? kind[1][1] : 'ملابس رياضية'
  const audEn = FOR[cat]?.[0] || '', audAr = FOR[cat]?.[1] || ''
  const brand = BRAND[brandKey]
  const colourEnTxt = colourEn ? ` in ${colourEn.toLowerCase().replace('/', ' and ')}` : ''
  const colourArTxt = colourAr ? ` ${colourAr}` : ''
  const titleEn = `${baseEn}${colourEn ? ` (${colourEn})` : ''} — Sporta Kuwait`
  const titleAr = `${baseAr}${colourAr ? ` (${colourAr})` : ''} — سبورتا الكويت`
  const lead = brand && !baseEn.includes(brand[0]) ? ` from ${brand[0]}` : ''
  const leadAr = brand && !baseAr.includes(brand[1].replace(' ', '')) && !baseAr.includes(brand[1]) ? ` من ${brand[1]}` : ''
  const descEn = `Buy ${baseEn}${colourEnTxt}${lead}${audEn ? ' ' + audEn : ''}. Delivery within 24 hours in Kuwait, easy 14-day returns, cash on delivery.`
  const descAr = `اشترِ ${baseAr}${colourArTxt}${leadAr}${audAr ? '، ' + audAr : ''}. توصيل خلال ٢٤ ساعة داخل الكويت، إرجاع خلال ١٤ يومًا، والدفع عند الاستلام.`
  out.products[slug] = { title_en: titleEn, title_ar: titleAr, description_en: descEn, description_ar: descAr }
}
const issues = []
const chk = (k, r) => {
  if (r.title_en.length > 120 || r.title_ar.length > 120) issues.push(`${k}: title over 120`)
  for (const f of ['description_en', 'description_ar']) {
    const n = r[f].length
    if (n > 320) issues.push(`${k}.${f}: ${n} > 320`)
    else if (n < 70 || n > 160) issues.push(`${k}.${f}: ${n} outside 70-160 (soft)`)
  }
  for (const f of ['title_en', 'title_ar']) if (r[f].length > 70) issues.push(`${k}.${f}: ${r[f].length} > 70 (soft)`)
  if (/[،؟؛]/.test(r.description_en) || /[٠-٩].*[0-9]|[0-9].*[٠-٩]/.test(r.description_ar)) issues.push(`${k}: mixed punctuation or digits`)
}
for (const [p, r] of Object.entries(out.pages)) chk(p, r)
for (const [p, r] of Object.entries(out.products)) chk(p, r)
const hard = issues.filter((i) => !/soft/.test(i))
if (process.argv.includes('--check')) { console.log(issues.join('\n') || 'no issues'); process.exit(hard.length ? 1 : 0) }
writeFileSync(join(HERE, 'seo-draft.json'), JSON.stringify(out, null, 1) + '\n')
const md = ['# SEO draft (review, then apply in /backends → SEO)', '', 'Generated by scripts/seo-draft.mjs. Pages first, then 46 products. Lengths in brackets.', '', '## Pages', '']
for (const [p, r] of Object.entries(out.pages)) md.push(`### ${p}`, `- EN title (${r.title_en.length}): ${r.title_en}`, `- AR title (${r.title_ar.length}): ${r.title_ar}`, `- EN desc (${r.description_en.length}): ${r.description_en}`, `- AR desc (${r.description_ar.length}): ${r.description_ar}`, '')
md.push('## Products', '')
for (const [s, r] of Object.entries(out.products)) md.push(`### ${s}`, `- EN title (${r.title_en.length}): ${r.title_en}`, `- AR title (${r.title_ar.length}): ${r.title_ar}`, `- EN desc (${r.description_en.length}): ${r.description_en}`, `- AR desc (${r.description_ar.length}): ${r.description_ar}`, '')
writeFileSync(join(HERE, 'seo-draft.md'), md.join('\n'))
console.log('wrote seo-draft.json and seo-draft.md; soft notes:', issues.length)
if (issues.length) console.log(issues.slice(0, 20).join('\n'))
