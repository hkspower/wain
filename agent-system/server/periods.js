'use strict';
/**
 * الفترات الزمنية التي تُسأل عنها فعلًا.
 *
 * ── الأسبوع يبدأ الأحد ──────────────────────────────────────────────
 * أسبوع العمل في الكويت من الأحد إلى الخميس، والمحاسبة أسبوعية. ولو
 * حُسب الأسبوع من الاثنين — وهو ما تفعله أكثر المكتبات — لوقع يوما عمل
 * كاملان (الأحد والاثنين) في أسبوعين مختلفين، فيسأل المدير عن «هذا
 * الأسبوع» يوم الأحد فيُجاب عن أسبوع مضى.
 *
 * ── الحدّ الأدنى مضبوط، والأعلى مفتوح ──────────────────────────────
 * كل فترة تُعطي لحظة بدايتها فقط، ويبقى «إلى الآن» ضمنًا — إلّا «أمس»
 * فلها نهاية، وإلّا لابتلعت اليوم كلّه معها.
 */

/** بداية يومٍ ما بتوقيت الجهاز */
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * الفترات المعروفة. كل واحدة تحمل مفاتيحها كما تُقال، واسمها في الجواب،
 * ودالّةً تعطي مداها من تاريخ مرجعيّ (يُمرَّر ليكون الاختبار ممكنًا).
 */
const PERIODS = [
  {
    id: 'today',
    label: 'اليوم',
    keys: ['اليوم', 'اليومين', 'هاليوم'],
    range: (now) => ({ from: startOfDay(now), to: null }),
  },
  {
    id: 'yesterday',
    label: 'أمس',
    keys: ['امس', 'البارحه', 'امبارح'],
    range: (now) => {
      const start = startOfDay(now);
      const from = new Date(start);
      from.setDate(from.getDate() - 1);
      return { from, to: start };          // ينتهي عند بداية اليوم
    },
  },
  {
    id: 'week',
    label: 'هذا الأسبوع',
    keys: ['الاسبوع', 'هذا الاسبوع', 'هالاسبوع', 'اسبوعيا', 'الاسبوعيه', 'اسبوع'],
    range: (now) => {
      const from = startOfDay(now);
      from.setDate(from.getDate() - from.getDay());   // ٠ = الأحد
      return { from, to: null };
    },
  },
  {
    id: 'month',
    label: 'هذا الشهر',
    keys: ['الشهر', 'هذا الشهر', 'هالشهر', 'شهريا', 'الشهريه'],
    range: (now) => {
      const from = startOfDay(now);
      from.setDate(1);
      return { from, to: null };
    },
  },
];

/**
 * يقرأ الفترة المذكورة في السؤال.
 * يعيد `{ id, label, from, to }`، أو الافتراضيّة إن لم تُذكر فترة.
 *
 * ولا تُخمَّن فترة من غير لفظها: «كم طلب» بلا زمن تعني اليوم، وهو أضيق
 * الاحتمالات وأقلّها إدهاشًا — لا الشهر ولا العمر كلّه.
 */
function readPeriod(words, now = new Date(), fallback = 'today') {
  const has = (phrase) => {
    const parts = phrase.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        const w = words[i + j];
        if (w !== parts[j] && w !== 'ال' + parts[j]) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  };

  /* الأخصّ أوّلًا: «هذا الأسبوع» قبل «اليوم» لو ذُكرا معًا لا يقع، لكن
     ترتيب الأطول أضمن حين تتداخل الألفاظ. */
  for (const p of [...PERIODS].sort((a, b) => b.id.length - a.id.length)) {
    if (p.keys.some(has)) return { id: p.id, label: p.label, ...p.range(now) };
  }
  const def = PERIODS.find((p) => p.id === fallback);
  return { id: def.id, label: def.label, ...def.range(now) };
}

/** شرط SQL على عمود تاريخ، ومعه وسائطه */
function sqlFor(range, column) {
  const where = [`${column} >= ?`];
  const args = [range.from.toISOString()];
  if (range.to) { where.push(`${column} < ?`); args.push(range.to.toISOString()); }
  return { sql: where.join(' AND '), args };
}

module.exports = { PERIODS, readPeriod, sqlFor, startOfDay };
