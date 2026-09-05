/* وكيل الطلب على واجهة موصول.
 *
 * ما هو: بابُ استقبالٍ يفهم كلام الزبون ويجمع حقول الطلب ثم يرسله للمكتب.
 * الفهم كلّه في الخادم (`/api/public/order/parse`) — المستخرِج القاعديّ نفسه
 * الذي تستعمله اللوحة: يقترح ولا يخمّن، وما لم يُقَل يبقى فارغًا ويُسأل عنه.
 *
 * الخادم بلا حالة: كلُّ جولةٍ تُرسل الحديثَ كلّه من أوّله، فالتصحيح
 * والإضافة يعملان بالتراكم لا بجلسةٍ محفوظة. والصوت يُلتقط في المتصفّح
 * نفسه (Web Speech) فلا يغادر تسجيلٌ الجهاز — يُرسل النصّ وحده.
 */
(() => {
  'use strict';

  /* عنوان البوّابة. `data-api` يكتبه من ينشر الموقع في صفحته، فهو مأمون.
     أمّا `?api=` فمن الرابط — أي من أيّ أحد.
     كان يُقرأ في كل مكان، وهي ثغرة تسريبٍ كاملة: رابطٌ نصّه
     `https://mawsool.com.kw/?api=https://…` يفتح صفحة موصول بنطاقها
     وشعارها وكلّ ما يطمئن له الزبون، ثم يذهب **كل ما يقوله** — اسمه
     وهاتفه وعنوانا الاستلام والتسليم — إلى خادم صاحب الرابط، ويردّ هو
     بتأكيدٍ مصنوع فلا يشكّ أحد. (جُرّب فعلًا: وصل النصّ كاملًا.)
     فصار التجاوز **للمعاينة المحلّية وحدها**: على أيّ مضيفٍ حقيقيّ
     يُهمَل ولا يُقرأ. */
  const DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1', ''];
  const override = DEV_HOSTS.includes(location.hostname)
    ? new URLSearchParams(location.search).get('api')
    : null;
  const API = override || document.body.dataset.api || '';

  const $ = (id) => document.getElementById(id);
  const hero = $('voHero'), chat = $('voChat'), card = $('voCard');
  const heardEl = $('voHeard'), missingEl = $('voMissing'), submitBtn = $('voSubmit');
  const done = $('voDone'), composer = $('voComposer');
  const mic = $('voMic'), form = $('voForm'), input = $('voInput'), hint = $('voHint');

  /* البوّابة تطلب أربعة لا غير؛ الباقي إثراء يُذكر إن ذُكر */
  const REQUIRED = ['customer_name', 'customer_phone', 'pickup_area', 'dropoff_area'];

  /* السؤال بصيغةٍ يفهمها المستخرِج إذا أُجيب بمثلها — القالب جزء من العقد */
  const ASK = {
    customer_name: 'ما اسمك؟ <b>قل مثلًا: اسمي نورة</b>',
    customer_phone: 'ما رقم هاتفك؟ <b>قل مثلًا: رقمي ٩٩٠٠٠٠٠٠</b>',
    pickup_area: 'من أين نستلم؟ <b>قل مثلًا: الاستلام من السالمية قطعة ٤</b>',
    dropoff_area: 'إلى أين نوصّل؟ <b>قل مثلًا: التسليم في الجابرية قطعة ٧</b>',
  };
  /* ما يُقال إقرارًا بما فُهم — تسميةٌ قصيرة لكل حقل */
  const GOT = {
    customer_name: (f) => `الاسم ${f.customer_name}`,
    /* يُعرض الرقم لا يُقال «رقمك»: الإقرار الذي لا يحمل القيمة لا يُمكّن
       من مراجعتها، والرقم أكثر ما يُخطئ فيه التعرّف على الكلام.
       ويُعزل عزلًا صريحًا (U+2066…U+2069) وإلّا وقعت «+» في يمين الرقم
       فقُرئ «٩٦٥…+». وعلامةُ الاتجاه وحدها (U+200E) لا تكفي — قِيس ذلك
       بالبكسل فلم تُغيّر شيئًا. والخطأ ظهر في الصورة لا في النصّ
       المستخرَج، فالنصّ يحمل العلامة والعين ترى الرقم مقلوبًا. */
    customer_phone: (f) => `رقمك ⁦${arDigits(f.customer_phone)}⁩`,
    pickup_area: (f) => `الاستلام من ${f.pickup_area}${f.pickup_block ? ' قطعة ' + arDigits(f.pickup_block) : ''}`,
    dropoff_area: (f) => `التسليم في ${f.dropoff_area}${f.dropoff_block ? ' قطعة ' + arDigits(f.dropoff_block) : ''}`,
  };
  const arDigits = (n) => String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

  /* حين لا يصل من الدورة شيء: يُقال ذلك صراحةً ومعه المثال — لا يُعاد
     السؤال بنصّه. الزبون الذي يرى سؤاله نفسه خمس مرّات يظنّ الآلة معطوبة،
     والذي يُقال له «ما وصلني رقم» يعرف أنّ عليه أن يكتبه بصيغةٍ أخرى. */
  const MISSED = {
    customer_name: 'ما وصلني اسم. اكتبه هكذا: <b>اسمي نورة</b>',
    customer_phone: 'ما وصلني رقم هاتف. اكتبه بأرقامه: <b>٩٩٠٠٠٠٠٠</b>',
    pickup_area: 'ما وصلتني منطقة استلام. اكتبها هكذا: <b>من السالمية قطعة ٤</b>',
    dropoff_area: 'ما وصلتني منطقة تسليم. اكتبها هكذا: <b>إلى الجابرية قطعة ٧</b>',
  };

  /* الصيغة المختصرة حين يُعاد السؤال نفسه بعد جواب عن سؤال الزبون */
  const ASK_SHORT = {
    customer_name: 'ولنكمل طلبك: ما اسمك؟',
    customer_phone: 'ولنكمل: ما رقم هاتفك؟',
    pickup_area: 'ولنكمل: من أين نستلم؟',
    dropoff_area: 'ولنكمل: إلى أين نوصّل؟',
  };
  /* الجواب القصير يُغلَّف بعنوان الحقل المنتظَر («السالمية» ← «الاستلام من
     السالمية»)، والتغليف **في الخادم** لا هنا: هو قرارٌ يسبق القراءة، ولو
     وقع في المتصفّح أوّلًا لصار سؤالُ الزبون «كم سعر التوصيل؟» كلامًا
     معنونًا «اسمي كم سعر التوصيل» فلا يُعرف سؤالًا بعدها. الخادم يقرّر
     أوّلًا: سؤالٌ يُجاب، أو كلامُ طلبٍ يُغلَّف — ويردّ في `accepted` ما ضمّه
     فعلًا لنحفظه كما استُعمل. */

  const state = {
    utterances: [],     // الحديث كما قيل، بترتيبه
    known: {},          // ما امتلأ حتى الدورة الماضية — ليُقال الجديد وحده
    parsed: null,       // آخر ردّ تحليل
    pendingField: null, // الحقل الذي سُئل عنه آخرًا — لتغليف الجواب القصير
    sending: false,
  };

  /* ------------------------------ العرض ------------------------------ */

  function bubble(kind, html) {
    chat.hidden = false;
    const div = document.createElement('div');
    div.className = `vo-msg vo-msg--${kind}`;
    div.innerHTML = html;
    chat.append(div);
    div.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return div;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* لماذا لا تُؤخذ النواقص من `missing` كما تأتي؟
     لأن غيابها ليس اكتمالًا. قِيس ذلك: من دخل فسأل سؤالين ولم يُملِ طلبًا،
     صار الحديثُ الذي يخصّ الطلب فارغًا، فردّ المستخرِج نقصًا واحدًا هو
     «لا نصّ» — وهو ليس من الحقول الأربعة، فخلت القائمة، فأعلن الوكيل
     «اكتمل الطلب» وأظهر زرّ الإرسال على طلبٍ لا شيء فيه. الاكتمال يُقاس
     بحضور الأربعة لا بغياب شكواها. */
  const WHY = {
    customer_name: 'لم يُذكر اسم صاحب الطلب',
    customer_phone: 'لم يُذكر رقم هاتف كويتي واضح',
    pickup_area: 'لم تُذكر منطقة الاستلام بين مناطق الكويت',
    dropoff_area: 'لم تُذكر منطقة التسليم بين مناطق الكويت',
  };
  function gaps() {
    const p = state.parsed || {};
    const f = p.fields || {};
    const said = p.missing || [];
    return REQUIRED.filter((k) => !f[k])
      .map((k) => said.find((m) => m.field === k) || { field: k, why: WHY[k] });
  }

  function renderCard() {
    const p = state.parsed;
    if (!p) { card.hidden = true; return; }
    const missingReq = gaps();
    if (!p.heard.length && !missingReq.length) { card.hidden = true; return; }
    card.hidden = false;
    heardEl.innerHTML = p.heard.map((h) => `<li>${esc(h)}</li>`).join('');
    missingEl.innerHTML = missingReq.map((m) => `<li>${esc(m.why)}</li>`).join('');
    submitBtn.hidden = missingReq.length !== 0;
  }

  /**
   * **يقول ما فهم قبل أن يسأل عمّا بقي.**
   *
   * كان يسأل ولا يقرّ: قِيس حوارٌ واقعيّ فقال الوكيل «ولنكمل: ما رقم هاتفك؟»
   * **خمس مرّات متتالية** — والزبون في أثنائها أعطى الاستلام، وسأل عن السعر،
   * وأعطى التسليم، وقال اسمه. كلُّ ذلك وصل وامتلأت به البطاقة، ولم يقل
   * الوكيل عنه كلمة. فالزبون لا يدري أوصل كلامُه أم ضاع، فيعيده أو ينصرف.
   *
   * ويُقال ما جدّ في هذه الدورة وحدها لا ما امتلأ من قبل: تكرارُ المعروف
   * ثرثرة، والجديدُ وحده خبر.
   */
  function acknowledge() {
    const f = (state.parsed && state.parsed.fields) || {};
    const gained = REQUIRED.filter((k) => f[k] && !state.known[k]);
    for (const k of REQUIRED) state.known[k] = !!f[k];
    if (!gained.length) return false;
    bubble('agent', 'تمام — ' + esc(gained.map((k) => GOT[k](f)).join('، ')) + '.');
    return true;
  }

  function nextQuestion(gained) {
    const missingReq = gaps();
    if (!missingReq.length) {
      state.pendingField = null;
      bubble('agent', 'اكتمل الطلب. راجع الملخّص ثم اضغط <b>«أرسل الطلب إلى موصول»</b>.');
      /* ويُؤتى بالزرّ إلى العين. الملتقط ملتصقٌ بأسفل الشاشة، وقياسٌ على
         ٣٢٠px وجد الزرّ خلفه تمامًا (٩١٧–٩٧٢ تحت ملتقطٍ يبدأ عند ٨٨٧):
         يقول الوكيل «اضغط أرسل» والزرّ غير مرئيّ ولا مضغوط، ولا يعرف
         الزبون أنّ عليه أن يمرّر. و‎scroll-margin يوقفه فوق الملتقط. */
      /* قفزةٌ لا انزلاق: الانزلاق يُبقي الزرّ يتحرّك تحت الإصبع لحظةً بعد
         أن صار مرئيًّا، فتقع الضغطة على ما تحته. */
      requestAnimationFrame(() => submitBtn.scrollIntoView({ block: 'end' }));
      return;
    }
    /* سؤالٌ معه اقتراح «هل تقصد؟» يتقدّم: جوابه ضغطة زرّ، وتركُه معلّقًا
       يجعل الزبون يجيب عن غيره والخطأ باقٍ. */
    const m = missingReq.find((x) => x.hint || x.choices) || missingReq[0];
    /* سؤالٌ يتكرّر حرفيًّا يُختصر. الزبون الذي يسأل سؤالين قبل أن يُملي
       طلبه كان يرى «ما اسمك؟ قل مثلًا: اسمي نورة» مرّتين بنصّها — والتكرار
       الحرفيّ يقرأ كعطب لا كإلحاح. والنواقص باقية في البطاقة على أي حال. */
    const again = state.pendingField === m.field && !m.hint;
    state.pendingField = m.field;
    /* ثلاث حالات لا واحدة: سؤالٌ أوّل، وسؤالٌ يُعاد وقد وصل شيءٌ غيره
       (فيُختصر)، وسؤالٌ يُعاد ولم يصل شيء (فيُقال إنّه لم يصل). */
    let html = ASK[m.field] || esc(m.why);
    /* و«ما وصلني اسم» لا تُقال لمن سأل سؤالًا: هو لم يحاول أن يجيب، فاتّهامه
       بأنّه أجاب بما لا يُفهم عتبٌ في غير موضعه. تُختصر له وحدها. */
    const wasAsking = !!(state.parsed && (state.parsed.answer || state.parsed.unanswered));
    if (again && !gained && !wasAsking) html = MISSED[m.field] || ASK_SHORT[m.field] || html;
    else if (again) html = ASK_SHORT[m.field] || html;
    /* «هل تقصد…؟» يأتي من الخادم اقتراحًا لا قيمةً — زرٌّ يقبله الزبون */
    if (m.hint) {
      html = `${esc(m.why)}<br><button type="button" class="vo-hintbtn"
        data-hint="${esc(m.hint)}" data-from="${esc(m.hintFrom || '')}">نعم، أقصد ${esc(m.hint)}</button>`;
    } else if (m.choices) {
      /* اسمٌ يحتمل موضعين («السالمي»: منطقةٌ في الجهراء واسمٌ دارج
         للسالمية). الخادم لا يملأ أحدهما ويسأل — والسؤال بلا زرٍّ يُجيبه
         أسوأ من ألّا يُسأل: يرى الزبون سؤالًا لا يعرف كيف يردّ عليه. */
      html = `${esc(m.why)}<br>` + m.choices.map((c, i) =>
        /* المعروض الاسم، والمُرسل ما يفهمه الخادم بلا التباس — وإلّا عاد
           السؤال على نفسه بلا نهاية. */
        `<button type="button" class="vo-hintbtn"
          data-hint="${esc((m.choiceValues && m.choiceValues[i]) || c)}"
          data-from="${esc(m.choiceFrom || '')}">${esc(c)}</button>`).join(' ');
    }
    const b = bubble('agent', html);
    for (const btn of b.querySelectorAll('.vo-hintbtn')) {
      btn.addEventListener('click', () => applyHint(btn.dataset.from, btn.dataset.hint));
    }
  }

  /* ----------------------------- الجولات ----------------------------- */

  /* يُرسَل ما ثبت من الحديث، وآخر ما قيل خامًا، والحقل المنتظَر. الخادم
     يقرأ المناطق بمواضعها من الحديث كلّه، ويجعل الأخيرة تعلو على ما سبقها،
     ويقرّر أهي سؤالٌ يُجاب أم كلامُ طلبٍ يُضمّ. */
  async function parseAll(latest = '') {
    const res = await fetch(`${API}/api/public/order/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        utterances: state.utterances,
        latest,
        pending: state.pendingField || '',
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'تعذّر الاتصال');
    state.parsed = await res.json();
  }

  async function turn(text) {
    const raw = text.trim();
    if (!raw || state.sending) return;

    hero.hidden = true;
    bubble('user', esc(raw));
    try {
      await parseAll(raw);
    } catch (err) {
      bubble('agent', `${esc(err.message)} — أعد المحاولة بعد لحظة.`);
      return;
    }

    /* ما ضمّه الخادم إلى الطلب يُحفظ كما ضمّه. والسؤال لا يُحفظ أصلًا —
       وهذا هو الفرق بين وكيلٍ يجيب وآخر يبتلع كلَّ ما يُقال طلبًا. */
    if (state.parsed.accepted) state.utterances.push(state.parsed.accepted);

    if (state.parsed.answer) {
      answerBubble(state.parsed.answer);
      renderCard();
      nextQuestion(acknowledge());   // يعود إلى ما كان يسأل عنه، فلا يضيع خيط الطلب
      return;
    }
    if (state.parsed.unanswered) {
      bubble('agent', `${esc(state.parsed.unanswered)} ${WA_LINK}`);
      renderCard();
      nextQuestion(acknowledge());
      return;
    }

    renderCard();
    nextQuestion(acknowledge());
  }

  const WA_LINK = '<a href="https://wa.me/96590000000" target="_blank" rel="noopener">واتساب</a>';

  /** جواب من معرفة موصول. ما وُسم بالإحالة يُذيَّل بطريق الإنسان. */
  function answerBubble(a) {
    bubble('agent', esc(a.answer) + (a.handoff
      ? `<br><span class="vo-msg__aside">للتفصيل الدقيق: ${WA_LINK}</span>` : ''));
  }

  /* تصحيح «هل تقصد…؟»: الكلمة الخاطئة تُستبدل في الحديث نفسه ثم يُعاد
     التحليل — لو أُلحقت الصحيحةُ إلحاقًا لبقيت الخاطئة تُقرأ معها. */
  async function applyHint(from, hintName) {
    bubble('user', `نعم، أقصد ${esc(hintName)}`);
    try {
      if (from) {
        state.utterances = state.utterances.map((u) => u.split(from).join(hintName));
        await parseAll();
      } else {
        /* بلا كلمةٍ تُستبدل: الاسم يُقال جملةً جديدة، ويضمّها الخادم كما
           يضمّ أي كلام — فلا تُدفع هنا وتُدفع هناك مرّتين. */
        await parseAll(hintName);
        if (state.parsed.accepted) state.utterances.push(state.parsed.accepted);
      }
    } catch { return; }
    renderCard();
    nextQuestion(acknowledge());
  }

  async function submitOrder() {
    if (state.sending || submitBtn.hidden) return;
    state.sending = true;
    submitBtn.disabled = true;
    const f = state.parsed.fields;
    try {
      const res = await fetch(`${API}/api/public/order`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer_name: f.customer_name, customer_phone: f.customer_phone,
          pickup_area: f.pickup_area, pickup_block: f.pickup_block || '',
          pickup_street: f.pickup_street || '',
          dropoff_area: f.dropoff_area, dropoff_block: f.dropoff_block || '',
          dropoff_street: f.dropoff_street || '',
          cod_amount: f.cod_amount || 0,
          vehicle: f.vehicle || 'sedan', priority: f.priority || 'normal',
          notes: f.notes || '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذّر إرسال الطلب');
      showDone(data.order);
    } catch (err) {
      bubble('agent', `${esc(err.message)} — لم يُرسل الطلب. صحّح ثم أعد المحاولة، أو اتصل بنا.`);
      submitBtn.disabled = false;
      state.sending = false;
    }
  }

  function showDone(order) {
    chat.hidden = true; card.hidden = true; composer.hidden = true;
    done.hidden = false;
    done.innerHTML = `
      <div class="vo-done__mark"><svg class="ic" aria-hidden="true"><use href="#i-check"></use></svg></div>
      <h2>وصل طلبك إلى موصول</h2>
      <div class="vo-done__code" dir="ltr">${esc(order.code)}</div>
      <p>من ${esc(order.pickup_address)}<br>إلى ${esc(order.dropoff_address)}</p>
      <p>سيتّصل بك المكتب على رقمك للتأكيد والتسعير، ثم يتحرّك الكابتن.
         احفظ رمز الطلب لأيّ متابعة.</p>
      <button class="btn btn--primary" type="button" id="voAgain">اطلب توصيلًا آخر</button>`;
    $('voAgain').addEventListener('click', () => location.reload());
    done.scrollIntoView({ block: 'center' });
  }

  /* ------------------------------ الصوت ------------------------------ */

  /* الالتقاط الصوتي في المتصفّح نفسه: لا يغادر تسجيلٌ الجهاز، ويُرسل النصّ
     وحده. وهذه الواجهة أخشنُ ممّا تبدو، فما يلي مكتوبٌ على سلوكها الفعليّ
     لا على وصفها:

     ١. **`continuous` مطفأةٌ افتراضًا**، فينتهي الالتقاط عند أوّل سكتة.
        والزبون يسكت بين جُمَله طبعًا — «ودي أوصل أغراض…» ثم يفكّر — فكان
        الطلب يُقطع عند أوّل شطر ويُرسل ناقصًا وينطفئ الزرّ. وهذا وحده
        يجعل الصوت يبدو معطوبًا وإن كان كل سطرٍ فيه صحيحًا.
     ٢. **`end` يقع بعد `error` أيضًا** (هكذا تنصّ الواجهة). فكان معالجُ
        النهاية يمسح رسالة الخطأ التي يحتاجها الزبون ويرسل ما في الحقل.
     ٣. **كروم ينهي الجلسة على السكوت** حتى مع `continuous`، فيلزم استئنافٌ
        صامت ما دام الزبون لم يطلب الإيقاف — وبحدٍّ لئلّا تدور الحلقة أبدًا.
     ٤. **قائمة النتائج تُصفَّر مع كل جلسة**، فما ثبت في جلسةٍ سابقة يُحفظ
        عندنا وإلّا ضاع عند أوّل استئناف.
     ٥. **الواجهة تحتاج سياقًا آمنًا** (HTTPS). وعلى نشرٍ بلا شهادة يظهر
        الزرّ ويَعِد بما لا يستطيع: يضغطه الزبون فلا يقع شيء. */

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  /* الصفحة بلا نصٍّ ساكن، فالسطر تحت الملتقط يبقى فارغًا في السكون.
     ولا يُترك أبدًا: الالتقاط يقول فيه أنه يسمع، والخطأ يقول فيه سببه —
     وذلك بيانُ حالٍ لا كتيّب. */
  const IDLE_HINT = '';
  const MAX_RESTARTS = 20;      // ‏استئنافٌ صامت بعد سكوتٍ يُنهيه المتصفّح
  const MAX_SESSION_MS = 90_000; // ميكروفونٌ منسيّ لا يبقى مفتوحًا للأبد

  if (!SR) {
    mic.hidden = true;
    hint.textContent = 'متصفّحك لا يدعم الإدخال الصوتي — اكتب طلبك كتابةً.';
  } else if (!window.isSecureContext) {
    /* لا يُعرض زرٌّ لا يعمل: الواجهة تشترط سياقًا آمنًا، فبلا HTTPS تفشل
       بلا رسالة. الكتابة تبقى الطريق الكامل. */
    mic.hidden = true;
    hint.textContent = 'الإدخال الصوتي يحتاج اتصالًا آمنًا (HTTPS) — اكتب طلبك كتابةً.';
  } else {
    const rec = new SR();
    rec.lang = 'ar-KW';
    rec.interimResults = true;
    rec.continuous = true;
    if ('maxAlternatives' in rec) rec.maxAlternatives = 1;

    let listening = false;   // الزبون يريد الاستماع
    let stopping = false;    // ضغط الإيقاف: ننهي عند `end`
    let failed = false;      // وقع خطأ: لا يمسح `end` رسالته ولا يرسل
    let committed = '';      // ما ثبت في جلساتٍ سابقة (تُصفَّر قائمة النتائج)
    let restarts = 0;
    let deadline = 0;

    const setIdle = (msg) => {
      listening = false; stopping = false;
      mic.setAttribute('aria-pressed', 'false');
      mic.setAttribute('aria-label', 'تكلّم بطلبك');
      hint.classList.remove('is-listening');
      hint.textContent = msg || IDLE_HINT;
    };

    /* **المساحة وحدها هي ما يُرسل — لا هي و`committed` معًا.**
       كان هنا `committed + ' ' + input.value`، و`committed` مكتوبٌ أصلًا
       في المساحة (انظر معالج `result` تحته). فكان كلّ ما سُمع قبل السكتة
       يُرسل مرّتين. وقيس على الجلسة كما يجريها المتصفّح:

         «ودي أطرش أغراض من حولي» ‹سكتة› «للفحيحيل»
         → «ودي أطرش أغراض من حولي ودي أطرش أغراض من حولي للفحيحيل»

       والسكتة بين الجملتين هي الحال الغالبة لا النادرة — بل هي سببُ آلة
       الاستئناف كلّها. ومثلها من كتب نصف طلبه ثمّ أكمله نطقًا: يُضاعَف
       المكتوب. و`committed` ليس مصدرًا ثانيًا للنصّ، إنّما ذاكرةٌ تُعيد
       بناء المساحة بعد أن تُصفَّر قائمة نتائج المتصفّح. */
    const finish = () => {
      const said = input.value.trim().replace(/\s+/g, ' ');
      committed = ''; restarts = 0; input.value = ''; baseH();
      if (said) turn(said);
    };

    rec.addEventListener('result', (e) => {
      let t = '';
      for (const r of e.results) t += r[0].transcript;
      /* المعروض = ما ثبت سابقًا + ما تُسمعه هذه الجلسة */
      input.value = (committed ? committed + ' ' : '') + t.trim();
      grow();
    });

    rec.addEventListener('error', (e) => {
      /* «aborted» يقع حين نوقف نحن، و«no-speech» حين تمرّ سكتة — وليسا
         عطبًا يُخبَر به الزبون. ما عداهما يُشرح ويُنهي الجلسة. */
      if (e.error === 'aborted') return;
      if (e.error === 'no-speech' && listening && !stopping) return;
      failed = true;
      setIdle(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'لم يُسمح بالميكروفون — اسمح به من إعدادات المتصفّح، أو اكتب طلبك.'
          : e.error === 'network'
            ? 'تعذّر الاتصال بخدمة التعرّف — اكتب طلبك أو أعد المحاولة.'
            : 'تعذّر الالتقاط — أعد المحاولة أو اكتب طلبك.'
      );
    });

    rec.addEventListener('end', () => {
      /* **الفشل يمنع الإرسال، ولا يمحو شيئًا.**
         كان يُفرّغ المساحة، فمن كتب «اسمي بدر ورقمي ٥٥٥٠١٠٢٠» ثمّ ضغط
         الميكروفون فمُنع الإذن، وجد كتابته قد مُحيت — والرسالة تقول له
         «أو اكتب طلبك» بعد أن أُتلف ما كتب. وكذلك من انقطعت عنه خدمة
         التعرّف بعد جملةٍ صحيحة: تُمحى الجملة. فما في المساحة يبقى
         للزبون يصحّحه أو يرسله بيده، و`committed` وحده يُصفَّر لأن
         المساحة صارت هي المصدر الوحيد. */
      if (failed) { failed = false; committed = ''; return; }

      /* أنهى المتصفّح الجلسة والزبون لم يطلب ذلك: نُثبّت ما سُمع ونستأنف
         بصمت، فلا ينقطع الطلب عند سكتةٍ بين جملتين. */
      if (listening && !stopping && restarts < MAX_RESTARTS && Date.now() < deadline) {
        committed = input.value.trim();
        restarts++;
        try { rec.start(); return; } catch { /* تعذّر الاستئناف: نُنهي */ }
      }
      setIdle(listening && !stopping ? 'انتهى وقت الالتقاط — أُرسل ما سُمع.' : '');
      finish();
    });

    mic.addEventListener('click', () => {
      if (listening) { stopping = true; hint.textContent = 'أُنهي…'; rec.stop(); return; }
      /* لا يُمحى ما كتبه الزبون بيده: يُثبَّت ويُبنى عليه الكلام */
      committed = input.value.trim();
      failed = false; restarts = 0;
      deadline = Date.now() + MAX_SESSION_MS;
      try { rec.start(); } catch { setIdle('تعذّر بدء الالتقاط — أعد المحاولة.'); return; }
      listening = true; stopping = false;
      mic.setAttribute('aria-pressed', 'true');
      mic.setAttribute('aria-label', 'أنهِ الالتقاط');
      hint.classList.add('is-listening');
      hint.textContent = 'أسمعك… تكلّم بطلبك كاملًا، واضغط الزرّ حين تنتهي.';
    });
  }

  /* المساحة تنمو بما فيها إلى سقفها ثم تُمرَّر. تُستدعى بعد كل كتابةٍ
     وبعد كل ما يكتبه الالتقاط الصوتي فيها.

     والسقف يُحسب من **الملتقط كلّه** لا من المساحة وحدها: للملتقط حشوٌ
     وسطرُ تلميحٍ تحته، فسقفٌ على المساحة بنسبةٍ من الشاشة يجعل أسفله يقع
     تحت الطيّة. قِيس ذلك: مساحةٌ بسقف ٤٠vh جعلت أسفل الملتقط عند ٨٩٨ في
     شاشةٍ طولها ٨٤٤. فيُطرح ما ليس مساحةً من الحساب. */
  /** ارتفاع الملتقط الحاليّ إلى الأنماط: عليه تُحسب هوامش التمرير */
  const publishHeight = () =>
    document.documentElement.style.setProperty('--composer-h', composer.offsetHeight + 'px');

  /* **زرّ الإرسال يقول إن كان له ما يرسله.**
     المساحة بلا نائبٍ نصّيّ (الصفحة كلمةٌ واحدة)، فكان الملتقط صندوقًا
     فارغًا وفيه زرٌّ صلبٌ لامع لا يفعل شيئًا لو ضُغط — لمعانٌ يَعِد بفعلٍ
     لا يقع. فيهدأ ما دام لا شيء ليُرسل، ويستوي حين يُكتب حرف. وهذه
     إشارةٌ بلا كلمة، وهو المطلوب في صفحةٍ نُزع منها كلّ نصّ. */
  const sendBtn = form.querySelector('.vo-typebar__send');
  const markReady = () => {
    if (sendBtn) sendBtn.dataset.ready = input.value.trim() ? 'yes' : 'no';
  };

  function grow() {
    const chrome = composer.offsetHeight - input.offsetHeight;   // حشوٌ وتلميحٌ وحدود
    const cap = Math.max(96, Math.round(innerHeight * 0.55) - chrome);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, cap) + 'px';
    publishHeight();
    markReady();
  }
  publishHeight();
  markReady();
  addEventListener('resize', () => { if (input.style.height) grow(); else publishHeight(); });
  /* العودة إلى ثلاثة أسطر — وتُقرأ حالة الزرّ معها، فالمساحة تُفرَّغ هنا
     بعد الإرسال ولولا ذلك لبقي الزرّ مستويًا وما عاد فيه ما يُرسل. */
  const baseH = () => { input.style.height = ''; publishHeight(); markReady(); };

  input.addEventListener('input', grow);

  /* **المساحة لا تُرسل بـEnter من نفسها**، بخلاف حقل السطر الواحد. فلو
     تُرك الأمر لها لكتب الزبون طلبه وضغط Enter فنزل سطرٌ ولم يُرسل شيء،
     ولا شيء يقول له لماذا. فـEnter يُرسل، وShift+Enter ينزل سطرًا لمن
     أراد أن يفصل جملتين. */
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    form.requestSubmit();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    baseH();
    turn(t);
  });
  submitBtn.addEventListener('click', submitOrder);
})();
