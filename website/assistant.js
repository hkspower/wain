/**
 * «مساعد موصول» — يجيب أسئلة الزبائن الشائعة، ويحيل ما عداها إلى إنسان.
 *
 * ── قاعدة واحدة تحكم كل شيء: لا رقم ──────────────────────────────────
 * الأرقام التجارية في الموقع تقديرية موضوعة للاتساق الداخلي لا كالتزامات
 * (راجع website/README.md). ووكيلٌ يقتبسها للزبون يحوّل التقدير إلى وعد،
 * والوعد إلى خصومة يوم يخلفه الواقع. فالمساعد **لا يذكر رقمًا البتّة**:
 * لا سعرًا ولا وقتًا ولا نسبة ولا وزنًا ولا حتى سنة موديل. كل سؤال رقمي
 * يذهب إلى واتساب.
 *
 * وهذه ليست نيّة بل شرط يفرضه البناء: `tools/check-assistant.mjs` يرفض
 * الإصدار إن وجد رقمًا واحدًا في أي جواب. النيّة تُنسى، والحارس لا يُنسى.
 *
 * ── وما لا يعرفه لا يخمّنه ────────────────────────────────────────────
 * لا مطابقة تقريبية تُخرج جوابًا «قريبًا». إن لم يبلغ السؤال عتبة ثقة
 * واضحة، يقول المساعد إنه لا يعرف ويعطي طريق الإنسان. جوابٌ خاطئ بثقة
 * أسوأ من لا جواب.
 */
