/* =========================================================================
   نظام موصول — واجهة المستخدم (بدون أطر عمل، بلا خطوة بناء)
   ========================================================================= */
(function () {
  'use strict';

  /* ------------------------------ الحالة ------------------------------ */
  const state = {
    me: null,
    meta: null,
    agents: [],
    stats: null,
    ordersFilter: { scope: 'active', q: '', status: '', governorate: '', agent_id: '' },
    loc: null,
  };

  const el = {
    login: document.getElementById('loginScreen'),
    loginForm: document.getElementById('loginForm'),
    loginMsg: document.getElementById('loginMsg'),
    app: document.getElementById('app'),
    view: document.getElementById('view'),
    nav: document.getElementById('mainNav'),
    tabbar: document.getElementById('tabbar'),
    whoName: document.getElementById('whoName'),
    whoRole: document.getElementById('whoRole'),
    availWrap: document.getElementById('availabilityWrap'),
    availSelect: document.getElementById('availabilitySelect'),
    logout: document.getElementById('logoutBtn'),
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    toasts: document.getElementById('toasts'),
    geoBar: document.getElementById('geoBar'),
    geoBarText: document.getElementById('geoBarText'),
    geoStop: document.getElementById('geoStop'),
  };

  /* ------------------------------ أدوات ------------------------------ */

  /* حزمة اللغة العربية — تتولّى الأرقام وتمييز العدد والوقت.
     تُحمَّل من vendor/arabic-kit.js قبل هذا الملف. */
  const AR = window.arabicKit;

  const ar = AR.digits;
  const money = (v) => AR.number(Number(v || 0), 3);
  const int = (v) => AR.number(Number(v || 0));

  /** عدد + اسمه بالصيغة الصحيحة: ٥ دقائق، طلبان، لا طلبات… */
  const count = (n, noun) => AR.plural(n, noun);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('ar-KW', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        hour12: true, timeZone: 'Asia/Kuwait',
      }).format(new Date(iso));
    } catch { return iso; }
  };

  const relTime = (iso) => (iso ? AR.since(iso) : '');

  function toast(message, kind = '') {
    const node = document.createElement('div');
    node.className = 'toast' + (kind ? ` toast--${kind}` : '');
    node.textContent = message;
    el.toasts.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  /* ------------------------------- الشبكة ------------------------------- */

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });

    let data = {};
    try { data = await res.json(); } catch { /* استجابة بلا جسم */ }

    if (res.status === 401 && state.me) { logout(true); throw new Error(data.error || 'انتهت الجلسة'); }
    if (!res.ok) throw new Error(data.error || 'تعذّر تنفيذ الطلب');
    return data;
  }

  /* ------------------------------- النافذة ------------------------------- */

  /* `showModal()` تتكفّل بحبس التنقّل وتعطيل ما خلفها وإغلاقها بـEsc، فلا
     يبقى لنا إلّا المحتوى. وكان ذلك كلّه مكتوبًا بيدنا — ناقصًا حبسَ التنقّل. */
  function openModal(title, html, onMount) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = html;
    el.modal.showModal();
    if (onMount) onMount(el.modalBody);
    const first = el.modalBody.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }

  function closeModal() {
    if (el.modal.open) el.modal.close();
  }

  /* التنظيف على `close` لا في `closeModal`: النافذة تُغلق بـEsc أيضًا وبضغطة
     خارجها، وكلاهما لا يمرّ بدالّتنا. */
  el.modal.addEventListener('close', () => { el.modalBody.innerHTML = ''; });
  el.modal.addEventListener('click', (e) => {
    /* الضغط على ظهر النافذة: الحدث يقع على `<dialog>` نفسها لأن البطاقة
       تغطّي ما عداه. */
    if (e.target === el.modal || e.target.closest('[data-close]')) closeModal();
  });

  /* ------------------------------ مكوّنات ------------------------------ */

  const statusBadge = (s) =>
    `<span class="badge badge--${s}">${esc(state.meta.statuses[s] || s)}</span>`;

  const vehicleName = (v) => state.meta.vehicles[v] || v;

  function orderCard(o) {
    const urgent = o.priority === 'urgent';
    return `
      <article class="order${urgent ? ' is-urgent' : ''}">
        <div class="order__top">
          <a class="order__code num" href="#/orders/${o.id}">${esc(o.code)}</a>
          ${statusBadge(o.status)}
          ${urgent ? '<span class="badge badge--urgent">عاجل</span>' : ''}
          ${o.has_pending_transfer ? '<span class="badge badge--transfer">تحويل معلّق</span>' : ''}
          <time class="order__time" datetime="${esc(o.updated_at || '')}">${esc(relTime(o.updated_at))}</time>
        </div>
        <div class="order__customer">${esc(o.customer_name)}</div>
        <div class="order__route">
          من <b>${esc(o.pickup_address)}</b><br>
          إلى <b>${esc(o.dropoff_address)}</b>
        </div>
        <div class="order__meta">
          <span>${esc(o.governorate)}</span>
          <span>${esc(vehicleName(o.vehicle))}</span>
          ${o.cod_amount > 0 ? `<span>تحصيل <b class="num">${money(o.cod_amount)}</b> د.ك</span>` : ''}
          ${o.agent_name ? `<span>المندوب: ${esc(o.agent_name)}</span>` : '<span>غير مُسند</span>'}
        </div>
      </article>`;
  }

  const emptyState = (title, sub) => `
    <div class="empty">
      <img src="assets/mawsool-mark.png" alt="">
      <b>${esc(title)}</b>
      <span>${esc(sub || '')}</span>
    </div>`;

  const skeleton = (n = 3) =>
    `<div class="skeleton">${'<div></div>'.repeat(n)}</div>`;

  /* ------------------------------ التوجيه ------------------------------ */

  const routes = {
    '': renderDashboard,
    'orders': renderOrders,
    'transfers': renderTransfers,
    'agents': renderAgents,
    'new': renderNewOrder,
    'location': renderLocation,
    'live': renderLive,
    'settings': renderSettings,
  };

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [head, ...rest] = raw.split('/');
    return { head, rest };
  }

  async function router() {
    if (!state.me) return;
    const { head, rest } = parseHash();
    highlightNav(head);

    try {
      if (head === 'orders' && rest[0]) return await renderOrderDetail(rest[0]);
      const fn = routes[head];
      if (!fn) { location.hash = '#/'; return; }
      await fn();
    } catch (err) {
      el.view.innerHTML = `<div class="card"><div class="card__body">${emptyState('تعذّر تحميل الصفحة', err.message)}</div></div>`;
    }
    el.view.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function navItems() {
    const inbox = state.stats?.pending_transfers_in || 0;
    const items = [
      { href: '#/', key: '', label: 'الرئيسية' },
      { href: '#/orders', key: 'orders', label: 'الطلبات' },
      { href: '#/transfers', key: 'transfers', label: 'التحويلات', pill: inbox },
    ];
    if (state.me.role === 'admin') {
      items.push({ href: '#/live', key: 'live', label: 'المباشر' });
      items.push({ href: '#/agents', key: 'agents', label: 'المندوبون' });
      /* «طلب جديد» فعلٌ لا مكان. سبعة عناصر لا تسع شاشة ٣٢٠، وكان هذا هو
         الذي يُعصر إلى ٣٤ بكسلًا على سطرين. يبقى في الشريط العلوي وزرًّا
         بارزًا في أعلى الرئيسية والطلبات، ويغيب عن شريط التنقّل السفلي. */
      items.push({ href: '#/new', key: 'new', label: 'طلب جديد', topOnly: true });
      items.push({ href: '#/settings', key: 'settings', label: 'الإعدادات' });
    } else {
      items.push({ href: '#/location', key: 'location', label: 'موقعي' });
    }
    return items;
  }

  function renderNav() {
    const link = (i) =>
      `<a href="${i.href}" data-key="${i.key}">${esc(i.label)}${i.pill ? `<span class="pill num">${ar(i.pill)}</span>` : ''}</a>`;
    const items = navItems();
    el.nav.innerHTML = items.map(link).join('');
    el.tabbar.innerHTML = items.filter((i) => !i.topOnly).map(link).join('');
    highlightNav(parseHash().head);
  }

  function highlightNav(key) {
    document.querySelectorAll('#mainNav a, #tabbar a').forEach((a) => {
      a.classList.toggle('is-active', a.dataset.key === key);
    });
  }

  /* ------------------------------ الصفحات ------------------------------ */

  async function refreshShared() {
    const [stats, agents] = await Promise.all([api('/stats'), api('/agents')]);
    state.stats = stats;
    state.agents = agents.agents;
    renderNav();
  }

  /* ---- الرئيسية ---- */

  async function renderDashboard() {
    el.view.innerHTML = `<div class="page-head"><div><h1>لوحة المتابعة</h1></div></div>${skeleton(2)}`;
    await refreshShared();

    const s = state.stats;
    const isAdmin = state.me.role === 'admin';

    const [active, transfersIn] = await Promise.all([
      api('/orders?scope=active&limit=8'),
      api('/transfers?box=inbox&status=pending'),
    ]);

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>أهلًا ${esc(state.me.name.split(' ')[0])}</h1>
          <p>${isAdmin ? 'ملخّص عمليات اليوم عبر كل المندوبين.' : 'هذه طلباتك النشطة وما يخصّك اليوم.'}</p>
        </div>
        ${isAdmin ? '<a class="btn btn--accent" href="#/new">+ طلب جديد</a>' : ''}
      </div>

      <div class="card ask">
        <div class="card__body">
          <form class="ask__bar" id="askForm">
            <input id="askText" autocomplete="off" enterkeyhint="search"
                   placeholder="اسأل موصول أو ألصق طلبًا…">
            <button type="button" class="btn btn--quiet ask__mic" id="askMic" hidden
                    aria-label="تكلّم بالسؤال" title="تكلّم بالسؤال">
              <!-- رسمة لا حرفًا: خطوط الموقع عربية ولا تحمل الرموز التعبيرية،
                   فالحرف يسقط إلى مربّع فارغ على أجهزة كثيرة. -->
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Z"/>
                <path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>
              </svg>
            </button>
            <button type="submit" class="btn btn--primary">اسأل</button>
          </form>
          <div class="ask__chips" id="askChips"></div>
          <div id="askOut" aria-live="polite"></div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat"><b class="num">${ar(s.active)}</b><span>طلبات نشطة</span></div>
        <div class="stat"><b class="num">${ar(s.delivered_today)}</b><span>سُلّمت اليوم</span></div>
        <div class="stat stat--accent"><b class="num">${money(s.cod_today)}</b><span>تحصيل اليوم (د.ك)</span></div>
        ${isAdmin
          ? `<div class="stat"><b class="num">${money(s.commission_today)}</b><span>عمولتنا اليوم (د.ك)</span></div>
             <div class="stat"><b class="num">${money(s.agent_earning_today)}</b><span>مستحقّ الكباتن اليوم (د.ك)</span></div>`
          : ''}
        ${isAdmin
          ? `<div class="stat"><b class="num">${ar(s.counts.new)}</b><span>بانتظار الإسناد</span></div>
             <div class="stat stat--dark"><b class="num">${ar(s.agents_online)}</b><span>مندوب متاح الآن</span></div>
             <a class="stat${s.agents_under_test > 0 ? ' stat--warn' : ''}" href="#/agents">
               <b class="num">${ar(s.agents_under_test)}</b><span>تحت التجربة</span></a>`
          : `<div class="stat stat--dark"><b class="num">${ar(s.pending_transfers_in)}</b><span>تحويلات بانتظار ردّك</span></div>`}
      </div>

      ${transfersIn.transfers.length ? `
      <div class="card">
        <div class="card__head">
          <h2>تحويلات بانتظار ردّك</h2>
          <a class="btn btn--ghost btn--sm" href="#/transfers">عرض الكل</a>
        </div>
        <div class="card__body">${transfersIn.transfers.slice(0, 3).map(transferCard).join('')}</div>
      </div>` : ''}

      <div class="card">
        <div class="card__head">
          <h2>${isAdmin ? 'أحدث الطلبات النشطة' : 'طلباتي النشطة'}</h2>
          <a class="btn btn--ghost btn--sm" href="#/orders">كل الطلبات</a>
        </div>
        <div class="card__body">
          ${active.orders.length
            ? `<div class="orders">${active.orders.map(orderCard).join('')}</div>`
            : emptyState('لا توجد طلبات نشطة', isAdmin ? 'كل الطلبات مكتملة حاليًا.' : 'ستظهر هنا الطلبات المسندة إليك.')}
        </div>
      </div>`;

    bindTransferActions(el.view);
    bindAsk();
  }

  /* ---- وكيل موصول على الصفحة الرئيسية ---- */

  /**
   * الوكيل **يقرأ ويقترح ولا يكتب**. الجواب يظهر فوق اللوحة، واللوحة تبقى
   * تحته: من لم يسأل شيئًا يرى ما كان يراه، ولا تُبدَّل شاشةٌ تعمل بمربّع
   * فارغ.
   */
  function bindAsk() {
    const form = document.getElementById('askForm');
    const box = document.getElementById('askText');
    const out = document.getElementById('askOut');
    const chips = document.getElementById('askChips');
    if (!form) return;

    const EXAMPLES = state.me.role === 'admin'
      ? ['كم سلّمنا هذا الأسبوع؟', 'مين متاح الآن؟', 'الطلبات بانتظار الإسناد',
         'كم العمولة؟', 'شنو شروط الكابتن؟']
      : ['طلباتي النشطة', 'كم سلّمت هذا الأسبوع؟', 'دورة الصرف', 'التحويلات'];
    chips.innerHTML = EXAMPLES.map((e) => `<button type="button" class="chip" data-ask="${esc(e)}">${esc(e)}</button>`).join('');
    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ask]');
      if (!b) return;
      box.value = b.dataset.ask;
      form.requestSubmit();
    });

    function answerHTML(r) {
      const d = r.data || {};
      const body = [];

      /* السياسة تُعرض بمصدرها وبما إن كان النظام يفرضها.
         «مفروض» يعني أن النظام يحرسه، و«غير مفروض» يعني أن حراسته على
         الموظّف — ولو خُلط الاثنان ترك الحراسة ظنًّا أنها مكفولة. */
      if (d.policy) {
        body.push(`<div class="ask__pol">
          ${d.policy.enforced
            ? '<span class="ask__pol-on">النظام يفرض هذا</span>'
            : `<span class="ask__pol-off">النظام لا يفرض هذا</span>
               <p>${esc(d.policy.why_not || '')}</p>`}
          <small>المصدر: ${esc(d.policy.source)}</small>
        </div>`);
      }
      if (d.audited) {
        body.push('<p class="ask__audit">سُجِّل اطّلاعك على أرقام هذا الكابتن في سجلّ حسابه.</p>');
      }
      if (d.rows) {
        body.push(`<dl class="ask__stats">${d.rows
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`);
      }
      if (d.orders?.length) body.push(`<div class="orders">${d.orders.map(orderCard).join('')}</div>`);
      if (d.agents?.length) {
        body.push(`<ul class="ask__agents">${d.agents.map((a) =>
          `<li><b>${esc(a.name)}</b><span>${esc(a.vehicle_label)} · ${esc(a.governorate)}</span></li>`).join('')}</ul>`);
      }
      if (d.parsed?.heard?.length) {
        body.push(`<ul class="ask__heard">${d.parsed.heard.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`);
      }
      /* الاقتراح سؤال يُضغط، لا قيمة طُبّقت — فيُعرض زرًّا بارزًا يسبق الأمثلة */
      if (d.suggest) {
        body.push(`<div class="ask__chips"><button type="button" class="chip chip--yes"
          data-ask="${esc(d.suggest)}">${esc(d.suggestLabel || d.suggest)}</button></div>`);
      }
      if (d.examples?.length) {
        body.push(`<div class="ask__chips">${d.examples
          .map((e) => `<button type="button" class="chip" data-ask="${esc(e)}">${esc(e)}</button>`).join('')}</div>`);
      }

      const acts = (r.actions || []).map((a) => `<a class="btn btn--sm ${a.primary ? 'btn--primary' : 'btn--ghost'}"
        href="${esc(a.href)}"${a.carry ? ` data-carry="${esc(a.carry)}"` : ''}>${esc(a.label)}</a>`).join('');

      /* السؤال يبقى فوق جوابه: بعد ضغط اقتراح أو رقاقة يتغيّر السؤال بلا أن
         يكتبه أحد، فلولا عرضُه لقرأ الموظّف جوابًا لا يعرف عمّ هو. */
      return `<div class="ask__answer${r.understood ? '' : ' is-unknown'}">
        <p class="ask__q">${esc(r.asked || '')}</p>
        <p class="ask__say">${esc(r.say)}</p>
        ${body.join('')}
        ${acts ? `<div class="ask__acts">${acts}</div>` : ''}
      </div>`;
    }

    async function run(text) {
      /* «…» في مكان الجواب تُقرأ جوابًا. الهيكل يقول «جارٍ» بلا كلمة */
      out.innerHTML = `<div class="ask__answer is-loading">
        <p class="ask__q">${esc(text)}</p><span class="ask__bar-skel"></span></div>`;
      try {
        const r = await api('/agent/ask', { method: 'POST', body: { text } });
        r.asked = text;
        out.innerHTML = answerHTML(r);
        /* صفّ رقائق واحد لا صفّان: رقائق الجواب أقرب إلى العين وأخصّ بالسياق */
        chips.hidden = !!out.querySelector('.ask__chips');
        /* «افتح النموذج مملوءًا» يحمل النصّ معه، فيُقرأ هناك ويُراجَع ويُنشأ
           بالمسار المعتاد — ولا يصير للإنشاء بابان. */
        const carry = out.querySelector('[data-carry]');
        if (carry) carry.addEventListener('click', () => { state.carryOrderText = carry.dataset.carry; });
        out.querySelectorAll('[data-ask]').forEach((b) =>
          b.addEventListener('click', () => { box.value = b.dataset.ask; form.requestSubmit(); }));
      } catch (err) {
        out.innerHTML = `<div class="ask__answer is-unknown"><p class="ask__say">${esc(err.message)}</p></div>`;
      }
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = box.value.trim();
      if (text) run(text);
    });

    /* الصوت في المتصفّح نفسه — لا يغادر الجهاز، ولا مفتاح مدفوعًا */
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = document.getElementById('askMic');
    if (!SR) return;
    mic.hidden = false;
    const rec = new SR();
    rec.lang = 'ar-KW';
    rec.interimResults = true;
    let live = false;
    rec.addEventListener('result', (e) => {
      let t = '';
      for (const r of e.results) t += r[0].transcript;
      box.value = t.trim();
    });
    rec.addEventListener('error', (e) => {
      live = false; mic.classList.remove('is-live');
      out.innerHTML = `<div class="ask__answer is-unknown"><p class="ask__say">${esc(
        e.error === 'not-allowed' ? 'المتصفّح منع الميكروفون — اسمح به أو اكتب سؤالك.'
        : e.error === 'no-speech' ? 'لم يصل كلام. حاول ثانيةً أو اكتب سؤالك.'
        : 'تعذّر التعرّف على الكلام. اكتب سؤالك.')}</p></div>`;
    });
    rec.addEventListener('end', () => {
      if (!live) return;
      live = false; mic.classList.remove('is-live');
      if (box.value.trim()) form.requestSubmit();
    });
    mic.addEventListener('click', () => {
      if (live) { live = false; rec.stop(); mic.classList.remove('is-live'); return; }
      box.value = ''; live = true; mic.classList.add('is-live');
      try { rec.start(); } catch { /* جارٍ أصلًا */ }
    });
  }

  /* ---- قائمة الطلبات ---- */

  async function renderOrders() {
    const f = state.ordersFilter;
    const isAdmin = state.me.role === 'admin';

    el.view.innerHTML = `
      <div class="page-head">
        <div><h1>الطلبات</h1><p>${isAdmin ? 'كل طلبات النظام مع إمكانية الإسناد والتحويل.' : 'الطلبات المسندة إليك.'}</p></div>
        ${isAdmin ? '<a class="btn btn--accent" href="#/new">+ طلب جديد</a>' : ''}
      </div>

      <search class="filters">
        <input id="fq" type="search" placeholder="ابحث برقم الطلب أو اسم العميل أو العنوان" value="${esc(f.q)}"
               enterkeyhint="search" autocapitalize="off" autocorrect="off" spellcheck="false">
        <select id="fgov">
          <option value="">كل المحافظات</option>
          ${state.meta.governorates.map((g) => `<option value="${esc(g)}"${f.governorate === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}
        </select>
        ${isAdmin ? `
        <select id="fagent">
          <option value="">كل المندوبين</option>
          ${state.agents.filter((a) => a.role === 'agent').map((a) =>
            `<option value="${a.id}"${String(f.agent_id) === String(a.id) ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select>` : ''}

      <div class="chips toolbar__chips" id="scopeChips">
        ${[
          ['active', 'نشطة'], ['done', 'منتهية'],
          ...(isAdmin ? [['unassigned', 'بانتظار الإسناد']] : []),
          ['', 'الكل'],
        ].map(([v, label]) =>
          `<button class="chip${f.scope === v ? ' is-on' : ''}" data-scope="${v}" type="button">${esc(label)}</button>`).join('')}
        </div>
      </search>

      <div id="ordersList">${skeleton(4)}</div>`;

    const load = async () => {
      const params = new URLSearchParams();
      if (f.scope) params.set('scope', f.scope);
      if (f.q) params.set('q', f.q);
      if (f.governorate) params.set('governorate', f.governorate);
      if (f.agent_id) params.set('agent_id', f.agent_id);
      const list = document.getElementById('ordersList');
      try {
        const { orders } = await api('/orders?' + params.toString());
        list.innerHTML = orders.length
          ? `<div class="orders">${orders.map(orderCard).join('')}</div>`
          : emptyState('لا توجد طلبات مطابقة', 'جرّب تغيير عوامل التصفية.');
      } catch (err) {
        list.innerHTML = emptyState('تعذّر تحميل الطلبات', err.message);
      }
    };

    let timer;
    document.getElementById('fq').addEventListener('input', (e) => {
      f.q = e.target.value.trim();
      clearTimeout(timer);
      timer = setTimeout(load, 280);
    });
    document.getElementById('fgov').addEventListener('change', (e) => { f.governorate = e.target.value; load(); });
    const fagent = document.getElementById('fagent');
    if (fagent) fagent.addEventListener('change', (e) => { f.agent_id = e.target.value; load(); });

    document.getElementById('scopeChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      f.scope = chip.dataset.scope;
      document.querySelectorAll('#scopeChips .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
      load();
    });

    await load();
  }

  /* ---- تفاصيل الطلب ---- */

  const EVENT_LABELS = {
    created: 'أُنشئ الطلب',
    assigned: 'إسناد لمندوب',
    status: 'تغيير الحالة',
    transfer_requested: 'طلب تحويل',
    transfer_accepted: 'قبول التحويل',
    transfer_rejected: 'رفض التحويل',
    transfer_cancelled: 'سحب التحويل',
  };

  function eventRow(ev) {
    /* سهم الانتقال: «←» ليس في مجموعة الخط المجتزأة فيسقط على خط النظام
       ويظهر بوزن مخالف لما حوله. «›» موجود في الخط، والمرآة الثنائية الاتجاه
       تقلبه في سياق عربي إلى يسار — فيشير من الحالة السابقة إلى التالية كما
       يقرأ العربي. (فُحص في المتصفّح: «‹» ينقلب إلى يمين، وهو عكس المقصود.) */
    const ARROW = '\u203A';
    const isTransfer = ev.type.startsWith('transfer');
    const bad = ev.type === 'transfer_rejected' || (ev.type === 'status' && ['failed', 'cancelled'].includes(ev.to_value));
    let detail = '';
    if (ev.type === 'status') {
      detail = `${state.meta.statuses[ev.from_value] || ev.from_value || '—'} ${ARROW} ${state.meta.statuses[ev.to_value] || ev.to_value}`;
    } else if (ev.from_value || ev.to_value) {
      detail = `${esc(ev.from_value || '—')} ${ARROW} ${esc(ev.to_value || '—')}`;
    }
    return `
      <li class="tl${isTransfer ? ' tl--transfer' : ''}${bad ? ' tl--bad' : ''}">
        <span class="tl__dot"></span>
        <b>${esc(EVENT_LABELS[ev.type] || ev.type)}</b>
        ${detail ? `<em>${detail}</em>` : ''}
        ${ev.note ? `<em>«${esc(ev.note)}»</em>` : ''}
        <span>${esc(fmtDate(ev.created_at))}${ev.actor_name ? ' — ' + esc(ev.actor_name) : ''}</span>
      </li>`;
  }

  async function renderOrderDetail(orderId) {
    el.view.innerHTML = skeleton(2);
    const { order } = await api('/orders/' + encodeURIComponent(orderId));
    const isAdmin = state.me.role === 'admin';
    const mine = order.agent_id === state.me.id;
    const pending = order.pending_transfer;

    const canAct = (isAdmin || mine) && order.allowed_next.length > 0;
    const canTransfer = (isAdmin || mine)
      && state.meta.active_statuses.includes(order.status)
      && order.agent_id && !pending;

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>الطلب <span class="num">${esc(order.code)}</span></h1>
          <p>${statusBadge(order.status)}
             ${order.priority === 'urgent' ? '<span class="badge badge--urgent">عاجل</span>' : ''}
             <time class="muted" datetime="${esc(order.updated_at || '')}">آخر تحديث ${esc(relTime(order.updated_at))}</time></p>
        </div>
        <a class="btn btn--ghost btn--sm" href="#/orders">رجوع للقائمة</a>
      </div>

      ${pending ? `
        <div class="transfer-note">
          <b>طلب تحويل معلّق</b>
          <p>من <b>${esc(pending.from_name)}</b> إلى <b>${esc(pending.to_name)}</b> — «${esc(pending.reason)}»</p>
          <div class="btn-row">
            ${(isAdmin || pending.to_agent_id === state.me.id) ? `
              <button class="btn btn--primary btn--sm" data-transfer="accept" data-id="${pending.id}">قبول التحويل</button>
              <button class="btn btn--danger btn--sm" data-transfer="reject" data-id="${pending.id}">رفض</button>` : ''}
            ${(isAdmin || pending.from_agent_id === state.me.id) ? `
              <button class="btn btn--quiet btn--sm" data-transfer="cancel" data-id="${pending.id}">سحب الطلب</button>` : ''}
          </div>
        </div>` : ''}

      ${driverLocationBlock(order)}

      <div class="detail">
        <div>
          <div class="card">
            <div class="card__head"><h2>بيانات الشحنة</h2></div>
            <div class="card__body">
              <dl class="kv">
                <dt>العميل</dt><dd>${esc(order.customer_name)}</dd>
                <dt>الهاتف</dt><dd><a href="tel:${esc(order.customer_phone)}" dir="ltr">${esc(order.customer_phone)}</a></dd>
                <dt>الاستلام</dt><dd>${esc(order.pickup_address)}</dd>
                <dt>التسليم</dt><dd>${esc(order.dropoff_address)}</dd>
                <dt>المحافظة</dt><dd>${esc(order.governorate)}</dd>
                <dt>المركبة</dt><dd>${esc(vehicleName(order.vehicle))}</dd>
                <dt>التحصيل</dt><dd class="num">${money(order.cod_amount)} د.ك</dd>
                <dt>رسوم التوصيل</dt><dd class="num">${money(order.delivery_fee)} د.ك</dd>
                ${isAdmin ? `
                  <dt>عمولة موصول</dt>
                  <dd class="num">${money(order.commission_amount)} د.ك
                    <small class="muted">${order.commission_type === 'percent'
                      ? `(${ar(order.commission_rate)}٪)` : '(مبلغ ثابت)'}</small></dd>` : ''}
                <dt>مستحقّ الكابتن</dt><dd class="num">${money(order.agent_earning)} د.ك</dd>
                <dt>المندوب</dt><dd>${order.agent_name ? esc(order.agent_name) : 'غير مُسند'}</dd>
                ${order.notes ? `<dt>ملاحظات</dt><dd>${esc(order.notes)}</dd>` : ''}
                ${order.failure_reason ? `<dt>سبب التعذّر</dt><dd>${esc(order.failure_reason)}</dd>` : ''}
                <dt>أُنشئ</dt><dd>${esc(fmtDate(order.created_at))}</dd>
                ${order.delivered_at ? `<dt>سُلّم</dt><dd>${esc(fmtDate(order.delivered_at))}</dd>` : ''}
              </dl>
            </div>
          </div>

          ${(canAct || canTransfer || isAdmin) ? `
          <div class="card">
            <div class="card__head"><h2>الإجراءات</h2></div>
            <div class="card__body">
              <div class="btn-row">
                ${order.allowed_next.map((s) =>
                  `<button class="btn ${['delivered'].includes(s) ? 'btn--primary' : ['failed', 'cancelled'].includes(s) ? 'btn--danger' : 'btn--ghost'} btn--sm"
                           data-status="${s}">${esc(state.meta.statuses[s])}</button>`).join('')}
                ${canTransfer ? '<button class="btn btn--accent btn--sm" data-open="transfer">تحويل لزميل</button>' : ''}
                ${isAdmin ? '<button class="btn btn--quiet btn--sm" data-open="assign">إسناد لمندوب</button>' : ''}
                ${isAdmin && order.agent_id && !state.meta.final_statuses.includes(order.status)
                  ? '<button class="btn btn--ghost btn--sm" data-open="link">رابط للكابتن</button>' : ''}
                ${isAdmin ? '<button class="btn btn--quiet btn--sm" data-open="report">إرسال التقرير بريدًا</button>' : ''}
              </div>
              ${!canAct && !canTransfer && !isAdmin ? '<p style="margin:.6rem 0 0;color:var(--ink-soft)">لا توجد إجراءات متاحة على هذا الطلب.</p>' : ''}
            </div>
          </div>` : ''}

          ${isAdmin && order.voice_notes && order.voice_notes.length ? `
          <div class="card">
            <div class="card__head"><h2>ملاحظات صوتية من الكابتن</h2></div>
            <div class="card__body">
              <ul class="voice-list">
                ${order.voice_notes.map((v) => `
                  <li>
                    <audio controls preload="none" src="/api/voice/${v.id}"></audio>
                    <span class="muted">${esc(count(Math.round(v.seconds), 'second'))} — ${esc(relTime(v.created_at))}</span>
                  </li>`).join('')}
              </ul>
            </div>
          </div>` : ''}
        </div>

        <div class="card">
          <div class="card__head"><h2>سجل الطلب</h2></div>
          <div class="card__body">
            <ul class="timeline">${order.events.map(eventRow).join('')}</ul>
          </div>
        </div>
      </div>`;

    bindTransferActions(el.view);

    el.view.querySelectorAll('[data-status]').forEach((btn) => {
      btn.addEventListener('click', () => promptStatus(order, btn.dataset.status));
    });
    const tBtn = el.view.querySelector('[data-open="transfer"]');
    if (tBtn) tBtn.addEventListener('click', () => promptTransfer(order));
    const aBtn = el.view.querySelector('[data-open="assign"]');
    if (aBtn) aBtn.addEventListener('click', () => promptAssign(order));
    const lBtn = el.view.querySelector('[data-open="link"]');
    if (lBtn) lBtn.addEventListener('click', () => promptLink(order));
    const rBtn = el.view.querySelector('[data-open="report"]');
    if (rBtn) rBtn.addEventListener('click', () => sendReport(order));
  }

  /* --------------------- رابط المهمّة للكابتن --------------------- */

  /** يعرض روابط الطلب، ويولّد رابطًا جديدًا جاهزًا للإرسال على واتساب */
  async function promptLink(order) {
    openModal('رابط المهمّة للكابتن', skeleton(2));

    async function paint() {
      let data;
      try {
        data = await api(`/orders/${order.id}/links`);
      } catch (err) {
        el.modalBody.innerHTML = `<p class="form-msg is-error">${esc(err.message)}</p>`;
        return;
      }
      const active = data.links.find((l) => l.active);

      el.modalBody.innerHTML = `
        <p class="hint">
          رابط واحد لهذه المهمّة يفتحه الكابتن بلا تسجيل دخول: يوافق على مشاركة
          موقعه، ويرسل ملاحظة صوتية، ويبلّغ النتيجة. إنشاء رابط جديد يُلغي السابق.
        </p>

        ${active ? `
          <label class="field">
            <span>الرابط — انسخه وأرسله على واتساب</span>
            <input id="lkUrl" dir="ltr" readonly value="${esc(active.url)}">
          </label>
          <div class="btn-row">
            <button class="btn btn--primary" id="lkCopy" type="button">نسخ الرابط</button>
            <a class="btn btn--accent" id="lkWa" target="_blank" rel="noopener"
               href="https://wa.me/?text=${encodeURIComponent(active.url)}">إرسال على واتساب</a>
            <button class="btn btn--danger btn--sm" id="lkRevoke" type="button">إلغاء الرابط</button>
          </div>
          <p class="lk-meta muted">
            ينتهي ${esc(AR.dateTime(active.expires_at))} ·
            ${active.opened_at ? `فُتح ${esc(relTime(active.opened_at))}` : 'لم يُفتح بعد'}
          </p>`
        : `<button class="btn btn--primary btn--block" id="lkNew" type="button">إنشاء رابط للكابتن</button>`}

        ${data.links.length > 1 || (data.links.length && !active) ? `
          <h4 class="approval__h">روابط سابقة</h4>
          <ol class="approval__log">
            ${data.links.filter((l) => !l.active).map((l) => `
              <li>
                <span class="muted">أُنشئ ${esc(relTime(l.created_at))}</span>
                ${l.opened_at ? `<span class="muted"> · فُتح</span>` : '<span class="muted"> · لم يُفتح</span>'}
                ${l.revoked_at ? '<span class="muted"> · ملغى</span>' : '<span class="muted"> · منتهٍ</span>'}
              </li>`).join('')}
          </ol>` : ''}`;

      const nBtn = document.getElementById('lkNew');
      if (nBtn) nBtn.addEventListener('click', async () => {
        nBtn.disabled = true;
        try {
          await api(`/orders/${order.id}/link`, { method: 'POST' });
          toast('أُنشئ الرابط', 'ok');
          await paint();
        } catch (err) { toast(err.message, 'error'); nBtn.disabled = false; }
      });

      const cBtn = document.getElementById('lkCopy');
      if (cBtn) cBtn.addEventListener('click', async () => {
        const input = document.getElementById('lkUrl');
        try {
          await navigator.clipboard.writeText(input.value);
          toast('نُسخ الرابط', 'ok');
        } catch {
          input.select();
          toast('اضغط نسخ من لوحة المفاتيح', '');
        }
      });

      const rvBtn = document.getElementById('lkRevoke');
      if (rvBtn) rvBtn.addEventListener('click', async () => {
        if (!confirm('سيتوقّف الرابط عن العمل فورًا. متأكّد؟')) return;
        try {
          await api(`/links/${active.id}`, { method: 'DELETE' });
          toast('أُلغي الرابط', 'ok');
          await paint();
        } catch (err) { toast(err.message, 'error'); }
      });
    }

    await paint();
  }

  /** يرسل تقرير المهمّة بريدًا يدويًا */
  async function sendReport(order) {
    try {
      const r = await api(`/orders/${order.id}/report`, { method: 'POST', body: {} });
      if (r.mail.status === 'sent') toast('أُرسل التقرير بريدًا', 'ok');
      else if (!r.configured) toast('لم يُضبط بريد الخادم — التقرير محفوظ في الصندوق', '');
      else toast('تعذّر الإرسال — التقرير محفوظ في الصندوق', 'error');
    } catch (err) { toast(err.message, 'error'); }
  }

/** موقع المندوب المسند — يوضّح سبب عدم التوفّر بدل تركه فارغًا */
  function driverLocationBlock(order) {
    const d = order.driver_location;
    if (!d || !order.agent_id) return '';
    if (!d.available) {
      const why = {
        no_consent: 'لم يمنح المندوب موافقته على مشاركة الموقع.',
        sharing_off: 'أوقف المندوب مشاركة الموقع مؤقتًا.',
        no_data: 'لم تصل أي قراءة موقع بعد.',
        stale: 'آخر قراءة موقع قديمة.',
      }[d.reason] || 'موقع المندوب غير متاح.';
      return `<div class="transfer-note" style="background:var(--mute-bg);border-color:var(--line-str)">
                <b>موقع المندوب غير متاح</b>
                <p style="margin-bottom:0">${esc(why)}</p>
              </div>`;
    }
    return `
      <div class="transfer-note" style="background:var(--ok-bg);border-color:#a8d9c1">
        <b>موقع المندوب الآن</b>
        <p>${esc(d.agent_name)} — آخر تحديث ${esc(relTime(d.recorded_at))}${
          d.accuracy ? ` (دقة ~${ar(Math.round(d.accuracy))} م)` : ''}</p>
        <div class="btn-row">
          <a class="btn btn--ghost btn--sm" target="_blank" rel="noopener"
             href="https://www.google.com/maps?q=${d.lat},${d.lng}">افتح في الخرائط</a>
        </div>
      </div>`;
  }

  function promptStatus(order, status) {
    const needsNote = status === 'failed';
    openModal(`تغيير الحالة إلى «${state.meta.statuses[status]}»`, `
      <form id="statusForm">
        <label class="field">
          <span>ملاحظة${needsNote ? ' (مطلوبة)' : ' (اختيارية)'}</span>
          <textarea name="note" placeholder="${needsNote ? 'اكتب سبب تعذّر التسليم' : 'أي تفاصيل تودّ تسجيلها'}"${needsNote ? ' required' : ''}></textarea>
        </label>
        <p class="form-msg" id="statusMsg"></p>
        <button class="btn btn--primary btn--block" type="submit">تأكيد</button>
      </form>`, (body) => {
      body.querySelector('#statusForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const note = e.target.note.value.trim();
        const msg = body.querySelector('#statusMsg');
        if (needsNote && !note) { msg.textContent = 'السبب مطلوب'; msg.className = 'form-msg is-bad'; return; }
        await submit(e.target, msg, async () => {
          await api(`/orders/${order.id}/status`, { method: 'PATCH', body: { status, note } });
          closeModal();
          toast('تم تحديث حالة الطلب', 'ok');
          await refreshShared();
          await renderOrderDetail(order.id);
        });
      });
    });
  }

  function promptTransfer(order) {
    const others = assignableAgents(order.agent_id);
    openModal('تحويل الطلب إلى زميل', `
      <p style="color:var(--ink-soft);font-size:.88rem">
        لن ينتقل الطلب حتى يقبله الزميل. يمكنك سحب الطلب قبل ردّه.
      </p>
      <form id="transferForm">
        <label class="field">
          <span>المندوب المستلِم</span>
          <select name="to_agent_id" required>
            <option value="">اختر مندوبًا…</option>
            ${others.map((a) => `<option value="${a.id}">${esc(a.name)}${probationTag(a)} — ${esc(state.meta.availability[a.availability])} (${AR.describe(a.active_orders, 'order', 'active')})</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>سبب التحويل</span>
          <textarea name="reason" required placeholder="مثال: العنوان أقرب لمنطقتك، أو عندي طلب عاجل آخر"></textarea>
        </label>
        <p class="form-msg" id="transferMsg"></p>
        <button class="btn btn--accent btn--block" type="submit">إرسال طلب التحويل</button>
      </form>`, (body) => {
      body.querySelector('#transferForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = body.querySelector('#transferMsg');
        await submit(e.target, msg, async () => {
          await api(`/orders/${order.id}/transfer`, {
            method: 'POST',
            body: {
              to_agent_id: Number(e.target.to_agent_id.value),
              reason: e.target.reason.value.trim(),
            },
          });
          closeModal();
          toast('أُرسل طلب التحويل، بانتظار ردّ الزميل', 'ok');
          await refreshShared();
          await renderOrderDetail(order.id);
        });
      });
    });
  }

  /* أسباب استبعاد الكابتن من الاقتراح، بنصّ يقرأه المدير */
  const NEAR_REASON = {
    no_consent: 'لم يوافق على مشاركة موقعه',
    sharing_off: 'أوقف المشاركة',
    no_data: 'لا توجد نقطة',
    stale: 'آخر نقطة قديمة',
    vehicle: 'مركبته لا تناسب',
    unavailable: 'غير متفرّغ',
    not_eligible: 'حسابه لا يستقبل طلبات',
    same_agent: 'الطلب لديه أصلًا',
  };

  /**
   * صندوق «الأقرب» داخل نافذة الإسناد. يقترح ولا يسند: الضغط على مرشّح يملأ
   * القائمة أسفله، والقرار والزرّ يبقيان للمدير.
   */
  async function fillNearest(box, order, select) {
    const setPin = () => `
      <p class="near__hint">
        الصق موقع الزبون (رابط خرائط أو إحداثيتين) ليقترح النظام الأقرب:
      </p>
      <div class="near__pin">
        <input type="text" id="pinInput" placeholder="29.3759, 47.9774 أو رابط خرائط"
           autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done">
        <button type="button" class="btn btn--quiet btn--sm" id="pinSave">احفظ الموقع</button>
      </div>
      <p class="form-msg" id="pinMsg"></p>`;

    if (order.pickup_lat == null) {
      box.innerHTML = setPin();
      box.querySelector('#pinSave').addEventListener('click', async () => {
        const msg = box.querySelector('#pinMsg');
        const pin = box.querySelector('#pinInput').value.trim();
        if (!pin) return;
        msg.textContent = 'جارٍ الحفظ…'; msg.className = 'form-msg';
        try {
          const res = await api(`/orders/${order.id}/pickup-pin`, { method: 'PUT', body: { pin } });
          await fillNearest(box, res.order, select);
        } catch (err) {
          msg.textContent = err.message; msg.className = 'form-msg is-bad';
        }
      });
      return;
    }

    box.innerHTML = '<p class="near__hint">جارٍ ترتيب الكباتن…</p>';
    let data;
    try {
      data = await api(`/orders/${order.id}/nearest`);
    } catch (err) {
      box.innerHTML = `<p class="form-msg is-bad">${esc(err.message)}</p>`;
      return;
    }

    if (!data.candidates.length) {
      const why = data.skipped.slice(0, 4)
        .map((c) => `${esc(c.agent_name)}: ${esc(NEAR_REASON[c.reason] || c.reason_text || '')}`)
        .join(' · ');
      box.innerHTML = `
        <p class="near__hint">لا يوجد كابتن يشارك موقعه الآن ويصلح لهذا الطلب.</p>
        ${why ? `<p class="near__skipped">${why}</p>` : ''}`;
      return;
    }

    box.innerHTML = `
      <p class="near__hint">الأقرب إلى موقع الزبون — مسافة مستقيمة لا مسافة سياقة:</p>
      <div class="near__list">
        ${data.candidates.map((c) => `
          <button type="button" class="near__item" data-agent="${c.id || c.agent_id}">
            <b>${esc(c.agent_name)}</b>
            <span class="near__km">${AR.number(c.straight_km, 1)} كم</span>
            <span class="near__meta">${AR.describe(c.active_orders, 'order', 'active')} · ${c.age_minutes < 1 ? 'موقعه الآن' : `موقعه قبل ${AR.number(Math.round(c.age_minutes))} د`}</span>
          </button>`).join('')}
      </div>
      ${data.skipped.length ? `<p class="near__skipped">استُبعد ${AR.describe(data.skipped.length, 'agent')}</p>` : ''}`;

    box.querySelectorAll('.near__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        select.value = btn.dataset.agent;
        box.querySelectorAll('.near__item').forEach((b) => b.classList.remove('is-picked'));
        btn.classList.add('is-picked');
      });
    });
  }

  function promptAssign(order) {
    const options = assignableAgents(order.agent_id);
    openModal('إسناد الطلب لمندوب', `
      <div class="near" id="nearBox"></div>
      <form id="assignForm">
        <label class="field">
          <span>المندوب</span>
          <select name="agent_id" required>
            <option value="">اختر مندوبًا…</option>
            ${options.map((a) => `<option value="${a.id}">${esc(a.name)}${probationTag(a)} — ${esc(a.governorate || 'بلا منطقة')} (${AR.describe(a.active_orders, 'order', 'active')})</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>ملاحظة (اختيارية)</span>
          <textarea name="note" placeholder="سبب الإسناد أو إعادة التوزيع"></textarea>
        </label>
        <p class="form-msg" id="assignMsg"></p>
        <button class="btn btn--primary btn--block" type="submit">إسناد</button>
      </form>`, (body) => {
      fillNearest(body.querySelector('#nearBox'), order, body.querySelector('[name="agent_id"]'));
      body.querySelector('#assignForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = body.querySelector('#assignMsg');
        await submit(e.target, msg, async () => {
          await api(`/orders/${order.id}/assign`, {
            method: 'POST',
            body: { agent_id: Number(e.target.agent_id.value), note: e.target.note.value.trim() },
          });
          closeModal();
          toast('تم إسناد الطلب', 'ok');
          await refreshShared();
          await renderOrderDetail(order.id);
        });
      });
    });
  }

  /* ---- التحويلات ---- */

  function transferCard(t) {
    const isIncoming = t.to_agent_id === state.me.id;
    const canRespond = t.status === 'pending' && (isIncoming || state.me.role === 'admin');
    const canCancel = t.status === 'pending' && (t.from_agent_id === state.me.id || state.me.role === 'admin');
    return `
      <div class="order" style="cursor:default">
        <div class="order__top">
          <a class="order__code num" href="#/orders/${t.order_id}">${esc(t.code)}</a>
          <span class="badge badge--${t.status === 'pending' ? 'pending' : t.status === 'accepted' ? 'delivered' : t.status === 'rejected' ? 'rejected' : 'offline'}">
            ${esc({ pending: 'بانتظار الردّ', accepted: 'مقبول', rejected: 'مرفوض', cancelled: 'مسحوب' }[t.status])}
          </span>
          ${t.priority === 'urgent' ? '<span class="badge badge--urgent">عاجل</span>' : ''}
        </div>
        <div class="order__customer">${esc(t.customer_name)}</div>
        <div class="order__route">
          ${isIncoming ? 'من' : 'إلى'} <b>${esc(isIncoming ? t.from_name : t.to_name)}</b>
          — «${esc(t.reason)}»
        </div>
        <div class="order__meta">
          <span>${esc(t.dropoff_address)}</span>
          <span>${esc(t.governorate)}</span>
          ${t.cod_amount > 0 ? `<span>تحصيل <b class="num">${money(t.cod_amount)}</b> د.ك</span>` : ''}
          <span>${esc(relTime(t.created_at))}</span>
        </div>
        ${t.response_note ? `<div class="order__route">الردّ: «${esc(t.response_note)}»</div>` : ''}
        ${(canRespond || canCancel) ? `
          <div class="btn-row" style="margin-top:.7rem">
            ${canRespond && isIncoming || (canRespond && state.me.role === 'admin') ? `
              <button class="btn btn--primary btn--sm" data-transfer="accept" data-id="${t.id}">قبول</button>
              <button class="btn btn--danger btn--sm" data-transfer="reject" data-id="${t.id}">رفض</button>` : ''}
            ${canCancel ? `<button class="btn btn--quiet btn--sm" data-transfer="cancel" data-id="${t.id}">سحب</button>` : ''}
          </div>` : ''}
      </div>`;
  }

  async function renderTransfers() {
    el.view.innerHTML = `<div class="page-head"><div><h1>التحويلات</h1></div></div>${skeleton(3)}`;
    const [inbox, outbox] = await Promise.all([
      api('/transfers?box=inbox'),
      api('/transfers?box=outbox'),
    ]);

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>التحويلات</h1>
          <p>الطلبات التي يريد زملاؤك تحويلها إليك، والطلبات التي حوّلتها أنت.</p>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h2>محوّلة إليّ</h2></div>
        <div class="card__body">
          ${inbox.transfers.length
            ? `<div class="orders">${inbox.transfers.map(transferCard).join('')}</div>`
            : emptyState('لا توجد تحويلات واردة', 'ستظهر هنا الطلبات التي يحوّلها الزملاء إليك.')}
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h2>حوّلتها أنا</h2></div>
        <div class="card__body">
          ${outbox.transfers.length
            ? `<div class="orders">${outbox.transfers.map(transferCard).join('')}</div>`
            : emptyState('لم تحوّل أي طلب بعد', 'افتح أي طلب مُسند إليك واضغط «تحويل لزميل».')}
        </div>
      </div>`;

    bindTransferActions(el.view);
  }

  function bindTransferActions(root) {
    root.querySelectorAll('[data-transfer]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.transfer;
        const id = btn.dataset.id;
        const labels = { accept: 'قبول التحويل', reject: 'رفض التحويل', cancel: 'سحب طلب التحويل' };
        openModal(labels[action], `
          <form id="respForm">
            <label class="field">
              <span>ملاحظة (اختيارية)</span>
              <textarea name="note" placeholder="${action === 'reject' ? 'سبب الرفض' : 'أي ملاحظة للزميل'}"></textarea>
            </label>
            <p class="form-msg" id="respMsg"></p>
            <button class="btn ${action === 'accept' ? 'btn--primary' : action === 'reject' ? 'btn--danger' : 'btn--quiet'} btn--block" type="submit">
              تأكيد
            </button>
          </form>`, (body) => {
          body.querySelector('#respForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = body.querySelector('#respMsg');
            await submit(e.target, msg, async () => {
              await api(`/transfers/${id}/${action}`, { method: 'POST', body: { note: e.target.note.value.trim() } });
              closeModal();
              toast({ accept: 'تم قبول التحويل، الطلب صار لك', reject: 'تم رفض التحويل', cancel: 'تم سحب طلب التحويل' }[action], 'ok');
              await refreshShared();
              await router();
            });
          });
        });
      });
    });
  }

  /* ---- المندوبون (للمدير) ---- */

  /** وسم حالة الاعتماد */
  const approvalBadge = (a) =>
    `<span class="badge badge--ap-${a.approval}">${esc(state.meta.approval[a.approval] || a.approval)}</span>`;

  /** هل يستطيع الحساب العمل واستلام الطلبات */
  const canWork = (a) => state.meta.working_approvals.includes(a.approval);

  /** هل بلغ المندوب تحت التجربة سقف طلباته النشطة */
  const atProbationCap = (a) =>
    a.approval === 'under_test' && state.meta.probation_max_orders > 0
      && a.active_orders >= state.meta.probation_max_orders;

  /**
   * المندوبون المؤهّلون لاستلام طلب. الخادم يفرض القاعدة نفسها؛ الفلترة هنا
   * حتى لا يختار المدير مندوبًا ثم تُرفض العملية.
   */
  const assignableAgents = (excludeId) => state.agents.filter((a) =>
    a.role === 'agent' && a.active && canWork(a) && !atProbationCap(a) && a.id !== excludeId);

  /** لاحقة توضّح أن المندوب تحت التجربة داخل القوائم المنسدلة */
  const probationTag = (a) => (a.approval === 'under_test' ? ' — تحت التجربة' : '');

  async function renderAgents() {
    if (state.me.role !== 'admin') { location.hash = '#/'; return; }
    el.view.innerHTML = `<div class="page-head"><div><h1>المندوبون</h1></div></div>${skeleton(2)}`;
    await refreshShared();

    const filter = state.agentsFilter || '';
    const shown = filter ? state.agents.filter((a) => a.approval === filter) : state.agents;
    const countOf = (k) => state.agents.filter((a) => a.approval === k).length;

    const tabs = [{ key: '', label: 'الكل', n: state.agents.length }]
      .concat(Object.entries(state.meta.approval).map(([k, v]) => ({ key: k, label: v, n: countOf(k) })));

    const cap = state.meta.probation_max_orders;

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>المندوبون</h1>
          <p>اعتماد الحسابات وإدارة الأحمال الحالية.</p>
        </div>
        <button class="btn btn--accent" id="addAgent" type="button">+ حساب جديد</button>
      </div>

      <div class="filters" role="tablist" aria-label="تصفية حسب حالة الاعتماد">
        ${tabs.map((t) => `
          <button class="chip${filter === t.key ? ' is-on' : ''}" role="tab"
                  aria-selected="${filter === t.key}" data-approval="${t.key}" type="button">
            ${esc(t.label)} <span class="n">${ar(t.n)}</span>
          </button>`).join('')}
      </div>

      ${countOf('under_test') > 0 && !filter ? `
        <p class="notice notice--warn">
          ${count(countOf('under_test'), 'account')} تحت التجربة بانتظار قرارك.
          ${cap > 0 ? `سقف الطلبات النشطة لكل واحد منهم ${count(cap, 'order')}.` : ''}
        </p>` : ''}

      <div class="card">
        <div class="card__body card__body--flush">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th><th>الاعتماد</th><th>اسم المستخدم</th><th>الدور</th>
                  <th>المركبة</th><th>المنطقة</th><th>التوفّر</th><th>طلبات نشطة</th>
                  <th>الهاتف</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${shown.length === 0 ? `
                  <tr><td colspan="10" class="td-empty">لا حسابات في هذه الحالة.</td></tr>` : ''}
                ${shown.map((a) => `
                  <tr${canWork(a) ? '' : ' class="row--muted"'}>
                    <td data-label="الاسم" class="cell--head">
                      <b>${esc(a.name)}</b>
                      ${a.approval_note ? `<small class="row__note">${esc(a.approval_note)}</small>` : ''}
                    </td>
                    <td data-label="الاعتماد">${approvalBadge(a)}</td>
                    <td data-label="اسم المستخدم"><span dir="ltr">${esc(a.username)}</span></td>
                    <td data-label="الدور">${esc(state.meta.roles[a.role])}</td>
                    <td data-label="المركبة">${esc(vehicleName(a.vehicle))}</td>
                    <td data-label="المنطقة">${esc(a.governorate || '—')}</td>
                    <td data-label="التوفّر">${canWork(a)
                      ? `<span class="badge badge--${a.availability}">${esc(state.meta.availability[a.availability])}</span>`
                      : '<span class="muted">—</span>'}</td>
                    <td data-label="طلبات نشطة" class="num">${ar(a.active_orders)}${
                      a.approval === 'under_test' && cap > 0 ? `<small class="muted"> / ${ar(cap)}</small>` : ''}</td>
                    <td data-label="الهاتف"><span dir="ltr">${esc(a.phone || '—')}</span></td>
                    <td class="row__actions">
                      <button class="btn btn--ghost btn--sm" data-approval-for="${a.id}" type="button">الاعتماد</button>
                      <button class="btn btn--ghost btn--sm" data-edit="${a.id}" type="button">تعديل</button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>`;

    document.getElementById('addAgent').addEventListener('click', promptNewAgent);
    el.view.querySelectorAll('[data-approval]').forEach((b) =>
      b.addEventListener('click', () => { state.agentsFilter = b.dataset.approval; renderAgents(); }));
    el.view.querySelectorAll('[data-edit]').forEach((b) =>
      b.addEventListener('click', () => promptEditAgent(state.agents.find((a) => a.id === Number(b.dataset.edit)))));
    el.view.querySelectorAll('[data-approval-for]').forEach((b) =>
      b.addEventListener('click', () => promptApproval(state.agents.find((a) => a.id === Number(b.dataset.approvalFor)))));
  }

  /** شاشة قرار الاعتماد: الحالة الحالية، والحمل، والسجل، وتغيير الحالة بسبب */
  async function promptApproval(a) {
    if (!a) return;
    openModal(`اعتماد: ${a.name}`, skeleton(2));

    let info;
    try {
      info = await api('/agents/' + a.id + '/approval');
    } catch (err) {
      el.modalBody.innerHTML = `<p class="form-msg is-error">${esc(err.message)}</p>`;
      return;
    }

    const cur = info.agent.approval;
    const cap = state.meta.probation_max_orders;
    const options = Object.entries(state.meta.approval).filter(([k]) => k !== cur);

    el.modalBody.innerHTML = `
      <div class="approval">
        <div class="approval__now">
          <span>الحالة الحالية</span>
          ${approvalBadge(info.agent)}
          ${info.agent.approval_note ? `<p class="approval__note">${esc(info.agent.approval_note)}</p>` : ''}
        </div>

        <p class="approval__load">
          ${AR.describe(info.active_orders, 'order', 'active')} لدى هذا الحساب.
          ${info.active_orders > 0
            ? '<b>لا يمكن حظره أو رفضه قبل إعادة إسناد طلباته لمندوب آخر.</b>'
            : ''}
        </p>

        <form id="approvalForm">
          <label class="field">
            <span>الحالة الجديدة</span>
            <select name="approval" required>
              ${options.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>السبب <small class="muted">(إلزامي عند الرفض أو الحظر)</small></span>
            <textarea name="note" rows="2" maxlength="400"
                      placeholder="يُحفظ في سجل الحساب ويظهر للإدارة"></textarea>
          </label>
          <p class="form-msg" id="approvalMsg"></p>
          <button class="btn btn--primary btn--block" type="submit">حفظ القرار</button>
        </form>

        ${cap > 0 && cur === 'under_test'
          ? `<p class="approval__hint">تحت التجربة: سقف ${count(cap, 'order')} نشطة في وقت واحد.</p>` : ''}

        <h4 class="approval__h">سجل القرارات</h4>
        <ol class="approval__log">
          ${info.history.length === 0 ? '<li class="muted">لا قرارات سابقة.</li>' : ''}
          ${info.history.map((h) => `
            <li>
              <b>${esc(state.meta.approval[h.to_value] || h.to_value)}</b>
              ${h.from_value ? `<span class="muted">من ${esc(state.meta.approval[h.from_value] || h.from_value)}</span>` : ''}
              <span class="muted">— ${esc(h.actor_name || 'النظام')}، ${esc(relTime(h.created_at))}</span>
              ${h.note ? `<p class="approval__note">${esc(h.note)}</p>` : ''}
            </li>`).join('')}
        </ol>
      </div>`;

    el.modalBody.querySelector('#approvalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = el.modalBody.querySelector('#approvalMsg');
      const fd = Object.fromEntries(new FormData(e.target));
      await submit(e.target, msg, async () => {
        await api('/agents/' + a.id + '/approval', { method: 'PATCH', body: fd });
        closeModal();
        toast('تم حفظ قرار الاعتماد', 'ok');
        await renderAgents();
      });
    });
  }

  function agentFormFields(a = {}) {
    return `
      <div class="form-grid">
        <label class="field"><span>الاسم الكامل</span><input name="name" required autocomplete="name" value="${esc(a.name || '')}"></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" value="${esc(a.phone || '')}"></label>
        <label class="field">
          <span>نوع المركبة</span>
          <select name="vehicle">
            ${Object.entries(state.meta.vehicles).map(([k, v]) =>
              `<option value="${k}"${a.vehicle === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>منطقة العمل</span>
          <select name="governorate">
            <option value="">بلا تحديد</option>
            ${state.meta.governorates.map((g) =>
              `<option value="${esc(g)}"${a.governorate === g ? ' selected' : ''}>${esc(g)}</option>`).join('')}
          </select>
        </label>
      </div>`;
  }

  function promptNewAgent() {
    openModal('إضافة حساب جديد', `
      <form id="agentForm">
        ${agentFormFields()}
        <div class="form-grid">
          <label class="field">
            <span>اسم المستخدم</span>
            <input name="username" dir="ltr" required placeholder="ahmad" pattern="[a-z0-9._\\-]+"
                   autocapitalize="off" autocorrect="off" spellcheck="false">
            <small>حروف لاتينية صغيرة وأرقام فقط</small>
          </label>
          <label class="field"><span>كلمة المرور</span><input name="password" type="password" required minlength="6"></label>
          <label class="field field--full">
            <span>الدور</span>
            <select name="role">
              <option value="agent">مندوب توصيل</option>
              <option value="admin">مدير عمليات</option>
            </select>
          </label>
        </div>
        <p class="form-msg" id="agentMsg"></p>
        <button class="btn btn--primary btn--block" type="submit">إنشاء الحساب</button>
      </form>`, (body) => {
      body.querySelector('#agentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = body.querySelector('#agentMsg');
        const fd = Object.fromEntries(new FormData(e.target));
        await submit(e.target, msg, async () => {
          await api('/agents', { method: 'POST', body: fd });
          closeModal();
          toast('تم إنشاء الحساب', 'ok');
          await renderAgents();
        });
      });
    });
  }

  function promptEditAgent(a) {
    if (!a) return;
    openModal(`تعديل: ${a.name}`, `
      <form id="agentForm">
        ${agentFormFields(a)}
        <label class="field">
          <span>كلمة مرور جديدة (اتركها فارغة لعدم التغيير)</span>
          <input name="password" type="password" minlength="6" autocomplete="new-password">
        </label>
        <p class="hint">
          الحالة الحالية: ${esc(state.meta.approval[a.approval] || a.approval)}.
          تُغيَّر من زر «الاعتماد» لأنها تتطلّب سببًا وتُسجَّل في سجل الحساب.
        </p>
        <p class="form-msg" id="agentMsg"></p>
        <button class="btn btn--primary btn--block" type="submit">حفظ التعديلات</button>
      </form>`, (body) => {
      body.querySelector('#agentForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = body.querySelector('#agentMsg');
        const fd = Object.fromEntries(new FormData(e.target));
        if (!fd.password) delete fd.password;
        await submit(e.target, msg, async () => {
          await api('/agents/' + a.id, { method: 'PATCH', body: fd });
          closeModal();
          toast('تم حفظ التعديلات', 'ok');
          await renderAgents();
        });
      });
    });
  }

  /* ---- طلب جديد (للمدير) ---- */

  async function renderNewOrder() {
    if (state.me.role !== 'admin') { location.hash = '#/'; return; }
    await refreshShared();

    el.view.innerHTML = `
      <div class="page-head"><div><h1>طلب جديد</h1><p>سجّل شحنة جديدة وأسندها لمندوب مباشرةً أو اتركها بانتظار الإسناد.</p></div></div>

      <div class="card vo">
        <div class="card__body">
          <div class="vo__head">
            <h2>ألصق الطلب هنا</h2>
            <p>ألصق كلام الزبون كما وصلك — أو تكلّم به — فتُملأ الحقول تحت وحدها.
               <b>راجعها قبل الإنشاء</b>: الوكيل يقترح ولا ينشئ.</p>
          </div>
          <!-- عمودان على الشاشة العريضة: النصّ الملصوق يمينًا وما فُهم منه
               يسارَه. والمراجعة مقارنة بين الاثنين، فوضعُهما فوق بعض يجعل
               المراجع يصعد وينزل بينهما، ويدفع النموذج نفسه خارج الشاشة. -->
          <div class="vo__grid">
            <div class="vo__in">
              <label class="field field--full">
                <span>نصّ الطلب</span>
                <textarea id="voText" rows="5" placeholder="الاسم: منى الصباح
الهاتف: ٩٩٨٨٧٧٦٦
الاستلام: السالمية ق٤ ش سالم المبارك
التسليم: الفحيحيل ق٧
المبلغ: ١٢٫٥٠٠

— أو بلا عناوين: «من السالمية قطعة ٤ إلى الفحيحيل قطعة ٧»"></textarea>
              </label>
              <div class="vo__bar">
                <button type="button" class="btn btn--primary" id="voMic" hidden>
                  <span id="voMicLabel">تكلّم بالطلب</span>
                </button>
                <button type="button" class="btn btn--quiet" id="voClear">امسح</button>
                <span class="vo__auto" id="voAuto"></span>
              </div>
            </div>
            <div id="voOut" class="vo__out"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card__body">
          <form id="orderForm">
            <div class="form-grid">
              <label class="field"><span>اسم العميل</span><input name="customer_name" required autocomplete="name" enterkeyhint="next"></label>
              <label class="field"><span>هاتف العميل</span><input name="customer_phone" type="tel" inputmode="tel" autocomplete="tel"
                dir="ltr" required placeholder="+965…" enterkeyhint="next"></label>
              <fieldset class="addr field--full">
                <legend>الاستلام</legend>
                <div class="addr__row">
                  <label class="field">
                    <span>المحافظة</span>
                    <select name="governorate" data-areas="pickup_area" required>
                      <option value="">اختر…</option>
                      ${state.meta.governorates.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
                    </select>
                  </label>
                  <label class="field">
                    <span>المنطقة</span>
                    <select name="pickup_area"><option value="">اختر المحافظة أولًا</option></select>
                  </label>
                  <label class="field">
                    <span>القطعة</span>
                    <input name="pickup_block" type="text" inputmode="numeric" data-block dir="ltr" placeholder="٤">
                  </label>
                </div>
                <label class="field field--full">
                  <span>الشارع والمبنى</span>
                  <input name="pickup_street" placeholder="شارع سالم المبارك، مبنى ١٢"
                         autocorrect="off" autocomplete="off">
                </label>
              </fieldset>

              <fieldset class="addr field--full">
                <legend>التسليم</legend>
                <div class="addr__row">
                  <label class="field">
                    <span>المحافظة</span>
                    <select name="dropoff_governorate" data-areas="dropoff_area">
                      <option value="">مثل الاستلام</option>
                      ${state.meta.governorates.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
                    </select>
                  </label>
                  <label class="field">
                    <span>المنطقة</span>
                    <select name="dropoff_area"><option value="">اختر المحافظة أولًا</option></select>
                  </label>
                  <label class="field">
                    <span>القطعة</span>
                    <input name="dropoff_block" type="text" inputmode="numeric" data-block dir="ltr" placeholder="٧">
                  </label>
                </div>
                <label class="field field--full">
                  <span>الشارع والمبنى</span>
                  <input name="dropoff_street" placeholder="شارع تونس، مبنى ٣"
                         autocorrect="off" autocomplete="off">
                </label>
              </fieldset>
              <label class="field">
                <span>نوع المركبة</span>
                <select name="vehicle">
                  ${Object.entries(state.meta.vehicles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
                </select>
              </label>
              <label class="field"><span>المبلغ المطلوب تحصيله (د.ك)</span><input name="cod_amount" type="text" inputmode="decimal" data-money value="0" dir="ltr"></label>
              <label class="field"><span>رسوم التوصيل (د.ك)</span><input name="delivery_fee" type="text" inputmode="decimal" data-money value="1.5" dir="ltr"></label>
              <label class="field">
                <span>الأولوية</span>
                <select name="priority">
                  <option value="normal">عادي</option>
                  <option value="urgent">عاجل</option>
                </select>
              </label>
              <label class="field">
                <span>إسناد لمندوب (اختياري)</span>
                <select name="agent_id">
                  <option value="">بانتظار الإسناد</option>
                  ${assignableAgents().map((a) =>
                    `<option value="${a.id}">${esc(a.name)}${probationTag(a)} — ${AR.describe(a.active_orders, 'order', 'active')}</option>`).join('')}
                </select>
              </label>
              <label class="field field--full"><span>ملاحظات للمندوب</span><textarea name="notes" placeholder="تفاصيل الشحنة، تعليمات التسليم…"></textarea></label>
            </div>
            <p class="form-msg" id="orderMsg"></p>
            <button class="btn btn--primary btn--lg" type="submit">إنشاء الطلب</button>
          </form>
        </div>
      </div>`;

    /* المنطقة تتبع المحافظة: اختيار محافظة يملأ قائمة مناطقها. وقائمة التسليم
       تتبع محافظة التسليم إن اختيرت، وإلّا فمحافظة الاستلام — كما يفترض
       الخادم تمامًا، فلا يعرض النموذج خيارًا يرفضه. */
    function fillAreas(gov, targetName) {
      const sel = document.querySelector(`[name="${targetName}"]`);
      if (!sel) return;
      const keep = sel.value;
      const list = (state.meta.areas || {})[gov] || [];
      sel.innerHTML = list.length
        ? '<option value="">بلا تحديد</option>' + list.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')
        : '<option value="">اختر المحافظة أولًا</option>';
      if (keep && list.includes(keep)) sel.value = keep;
    }

    const govPick = document.querySelector('[name="governorate"]');
    const govDrop = document.querySelector('[name="dropoff_governorate"]');
    const syncDrop = () => fillAreas(govDrop.value || govPick.value, 'dropoff_area');
    govPick.addEventListener('change', () => { fillAreas(govPick.value, 'pickup_area'); syncDrop(); });
    govDrop.addEventListener('change', syncDrop);

    /* القطعة تُكتب بالعربية كما تُقرأ.
       كان الحقل `type=number`، والمتصفّح يرفض «٤» بصمت: يكتبها الموظّف على
       لوحة مفاتيح عربية فلا يظهر شيء ولا يقول له أحد لماذا. فصار نصًّا
       يقبل الرقمين ويحوّل العربيّ إلى لاتينيّ قبل الإرسال — والخادم يبقى
       هو الحكم على المدى. */
    for (const box of document.querySelectorAll('[data-block]')) {
      box.addEventListener('input', () => {
        const at = box.selectionStart;
        const clean = AR.toLatin(box.value).replace(/[^0-9]/g, '');
        if (clean !== box.value) { box.value = clean; try { box.setSelectionRange(at, at); } catch { /* لا يهمّ */ } }
      });
    }

    /* المبالغ كالقطعة: كانت `type=number` فتفتح على الجوال لوحةً بلا فاصلة
       عشرية في بعض اللغات، وتغيّر قيمتها إن مرّ الإصبع فوقها. وصارت نصًّا
       بلوحة أرقام عشرية (`inputmode=decimal`) تقبل «٢٫٥» و«2.5» سواءً —
       والخادم يبقى هو الحكم على المدى. */
    for (const box of document.querySelectorAll('[data-money]')) {
      box.addEventListener('input', () => {
        const at = box.selectionStart;
        let clean = AR.toLatin(box.value).replace(/[^0-9.]/g, '');
        const dot = clean.indexOf('.');            // فاصلة واحدة لا أكثر
        if (dot >= 0) clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
        if (clean !== box.value) { box.value = clean; try { box.setSelectionRange(at, at); } catch { /* لا يهمّ */ } }
      });
    }

    /* ---------------------- الطلب المنطوق ---------------------- */

    /* التعرّف على الكلام يجري في المتصفّح نفسه: لا يخرج صوت الزبون إلى خدمة
       خارجية، ولا يحتاج النظام مفتاحًا مدفوعًا ليعمل. وما لا يدعمه المتصفّح
       يُقال صراحةً ويبقى اللصق طريقًا كاملًا — لا زرٌّ ميّت بلا تفسير. */
    const voText = document.getElementById('voText');
    const voOut = document.getElementById('voOut');
    const voMic = document.getElementById('voMic');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    function voFill(res) {
      /* الحقل الذي ملأه الوكيل يُعلَّم.
         ثلاثة عشر حقلًا تُملأ في لحظة، ومطالبةُ الموظّف بمراجعتها بلا دليل
         على أيّها تغيّر مطالبةٌ بلا معنى: يمرّ بعينه على النموذج فلا يعرف ما
         كتبه هو وما كتبه الوكيل. والعلامة تزول عند أول تعديل يدويّ — صار
         الحقل حينها حقلَه هو. */
      for (const f of document.querySelectorAll('#orderForm .is-filled')) f.classList.remove('is-filled');

      const set = (name, value) => {
        const f = document.querySelector(`#orderForm [name="${name}"]`);
        if (!f || value === undefined || value === null) return false;
        f.value = value;
        f.dispatchEvent(new Event('change', { bubbles: true }));
        f.classList.add('is-filled');
        f.addEventListener('input', () => f.classList.remove('is-filled'), { once: true });
        return true;
      };

      /* المحافظة قبل المنطقة: قائمة المناطق لا تُملأ إلّا بعد اختيار محافظتها */
      set('governorate', res.fields.governorate);
      set('dropoff_governorate', res.fields.dropoff_governorate);
      for (const [k, v] of Object.entries(res.fields)) {
        if (k === 'governorate' || k === 'dropoff_governorate') continue;
        set(k, v);
      }

      voOut.innerHTML = `
        ${res.heard.length ? `<div class="vo__heard"><b>فُهم:</b><ul>${
          res.heard.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
        ${res.missing.length ? `<div class="vo__missing"><b>لم يُذكر — اسأل عنه:</b><ul>${
          res.missing.map((m) => `<li>${esc(m.why)}${m.hint
            ? ` <button type="button" class="chip chip--yes" data-fix="${esc(m.field)}"
                 data-val="${esc(m.hint)}" data-from="${esc(m.hintFrom || '')}">ضع «${esc(m.hint)}»</button>` : ''}</li>`).join('')}</ul></div>` : ''}
        ${!res.heard.length ? '<p class="vo__none">لم يُفهم شيء من هذا النصّ. اكتب الحقول بيدك.</p>' : ''}`;

      /* الاقتراح لا يُطبَّق إلّا بضغطة الموظّف. والمحافظة تُضبط قبل المنطقة،
         وإلّا كانت قائمة المناطق فارغةً فلا يقع الاختيار. */
      for (const b of voOut.querySelectorAll('[data-fix]')) {
        b.addEventListener('click', () => {
          /* المحافظة تُعكس من `meta.areas` الموجودة أصلًا، فلا تُضاف خريطة
             ثانية إلى الواجهة البرمجية تفترق عن الأولى يوم تُعدَّل. */
          const govName = Object.keys(state.meta.areas || {})
            .find((g) => state.meta.areas[g].includes(b.dataset.val));
          const isDrop = b.dataset.fix.startsWith('dropoff');
          if (govName) set(isDrop ? 'dropoff_governorate' : 'governorate', govName);
          set(b.dataset.fix, b.dataset.val);

          /* الكلمة المخطئة كانت قد سقطت في «الشارع» لأنها لم تُعرف منطقةً،
             فتخرج منه الآن — وإلّا صار العنوان «السالمية، السالمي». */
          const street = document.querySelector(`#orderForm [name="${isDrop ? 'dropoff' : 'pickup'}_street"]`);
          if (b.dataset.from && street) {
            const left = street.value.replace(b.dataset.from, '').replace(/\s+/g, ' ').trim();
            if (left !== street.value) set(`${isDrop ? 'dropoff' : 'pickup'}_street`, left);
          }
          b.closest('li').remove();
        });
      }
    }

    const voAuto = document.getElementById('voAuto');
    /* «حقل» ليس في قاموس الحزمة، وصيغه تُمرَّر كما تسمح الحزمة صراحةً */
    const VO_FIELD = {
      gender: 'm', human: false, zero: 'لا حقول', one: 'حقل واحد', two: 'حقلان',
      twoOblique: 'حقلين', few: 'حقول', many: 'حقلًا', other: 'حقل',
    };

    async function voParse() {
      const transcript = voText.value.trim();
      if (!transcript) { voOut.innerHTML = ''; voAuto.textContent = ''; return; }
      voAuto.textContent = 'يقرأ…';
      try {
        const res = await api('/voice-orders/parse', { method: 'POST', body: { transcript } });
        voFill(res);
        voAuto.textContent = res.heard.length
          ? 'مُلئ ' + AR.plural(Object.keys(res.fields).length, VO_FIELD)
          : '';
      } catch (err) {
        voAuto.textContent = '';
        voOut.innerHTML = `<p class="vo__none">${esc(err.message)}</p>`;
      }
    }

    /* اللصق يملأ وحده — لا زرّ بينهما.
       الزرّ خطوة يدوية بلا فائدة: من ألصق النصّ يريد قراءته، وإن نُسي الزرّ
       ظنّ أن الوكيل لا يعمل. والكتابة تُمهَل قليلًا حتى لا يُقرأ نصف سطر. */
    /* الصندوق يكبر بما فيه: من ألصق طلبًا كاملًا يريد أن يراه كلّه ليقارنه
       بما فُهم، لا أن يمرّره سطرين سطرين. وله سقف حتى لا يدفع النموذج بعيدًا. */
    const voGrow = () => {
      voText.style.height = 'auto';
      voText.style.height = Math.min(voText.scrollHeight + 2, 340) + 'px';
    };

    let voTimer = null;
    const voSoon = (ms) => {
      clearTimeout(voTimer);
      voTimer = setTimeout(voParse, ms);
    };
    voText.addEventListener('paste', () => { setTimeout(voGrow, 0); voSoon(60); });

    /* نصٌّ جاء من الوكيل في الصفحة الرئيسية: يُقرأ هنا ويُراجَع ويُنشأ
       بالمسار المعتاد. ويُمسح بعد أخذه فلا يعود على طلبٍ تالٍ. */
    if (state.carryOrderText) {
      voText.value = state.carryOrderText;
      state.carryOrderText = null;
      voGrow();
      voParse();
    }
    voText.addEventListener('input', () => { voGrow(); voSoon(700); });

    document.getElementById('voClear').addEventListener('click', () => {
      clearTimeout(voTimer);
      voText.value = ''; voOut.innerHTML = ''; voAuto.textContent = '';
      voText.style.height = '';
      voText.focus();
    });

    if (SR) {
      voMic.hidden = false;
      const rec = new SR();
      rec.lang = 'ar-KW';
      rec.interimResults = true;
      rec.continuous = true;
      let on = false;

      const label = (t) => { document.getElementById('voMicLabel').textContent = t; };
      rec.addEventListener('result', (e) => {
        let out = '';
        for (const r of e.results) out += r[0].transcript;
        voText.value = out.trim();
      });
      rec.addEventListener('error', (e) => {
        on = false; label('تكلّم بالطلب'); voMic.classList.remove('is-live');
        voOut.innerHTML = `<p class="vo__none">${esc(
          e.error === 'not-allowed' ? 'المتصفّح منع استعمال الميكروفون — اسمح به أو ألصق النصّ.'
          : e.error === 'no-speech' ? 'لم يصل كلام. حاول ثانيةً أو ألصق النصّ.'
          : 'تعذّر التعرّف على الكلام. ألصق النصّ.')}</p>`;
      });
      rec.addEventListener('end', () => {
        if (!on) return;
        on = false; label('تكلّم بالطلب'); voMic.classList.remove('is-live');
        voParse();
      });

      voMic.addEventListener('click', () => {
        if (on) { on = false; rec.stop(); label('تكلّم بالطلب'); voMic.classList.remove('is-live'); voParse(); return; }
        voText.value = ''; voOut.innerHTML = '';
        on = true; label('أنصت… اضغط للإيقاف'); voMic.classList.add('is-live');
        try { rec.start(); } catch { /* جارٍ أصلًا */ }
      });
    } else {
      voOut.innerHTML = '<p class="vo__none">هذا المتصفّح لا يدعم التعرّف على الكلام — ألصق نصّ الطلب واضغط «اقرأ النصّ».</p>';
    }

    document.getElementById('orderForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('orderMsg');
      const fd = Object.fromEntries(new FormData(e.target));
      for (const k of Object.keys(fd)) if (fd[k] === '') delete fd[k];
      await submit(e.target, msg, async () => {
        const { order } = await api('/orders', { method: 'POST', body: fd });
        toast(`تم إنشاء الطلب ${order.code}`, 'ok');
        location.hash = '#/orders/' + order.id;
      });
    });
  }


  /* ========================= تتبّع الموقع ========================= */

  const geo = {
    watchId: null,
    lastSent: 0,
    /** أقل فاصل بين إرسالين — يطابق الحدّ في الخادم */
    interval: 10000,

    supported() {
      return 'geolocation' in navigator;
    },
    /** المتصفحات تمنع تحديد الموقع خارج سياق آمن */
    secure() {
      return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    },

    start() {
      if (this.watchId != null || !this.supported() || !this.secure()) return;
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.onPosition(pos),
        (err) => this.onError(err),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 25000 }
      );
    },

    stop() {
      if (this.watchId == null) return;
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    },

    async onPosition(pos) {
      const now = Date.now();
      if (now - this.lastSent < this.interval) return;
      this.lastSent = now;
      const c = pos.coords;
      try {
        await api('/me/location', {
          method: 'POST',
          body: {
            lat: c.latitude, lng: c.longitude,
            accuracy: c.accuracy, speed: c.speed, heading: c.heading,
          },
        });
      } catch (err) {
        // الخادم قد يرفض إن سُحبت الموافقة من جهاز آخر — نوقف فورًا
        if (/موافقة|متوقفة/.test(err.message)) {
          this.stop();
          await refreshConsent();
          renderGeoBar();
        }
      }
    },

    onError(err) {
      const messages = {
        1: 'رفض المتصفح إذن الموقع. فعّله من إعدادات الموقع في المتصفح.',
        2: 'تعذّر تحديد موقعك حاليًا. تأكّد من تشغيل خدمة الموقع في جهازك.',
        3: 'انتهت مهلة تحديد الموقع.',
      };
      toast(messages[err.code] || 'تعذّر قراءة الموقع', 'bad');
      if (err.code === 1) { this.stop(); renderGeoBar(); }
    },
  };

  async function refreshConsent() {
    if (state.me.role !== 'agent') return null;
    state.loc = await api('/me/location-consent');
    return state.loc;
  }

  /** الشريط الدائم: المندوب يجب أن يرى أن موقعه يُشارَك، دائمًا */
  function renderGeoBar() {
    if (!state.me || state.me.role !== 'agent' || !state.loc) {
      el.geoBar.hidden = true;
      return;
    }
    const on = state.loc.consent && state.loc.sharing;
    el.geoBar.hidden = !state.loc.consent;
    el.geoBar.classList.toggle('geo-bar--off', !on);
    el.geoBarText.textContent = on
      ? 'مشاركة موقعك نشطة أثناء العمل'
      : 'مشاركة الموقع متوقفة';
    el.geoStop.textContent = on ? 'إيقاف المشاركة' : 'استئناف المشاركة';

    if (on) geo.start(); else geo.stop();
  }

  el.geoStop.addEventListener('click', async () => {
    try {
      state.loc = await api('/me/location-sharing', {
        method: 'PATCH',
        body: { sharing: !(state.loc && state.loc.sharing) },
      });
      renderGeoBar();
      toast(state.loc.sharing ? 'استُؤنفت مشاركة الموقع' : 'أُوقفت مشاركة الموقع', 'ok');
      if (parseHash().head === 'location') await renderLocation();
    } catch (err) { toast(err.message, 'bad'); }
  });

  /* ---- صفحة المندوب: الموافقة والتحكّم ---- */

  async function renderLocation() {
    if (state.me.role !== 'agent') { location.hash = '#/'; return; }
    el.view.innerHTML = skeleton(2);
    await refreshConsent();
    const L = state.loc;
    const blocked = !geo.supported() || !geo.secure();

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>موقعي</h1>
          <p>أنت تتحكّم بمشاركة موقعك بالكامل — لا يُسجَّل شيء بدون موافقتك.</p>
        </div>
      </div>

      ${blocked ? `<div class="card"><div class="card__body">${emptyState(
        'تحديد الموقع غير متاح في هذا المتصفح',
        !geo.secure()
          ? 'يعمل تحديد الموقع على اتصال آمن (HTTPS) فقط. افتح النظام عبر رابط آمن.'
          : 'متصفحك لا يدعم تحديد الموقع.')}</div></div>` : ''}

      <div class="consent">
        <div class="consent__head">
          <h2>${L.consent ? 'مشاركة الموقع مفعّلة' : 'مشاركة الموقع أثناء العمل'}</h2>
          <p>${L.consent
            ? 'وافقت في ' + esc(fmtDate(L.consent_at)) + '. يمكنك السحب في أي وقت.'
            : 'اقرأ ما يلي قبل الموافقة.'}</p>
        </div>
        <div class="consent__body">
          <ul class="consent__list">
            <li>يُسجَّل موقعك <b>فقط حين تكون المشاركة مشغّلة</b>، وتوقفها بضغطة واحدة متى شئت.</li>
            <li>يراه <b>مدير العمليات فقط</b> لتوزيع الطلبات ومتابعة التسليم — ولا يراه أي مندوب آخر.</li>
            <li>تُحذف النقاط تلقائيًا بعد <b>${count(L.retention_hours, 'hour')}</b>.</li>
            <li>عند سحب الموافقة <b>يُمسح كل سجلّ مواقعك فورًا</b>.</li>
            <li>تُسجَّل كل مرة يطّلع فيها المدير على موقعك، وتظهر لك أدناه.</li>
          </ul>

          <p class="consent__note">
            الموافقة اختيارية وقابلة للسحب، ولا تُستخدم لأي غرض غير توزيع الطلبات ومتابعتها.
          </p>

          <div class="btn-row">
            ${L.consent ? `
              <button class="btn ${L.sharing ? 'btn--quiet' : 'btn--primary'}" id="toggleShare" type="button">
                ${L.sharing ? 'إيقاف المشاركة مؤقتًا' : 'استئناف المشاركة'}
              </button>
              <button class="btn btn--ghost" id="purgeHistory" type="button">مسح سجلّ مواقعي</button>
              <button class="btn btn--danger" id="revoke" type="button">سحب الموافقة ومسح البيانات</button>
            ` : `
              <button class="btn btn--primary btn--lg" id="grant" type="button" ${blocked ? 'disabled' : ''}>
                أوافق على مشاركة موقعي أثناء العمل
              </button>
            `}
          </div>
        </div>
      </div>

      ${L.consent ? `
      <div class="card" style="margin-top:1.1rem">
        <div class="card__head"><h2>ما هو مخزّن الآن</h2></div>
        <div class="card__body">
          <dl class="kv">
            <dt>حالة المشاركة</dt>
            <dd>${L.sharing ? '<span class="badge badge--available">نشطة</span>' : '<span class="badge badge--offline">متوقفة</span>'}</dd>
            <dt>عدد النقاط المحفوظة</dt><dd class="num">${ar(L.stored_points)}</dd>
            <dt>آخر نقطة</dt><dd>${L.last_point_at ? esc(fmtDate(L.last_point_at)) + ' — ' + esc(relTime(L.last_point_at)) : 'لا توجد'}</dd>
            <dt>مدة الاحتفاظ</dt><dd>${count(L.retention_hours, 'hour')}</dd>
          </dl>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h2>من اطّلع على موقعي</h2></div>
        <div class="card__body">
          ${L.recent_views.length
            ? `<ul class="timeline">${L.recent_views.map((v) => `
                <li class="tl"><span class="tl__dot"></span>
                  <b>${esc(v.viewer_name)}</b>
                  <span>${esc(fmtDate(v.viewed_at))} — ${esc(relTime(v.viewed_at))}</span>
                </li>`).join('')}</ul>`
            : emptyState('لم يطّلع أحد بعد', 'سيظهر هنا كل اطّلاع من الإدارة على موقعك.')}
        </div>
      </div>` : ''}`;

    const bind = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener('click', fn);
    };

    bind('grant', async () => {
      // نطلب إذن المتصفح أولًا: لا معنى لتسجيل موافقة ثم يرفض الجهاز
      navigator.geolocation.getCurrentPosition(
        async () => {
          try {
            state.loc = await api('/me/location-consent', { method: 'POST', body: { granted: true } });
            toast('شكرًا — بدأت مشاركة موقعك أثناء العمل', 'ok');
            renderGeoBar();
            await renderLocation();
          } catch (err) { toast(err.message, 'bad'); }
        },
        (err) => geo.onError(err),
        { enableHighAccuracy: true, timeout: 20000 }
      );
    });

    bind('toggleShare', () => el.geoStop.click());

    bind('purgeHistory', () => {
      openModal('مسح سجلّ المواقع', `
        <p>سيُحذف كل ما سُجّل من نقاط موقعك حتى الآن. تبقى الموافقة فعّالة ويستمر التسجيل بعدها.</p>
        <div class="btn-row">
          <button class="btn btn--danger" id="confirmPurge" type="button">نعم، امسح السجل</button>
          <button class="btn btn--quiet" type="button" data-close>إلغاء</button>
        </div>`, (body) => {
        body.querySelector('#confirmPurge').addEventListener('click', async () => {
          try {
            const r = await api('/me/location-history', { method: 'DELETE' });
            state.loc = r;
            closeModal();
            toast('حُذفت ' + ar(r.deleted) + ' نقطة', 'ok');
            await renderLocation();
          } catch (err) { toast(err.message, 'bad'); }
        });
      });
    });

    bind('revoke', () => {
      openModal('سحب الموافقة', `
        <p>سيتوقّف تسجيل موقعك فورًا، و<b>يُمسح كل سجلّ مواقعك</b> نهائيًا.
           يمكنك الموافقة مجددًا في أي وقت.</p>
        <div class="btn-row">
          <button class="btn btn--danger" id="confirmRevoke" type="button">نعم، اسحب الموافقة</button>
          <button class="btn btn--quiet" type="button" data-close>إلغاء</button>
        </div>`, (body) => {
        body.querySelector('#confirmRevoke').addEventListener('click', async () => {
          try {
            state.loc = await api('/me/location-consent', { method: 'POST', body: { granted: false } });
            geo.stop();
            closeModal();
            toast('سُحبت الموافقة ومُسحت البيانات', 'ok');
            renderGeoBar();
            await renderLocation();
          } catch (err) { toast(err.message, 'bad'); }
        });
      });
    });
  }

  /* ---- لوحة المدير المباشرة ---- */

  // حدود الكويت التقريبية لرسم مخطّط المواقع
  const KW = { minLat: 28.45, maxLat: 30.15, minLng: 46.5, maxLng: 48.5 };

  /* درجة الطول أقصر من درجة العرض بجيب تمام العرض. لو رُسمتا بالطول نفسه
     ظهرت المسافة شرقًا-غربًا أطول مما هي، فيبدو كابتنان متجاوران متباعدين.
     نحسب النسبة من الحدود نفسها لا برقم مكتوب، فلا تنحرف لو عُدّلت الحدود. */
  const KW_RATIO =
    ((KW.maxLng - KW.minLng) * Math.cos((((KW.minLat + KW.maxLat) / 2) * Math.PI) / 180))
    / (KW.maxLat - KW.minLat);

  const REASONS = {
    no_consent: 'لم يمنح الموافقة',
    sharing_off: 'أوقف المشاركة',
    no_data: 'لا توجد قراءة بعد',
    stale: 'آخر قراءة قديمة',
  };

  /* ترتيب اللوحة بحسب ما يحتاجه المدير أولًا: من موقعه حيّ الآن، ثم من
     قراءته قديمة، ثم من لا قراءة له، ثم من أوقف المشاركة أو لم يوافق.
     الترتيب الأبجدي يدسّ من لم يوافق بين اثنين يتحرّكان الآن. */
  const LIVE_RANK = { null: 0, stale: 1, no_data: 2, sharing_off: 3, no_consent: 4 };
  const rankOf = (a) => (a.available ? 0 : (LIVE_RANK[a.reason] ?? 5));

  /* ------------------------- الإعدادات: العمولة ------------------------- */

  async function renderSettings() {
    if (state.me.role !== 'admin') { location.hash = '#/'; return; }
    el.view.innerHTML = `<div class="page-head"><div><h1>الإعدادات</h1></div></div>${skeleton(2)}`;

    let data;
    try {
      data = await api('/settings');
    } catch (err) {
      el.view.innerHTML = `<div class="card"><div class="card__body">${emptyState('تعذّر تحميل الإعدادات', err.message)}</div></div>`;
      return;
    }

    const s = data.settings;
    const isPercent = s.commission_type === 'percent';
    // مثال حيّ على رسوم شائعة حتى يرى المدير أثر العمولة قبل أن يحفظها
    const sample = 1.5;

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>الإعدادات</h1>
          <p>عمولة الوساطة وما يترتّب عليها من مستحقّات الكباتن.</p>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card__head"><h2>عمولة الوساطة</h2></div>
          <div class="card__body">
            <p class="hint">
              موصول وسيط بين الكابتن والزبون: العمولة دخل المنصّة، والباقي مستحقّ
              للكابتن. <b>تُلتقط على الطلب وقت إنشائه</b> — تغييرها هنا يسري على
              الطلبات الجديدة فقط ولا يمسّ طلبًا سابقًا.
            </p>

            <form id="settingsForm">
              <div class="form-grid">
                <label class="field">
                  <span>نوع العمولة</span>
                  <select name="commission_type" id="cType">
                    ${Object.entries(data.commission_types).map(([k, v]) =>
                      `<option value="${k}"${s.commission_type === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
                  </select>
                </label>
                <label class="field">
                  <span id="cLabel">${isPercent ? 'النسبة (٪)' : 'المبلغ (د.ك)'}</span>
                  <input name="commission_rate" id="cRate" type="number" dir="ltr"
                         step="${isPercent ? '0.5' : '0.05'}" min="0" max="100"
                         value="${esc(s.commission_rate)}" required>
                </label>
                <label class="field field--full">
                  <span>سبب التغيير <small class="muted">(اختياري، يُحفظ في السجل)</small></span>
                  <input name="note" maxlength="300" placeholder="مثال: مراجعة أسعار الربع الأول">
                </label>
              </div>

              <div class="calc" id="calc"></div>

              <p class="form-msg" id="settingsMsg"></p>
              <button class="btn btn--primary btn--block" type="submit">حفظ العمولة</button>
            </form>
          </div>
        </div>

        <div class="card">
          <div class="card__head">
            <h2>صادر البريد</h2>
            <button class="btn btn--quiet btn--sm" id="mailRetry" type="button">إعادة المحاولة</button>
          </div>
          <div class="card__body" id="mailBox">${skeleton(1)}</div>
        </div>

        <div class="card detail__full">
          <div class="card__head"><h2>سجل تغييرات العمولة</h2></div>
          <div class="card__body">
            <ol class="approval__log">
              ${data.history.length === 0 ? '<li class="muted">لم تُغيَّر العمولة بعد.</li>' : ''}
              ${data.history.map((h) => `
                <li>
                  <b>${esc(h.to_value)}</b>
                  <span class="muted">من ${esc(h.from_value)}</span>
                  <span class="muted">— ${esc(h.actor_name || 'النظام')}، ${esc(relTime(h.created_at))}</span>
                  ${h.note ? `<p class="approval__note">${esc(h.note)}</p>` : ''}
                </li>`).join('')}
            </ol>
          </div>
        </div>
      </div>`;

    const form = document.getElementById('settingsForm');
    const typeSel = document.getElementById('cType');
    const rateInp = document.getElementById('cRate');
    const calcBox = document.getElementById('calc');

    /** يعرض أثر القيمة المكتوبة على رسوم نموذجية، بنفس حساب الخادم */
    function paint() {
      const percent = typeSel.value === 'percent';
      document.getElementById('cLabel').textContent = percent ? 'النسبة (٪)' : 'المبلغ (د.ك)';
      rateInp.step = percent ? '0.5' : '0.05';

      const rate = Math.min(100, Math.max(0, Number(rateInp.value) || 0));
      const raw = percent ? sample * (rate / 100) : rate;
      const commission = Math.round(Math.min(sample, Math.max(0, raw)) * 1000) / 1000;
      const earning = Math.round((sample - commission) * 1000) / 1000;

      calcBox.innerHTML = `
        <span class="calc__t">على طلب رسومه ${money(sample)} د.ك</span>
        <div class="calc__row"><span>عمولة موصول</span><b>${money(commission)} د.ك</b></div>
        <div class="calc__row"><span>مستحقّ الكابتن</span><b>${money(earning)} د.ك</b></div>`;
    }

    typeSel.addEventListener('change', paint);
    rateInp.addEventListener('input', paint);
    paint();
    paintMailbox();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('settingsMsg');
      const fd = Object.fromEntries(new FormData(e.target));
      await submit(e.target, msg, async () => {
        await api('/settings', { method: 'PATCH', body: fd });
        toast('تم حفظ العمولة', 'ok');
        await renderSettings();
      });
    });
  }

  const MAIL_STATUS = { pending: 'بانتظار الإرسال', sent: 'أُرسلت', failed: 'فشلت' };

  /** صادر البريد داخل شاشة الإعدادات */
  async function paintMailbox() {
    const box = document.getElementById('mailBox');
    if (!box) return;

    let data;
    try {
      data = await api('/emails');
    } catch (err) {
      box.innerHTML = `<p class="form-msg is-error">${esc(err.message)}</p>`;
      return;
    }

    box.innerHTML = `
      ${data.configured
        ? `<p class="hint">الإرسال مضبوط إلى <b dir="ltr">${esc(data.to)}</b>.</p>`
        : `<p class="notice notice--warn">
             <b>لم يُضبط بريد الخادم بعد.</b> التقارير تُحفظ هنا ولا تضيع، لكنها
             لا تصل أحدًا حتى تُضبط <code dir="ltr">MAWSOOL_SMTP_URL</code> و
             <code dir="ltr">MAWSOOL_MAIL_TO</code> ثم تضغط «إعادة المحاولة».
           </p>`}

      <ol class="approval__log">
        ${data.emails.length === 0 ? '<li class="muted">لا رسائل بعد.</li>' : ''}
        ${data.emails.map((m) => `
          <li>
            <b>${esc(m.order_code || 'تقرير')}</b>
            <span class="badge badge--${m.status === 'sent' ? 'delivered' : m.status === 'failed' ? 'failed' : 'assigned'}">
              ${esc(MAIL_STATUS[m.status] || m.status)}</span>
            <span class="muted">— ${esc(relTime(m.created_at))}</span>
            ${m.error ? `<p class="approval__note">${esc(m.error)}</p>` : ''}
          </li>`).join('')}
      </ol>`;

    const retry = document.getElementById('mailRetry');
    if (retry && !retry.dataset.bound) {
      retry.dataset.bound = '1';
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        try {
          const r = await api('/emails/retry', { method: 'POST', body: {} });
          const sent = r.results.filter((x) => x.sent).length;
          toast(sent ? `أُرسلت ${count(sent, 'message')}` : 'لم تُرسل أي رسالة', sent ? 'ok' : '');
        } catch (err) { toast(err.message, 'error'); }
        retry.disabled = false;
        await paintMailbox();
      });
    }
  }

  const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  /* معظم كباتننا في مدينة الكويت، وعشرون نقطة هناك تصير بقعة واحدة لا تُقرأ
     ولا يُعرف كم فيها. فالنقاط المتلاصقة تُجمع في دائرة تحمل عددها، وتبقى
     نقطة كل كابتن على موضعها الحقيقي تظهر وحدها حين يُضاء سطره. */
  const DOT_R = 7; // نصف قطر النقطة المفردة كما تُرسم

  function drawClusters(map, groups) {
    const box = map.getBoundingClientRect();
    for (const old of map.querySelectorAll('.cluster')) old.remove();
    for (const pin of map.querySelectorAll('.pin')) pin.classList.remove('pin--clustered');

    groups.forEach((g, i) => {
      if (g.members.length < 2) { g.members[0].pin.dataset.group = i; return; }
      for (const m of g.members) { m.pin.classList.add('pin--clustered'); m.pin.dataset.group = i; }
      const stale = g.members.every((m) => m.pin.classList.contains('pin--stale'));
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'cluster' + (stale ? ' cluster--stale' : '');
      node.dataset.members = g.members.map((m) => m.pin.dataset.agent).join(' ');
      node.dataset.group = i;
      node.style.insetInlineStart = `${(100 - (g.x / box.width) * 100).toFixed(2)}%`;
      node.style.top = `${((g.y / box.height) * 100).toFixed(2)}%`;
      node.textContent = AR.digits(g.members.length);
      node.setAttribute('aria-label', `${AR.plural(g.members.length, 'agent')} في هذا الموضع`);
      map.appendChild(node);
    });
  }

  /* دائرة التجمّع أعرض من النقطة، وتتّسع أكثر برقم من خانتين. لذلك لا يكفي
     حساب المسافة بين المراكز بأنصاف أقطار مقدَّرة — نرسم ثم نقيس المستطيلات
     الفعلية، فإن تلامس رسمان ضُمّا وأُعيد الرسم. التقدير هو ما أخفى تراكبين. */
  function separateMarks(map, groups) {
    for (let pass = 0; pass < 24; pass++) {
      drawClusters(map, groups);
      const marks = [...map.querySelectorAll('.cluster, .pin:not(.pin--clustered) .pin__dot')]
        .map((n) => {
          const r = n.getBoundingClientRect();
          const owner = n.closest('[data-group]');
          return { g: Number(owner.dataset.group),
                   left: r.left - 1, right: r.right + 1, top: r.top - 1, bottom: r.bottom + 1 };
        });

      /* نضمّ أقرب زوج متلامس لا أوّل زوج نصادفه: الأوّل يبني كرة ثلج تبتلع
         المخطّط كلّه لأن المركز ينزاح مع كل ضمّة، والأقرب يوزّع التجمّعات. */
      let pair = null;
      let best = Infinity;
      for (let i = 0; i < marks.length; i++) {
        for (let j = i + 1; j < marks.length; j++) {
          if (marks[i].g === marks[j].g || !hits(marks[i], marks[j])) continue;
          const dx = (marks[i].left + marks[i].right - marks[j].left - marks[j].right) / 2;
          const dy = (marks[i].top + marks[i].bottom - marks[j].top - marks[j].bottom) / 2;
          const d = Math.hypot(dx, dy);
          if (d < best) { best = d; pair = [marks[i].g, marks[j].g]; }
        }
      }
      if (!pair) return;

      const [a, b] = pair.sort((x, y) => x - y);
      groups[a].members.push(...groups[b].members);
      groups[a].x = groups[a].members.reduce((s, m) => s + m.x, 0) / groups[a].members.length;
      groups[a].y = groups[a].members.reduce((s, m) => s + m.y, 0) / groups[a].members.length;
      groups.splice(b, 1);
    }
  }

  function clusterPins(map) {
    const box = map.getBoundingClientRect();
    const pins = [...map.querySelectorAll('.pin')].map((pin) => {
      const d = pin.querySelector('.pin__dot').getBoundingClientRect();
      return { pin, x: d.left + d.width / 2 - box.left, y: d.top + d.height / 2 - box.top };
    });

    const groups = [];
    for (const p of pins) {
      const near = groups.find((g) => Math.hypot(g.x - p.x, g.y - p.y) <= DOT_R * 2);
      if (near) {
        near.members.push(p);
        near.x = near.members.reduce((s, m) => s + m.x, 0) / near.members.length;
        near.y = near.members.reduce((s, m) => s + m.y, 0) / near.members.length;
      } else {
        groups.push({ x: p.x, y: p.y, members: [p] });
      }
    }

    separateMarks(map, groups);
    return groups.filter((g) => g.members.length > 1).length;
  }

  /* الاسم يوضع فوق النقطة، فإن زاحم اسمًا موضوعًا جُرّبت جهة أخرى. النقطة
     نفسها لا تتحرّك أبدًا: إزاحة النقطة كذبٌ على المدير، أمّا إزاحة الاسم
     فترتيب. ومن لم يجد لاسمه موضعًا يُخفى اسمه ويظهر عند المرور على سطره. */
  const TAG_SIDES = ['up', 'down', 'start', 'end'];

  function layoutPinTags(map) {
    const pins = [...map.querySelectorAll('.pin:not(.pin--clustered)')];
    const box = map.getBoundingClientRect();
    const taken = [...map.querySelectorAll('.pin__dot, .cluster')].map((n) => n.getBoundingClientRect());
    let hidden = 0;

    for (const pin of pins) {
      const tag = pin.querySelector('.pin__tag');
      let placed = false;
      for (const side of TAG_SIDES) {
        pin.dataset.side = side;
        const r = tag.getBoundingClientRect();
        const inside = r.left >= box.left && r.right <= box.right
                    && r.top >= box.top && r.bottom <= box.bottom;
        if (inside && !taken.some((t) => hits(r, t))) { taken.push(r); placed = true; break; }
      }
      if (!placed) { pin.classList.add('pin--crowded'); hidden++; }
    }
    return hidden;
  }

  function livePins(shown) {
    return shown.map((a) => {
      const x = (a.lng - KW.minLng) / (KW.maxLng - KW.minLng);
      const y = 1 - (a.lat - KW.minLat) / (KW.maxLat - KW.minLat);
      const cx = Math.min(Math.max(x, 0.02), 0.98) * 100;
      const cy = Math.min(Math.max(y, 0.02), 0.98) * 100;
      const first = a.agent_name.split(' ')[0];
      return `<button class="pin${a.reason === 'stale' ? ' pin--stale' : ''}" type="button"
                      data-agent="${a.agent_id}" data-side="up"
                      style="inset-inline-start:${(100 - cx).toFixed(2)}%; top:${cy.toFixed(2)}%"
                      aria-label="${esc(a.agent_name)} — ${a.reason === 'stale' ? 'آخر قراءة قديمة' : 'موقع محدَّث'}">
                <span class="pin__dot"></span><span class="pin__tag">${esc(first)}</span>
              </button>`;
    }).join('');
  }

  function liveRows(agents) {
    return agents.map((a) => `
      <article class="live-row" data-agent="${a.agent_id}"${a.available ? ' tabindex="0"' : ''}>
        <div class="live-row__top">
          <b>${esc(a.agent_name)}</b>
          <span class="badge badge--${a.availability}">${esc(state.meta.availability[a.availability])}</span>
          ${a.available
            ? '<span class="badge badge--delivered">موقع محدَّث</span>'
            : `<span class="badge badge--offline">${esc(REASONS[a.reason] || 'غير متاح')}</span>`}
        </div>
        <div class="live-row__meta">
          <span>${esc(vehicleName(a.vehicle))}</span>
          <span>${esc(a.governorate || 'بلا منطقة')}</span>
          <span>${AR.describe(a.active_orders, 'order', 'active')}</span>
          ${a.order_code ? `<span>يوصّل <a href="#/orders/${a.order_id}">${esc(a.order_code)}</a></span>` : ''}
          ${a.recorded_at ? `<span><time datetime="${esc(a.recorded_at)}">${esc(relTime(a.recorded_at))}</time></span>` : ''}
          ${a.lat != null ? `<span><a href="https://www.google.com/maps?q=${a.lat},${a.lng}"
               target="_blank" rel="noopener">افتح في الخرائط</a></span>` : ''}
        </div>
      </article>`).join('');
  }

  /* رسم اللوحة وحدها دون رأس الصفحة، ليعيد التحديث الدوري رسمها
     بلا وميض في العنوان ولا قفزة في موضع التمرير. */
  function paintLiveBoard(host, agents) {
    const sorted = [...agents].sort((x, y) => rankOf(x) - rankOf(y));
    const shown = sorted.filter((a) => a.available || a.reason === 'stale');
    const fresh = sorted.filter((a) => a.available).length;

    host.innerHTML = `
      <div class="live__map-col">
        <div class="map" style="aspect-ratio:${KW_RATIO.toFixed(4)}">
          ${livePins(shown)}
          <p class="map__scale">مخطّط تقريبي لحدود الكويت<span class="map__crowd"></span></p>
        </div>
        <p class="map__key">
          <span class="map__key-item"><i class="pin__dot"></i>موقع محدَّث (${AR.digits(fresh)})</span>
          <span class="map__key-item"><i class="pin__dot pin__dot--stale"></i>آخر قراءة قديمة (${AR.digits(shown.length - fresh)})</span>
          ${sorted.length > shown.length
            ? `<span class="map__key-note">${AR.plural(sorted.length - shown.length, 'agent')} بلا موقع، في القائمة وحدها</span>`
            : ''}
        </p>
      </div>
      <div class="live__list">${liveRows(sorted)}</div>`;

    const map = host.querySelector('.map');
    const clusters = clusterPins(map);
    const crowded = layoutPinTags(map);
    /* عدد المخفيّ ليس معلومة يتصرّف بها المدير، أمّا طريقة إظهاره فنعم */
    if (clusters || crowded) {
      host.querySelector('.map__crowd').textContent =
        ` — ${clusters ? 'الرقم في الدائرة عدد من فيها. ' : ''}مرّر على سطر الكابتن ليظهر موضعه`;
    }

    /* ربط النقطة بسطرها في الاتجاهين: اللوحة نصفان لا يفيدان إلا معًا. */
    const light = (id, on) => {
      for (const n of host.querySelectorAll(`[data-agent="${id}"]`)) n.classList.toggle('is-lit', on);
      for (const c of host.querySelectorAll('.cluster')) {
        if (c.dataset.members.split(' ').includes(String(id))) c.classList.toggle('is-lit', on);
      }
    };
    for (const row of host.querySelectorAll('.live-row')) {
      const id = row.dataset.agent;
      row.addEventListener('mouseenter', () => light(id, true));
      row.addEventListener('mouseleave', () => light(id, false));
      row.addEventListener('focusin', () => light(id, true));
      row.addEventListener('focusout', () => light(id, false));
    }
    const goToRow = (id) => {
      const row = host.querySelector(`.live-row[data-agent="${id}"]`);
      if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.focus(); }
    };
    for (const pin of host.querySelectorAll('.pin')) {
      const id = pin.dataset.agent;
      pin.addEventListener('mouseenter', () => light(id, true));
      pin.addEventListener('mouseleave', () => light(id, false));
      pin.addEventListener('click', () => goToRow(id));
    }
    /* التجمّع لا يُفرَد على المخطّط — تفريقه يضع الكباتن في غير مواضعهم.
       بدله يُضيء أسطرهم في القائمة، وهي الموضع الذي تُقرأ فيه الأسماء. */
    for (const cl of host.querySelectorAll('.cluster')) {
      const ids = cl.dataset.members.split(' ');
      const all = (on) => { for (const id of ids) light(id, on); };
      cl.addEventListener('mouseenter', () => all(true));
      cl.addEventListener('mouseleave', () => all(false));
      cl.addEventListener('click', () => goToRow(ids[0]));
    }
  }

  async function renderLive() {
    if (state.me.role !== 'admin') { location.hash = '#/'; return; }
    el.view.innerHTML = `<div class="page-head"><div><h1>المواقع المباشرة</h1></div></div>${skeleton(3)}`;
    const { agents } = await api('/locations/live');

    el.view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>المواقع المباشرة</h1>
          <p>يظهر هنا المندوبون الذين وافقوا على المشاركة وفعّلوها فقط.</p>
        </div>
        <div class="page-head__side">
          <span class="live__stamp" id="liveStamp"></span>
          <button class="btn btn--ghost btn--sm" id="refreshLive" type="button">تحديث</button>
        </div>
      </div>
      <div class="live" id="liveBoard"></div>`;

    paintLiveBoard(document.getElementById('liveBoard'), agents);
    stampLive();
    document.getElementById('refreshLive').addEventListener('click', renderLive);
  }

  /* اللوحة تدّعي أنها «مباشرة»، فلا يصحّ أن تنتظر ضغطة زر. الخادم يسجّل
     اطّلاعًا واحدًا كل خمس دقائق لكل كابتن، فالتحديث الدوري لا يُغرق سجلّ
     الخصوصية الذي يراه الكابتن. */
  let liveAt = 0;

  function stampLive() {
    liveAt = Date.now();
    tickLiveStamp();
  }

  function tickLiveStamp() {
    const node = document.getElementById('liveStamp');
    if (!node || !liveAt) return;
    // `since` تحمل حرف الجر بنفسها: «الآن» أو «قبل دقيقتين»
    node.textContent = 'حُدِّثت ' + relTime(new Date(liveAt).toISOString());
  }

  async function refreshLiveBoard() {
    const host = document.getElementById('liveBoard');
    if (!host) return;
    const { agents } = await api('/locations/live');
    if (!document.getElementById('liveBoard')) return; // غادر المستخدم الصفحة أثناء الطلب
    paintLiveBoard(host, agents);
    stampLive();
  }

  /* --------------------------- إرسال النماذج --------------------------- */

  async function submit(form, msgNode, fn) {
    const button = form.querySelector('button[type=submit]');
    const original = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'جارٍ التنفيذ…'; }
    if (msgNode) { msgNode.textContent = ''; msgNode.className = 'form-msg'; }
    try {
      await fn();
    } catch (err) {
      if (msgNode) { msgNode.textContent = err.message; msgNode.className = 'form-msg is-bad'; }
      else toast(err.message, 'bad');
    } finally {
      if (button) { button.disabled = false; button.textContent = original; }
    }
  }

  /* ------------------------------ الجلسة ------------------------------ */

  function showLogin() {
    el.app.hidden = true;
    el.login.hidden = false;
    state.me = null;
  }

  async function showApp() {
    el.login.hidden = true;
    el.app.hidden = false;

    el.whoName.textContent = state.me.name;
    el.whoRole.textContent = state.meta.roles[state.me.role];

    const isAgent = state.me.role === 'agent';
    el.availWrap.hidden = !isAgent;
    if (isAgent) el.availSelect.value = state.me.availability;

    await refreshShared();
    if (state.me.role === 'agent') {
      try { await refreshConsent(); renderGeoBar(); } catch { /* غير حرج */ }
    }
    await router();
  }

  async function logout(silent) {
    try { if (!silent) await api('/auth/logout', { method: 'POST' }); } catch { /* تجاهل */ }
    geo.stop();
    state.loc = null;
    el.geoBar.hidden = true;
    state.me = null;
    location.hash = '';
    showLogin();
    if (!silent) toast('تم تسجيل الخروج');
  }

  el.logout.addEventListener('click', () => logout(false));

  el.availSelect.addEventListener('change', async (e) => {
    try {
      const { agent } = await api('/me/availability', { method: 'PATCH', body: { availability: e.target.value } });
      state.me = agent;
      toast('تم تحديث حالتك إلى: ' + state.meta.availability[agent.availability], 'ok');
    } catch (err) {
      toast(err.message, 'bad');
      e.target.value = state.me.availability;
    }
  });

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = el.loginMsg;
    await submit(e.target, msg, async () => {
      const { agent } = await api('/auth/login', {
        method: 'POST',
        body: { username: e.target.username.value.trim(), password: e.target.password.value },
      });
      state.me = agent;
      e.target.reset();
      await showApp();
    });
  });

  /* أثناء الكتابة يختفي الشريط السفلي (انظر app.css). الحدثان يصعدان من أي
     حقل مهما أُعيد رسم الصفحة، فلا يحتاج الأمر ربطًا في كل شاشة. */
  const TYPEABLE = /^(INPUT|TEXTAREA|SELECT)$/;
  document.addEventListener('focusin', (e) => {
    if (TYPEABLE.test(e.target.tagName)) document.body.classList.add('is-typing');
  });
  document.addEventListener('focusout', (e) => {
    if (TYPEABLE.test(e.target.tagName)) document.body.classList.remove('is-typing');
  });

  window.addEventListener('hashchange', router);

  /* تحديث تلقائي كل ٤٥ ثانية للصفحة الحالية.
     `el.modal` صار <dialog>، وحالته في `open` لا في `hidden`. */
  setInterval(async () => {
    if (!state.me || document.hidden || el.modal.open) return;
    try { await refreshShared(); } catch { /* تجاهل */ }
    if (location.hash === '#/live') {
      try { await refreshLiveBoard(); } catch { /* تجاهل */ }
    }
  }, 45000);

  /* عقرب «حُدِّثت قبل …» يتحرّك كل عشر ثوانٍ ولو لم تصل بيانات جديدة، فلا
     يظن المدير أن ما أمامه لحظيّ وقد مضى عليه دقائق. */
  setInterval(tickLiveStamp, 10000);

  /* ------------------------------ الإقلاع ------------------------------ */

  (async function boot() {
    try {
      state.meta = await api('/meta');
    } catch {
      document.body.innerHTML = '<p style="padding:2rem;text-align:center">تعذّر الاتصال بالخادم.</p>';
      return;
    }
    try {
      const { agent } = await api('/auth/me');
      state.me = agent;
      await showApp();
    } catch {
      showLogin();
    }
  })();
})();
