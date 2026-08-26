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

  const API = new URLSearchParams(location.search).get('api')
    || document.body.dataset.api || '';

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
  /* جوابٌ قصير بلا عنوانه يُغلَّف بعنوان السؤال المنتظَر، فيقع في حقله:
     «السالمية» وحدها تُقرأ استلامًا أينما وقعت — التغليف يحسم الجهة. */
  const WRAP = {
    customer_name: (t) => (/اسمي/.test(t) ? t : `اسمي ${t}`),
    customer_phone: (t) => (/رقمي|هاتفي/.test(t) ? t : `رقمي ${t}`),
    pickup_area: (t) => (/من|الاستلام/.test(t) ? t : `الاستلام من ${t}`),
    dropoff_area: (t) => (/إلى|الى|التسليم/.test(t) ? t : `التسليم إلى ${t}`),
  };

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

  async function parseAll() {
    const res = await fetch(`${API}/api/public/order/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: state.utterances.join('، ') }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'تعذّر الاتصال');
    state.parsed = await res.json();
  }

  async function turn(text) {
    const raw = text.trim();
    if (!raw || state.sending) return;
    const wrapped = state.pendingField && raw.length <= 40 && WRAP[state.pendingField]
      ? WRAP[state.pendingField](raw) : raw;

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

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    mic.hidden = true;
    hint.textContent = 'متصفّحك لا يدعم الإدخال الصوتي — اكتب طلبك كتابةً.';
  } else {
    const rec = new SR();
    rec.lang = 'ar-KW';
    rec.interimResults = true;
    let live = false, finalText = '';

    rec.addEventListener('result', (e) => {
      let t = '';
      for (const r of e.results) t += r[0].transcript;
      input.value = t.trim();
      if (e.results[e.results.length - 1].isFinal) finalText = t.trim();
    });
    rec.addEventListener('end', () => {
      live = false;
      mic.setAttribute('aria-pressed', 'false');
      hint.classList.remove('is-listening');
      hint.textContent = 'يعمل الإدخال الصوتي على متصفّح الجوال مباشرة — أو اكتب طلبك كتابةً.';
      const said = finalText || input.value.trim();
      finalText = ''; input.value = '';
      if (said) turn(said);
    });
    rec.addEventListener('error', (e) => {
      live = false;
      mic.setAttribute('aria-pressed', 'false');
      hint.classList.remove('is-listening');
      hint.textContent = e.error === 'not-allowed'
        ? 'لم يُسمح بالميكروفون — اسمح به من إعدادات المتصفّح، أو اكتب طلبك.'
        : 'تعذّر الالتقاط — أعد المحاولة أو اكتب طلبك.';
    });

    mic.addEventListener('click', () => {
      if (live) { rec.stop(); return; }
      finalText = ''; input.value = '';
      try { rec.start(); } catch { return; }
      live = true;
      mic.setAttribute('aria-pressed', 'true');
      hint.classList.add('is-listening');
      hint.textContent = 'أسمعك… تكلّم بطلبك ثم اسكت لحظة.';
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
