/* =========================================================================
   صفحة مهمّة الكابتن — تُفتح من رابط يُرسل على واتساب، بلا تسجيل دخول.
   ثلاثة أفعال لا رابع: موافقة الموقع، ملاحظة صوتية، بلاغ النتيجة.
   ========================================================================= */
(function () {
  'use strict';

  const AR = window.arabicKit;
  const ar = AR.digits;
  const money = (v) => AR.number(Number(v || 0), 3);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TOKEN = decodeURIComponent(location.pathname.replace(/^\/l\/?/, '').split('/')[0] || '');
  const main = document.getElementById('lkMain');
  const who = document.getElementById('lkWho');
  const toasts = document.getElementById('toasts');

  let ctx = null;

  function toast(msg, kind) {
    const n = document.createElement('div');
    n.className = 'toast' + (kind ? ' toast--' + kind : '');
    n.textContent = msg;
    toasts.appendChild(n);
    setTimeout(() => n.remove(), 4200);
  }

  async function api(path, opts) {
    const o = opts || {};
    const res = await fetch('/api/link/' + encodeURIComponent(TOKEN) + path, {
      method: o.method || 'GET',
      headers: o.headers || (o.body ? { 'Content-Type': 'application/json' } : undefined),
      body: o.raw ? o.raw : (o.body ? JSON.stringify(o.body) : undefined),
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* بلا جسم */ }
    if (!res.ok) {
      const err = new Error(data.error || 'تعذّر تنفيذ الطلب');
      err.code = data.code || '';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ------------------------------ الموقع ------------------------------ */

  const geo = {
    watchId: null,
    lastSent: 0,
    interval: 10000,

    supported() {
      return 'geolocation' in navigator && window.isSecureContext;
    },

    start() {
      if (this.watchId != null || !this.supported()) return;
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.push(pos),
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            toast('رفض المتصفح إذن الموقع. فعّله من إعدادات المتصفح.', 'error');
            setSharing(false, true);
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
      );
    },

    stop() {
      if (this.watchId == null) return;
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    },

    async push(pos) {
      const t = Date.now();
      if (t - this.lastSent < this.interval) return;
      this.lastSent = t;
      const c = pos.coords;
      try {
        await api('/location', {
          method: 'POST',
          body: {
            lat: c.latitude, lng: c.longitude,
            accuracy: c.accuracy, speed: c.speed, heading: c.heading,
          },
        });
      } catch (err) {
        if (err.code === 'consent_required' || err.code === 'sharing_off') this.stop();
      }
    },
  };

  /* --------------------------- التسجيل الصوتي --------------------------- */

  const rec = {
    media: null,
    recorder: null,
    chunks: [],
    startedAt: 0,
    timer: null,
    MAX_SECONDS: 180,

    supported() {
      return !!(navigator.mediaDevices && window.MediaRecorder && window.isSecureContext);
    },

    /** أول صيغة يدعمها المتصفح من الصيغ التي يقبلها الخادم */
    mimeType() {
      const wanted = ['audio/webm', 'audio/ogg', 'audio/mp4'];
      for (const m of wanted) {
        if (MediaRecorder.isTypeSupported(m)) return m;
      }
      return '';
    },

    async start(onTick) {
      this.media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = this.mimeType();
      this.recorder = new MediaRecorder(this.media, type ? { mimeType: type } : undefined);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
      this.recorder.start();
      this.startedAt = Date.now();
      this.timer = setInterval(() => {
        const s = this.elapsed();
        onTick(s);
        if (s >= this.MAX_SECONDS) this.stop();
      }, 250);
    },

    elapsed() {
      return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
    },

    stop() {
      return new Promise((resolve) => {
        if (!this.recorder || this.recorder.state === 'inactive') return resolve(null);
        const seconds = this.elapsed();
        this.recorder.onstop = () => {
          clearInterval(this.timer);
          this.media.getTracks().forEach((t) => t.stop());
          const blob = new Blob(this.chunks, { type: this.recorder.mimeType.split(';')[0] });
          this.startedAt = 0;
          resolve({ blob, seconds });
        };
        this.recorder.stop();
      });
    },
  };

  /* ------------------------------ الرسم ------------------------------ */

  function fail(err) {
    const hints = {
      link_expired: 'انتهت صلاحية هذا الرابط. اطلب من الإدارة رابطًا جديدًا.',
      link_revoked: 'أُلغي هذا الرابط من الإدارة.',
      link_reassigned: 'انتقل هذا الطلب إلى كابتن آخر.',
      link_finished: 'انتهى هذا الطلب — شكرًا لك.',
      link_unknown: 'الرابط غير صحيح. تأكّد من نسخه كاملًا.',
    };
    main.innerHTML = `
      <div class="lk-card lk-card--msg">
        <span class="lk-msg__ic" aria-hidden="true">✕</span>
        <h1>تعذّر فتح المهمّة</h1>
        <p>${esc(hints[err.code] || err.message)}</p>
      </div>`;
  }

  function render() {
    const o = ctx.order;
    const a = ctx.agent;
    who.textContent = a.name;

    main.innerHTML = `
      <div class="lk-card">
        <div class="lk-head">
          <span class="lk-code num">${esc(o.code)}</span>
          <span class="badge badge--${esc(o.status)}">${esc(o.status_label)}</span>
          ${o.priority === 'urgent' ? '<span class="badge badge--urgent">عاجل</span>' : ''}
        </div>

        <div class="lk-route">
          <div class="lk-route__row">
            <span class="lk-dot lk-dot--from"></span>
            <div><b>الاستلام</b><span>${esc(o.pickup_address)}</span></div>
          </div>
          <div class="lk-route__row">
            <span class="lk-dot lk-dot--to"></span>
            <div><b>التسليم</b><span>${esc(o.dropoff_address)}</span></div>
          </div>
        </div>

        <dl class="lk-kv">
          <dt>العميل</dt>
          <dd>${esc(o.customer_name)} —
            <a href="tel:${esc(o.customer_phone)}" dir="ltr">${esc(o.customer_phone)}</a></dd>
          <dt>المحافظة</dt><dd>${esc(o.governorate)}</dd>
          ${o.cod_amount > 0
            ? `<dt>تحصيل من العميل</dt><dd class="num lk-strong">${money(o.cod_amount)} د.ك</dd>` : ''}
          <dt>مستحقّك من الطلب</dt><dd class="num lk-strong">${money(o.agent_earning)} د.ك</dd>
        </dl>
        ${o.notes ? `<p class="lk-notes">${esc(o.notes)}</p>` : ''}
      </div>

      <!-- ١ — الموقع -->
      <section class="lk-card" id="lkGeo">
        <h2 class="lk-h">١ · مشاركة موقعك المباشر</h2>
        <div id="lkGeoBody"></div>
      </section>

      <!-- ٢ — الملاحظة الصوتية -->
      <section class="lk-card">
        <h2 class="lk-h">٢ · ملاحظة صوتية للإدارة</h2>
        <p class="lk-sub">سجّل ملاحظة قصيرة إن احتجت — تصل الإدارة مباشرة.</p>
        <div class="lk-rec" id="lkRec"></div>
        <ul class="lk-voice" id="lkVoice"></ul>
      </section>

      <!-- ٣ — النتيجة -->
      <section class="lk-card">
        <h2 class="lk-h">٣ · نتيجة التسليم</h2>
        <div class="lk-outcomes">
          <button class="lk-out lk-out--ok" data-outcome="delivered" type="button">
            <b>تم التسليم</b><span>سلّمت الشحنة للعميل</span></button>
          <button class="lk-out lk-out--wait" data-outcome="not_yet" type="button">
            <b>لم يُسلَّم بعد</b><span>ما زلت على المهمّة</span></button>
          <button class="lk-out lk-out--bad" data-outcome="failed" type="button">
            <b>تعذّر التسليم</b><span>لم أتمكّن من التسليم</span></button>
        </div>
        <div id="lkOutForm"></div>
      </section>

      <p class="lk-foot">
        ينتهي هذا الرابط ${esc(AR.dateTime(ctx.expires_at))}.
      </p>`;

    paintGeo();
    paintRec();
    paintVoiceList();
    bindOutcomes();
  }

  /* -------------------------- قسم الموقع -------------------------- */

  function paintGeo() {
    const box = document.getElementById('lkGeoBody');
    const a = ctx.agent;

    if (!geo.supported()) {
      box.innerHTML = `<p class="lk-warn">
        تحديد الموقع يحتاج اتصالًا آمنًا (HTTPS). افتح الرابط من متصفح الجوال
        مباشرة، وإن استمرت المشكلة أبلغ الإدارة.</p>`;
      return;
    }

    if (!a.consent) {
      box.innerHTML = `
        <p class="lk-sub">
          الإدارة تحتاج موقعك أثناء المهمّة فقط لمتابعة الشحنة وإسناد أقرب طلب لك.
          <b>القرار قرارك</b> — تستطيع سحب الموافقة في أي لحظة، وعند السحب
          <b>يُمسح كل سجلّ مواقعك فورًا</b>.
        </p>
        <button class="btn btn--primary btn--block" id="lkGrant" type="button">
          أوافق على مشاركة موقعي</button>`;
      document.getElementById('lkGrant').addEventListener('click', () => setConsent(true));
      return;
    }

    box.innerHTML = `
      <div class="lk-state ${a.sharing ? 'is-on' : ''}">
        <span class="lk-state__dot"></span>
        <b>${a.sharing ? 'المشاركة مفعّلة الآن' : 'الموافقة ممنوحة — المشاركة متوقّفة'}</b>
      </div>
      <div class="btn-row">
        ${a.sharing
          ? '<button class="btn btn--quiet" id="lkPause" type="button">إيقاف مؤقّت</button>'
          : '<button class="btn btn--primary" id="lkResume" type="button">تشغيل المشاركة</button>'}
        <button class="btn btn--danger" id="lkRevoke" type="button">سحب الموافقة ومسح السجل</button>
      </div>`;

    const pause = document.getElementById('lkPause');
    const resume = document.getElementById('lkResume');
    if (pause) pause.addEventListener('click', () => setSharing(false));
    if (resume) resume.addEventListener('click', () => setSharing(true));
    document.getElementById('lkRevoke').addEventListener('click', () => {
      if (confirm('سيتوقّف التتبّع ويُمسح كل سجلّ مواقعك. متأكّد؟')) setConsent(false);
    });

    if (a.sharing) geo.start(); else geo.stop();
  }

  async function setConsent(granted) {
    try {
      const r = await api('/consent', { method: 'POST', body: { granted } });
      ctx.agent.consent = !!r.consent.consent;
      ctx.agent.sharing = !!r.consent.sharing;
      toast(granted ? 'شكرًا — بدأت المشاركة' : 'سُحبت الموافقة ومُسح السجل', 'ok');
      paintGeo();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function setSharing(on, quiet) {
    try {
      const r = await api('/sharing', { method: 'PATCH', body: { sharing: on } });
      ctx.agent.sharing = !!r.consent.sharing;
      if (!quiet) toast(on ? 'المشاركة مفعّلة' : 'أُوقفت المشاركة', 'ok');
      paintGeo();
    } catch (err) { if (!quiet) toast(err.message, 'error'); }
  }

  /* ------------------------ قسم التسجيل الصوتي ------------------------ */

  function paintRec(state) {
    const box = document.getElementById('lkRec');

    if (!rec.supported()) {
      box.innerHTML = `<p class="lk-warn">
        التسجيل الصوتي يحتاج اتصالًا آمنًا (HTTPS) ومتصفحًا حديثًا.</p>`;
      return;
    }

    if (state === 'recording') {
      box.innerHTML = `
        <div class="lk-recbar is-live">
          <span class="lk-recdot" aria-hidden="true"></span>
          <span id="lkTime" class="num">٠:٠٠</span>
          <button class="btn btn--danger btn--sm" id="lkStop" type="button">إيقاف وإرسال</button>
        </div>`;
      document.getElementById('lkStop').addEventListener('click', stopAndSend);
      return;
    }

    if (state === 'sending') {
      box.innerHTML = '<div class="lk-recbar"><span class="lk-spin"></span> جارٍ الإرسال…</div>';
      return;
    }

    box.innerHTML = `
      <button class="btn btn--accent btn--block" id="lkStart" type="button">
        🎙️ ابدأ التسجيل</button>`;
    document.getElementById('lkStart').addEventListener('click', startRec);
  }

  async function startRec() {
    try {
      await rec.start((s) => {
        const t = document.getElementById('lkTime');
        if (t) {
          const m = Math.floor(s / 60);
          const sec = Math.floor(s % 60);
          t.textContent = ar(m) + ':' + ar(String(sec).padStart(2, '0'));
        }
      });
      paintRec('recording');
    } catch (err) {
      toast('تعذّر الوصول للميكروفون. اسمح به من إعدادات المتصفح.', 'error');
    }
  }

  async function stopAndSend() {
    const out = await rec.stop();
    if (!out || !out.blob.size) { paintRec(); return; }
    if (out.seconds < 1) { toast('التسجيل قصير جدًا', 'error'); paintRec(); return; }

    paintRec('sending');
    try {
      const data = await api('/voice', {
        method: 'POST',
        headers: { 'Content-Type': out.blob.type, 'X-Voice-Seconds': String(Math.round(out.seconds)) },
        raw: out.blob,
      });
      ctx.voice_notes.unshift(data.voice_note);
      toast('وصلت ملاحظتك للإدارة', 'ok');
      paintVoiceList();
    } catch (err) {
      toast(err.message, 'error');
    }
    paintRec();
  }

  function paintVoiceList() {
    const list = document.getElementById('lkVoice');
    if (!ctx.voice_notes.length) { list.innerHTML = ''; return; }
    list.innerHTML = ctx.voice_notes.map((v) => `
      <li>
        <span class="lk-voice__ic" aria-hidden="true">🎧</span>
        <span>ملاحظة ${esc(AR.plural(Math.round(v.seconds), 'second'))}</span>
        <span class="muted">${esc(AR.since(v.created_at))}</span>
      </li>`).join('');
  }

  /* --------------------------- قسم النتيجة --------------------------- */

  function bindOutcomes() {
    document.querySelectorAll('[data-outcome]').forEach((btn) => {
      btn.addEventListener('click', () => outcomeForm(btn.dataset.outcome));
    });
  }

  const NEEDS_NOTE = { failed: 'اكتب سبب تعذّر التسليم', not_yet: 'اكتب سبب التأخّر باختصار' };

  function outcomeForm(outcome) {
    const box = document.getElementById('lkOutForm');
    const label = ctx.outcomes[outcome];
    const need = NEEDS_NOTE[outcome];

    document.querySelectorAll('[data-outcome]').forEach((b) =>
      b.classList.toggle('is-on', b.dataset.outcome === outcome));

    box.innerHTML = `
      <form class="lk-outform" id="lkOutF">
        <label class="field">
          <span>${need ? esc(need) : 'ملاحظة (اختياري)'}</span>
          <textarea name="note" rows="2" maxlength="500"
                    ${need ? 'required' : ''}></textarea>
        </label>
        <p class="form-msg" id="lkOutMsg"></p>
        <button class="btn btn--primary btn--block" type="submit">تأكيد: ${esc(label)}</button>
      </form>`;

    document.getElementById('lkOutF').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      const msg = document.getElementById('lkOutMsg');
      const note = e.target.note.value.trim();
      btn.disabled = true;
      msg.textContent = '';
      msg.className = 'form-msg';
      try {
        const r = await api('/outcome', { method: 'POST', body: { outcome, note } });
        done(r);
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'form-msg is-error';
        btn.disabled = false;
      }
    });
  }

  function done(r) {
    geo.stop();
    if (!r.changed_status) {
      toast('وصل بلاغك للإدارة', 'ok');
      // «لم يُسلَّم بعد» لا تنهي المهمّة، فتبقى الصفحة عاملة
      refresh();
      return;
    }
    main.innerHTML = `
      <div class="lk-card lk-card--msg">
        <span class="lk-msg__ic lk-msg__ic--ok" aria-hidden="true">✓</span>
        <h1>${esc(r.status_label)}</h1>
        <p>وصل بلاغك للإدارة وأُرسل تقرير المهمّة. شكرًا لك.</p>
        <p class="muted">انتهت صلاحية هذا الرابط الآن.</p>
      </div>`;
  }

  /* ------------------------------ الإقلاع ------------------------------ */

  async function refresh() {
    ctx = await api('');
    render();
  }

  async function boot() {
    if (!TOKEN) return fail({ code: 'link_unknown', message: 'الرابط غير صحيح' });
    try {
      await refresh();
    } catch (err) {
      fail(err);
    }
  }

  // إعادة تشغيل التتبّع عند العودة للصفحة
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.agent.sharing) geo.start();
  });

  boot();
})();
