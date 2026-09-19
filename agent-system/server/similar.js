'use strict';
/**
 * «هل تقصد…؟» — الاقتراح ليس تخمينًا.
 *
 * قرّرنا في المستخرِج ألّا يُطابق اسمَ منطقةٍ تطابقًا تقريبيًّا: «السالمي»
 * ليست منطقة، ولا تُملأ على أنها السالمية. ذلك القرار قائم ولم يتغيّر —
 * **لا شيء هنا يملأ حقلًا**.
 *
 * لكنّ الصمت ليس أمانة أيضًا. من كتب «السالمي» يعرف قصده، والنظام يعرف أن
 * «السالمية» على بُعد حرف واحد، فيسكت ويقول «لم أفهم». الفرق بين الأمانة
 * والعجز أن يقول: **«هل تقصد السالمية؟»** ويترك الجواب لصاحبه.
 *
 * فالقاعدة: يُقترح ولا يُطبَّق. الاقتراح سؤال يُعرض، والإنسان يضغطه أو
 * يتجاهله. ولا يخرج اقتراح إلّا إذا كان قريبًا قربًا يُعتدّ به — والاقتراح
 * البعيد أسوأ من لا اقتراح، لأنه يعلّم صاحبه ألّا يثق بالاقتراحات.
 */

const ar = require('arabic-kit');

/**
 * مسافة التحرير بين نصّين (ليفنشتاين): كم إضافةً وحذفًا واستبدالًا يلزم
 * لتحويل أحدهما إلى الآخر.
 */
function distance(a, b) {
  const s = String(a);
  const t = String(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;

  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,                                   // حذف
        cur[j - 1] + 1,                                // إضافة
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)  // استبدال
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

/**
 * أقصى مسافة تُقبل لكلمة بطولٍ معيّن.
 *
 * الكلمة القصيرة يقلبها حرفٌ واحد إلى كلمة أخرى تمامًا («بيان» و«بنيد»)،
 * فتُشدَّد عليها؛ والطويلة تحتمل حرفين. وما فوق ذلك ليس خطأً في الكتابة بل
 * كلمة أخرى.
 */
function allowed(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * أقرب اسم من قائمة، أو `null` إن لم يقترب شيء.
 *
 * تُقارَن الأسماء بعد التطبيع (بلا تشكيل ولا فرق بين ة/ه وأ/ا وى/ي)، لأن
 * تلك فروق كتابة لا فروق كلمات.
 *
 * ويُشترط أن يكون الأقرب **أقرب بوضوح** من الذي يليه: لو تساوى مرشّحان فلا
 * وجه لترجيح أحدهما، وعرض أحدهما اعتباطًا يوهم بيقين لا وجود له.
 */
function closest(input, candidates, { max } = {}) {
  const q = ar.normalize(String(input || '')).toLowerCase().trim();
  if (!q) return null;

  const cap = max !== undefined ? max : allowed(q.length);
  if (cap <= 0) return null;

  const scored = candidates
    .map((name) => ({ name, d: distance(q, ar.normalize(String(name)).toLowerCase()) }))
    .filter((x) => x.d <= cap)
    .sort((a, b) => a.d - b.d);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].d === scored[1].d) return null; // تساوٍ: لا ترجيح
  return scored[0].name;
}

/**
 * أقرب اسم لأي كلمة في الجملة.
 * «وين طلبات السالمي؟» — الاسم المقصود كلمة داخل سؤال، لا السؤال كلّه.
 * يعيد `{ word, name }` — الكلمة كما كتبها صاحبها والاسم المقترح.
 */
function closestInText(text, candidates, opts) {
  const words = String(text || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  /* تُجرَّب الكلمة وحدها ثمّ مع تاليتها: «أبو حليفه» اسمان في الكتابة واحد
     في المعنى، ولا تُقارَن «أبو» وحدها بشيء. */
  const tries = [];
  for (let i = 0; i < words.length; i++) {
    tries.push(words[i]);
    if (words[i + 1]) tries.push(words[i] + ' ' + words[i + 1]);
  }

  /* **حشوُ الكلام لا يُقترح له اسمُ منطقة.**
     قال الزبون «لا أدري» جوابًا عن سؤالٍ، فردّ الوكيل: «"أدري" ليست من
     مناطق الكويت — هل تقصد "الري"؟». وهو سؤالٌ عن كلمةٍ لم يقصد بها مكانًا
     أصلًا، ويجعل الحوار يبدو كمن لا يسمع. والمسافة قصيرة فعلًا («أدري» و
     «الري» حرفان)، فالمقياس لا يخطئ — إنّما يُسأل عمّا لا يُسأل عنه.
     ويأتي المُميِّز من المستدعي (`isFiller`) فلا تعرف هذه الوحدةُ لهجةً. */
  const skip = (opts && opts.skip) || null;

  let best = null;
  for (const w of tries) {
    if (skip && skip(w)) continue;
    const name = closest(w, candidates, opts);
    if (!name) continue;
    const d = distance(ar.normalize(w).toLowerCase(), ar.normalize(name).toLowerCase());
    if (d === 0) return null;                       // مكتوب صحيحًا: لا اقتراح
    if (!best || d < best.d) best = { word: w, name, d };
  }
  return best ? { word: best.word, name: best.name } : null;
}

module.exports = { distance, closest, closestInText, allowed };
