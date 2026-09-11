/*!
 * arabic-kit — حزمة اللغة العربية لمشروع موصول
 *
 * تعالج ما لا تعالجه أدوات التنسيق العامة في العربية:
 *   • الأرقام العربية-الهندية بفواصلها الصحيحة (٬ للآلاف و٫ للعشرية).
 *   • تمييز العدد: العربية لها ست صيغ لا صيغتان، فـ«٥ دقيقة» خطأ و«٥ دقائق» صواب.
 *   • المثنّى: «طلبان» لا «٢ طلب».
 *   • الصفر: «لا طلبات» لا «٠ طلب».
 *   • الوقت النسبي والتاريخ والعملة بالصيغة الكويتية (الدينار من ثلاث خانات).
 *
 * تعمل في Node وفي المتصفح بلا أدوات بناء:
 *   const ar = require('arabic-kit');        // Node
 *   <script src="vendor/arabic-kit.js">      // المتصفح ← window.arabicKit
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.arabicKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ————————————————————————————— الأرقام ————————————————————————————— */

  const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const DECIMAL = '٫';   // ٫ الفاصلة العشرية العربية
  const THOUSANDS = '٬'; // ٬ فاصلة الآلاف العربية
  const LRM = '‎';       // علامة اتجاه لليسار (مصدَّرة للتوافق)
  /* عزلٌ صريح: ما بين هذين محارفُ نصٍّ مستقلّ اتجاهه يسار. وهو ما تحتاجه
     أرقام الهواتف في جملةٍ عربية — لا مجرّد علامة اتجاه. */
  const LRI = '⁦';       // LEFT-TO-RIGHT ISOLATE
  const PDI = '⁩';       // POP DIRECTIONAL ISOLATE

  /** يحوّل كل رقم لاتيني في نص إلى رقم عربي-هندي، ويترك ما عداه كما هو. */
  function digits(value) {
    return String(value).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
  }

  /** يعكس العملية: أرقام عربية-هندية ← لاتينية. مفيد لقراءة مدخلات المستخدم. */
  function toLatin(value) {
    return String(value)
      .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
      .replace(new RegExp(DECIMAL, 'g'), '.')
      .replace(new RegExp(THOUSANDS, 'g'), '');
  }

  /**
   * رقم منسّق بالكامل: فاصل آلاف عربي، وفاصلة عشرية عربية، وأرقام عربية-هندية.
   * number(128000) → ١٢٨٬٠٠٠        number(1.5, 3) → ١٫٥٠٠
   */
  function number(value, decimals) {
    const n = Number(value);
    if (!isFinite(n)) return digits(value);
    const fixed = decimals == null ? String(n) : n.toFixed(decimals);
    const neg = fixed.startsWith('-');
    const [intPart, fracPart] = fixed.replace('-', '').split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS);
    const out = grouped + (fracPart ? DECIMAL + fracPart : '');
    return (neg ? '−' : '') + digits(out);
  }

  /** مبلغ بالدينار الكويتي — ثلاث خانات عشرية دائمًا. money(1.5) → ١٫٥٠٠ د.ك */
  function money(value, currency) {
    return number(value, 3) + ' ' + (currency || 'د.ك');
  }

  /** نسبة مئوية بعلامة النسبة العربية. percent(98) → ٩٨٪ */
  function percent(value, decimals) {
    return number(value, decimals) + '٪';
  }

  /* ———————————————————————— تمييز العدد (الجمع) ———————————————————————— */

  /**
   * فئة العدد حسب قواعد CLDR للعربية — ست فئات لا اثنتان.
   *   ٠ → zero  |  ١ → one  |  ٢ → two
   *   ٣–١٠ → few (جمع)  |  ١١–٩٩ → many (مفرد منصوب)  |  ما عداها → other (مفرد مجرور)
   */
  function pluralCategory(n) {
    const abs = Math.abs(Number(n));
    if (!isFinite(abs)) return 'other';
    if (abs === 0) return 'zero';
    if (abs === 1) return 'one';
    if (abs === 2) return 'two';
    const mod100 = abs % 100;
    if (mod100 >= 3 && mod100 <= 10) return 'few';
    if (mod100 >= 11 && mod100 <= 99) return 'many';
    return 'other';
  }

  /**
   * قاموس الأسماء. كل اسم بصيغه الست كما تُقرأ في جملة:
   *   zero/one/two مكتفية بذاتها (لا يسبقها رقم)، وما عداها يسبقها الرقم.
   * الصيغة `many` مفرد منصوب بتنوين الفتح (طلبًا)، وهي الصيغة الصحيحة لـ١١–٩٩.
   *
   * `twoOblique` هي صيغة المثنّى المجرورة/المنصوبة — «قبل دقيقتين» لا
   * «قبل دقيقتان». تُستعمل تلقائيًا بعد حروف الجر عبر الخيار { case: 'oblique' }.
   *
   * `gender` جنس المفرد، و`human` هل الاسم لعاقل — يحتاجهما توافق الصفة:
   * جمع غير العاقل يوصف بمفرد مؤنث («٥ طلبات نشطة»)، وجمع العاقل يوصف بجمعه
   * («٥ مندوبين نشطين»). هذه قاعدة عربية لا يمكن تجاهلها بجدول صفات واحد.
   */
  const NOUNS = {
    order:    { gender: 'm', human: false, zero: 'لا طلبات',    one: 'طلب واحد',     two: 'طلبان',       twoOblique: 'طلبين',      few: 'طلبات',      many: 'طلبًا',      other: 'طلب' },
    agent:    { gender: 'm', human: true,  zero: 'لا مندوبين',  one: 'مندوب واحد',   two: 'مندوبان',     twoOblique: 'مندوبين',    few: 'مندوبين',    many: 'مندوبًا',    other: 'مندوب' },
    account:  { gender: 'm', human: false, zero: 'لا حسابات',   one: 'حساب واحد',    two: 'حسابان',      twoOblique: 'حسابين',     few: 'حسابات',     many: 'حسابًا',     other: 'حساب' },
    transfer: { gender: 'm', human: false, zero: 'لا تحويلات',  one: 'تحويل واحد',   two: 'تحويلان',     twoOblique: 'تحويلين',    few: 'تحويلات',    many: 'تحويلًا',    other: 'تحويل' },
    attempt:  { gender: 'f', human: false, zero: 'لا محاولات',  one: 'محاولة واحدة', two: 'محاولتان',    twoOblique: 'محاولتين',   few: 'محاولات',    many: 'محاولة',     other: 'محاولة' },
    point:    { gender: 'f', human: false, zero: 'لا نقاط',     one: 'نقطة واحدة',   two: 'نقطتان',      twoOblique: 'نقطتين',     few: 'نقاط',       many: 'نقطة',       other: 'نقطة' },
    message:  { gender: 'f', human: false, zero: 'لا رسائل',    one: 'رسالة واحدة',  two: 'رسالتان',     twoOblique: 'رسالتين',    few: 'رسائل',      many: 'رسالة',      other: 'رسالة' },
    note:     { gender: 'f', human: false, zero: 'لا ملاحظات',  one: 'ملاحظة واحدة', two: 'ملاحظتان',    twoOblique: 'ملاحظتين',   few: 'ملاحظات',    many: 'ملاحظة',     other: 'ملاحظة' },
    second:   { gender: 'f', human: false, zero: 'لا ثوانٍ',    one: 'ثانية واحدة',  two: 'ثانيتان',     twoOblique: 'ثانيتين',    few: 'ثوانٍ',      many: 'ثانية',      other: 'ثانية' },
    minute:   { gender: 'f', human: false, zero: 'لا دقائق',    one: 'دقيقة واحدة',  two: 'دقيقتان',     twoOblique: 'دقيقتين',    few: 'دقائق',      many: 'دقيقة',      other: 'دقيقة' },
    hour:     { gender: 'f', human: false, zero: 'لا ساعات',    one: 'ساعة واحدة',   two: 'ساعتان',      twoOblique: 'ساعتين',     few: 'ساعات',      many: 'ساعة',       other: 'ساعة' },
    day:      { gender: 'm', human: false, zero: 'لا أيام',     one: 'يوم واحد',     two: 'يومان',       twoOblique: 'يومين',      few: 'أيام',       many: 'يومًا',      other: 'يوم' },
    month:    { gender: 'm', human: false, zero: 'لا أشهر',     one: 'شهر واحد',     two: 'شهران',       twoOblique: 'شهرين',      few: 'أشهر',       many: 'شهرًا',      other: 'شهر' },
    kilo:     { gender: 'm', human: false, zero: 'لا كيلوغرام', one: 'كيلوغرام',     two: 'كيلوغرامان',  twoOblique: 'كيلوغرامين', few: 'كيلوغرامات', many: 'كيلوغرامًا', other: 'كيلوغرام' },
  };

  /** يضيف اسمًا جديدًا للقاموس أو يستبدل صيغه. */
  function noun(key, forms) {
    NOUNS[key] = Object.assign({}, NOUNS[key], forms);
    return NOUNS[key];
  }

  /**
   * العدد مع تمييزه بالصيغة الصحيحة.
   *   plural(0, 'order')  → لا طلبات
   *   plural(1, 'order')  → طلب واحد
   *   plural(2, 'order')  → طلبان
   *   plural(5, 'order')  → ٥ طلبات
   *   plural(11, 'order') → ١١ طلبًا
   *   plural(100,'order') → ١٠٠ طلب
   *
   * خيار { showNumber: true } يُظهر الرقم حتى في ٠ و١ و٢ (للجداول والعدّادات
   * حيث يُقرأ الرقم لا الجملة): «٢ طلبات» تصبح «٢ طلبان» مع الرقم ظاهرًا.
   *
   * خيار { case: 'oblique' } للمثنّى بعد حرف جر: «قبل دقيقتين» لا «قبل دقيقتان».
   */
  function plural(n, key, options) {
    const opts = options || {};
    const forms = typeof key === 'object' ? key : NOUNS[key];
    if (!forms) throw new Error('arabic-kit: اسم غير معروف في القاموس: ' + key);
    const cat = pluralCategory(n);
    let word = forms[cat] != null ? forms[cat] : forms.other;
    if (cat === 'two' && opts.case === 'oblique' && forms.twoOblique) word = forms.twoOblique;
    // zero/one/two صيغ مكتفية بذاتها، فلا يسبقها رقم إلا عند طلب ذلك صراحةً
    const standalone = cat === 'zero' || cat === 'one' || cat === 'two';
    if (standalone && !opts.showNumber) return word;
    if (standalone && opts.showNumber && cat === 'zero') return number(0) + ' ' + forms.few;
    return number(n) + ' ' + word;
  }

  /**
   * الصفات. لكل صفة صيغ المفرد بالمذكّر (`m`) والمؤنّث (`f`)، وصيغة جمع
   * المذكّر السالم (`pm`) لوصف جمع العاقل، وصيغة جمع غير العاقل (`nh`) وهي
   * المفرد المؤنث كما تقتضي القاعدة.
   */
  const ADJECTIVES = {
    active: {
      m: { one: 'نشط', two: 'نشطان', twoOblique: 'نشطين', many: 'نشطًا', other: 'نشط' },
      f: { one: 'نشطة', two: 'نشطتان', twoOblique: 'نشطتين', many: 'نشطة', other: 'نشطة' },
      pm: 'نشطين', nh: 'نشطة',
    },
    shown: {
      m: { one: 'ظاهر', two: 'ظاهران', twoOblique: 'ظاهرين', many: 'ظاهرًا', other: 'ظاهر' },
      f: { one: 'ظاهرة', two: 'ظاهرتان', twoOblique: 'ظاهرتين', many: 'ظاهرة', other: 'ظاهرة' },
      pm: 'ظاهرين', nh: 'ظاهرة',
    },
    pending: {
      m: { one: 'معلّق', two: 'معلّقان', twoOblique: 'معلّقين', many: 'معلّقًا', other: 'معلّق' },
      f: { one: 'معلّقة', two: 'معلّقتان', twoOblique: 'معلّقتين', many: 'معلّقة', other: 'معلّقة' },
      pm: 'معلّقين', nh: 'معلّقة',
    },
  };

  /** يضيف صفة جديدة للقاموس أو يستبدل صيغها. */
  function adjective(key, forms) {
    ADJECTIVES[key] = Object.assign({}, ADJECTIVES[key], forms);
    return ADJECTIVES[key];
  }

  /**
   * عدد + اسم + صفة متوافقة معه في الجنس والعدد والعقل:
   *   describe(2, 'order', 'active')  → طلبان نشطان
   *   describe(5, 'order', 'active')  → ٥ طلبات نشطة      (جمع غير عاقل ← مفرد مؤنث)
   *   describe(5, 'agent', 'shown')   → ٥ مندوبين ظاهرين  (جمع عاقل ← جمع)
   *   describe(0, 'agent', 'shown')   → لا مندوبين ظاهرين
   */
  function describe(n, key, adjKey, options) {
    const opts = options || {};
    const nounForms = typeof key === 'object' ? key : NOUNS[key];
    const head = plural(n, key, opts);
    const adj = typeof adjKey === 'object' ? adjKey : ADJECTIVES[adjKey];
    if (!adj || !nounForms) return head;

    const cat = pluralCategory(n);
    const gender = nounForms.gender === 'f' ? 'f' : 'm';
    const human = !!nounForms.human;
    const singular = adj[gender] || adj.m || {};

    let word;
    if (cat === 'zero' || cat === 'few') {
      // الجمع: العاقل يوصف بجمعه، وغير العاقل بمفرد مؤنث
      word = human ? adj.pm : adj.nh;
    } else if (cat === 'two') {
      word = (opts.case === 'oblique' && singular.twoOblique) ? singular.twoOblique : singular.two;
    } else {
      word = singular[cat] != null ? singular[cat] : singular.other;
    }
    return word ? head + ' ' + word : head;
  }

  /* ————————————————————————— الوقت والتاريخ ————————————————————————— */

  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function asDate(value) {
    return value instanceof Date ? value : new Date(value);
  }

  /** الوقت بنظام ١٢ ساعة: time(d) → ٠٩:٤٢ صباحًا */
  function time(value) {
    const d = asDate(value);
    if (isNaN(d)) return '';
    const h24 = d.getHours();
    const period = h24 < 12 ? 'صباحًا' : (h24 < 18 ? 'ظهرًا' : 'مساءً');
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return digits(String(h12).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')) + ' ' + period;
  }

  /** التاريخ: date(d) → ١٢ أغسطس ٢٠٢٦ */
  function date(value, withWeekday) {
    const d = asDate(value);
    if (isNaN(d)) return '';
    const body = digits(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + digits(d.getFullYear());
    return withWeekday ? WEEKDAYS[d.getDay()] + '، ' + body : body;
  }

  /** التاريخ والوقت معًا. */
  function dateTime(value) {
    const d = asDate(value);
    if (isNaN(d)) return '';
    return date(d) + ' — ' + time(d);
  }

  /**
   * وقت نسبي بصيغ الجمع الصحيحة:
   *   since(الآن)          → الآن
   *   since(قبل دقيقتين)   → قبل دقيقتين
   *   since(قبل ٥ دقائق)   → قبل ٥ دقائق
   *   since(بعد ٣ ساعات)   → بعد ٣ ساعات
   */
  function since(value, nowMs) {
    const d = asDate(value);
    if (isNaN(d)) return '';
    const deltaMs = (nowMs == null ? Date.now() : nowMs) - d.getTime();
    const future = deltaMs < 0;
    const prefix = future ? 'بعد ' : 'قبل ';
    const mins = Math.abs(deltaMs) / 60000;
    // «قبل» و«بعد» حرفا جر، فالمثنّى بعدهما مجرور: قبل دقيقتين لا قبل دقيقتان
    const oblique = { case: 'oblique' };

    if (mins < 1) return 'الآن';
    if (mins < 60) return prefix + plural(Math.round(mins), 'minute', oblique);
    const hours = mins / 60;
    if (hours < 24) return prefix + plural(Math.round(hours), 'hour', oblique);
    const days = hours / 24;
    if (days < 30) return prefix + plural(Math.round(days), 'day', oblique);
    return prefix + plural(Math.round(days / 30), 'month', oblique);
  }

  /** مدة مقروءة من عدد دقائق. duration(95) → ساعة واحدة و٣٥ دقيقة */
  function duration(totalMinutes) {
    const total = Math.max(0, Math.round(Number(totalMinutes) || 0));
    if (total === 0) return plural(0, 'minute');
    const h = Math.floor(total / 60);
    const m = total % 60;
    const parts = [];
    if (h) parts.push(plural(h, 'hour'));
    if (m) parts.push(plural(m, 'minute'));
    return list(parts);
  }

  /* ————————————————————————————— النصوص ————————————————————————————— */

  /** يربط عناصر بفواصل عربية وواو قبل الأخير: list(['أ','ب','ج']) → أ، ب وج */
  function list(items) {
    const arr = (items || []).filter((x) => x != null && x !== '');
    if (arr.length === 0) return '';
    if (arr.length === 1) return String(arr[0]);
    return arr.slice(0, -1).join('، ') + ' و' + arr[arr.length - 1];
  }

  /**
   * يحمي نصًّا لاتينيًّا داخل جملة عربية من انقلاب اتجاهه — مثل أرقام
   * الهواتف وأكواد الطلبات، حيث تقفز علامة + أو # إلى الطرف الخاطئ.
   *
   * ── لماذا لا تكفي LRM ───────────────────────────────────────────────
   * كانت تضع علامة LRM (U+200E) وحدها، **وهي لا تفعل شيئًا هنا**. قِيس
   * موضع «+» بالبكسل في صفحةٍ عربية: بقيت في يمين الأرقام كما لو لم تكن
   * العلامة. وسببه أنّ LRM علامةٌ محايدةُ الحدّ تؤثّر في ترتيب المحايدات
   * حولها، ولا تعزل ما بعدها ولا تفرض عليه اتجاهًا — والأرقام العربية
   * الهندية صنفُها «رقم عربي» فتبقى «+» تابعةً للفقرة لا للرقم.
   *
   * والعزل الصريح (U+2066 … U+2069) يفعل: يجعل ما بينهما نصًّا مستقلًّا
   * اتجاهه يسار، فتقع «+» في مبتدئه. جُرّبت خمسة أساليب وقِيست بالبكسل،
   * فسقطت LRM وحدها ونجح العزل ونظائره في الوسوم. واختير العزل لأنّه
   * محارف لا وسوم: يعمل في الصفحة وفي البريد وفي رسالة واتساب سواء.
   */
  function ltr(text) {
    return LRI + String(text) + PDI;
  }

  /** يزيل التشكيل والتطويل — للبحث والمقارنة لا للعرض. */
  function normalize(text) {
    return String(text)
      .replace(/[ً-ْٰـ]/g, '')  // تشكيل وتطويل
      .replace(/[إأآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .trim();
  }

  /** مقارنة نصين عربيين بتجاهل التشكيل واختلاف الهمزات. */
  function looseEqual(a, b) {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
  }

  return {
    // أرقام
    digits, toLatin, number, money, percent,
    // جمع
    pluralCategory, plural, describe, noun, adjective, NOUNS, ADJECTIVES,
    // وقت
    time, date, dateTime, since, duration, MONTHS, WEEKDAYS,
    // نصوص
    list, ltr, normalize, looseEqual,
    // ثوابت مفيدة
    DECIMAL, THOUSANDS, LRM, LRI, PDI,
  };
});