(function () {
  'use strict';

  /* تطبيع عربي: يزيل التشكيل ويوحّد الألف والياء والتاء المربوطة، فيطابق
     «كم السعر» و«كم السّعر؟» و«چم السعر» بلا قوائم إملاء طويلة. */
  function normalize(s) {
    return String(s || '')
      .replace(/[ً-ْـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ؤئ]/g, 'ء')
      .replace(/چ/g, 'ج')
      .replace(/[^ء-يa-zA-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  var WA = 'https://wa.me/96590000000';

  /* كل جواب مربوط بمصدره في الصفحة، فمن يعدّل النصّ يعرف ما يتبعه. */
  var TOPICS = [
    {
      id: 'what',
      keys: ['ايش موصول', 'وش موصول', 'ما هي موصول', 'من انتم', 'وش تسوون', 'الخدمه', 'ايش تقدمون'],
      q: 'ما هي موصول؟',
      a: 'موصول وسيط بين الزبون والكابتن: نربطك بكابتن معتمد يملك سيارته الخاصة ليوصّل طلبك داخل الكويت. لا نملك أسطولًا ولا نوظّف سائقين.',
      src: '#hero',
    },
    {
      id: 'coverage',
      keys: ['وين توصلون', 'المناطق', 'التغطيه', 'تغطون', 'المحافظات', 'توصلون منطقتي'],
      q: 'أين تصلون؟',
      a: 'نغطي محافظات الكويت كلها. اختر محافظتك في قسم «مناطق التغطية» لترى المناطق المشمولة فيها.',
      src: '#coverage',
    },
    {
      id: 'price',
      keys: ['كم السعر', 'السعر', 'الاسعار', 'كم يكلف', 'التكلفه', 'الرسوم', 'كم عليه', 'كم تاخذون'],
      q: 'كم تكلفة التوصيل؟',
      a: 'السعر يختلف حسب المحافظة ونوع السيارة وحجم الشحنة. تواصل معنا على واتساب وسنعطيك السعر الدقيق لطلبك قبل أن تؤكّده.',
      handoff: true,
      src: '#pricing',
    },
    {
      id: 'time',
      keys: ['كم ياخذ', 'الوقت', 'متى يوصل', 'كم مده', 'سرعه التوصيل', 'كم يستغرق', 'وقت التوصيل'],
      q: 'كم يستغرق التوصيل؟',
      a: 'الوقت يعتمد على المسافة بين الاستلام والتسليم وحركة المرور وقت الطلب. راسلنا على واتساب بالعنوانين ونعطيك الوقت المتوقّع لطلبك.',
      handoff: true,
      src: '#faq',
    },
    {
      id: 'pay',
      keys: ['الدفع', 'ادفع', 'كي نت', 'كاش', 'نقدا', 'طرق الدفع', 'تحويل بنكي', 'فيزا'],
      q: 'ما طرق الدفع؟',
      a: 'نقبل الدفع نقدًا وكي نت عند الاستلام، والتحويل البنكي للشركات والمتاجر ذات العقود الشهرية.',
      src: '#faq',
    },
    {
      id: 'buyforme',
      keys: ['اشتري لي', 'تشترون', 'شراء الطلب', 'يشتري السائق', 'تشتري عني'],
      q: 'هل يشتري الكابتن الطلب نيابةً عني؟',
      a: 'نعم، خدمة «اشترِ لي» متاحة: يدفع الكابتن قيمة المشتريات وتسدّدها له عند التسليم مع رسوم خدمة. راسلنا على واتساب لتفاصيل الرسوم على طلبك.',
      handoff: true,
      src: '#faq',
    },
    {
      id: 'insurance',
      keys: ['التامين', 'مؤمنه', 'مؤمن', 'ضمان', 'لو انكسر', 'لو ضاع', 'تلف الشحنه'],
      q: 'هل الشحنات مؤمَّنة؟',
      a: 'نعم، الشحنات مؤمَّنة، وللشحنات ذات القيمة العالية يمكن طلب تغطية إضافية عند تأكيد الطلب. راسلنا على واتساب لمعرفة حدود التغطية.',
      handoff: true,
      src: '#faq',
    },
    {
      id: 'absent',
      keys: ['ما احد موجود', 'المستلم مو موجود', 'ما رد', 'لو ما كان موجود', 'ما استلم'],
      q: 'ماذا لو لم يكن المستلم موجودًا؟',
      a: 'ينتظر الكابتن مدةً قصيرة ثم يتواصل معك لتحديد الإجراء. وإن تعذّر التسليم تُعاد الشحنة إلى نقطة الاستلام مقابل رسوم. راسلنا على واتساب للتفاصيل.',
      handoff: true,
      src: '#faq',
    },
    {
      id: 'store',
      keys: ['متجري', 'المتجر', 'ربط', 'api', 'واجهه برمجيه', 'شوبيفاي', 'سله', 'زد'],
      q: 'كيف أربط متجري بموصول؟',
      a: 'نوفّر واجهة برمجية وإضافات لمنصات المتاجر الشائعة. بعد الاشتراك في باقة المتاجر يصلك مفتاح الوصول ولوحة تحكم لإنشاء الشحنات ومتابعتها. راسلنا على واتساب لبدء الربط.',
      handoff: true,
      src: '#faq',
    },
    {
      id: 'cold',
      keys: ['مبرد', 'تبريد', 'ثلاجه', 'مواد غذاءيه', 'ادويه', 'حلويات'],
      q: 'هل يوجد توصيل مبرّد؟',
      a: 'نعم، لدينا خيار السيارة المبرّدة للمواد الغذائية الطازجة والحلويات والأدوية التي تحتاج سلسلة تبريد.',
      src: '#fleet',
    },
    {
      id: 'track',
      keys: ['اتابع', 'التتبع', 'وين طلبي', 'اين طلبي', 'رابط التتبع', 'اتتبع'],
      q: 'كيف أتابع طلبي؟',
      a: 'يصلك رابط تتبّع خاص بطلبك على واتساب فور إسناده لكابتن، تتابع منه حالة الشحنة حتى التسليم.',
      src: '#track',
    },
    {
      id: 'join',
      keys: ['ابغى اشتغل', 'انضم', 'كابتن', 'وظيفه', 'اشتغل معكم', 'التسجيل كسائق', 'ابي اشتغل'],
      q: 'كيف أنضم كابتن؟',
      a: 'الانضمام يشترط أن تملك سيارتك الخاصة وأن تكون حديثة الموديل، وأن تجتاز مقابلة شخصية قبل الاعتماد. راسلنا على واتساب لنبدأ معك.',
      handoff: true,
      src: '#hero',
    },
    {
      id: 'hours',
      keys: ['متى تشتغلون', 'الدوام', 'اوقات العمل', 'تشتغلون الجمعه', 'تفتحون'],
      q: 'ما أوقات العمل؟',
      a: 'نعمل يوميًا. أوقات الدوام مكتوبة في أعلى الصفحة، وإن كان طلبك خارجها فراسلنا على واتساب ونرى ما يمكن عمله.',
      handoff: true,
      src: '#hero',
    },
    {
      id: 'contact',
      keys: ['ابغى اكلم', 'موظف', 'رقمكم', 'اتصال', 'تواصل', 'خدمه العملاء', 'شكوى', 'ابي احد'],
      q: 'كيف أتواصل معكم؟',
      a: 'أسرع طريق هو واتساب — يردّ عليك فريق خدمة العملاء. وتجد وسائل التواصل كلها في قسم «اطلب كابتن موصول» أسفل الصفحة.',
      handoff: true,
      src: '#order',
    },
  ];

  var FALLBACK =
    'ما عندي جواب موثوق عن هذا. لا أحبّ أن أخمّن عليك — راسلنا على واتساب ' +
    'ويجيبك أحد من الفريق مباشرةً.';

  /* ------------------------------ المطابقة ------------------------------ */

  /* سؤال الموضوع المعروض هو بالتعريف صياغة صحيحة له، فيُضاف إلى مفاتيحه
     تلقائيًّا — بدل الاعتماد على أن يتذكّر المحرّر تكراره في القائمة. */
  var PREPPED = TOPICS.map(function (t) {
    var keys = t.keys.concat([t.q]).map(normalize).filter(Boolean);
    return {
      t: t,
      phrases: keys.filter(function (k) { return k.indexOf(' ') !== -1; }),
      words: keys.filter(function (k) { return k.indexOf(' ') === -1 && k.length >= 3; }),
    };
  });

  /**
   * المطابقة بالكلمة الكاملة لا بالجزء.
   *
   * المطابقة الجزئية كانت تجعل «موظف» تُصيب داخل «موظفيكم»، فيردّ المساعد
   * على «كم عدد موظفيكم» بجواب عن التواصل. كلمة داخل كلمة ليست الكلمة.
   */
  function match(input) {
    var q = normalize(input);
    if (q.length < 3) return null;
    var toks = q.split(' ');

    var best = null;
    var bestScore = 0;
    PREPPED.forEach(function (p) {
      var score = 0;
      p.phrases.forEach(function (k) { if (q.indexOf(k) !== -1) score += 10; });
      p.words.forEach(function (w) { if (toks.indexOf(w) !== -1) score += 5; });
      if (score > bestScore) { bestScore = score; best = p.t; }
    });

    // عتبة: عبارة كاملة أو كلمة دالّة كاملة. دونها لا نجيب بل نحيل.
    return bestScore >= 5 ? best : null;
  }

  /* ------------------------------ الواجهة ------------------------------ */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function build() {
    var panel = el('div', 'asst');
    panel.id = 'asst';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'مساعد موصول');
    panel.hidden = true;

    var head = el('div', 'asst__head');
    head.appendChild(el('b', null, 'مساعد موصول'));
    var close = el('button', 'asst__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'إغلاق المساعد');
    close.innerHTML = '&times;';
    head.appendChild(close);
    panel.appendChild(head);

    var log = el('div', 'asst__log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    panel.appendChild(log);

    var chips = el('div', 'asst__chips');
    panel.appendChild(chips);

    var form = el('form', 'asst__form');
    var input = el('input', 'asst__input');
    input.type = 'text';
    input.placeholder = 'اكتب سؤالك…';
    input.setAttribute('aria-label', 'اكتب سؤالك');
    input.autocomplete = 'off';
    var send = el('button', 'asst__send', 'إرسال');
    send.type = 'submit';
    form.appendChild(input);
    form.appendChild(send);
    panel.appendChild(form);

    var foot = el('div', 'asst__foot');
    var wa = el('a', 'asst__wa', 'تواصل على واتساب');
    wa.href = WA;
    wa.target = '_blank';
    wa.rel = 'noopener';
    foot.appendChild(wa);
    panel.appendChild(foot);

    document.body.appendChild(panel);
    return { panel: panel, log: log, chips: chips, form: form, input: input, close: close };
  }

  function say(log, who, text, withWa) {
    var row = el('div', 'asst__msg asst__msg--' + who);
    row.appendChild(el('p', null, text));
    if (withWa) {
      var a = el('a', 'asst__inline', 'افتح واتساب');
      a.href = WA;
      a.target = '_blank';
      a.rel = 'noopener';
      row.appendChild(a);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function init() {
    var trigger = document.querySelector('[data-asst-open]');
    if (!trigger) return;

    var ui = build();
    var opened = false;

    function answer(text) {
      say(ui.log, 'me', text);
      var hit = match(text);
      if (hit) say(ui.log, 'bot', hit.a, !!hit.handoff);
      else say(ui.log, 'bot', FALLBACK, true);
    }

    TOPICS.slice(0, 5).forEach(function (t) {
      var b = el('button', 'asst__chip', t.q);
      b.type = 'button';
      b.addEventListener('click', function () { answer(t.q); });
      ui.chips.appendChild(b);
    });

    ui.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = ui.input.value.trim();
      if (!v) return;
      ui.input.value = '';
      answer(v);
    });

    function open() {
      ui.panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      if (!opened) {
        opened = true;
        say(ui.log, 'bot', 'هلا بك. أجاوب على الأسئلة الشائعة عن موصول، وأحوّلك لواتساب في أي شيء يخصّ طلبك أو سعره.');
      }
      ui.input.focus();
    }
    function shut() {
      ui.panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }

    trigger.addEventListener('click', function () {
      if (ui.panel.hidden) open(); else shut();
    });
    ui.close.addEventListener('click', shut);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !ui.panel.hidden) shut();
    });
  }

  // يعمل في المتصفّح، ويُحمَّل في Node بلا DOM ليفحصه حارس البناء
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  // يقرأها حارس البناء ليتحقّق أن لا رقم في أي جواب
  if (typeof module !== 'undefined' && module.exports) module.exports = { TOPICS: TOPICS, FALLBACK: FALLBACK, normalize: normalize, match: match };
})();
