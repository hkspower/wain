// Kuwait delivery addressing.
//
// Kuwait does not use street addresses the way most checkout forms assume.
// Nothing is delivered to "12 Amman Street, Salmiya, 12345" — there are no
// postcodes in civilian use, and a courier navigates by
//   governorate → area → block → street → building → floor/flat.
// A generic address form produces undeliverable orders here, so this is the
// shape the checkout collects and the shape the admin shows.
//
// The area lists cover the residential areas Sporta actually delivers to.
// They are not the exhaustive PACI register — an area that is missing can
// still be typed, because the field accepts free text with these as
// suggestions rather than forcing a closed list.

export const GOVERNORATES = [
  {
    id: 'capital',
    name: { en: 'Capital', ar: 'العاصمة' },
    areas: [
      { en: 'Kuwait City', ar: 'مدينة الكويت' },
      { en: 'Sharq', ar: 'شرق' },
      { en: 'Mirqab', ar: 'المرقاب' },
      { en: 'Dasman', ar: 'دسمان' },
      { en: 'Qibla', ar: 'قبلة' },
      { en: 'Salhiya', ar: 'الصالحية' },
      { en: 'Bneid Al Gar', ar: 'بنيد القار' },
      { en: 'Kaifan', ar: 'كيفان' },
      { en: 'Mansouriya', ar: 'المنصورية' },
      { en: 'Dasma', ar: 'الدسمة' },
      { en: 'Daiya', ar: 'الدعية' },
      { en: 'Shamiya', ar: 'الشامية' },
      { en: 'Abdullah Al-Salem', ar: 'ضاحية عبدالله السالم' },
      { en: 'Nuzha', ar: 'النزهة' },
      { en: 'Faiha', ar: 'الفيحاء' },
      { en: 'Khaldiya', ar: 'الخالدية' },
      { en: 'Rawda', ar: 'الروضة' },
      { en: 'Adailiya', ar: 'العديلية' },
      { en: 'Yarmouk', ar: 'اليرموك' },
      { en: 'Surra', ar: 'السرة' },
      { en: 'Qadsiya', ar: 'القادسية' },
      { en: 'Qurtuba', ar: 'قرطبة' },
      { en: 'Shuwaikh', ar: 'الشويخ' },
      { en: 'Doha', ar: 'الدوحة' },
      { en: 'Granada', ar: 'غرناطة' },
      { en: 'Sulaibikhat', ar: 'الصليبيخات' },
      { en: 'Jaber Al-Ahmad', ar: 'جابر الأحمد' },
      { en: 'Nahdha', ar: 'النهضة' },
      { en: 'Qairawan', ar: 'القيروان' },
    ],
  },
  {
    id: 'hawalli',
    name: { en: 'Hawalli', ar: 'حولي' },
    areas: [
      { en: 'Hawalli', ar: 'حولي' },
      { en: 'Salmiya', ar: 'السالمية' },
      { en: 'Rumaithiya', ar: 'الرميثية' },
      { en: 'Bayan', ar: 'بيان' },
      { en: 'Mishref', ar: 'مشرف' },
      { en: 'Salwa', ar: 'سلوى' },
      { en: 'Jabriya', ar: 'الجابرية' },
      { en: 'Shaab', ar: 'الشعب' },
      { en: 'Maidan Hawalli', ar: 'ميدان حولي' },
      { en: 'Nugra', ar: 'النقرة' },
      { en: "Bida'a", ar: 'البدع' },
      { en: 'Zahra', ar: 'الزهراء' },
      { en: 'Hitteen', ar: 'حطين' },
      { en: 'Shuhada', ar: 'الشهداء' },
      { en: 'Salam', ar: 'السلام' },
      { en: 'Siddeeq', ar: 'الصديق' },
      { en: 'Mubarak Al-Abdullah', ar: 'مبارك العبدالله' },
    ],
  },
  {
    id: 'farwaniya',
    name: { en: 'Farwaniya', ar: 'الفروانية' },
    areas: [
      { en: 'Farwaniya', ar: 'الفروانية' },
      { en: 'Khaitan', ar: 'خيطان' },
      { en: 'Abraq Khaitan', ar: 'أبرق خيطان' },
      { en: 'Jleeb Al-Shuyoukh', ar: 'جليب الشيوخ' },
      { en: 'Ardiya', ar: 'العارضية' },
      { en: 'Rabiya', ar: 'الرابية' },
      { en: 'Andalous', ar: 'الأندلس' },
      { en: 'Rehab', ar: 'الرحاب' },
      { en: 'Ishbiliya', ar: 'إشبيلية' },
      { en: 'Firdous', ar: 'الفردوس' },
      { en: 'Omariya', ar: 'العمرية' },
      { en: 'Riggae', ar: 'الرقعي' },
      { en: 'Dajeej', ar: 'الضجيج' },
      { en: 'Abdullah Al-Mubarak', ar: 'عبدالله المبارك' },
      { en: 'Sabah Al-Nasser', ar: 'صباح الناصر' },
    ],
  },
  {
    id: 'mubarak-al-kabeer',
    name: { en: 'Mubarak Al-Kabeer', ar: 'مبارك الكبير' },
    areas: [
      { en: 'Mubarak Al-Kabeer', ar: 'مبارك الكبير' },
      { en: 'Qurain', ar: 'القرين' },
      { en: 'Adan', ar: 'العدان' },
      { en: 'Qusour', ar: 'القصور' },
      { en: 'Sabah Al-Salem', ar: 'صباح السالم' },
      { en: 'Messila', ar: 'المسيلة' },
      { en: 'Abu Ftaira', ar: 'أبو فطيرة' },
      { en: 'Fnaitees', ar: 'الفنيطيس' },
      { en: 'Mesayel', ar: 'المسايل' },
      { en: 'Sabhan', ar: 'صبحان' },
    ],
  },
  {
    id: 'ahmadi',
    name: { en: 'Ahmadi', ar: 'الأحمدي' },
    areas: [
      { en: 'Ahmadi', ar: 'الأحمدي' },
      { en: 'Fahaheel', ar: 'الفحيحيل' },
      { en: 'Mangaf', ar: 'المنقف' },
      { en: 'Abu Halifa', ar: 'أبو حليفة' },
      { en: 'Fintas', ar: 'الفنطاس' },
      { en: 'Mahboula', ar: 'المهبولة' },
      { en: 'Riqqa', ar: 'الرقة' },
      { en: 'Hadiya', ar: 'هدية' },
      { en: 'Sabahiya', ar: 'الصباحية' },
      { en: 'Egaila', ar: 'العقيلة' },
      { en: 'Ali Sabah Al-Salem', ar: 'علي صباح السالم' },
      { en: 'Jaber Al-Ali', ar: 'جابر العلي' },
      { en: 'Sabah Al-Ahmad', ar: 'صباح الأحمد' },
      { en: 'Wafra', ar: 'الوفرة' },
      { en: 'Khairan', ar: 'الخيران' },
    ],
  },
  {
    id: 'jahra',
    name: { en: 'Jahra', ar: 'الجهراء' },
    areas: [
      { en: 'Jahra', ar: 'الجهراء' },
      { en: 'Saad Al-Abdullah', ar: 'سعد العبدالله' },
      { en: 'Naeem', ar: 'النعيم' },
      { en: 'Nasseem', ar: 'النسيم' },
      { en: 'Qasr', ar: 'القصر' },
      { en: 'Waha', ar: 'الواحة' },
      { en: 'Oyoun', ar: 'العيون' },
      { en: 'Taima', ar: 'تيماء' },
      { en: 'Sulaibiya', ar: 'الصليبية' },
      { en: 'Amghara', ar: 'أمغرة' },
      { en: 'Kabd', ar: 'كبد' },
    ],
  },
]

