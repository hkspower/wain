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
  /* جوابٌ **مجرّد** يُغلَّف بعنوان السؤال المنتظَر فيقع في حقله: «السالمية»
     وحدها تُقرأ استلامًا أينما وقعت، والتغليف يحسم الجهة.
     والشرط «مجرّد» لا يُستغنى عنه: كان التغليف يجري على الطول وحده، فمن
     أجاب سؤال الاستلام بتصحيحٍ لاسمه («لا، اسمي فهد») صار كلامه
     «الاستلام من لا، اسمي فهد» — ويُقرأ «الاستلام» نفسه اسمَ منطقةٍ لم
     تُفهم، فيسأل الوكيل «هل تقصد السلام؟» عن كلمةٍ لم يقلها أحد. الغلاف
     الذي يفسد الكلام أسوأ من غلافٍ لا يقع. */
  const CARRIES_LABEL = /اسمي|رقمي|هاتفي|الاستلام|الإستلام|التسليم|إلى|الى|(^|\s)من(\s|$)|المبلغ|الرسوم|ملاحظ/;
  const WRAP = {
    customer_name: (t) => `اسمي ${t}`,
    customer_phone: (t) => `رقمي ${t}`,
    pickup_area: (t) => `الاستلام من ${t}`,
    dropoff_area: (t) => `التسليم إلى ${t}`,
  };
  const wrapAnswer = (field, t) =>
    (field && WRAP[field] && t.length <= 40 && !CARRIES_LABEL.test(t)) ? WRAP[field](t) : t;

  const state = {
    utterances: [],     // الحديث كما قيل، بترتيبه
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

  function renderCard() {
    const p = state.parsed;
    if (!p || (!p.heard.length && !p.missing.length)) { card.hidden = true; return; }
    card.hidden = false;
    heardEl.innerHTML = p.heard.map((h) => `<li>${esc(h)}</li>`).join('');
    const missingReq = p.missing.filter((m) => REQUIRED.includes(m.field));
    missingEl.innerHTML = missingReq.map((m) => `<li>${esc(m.why)}</li>`).join('');
    submitBtn.hidden = missingReq.length !== 0;
  }

  function nextQuestion() {
    const missingReq = state.parsed.missing.filter((m) => REQUIRED.includes(m.field));
    if (!missingReq.length) {
      state.pendingField = null;
      bubble('agent', 'اكتمل الطلب. راجع الملخّص ثم اضغط <b>«أرسل الطلب إلى موصول»</b>.');
      return;
    }
    /* سؤالٌ معه اقتراح «هل تقصد؟» يتقدّم: جوابه ضغطة زرّ، وتركُه معلّقًا
       يجعل الزبون يجيب عن غيره والخطأ باقٍ. */
    const m = missingReq.find((x) => x.hint) || missingReq[0];
    state.pendingField = m.field;
    let html = ASK[m.field] || esc(m.why);
    /* «هل تقصد…؟» يأتي من الخادم اقتراحًا لا قيمةً — زرٌّ يقبله الزبون */
    if (m.hint) {
      html = `${esc(m.why)}<br><button type="button" class="vo-hintbtn"
        data-hint="${esc(m.hint)}" data-from="${esc(m.hintFrom || '')}">نعم، أقصد ${esc(m.hint)}</button>`;
    }
    const b = bubble('agent', html);
    const btn = b.querySelector('.vo-hintbtn');
    if (btn) btn.addEventListener('click', () => applyHint(btn.dataset.from, btn.dataset.hint));
  }

  /* ----------------------------- الجولات ----------------------------- */

  /* يُرسَل الحديث كلّه ومعه آخر جملة على حدة: الأوّل يقرأ المناطق بمواضعها،
     والثاني يجعل التصحيح يعلو على ما سبقه (القاعدة في الخادم). */
  async function parseAll() {
    const res = await fetch(`${API}/api/public/order/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: state.utterances.join('، '),
        latest: state.utterances[state.utterances.length - 1] || '',
      }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'تعذّر الاتصال');
    state.parsed = await res.json();
  }

  async function turn(text) {
    const raw = text.trim();
    if (!raw || state.sending) return;
    const wrapped = wrapAnswer(state.pendingField, raw);

    hero.hidden = true;
    bubble('user', esc(raw));
    state.utterances.push(wrapped);
    try {
      await parseAll();
    } catch (err) {
      state.utterances.pop();
      bubble('agent', `${esc(err.message)} — أعد المحاولة بعد لحظة.`);
      return;
    }
    renderCard();
    nextQuestion();
  }

  /* تصحيح «هل تقصد…؟»: الكلمة الخاطئة تُستبدل في الحديث نفسه ثم يُعاد
     التحليل — لو أُلحقت الصحيحةُ إلحاقًا لبقيت الخاطئة تُقرأ معها. */
  async function applyHint(from, hintName) {
    if (from) state.utterances = state.utterances.map((u) => u.split(from).join(hintName));
    else state.utterances.push(hintName);
    bubble('user', `نعم، أقصد ${esc(hintName)}`);
    try { await parseAll(); } catch { return; }
    renderCard();
    nextQuestion();
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
  const IDLE_HINT = 'اضغط الميكروفون وتكلّم بطلبك، أو اكتبه.';
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

    const finish = () => {
      const said = (committed + ' ' + input.value).trim().replace(/\s+/g, ' ');
      committed = ''; restarts = 0; input.value = '';
      if (said) turn(said);
    };

    rec.addEventListener('result', (e) => {
      let t = '';
      for (const r of e.results) t += r[0].transcript;
      /* المعروض = ما ثبت سابقًا + ما تُسمعه هذه الجلسة */
      input.value = (committed ? committed + ' ' : '') + t.trim();
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
      if (failed) { failed = false; committed = ''; input.value = ''; return; }

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

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    turn(t);
  });
  submitBtn.addEventListener('click', submitOrder);
})();