export const governorate = (id) => GOVERNORATES.find((g) => g.id === id)

// Kuwait mobiles are 8 digits starting 5, 6 or 9 (landlines start 1/2 and
// cannot receive the delivery SMS/WhatsApp, so they are rejected). Mirrors
// normalise_kw_phone() in checkout-migration.sql — the database repeats this
// check, because a browser can be bypassed and this one cannot.
export function normalisePhone(input) {
  let d = String(input ?? '').replace(/\D/g, '')
  if (d.startsWith('00965')) d = d.slice(5)
  else if (d.length === 11 && d.startsWith('965')) d = d.slice(3)
  return /^[569]\d{7}$/.test(d) ? `965${d}` : null
}

// Display form of what the customer typed: 9988 7766.
export const prettyPhone = (d) => {
  const n = String(d ?? '').replace(/\D/g, '').slice(-8)
  return n.length === 8 ? `${n.slice(0, 4)} ${n.slice(4)}` : String(d ?? '')
}

// One-line address for the admin, the packing slip and the courier.
export function formatAddress(o, lang = 'en') {
  const g = governorate(o.customer_governorate)
  const L = lang === 'ar'
    ? { block: 'قطعة', street: 'شارع', building: 'منزل', floor: 'دور', flat: 'شقة' }
    : { block: 'Block', street: 'Street', building: 'Building', floor: 'Floor', flat: 'Flat' }
  return [
    o.customer_area,
    g && g.name[lang],
    o.customer_block && `${L.block} ${o.customer_block}`,
    o.customer_street && `${L.street} ${o.customer_street}`,
    o.customer_building && `${L.building} ${o.customer_building}`,
    o.customer_floor && `${L.floor} ${o.customer_floor}`,
    o.customer_flat && `${L.flat} ${o.customer_flat}`,
  ]
    .filter(Boolean)
    .join(' · ')
}
