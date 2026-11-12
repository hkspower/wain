/* Sporta checkout: pick the governorate from the area.
 * A customer could type Salmiya (Hawalli) with Capital selected and the order
 * went through with a governorate the courier would follow to the wrong place.
 * When the area field loses focus and its text is a known area of ANOTHER
 * governorate, this sets the governorate to match and puts the area back
 * (changing the governorate clears the area in the page's own code).
 * Unknown areas are left alone: free text stays allowed on purpose.
 * Same 97-area list the checkout suggests (6 governorates, Arabic + English).
 * External file: the live CSP forbids inline script. No dollar signs on purpose
 * (the installer runs through docker compose, which interpolates them). */
(function () {
  'use strict';
  var DATA = 'capital:Kuwait City|مدينة الكويت|Sharq|شرق|Mirqab|المرقاب|Dasman|دسمان|Qibla|قبلة|Salhiya|الصالحية|Bneid Al Gar|بنيد القار|Kaifan|كيفان|Mansouriya|المنصورية|Dasma|الدسمة|Daiya|الدعية|Shamiya|الشامية|Abdullah Al-Salem|ضاحية عبدالله السالم|Nuzha|النزهة|Faiha|الفيحاء|Khaldiya|الخالدية|Rawda|الروضة|Adailiya|العديلية|Yarmouk|اليرموك|Surra|السرة|Qadsiya|القادسية|Qurtuba|قرطبة|Shuwaikh|الشويخ|Doha|الدوحة|Granada|غرناطة|Sulaibikhat|الصليبيخات|Jaber Al-Ahmad|جابر الأحمد|Nahdha|النهضة|Qairawan|القيروان;hawalli:Hawalli|حولي|Salmiya|السالمية|Rumaithiya|الرميثية|Bayan|بيان|Mishref|مشرف|Salwa|سلوى|Jabriya|الجابرية|Shaab|الشعب|Maidan Hawalli|ميدان حولي|Nugra|النقرة|Bida\'a|البدع|Zahra|الزهراء|Hitteen|حطين|Shuhada|الشهداء|Salam|السلام|Siddeeq|الصديق|Mubarak Al-Abdullah|مبارك العبدالله;farwaniya:Farwaniya|الفروانية|Khaitan|خيطان|Abraq Khaitan|أبرق خيطان|Jleeb Al-Shuyoukh|جليب الشيوخ|Ardiya|العارضية|Rabiya|الرابية|Andalous|الأندلس|Rehab|الرحاب|Ishbiliya|إشبيلية|Firdous|الفردوس|Omariya|العمرية|Riggae|الرقعي|Dajeej|الضجيج|Abdullah Al-Mubarak|عبدالله المبارك|Sabah Al-Nasser|صباح الناصر;mubarak-al-kabeer:Mubarak Al-Kabeer|مبارك الكبير|Qurain|القرين|Adan|العدان|Qusour|القصور|Sabah Al-Salem|صباح السالم|Messila|المسيلة|Abu Ftaira|أبو فطيرة|Fnaitees|الفنيطيس|Mesayel|المسايل|Sabhan|صبحان;ahmadi:Ahmadi|الأحمدي|Fahaheel|الفحيحيل|Mangaf|المنقف|Abu Halifa|أبو حليفة|Fintas|الفنطاس|Mahboula|المهبولة|Riqqa|الرقة|Hadiya|هدية|Sabahiya|الصباحية|Egaila|العقيلة|Ali Sabah Al-Salem|علي صباح السالم|Jaber Al-Ali|جابر العلي|Sabah Al-Ahmad|صباح الأحمد|Wafra|الوفرة|Khairan|الخيران;jahra:Jahra|الجهراء|Saad Al-Abdullah|سعد العبدالله|Naeem|النعيم|Nasseem|النسيم|Qasr|القصر|Waha|الواحة|Oyoun|العيون|Taima|تيماء|Sulaibiya|الصليبية|Amghara|أمغرة|Kabd|كبد';
  function norm(s) {
    s = String(s || '').toLowerCase().trim();
    s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    s = s.replace(/[ً-ْـ]/g, '');
    s = s.replace(/^ال/, '').replace(/^al[- ]?/, '');
    return s.replace(/[^a-z0-9؀-ۿ]/g, '');
  }
  var MAP = {};
  DATA.split(';').forEach(function (block) {
    var i = block.indexOf(':'); var gov = block.slice(0, i);
    block.slice(i + 1).split('|').forEach(function (name) { var k = norm(name); if (k && !MAP[k]) MAP[k] = gov; });
  });
  var setVal = function (el, v) {
    var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  function fix(area) {
    /* The field may have been replaced since the focusout (the page re-creates its form on a step change): a field that
     * is no longer in the page is not the customer's any more. */
    if (!area.isConnected) return;
    var form = area.form || document;
    var gov = form.querySelector('select[name="address-level1"]');
    var want = MAP[norm(area.value)];
    if (!gov || !want || gov.value === want) return;
    if (!gov.querySelector('option[value="' + want + '"]')) return;
    var typed = area.value;
    setVal(gov, want);
    gov.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      var a = form.querySelector('[name="address-level2"]') || area;
      if (a.value === typed) return;
      /* Put the typed area back ONLY into the empty field the page's own code left behind when the governorate changed.
       * Within these 60 ms the customer may already have typed something else there (or picked another governorate);
       * writing the older text over it would be the stale write winning over the fresh one. */
      if (a.value || gov.value !== want) return;
      setVal(a, typed);
      a.dispatchEvent(new Event('input', { bubbles: true }));
      a.dispatchEvent(new Event('change', { bubbles: true }));
    }, 60);
  }
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t && t.name === 'address-level2') setTimeout(function () { fix(t); }, 120);
  }, true);
})();

/* Sporta checkout: OPTIONAL delivery location (stage 1, add-on only, no backend change).
 * The customer may tap "Share my location (optional)" under the delivery note. Nothing is requested before the
 * tap and nothing is required to order. The position travels as ONE map link written at the END of the existing
 * delivery note ("Location: https://www.google.com/maps?q=LAT,LNG" / "الموقع: ..."), which the order already
 * stores (orders.customer_note, 280 characters), shows in the admin and prints in the warehouse email.
 *
 * Rules this file keeps (each one is asserted by scripts/checkout-location-test.mjs):
 *  - The coordinates live ONLY in the note line. No storage of its own, no network request, no map preview.
 *  - The line is NEVER persisted. The checkout's "Remember these details on this device" box is ON by default and
 *    the storefront saves the whole form, note included, under the localStorage key "sporta.delivery"; a later
 *    visit with complete details goes to the quick checkout (no textarea, no location control), which prints and
 *    submits the saved note, so an old pin would ride on the NEXT order (home, then office: the driver is sent to
 *    the wrong place) and the coordinates would stay on a shared device. So this file, and only for that exact key
 *    (localStorage and sessionStorage): (a) wraps Storage.prototype.setItem and takes our line out of the note
 *    before it is stored, (b) wraps getItem so the app never READS a line that is already stored, (c) rewrites an
 *    already-stored value on load and on every pass over /checkout. Every other key, and every other field, passes
 *    through untouched (same arguments, same return value, same exceptions). The note the customer is typing in
 *    this page (React state) is NOT touched: the line stays there until they order or remove it.
 *  - The line is joined with ONE SPACE, never a newline: the server deletes control characters, so
 *    "text\nLocation:" would arrive as "textLocation:". The location segment is always LAST.
 *  - It is written into the React-controlled textarea through the native value setter plus a bubbling input
 *    event, so React state (and the order payload) follow. A plain textarea.value = x would be undone by the next
 *    render.
 *  - If the line does not fit the note's limit (280, or its maxlength) nothing is written and the customer is
 *    told to shorten the note; the customer's words are never cut.
 *  - The state is READ from the note on every pass, so a line that is in the note (pasted, or kept by the page)
 *    is shown (and can be removed), an edit that deletes the line returns the control to idle, and two lines can
 *    never exist: sharing again replaces.
 *  - Permissions-Policy: the site's header says geolocation=(self) since deploy-20261103T104853Z-8bf6001, so the
 *    control is live. If the header ever says geolocation=() again, the browser refuses the call on every tap and
 *    the control hides itself (document.permissionsPolicy.allowsFeature). That API exists in Chromium only:
 *    Safari and Firefox do not expose document.permissionsPolicy, so there the control is ALWAYS shown and a
 *    refusal is handled as an ordinary denied/failed lookup.
 *  - A lookup that never answers (in-app browsers, an unanswered iOS prompt) ends after about 25 s as a failure;
 *    a timeout (error code 3) is retried ONCE with low accuracy before it is reported; a position of exactly 0,0,
 *    a non-number or an out-of-range value (a webview can report null as 0) is refused as "could not get it".
 *  - /checkout only, the control is re-inserted idempotently after React re-renders (one debounced observer,
 *    disconnected around its own writes) and removed everywhere else. It touches nothing else on the page.
 *  - Evaluating this file twice is harmless: the second run finds the marker on <html> and returns at once
 *    (two live instances would undo each other's writes forever).
 * Inline styles only, with the page's own CSS variables and fallbacks; no inline script (the CSP forbids it).
 * No dollar signs on purpose (see the header of this file). */
(function () {
  'use strict';
  /* Once per page: a second evaluation would start a second observer that undoes the first one's writes. The marker
   * is a JS property on <html> (an attribute would change the page's markup) and on window (document.documentElement
   * can still be null when a script runs at document start). */
  var root0 = document.documentElement;
  if (window.__sportaLocJs || (root0 && root0.__sportaLocJs)) return;
  window.__sportaLocJs = 1;
  if (root0) root0.__sportaLocJs = 1;
  var NS = 'sporta-loc';
  var LIMIT = 280;
  var STORE_KEY = 'sporta.delivery';
  var WATCHDOG_MS = 25000;
  var MAPS = 'https://www.google.com/maps?q=';
  var WEAK_M = 500;
  var LINE_SRC = '(Location|الموقع): https:\\/\\/www\\.google\\.com\\/maps\\?q=(-?\\d{1,3}\\.\\d{1,6}),(-?\\d{1,3}\\.\\d{1,6})';

  var S = {
    en: {
      label: 'Location: ',
      region: 'Delivery location (optional)',
      share: 'Share my location (optional)',
      hint: 'Helps the driver find you. Added to your delivery note and shared only with the shop and the delivery team.',
      locating: 'Finding your location…',
      done: 'Location added (about {n} m)',
      doneWeak: 'Location added, but it is only accurate to about {n} m. You can remove it or try again.',
      doneOld: 'A location is in your note. Remove it if you are somewhere else now.',
      open: 'Open in Maps',
      remove: 'Remove',
      removeLabel: 'Remove location',
      retry: 'Try again',
      removed: 'Location removed.',
      denied: 'Location is turned off for this site. You can still place your order. To turn it on, allow Location for this site in your browser settings, then tap again.',
      fail: 'Could not get your location. Your order is not affected.',
      tooLong: 'Your note is too long to add the location. Shorten it first.'
    },
    ar: {
      label: 'الموقع: ',
      region: 'موقع التوصيل (اختياري)',
      share: 'مشاركة موقعي (اختياري)',
      hint: 'يساعد المندوب في الوصول إليك. يُضاف إلى ملاحظة التوصيل ويصل إلى المتجر وفريق التوصيل فقط.',
      locating: 'جارٍ تحديد موقعك…',
      done: 'تمت إضافة الموقع (بدقة تقارب {n} م)',
      doneWeak: 'تمت إضافة الموقع، لكن دقته تقارب {n} م فقط. يمكنك إزالته أو المحاولة مرة أخرى.',
      doneOld: 'يوجد موقع في ملاحظتك. أزله إن كنت في مكان آخر الآن.',
      open: 'فتح في الخرائط',
      remove: 'إزالة',
      removeLabel: 'إزالة الموقع',
      retry: 'إعادة المحاولة',
      removed: 'تمت إزالة الموقع.',
      denied: 'مشاركة الموقع الجغرافي متوقفة لهذا المتجر. يمكنك إتمام طلبك بدونها. لتفعيلها، اسمح بالموقع الجغرافي لهذا المتجر من إعدادات المتصفح ثم اضغط مرة أخرى.',
      fail: 'تعذّر تحديد موقعك. طلبك لا يتأثر.',
      tooLong: 'ملاحظتك طويلة جدًا لإضافة الموقع. قصّرها أولًا.'
    }
  };

  var busy = false, token = 0, msg = null, last = null, writing = false, timer = null, obs = null, live = false, refocus = false, dog = null;

  function lang() {
    var h = document.documentElement;
    var l = (h.getAttribute('lang') || '').toLowerCase();
    if (l.indexOf('ar') === 0) return 'ar';
    if (l.indexOf('en') === 0) return 'en';
    return h.getAttribute('dir') === 'rtl' ? 'ar' : 'en';
  }
  function onCheckout() { return location.pathname === '/checkout' || location.pathname === '/checkout/'; }
  function blocked() {
    var p = document.permissionsPolicy || document.featurePolicy;
    if (p && typeof p.allowsFeature === 'function') {
      try { return p.allowsFeature('geolocation') === false; } catch (e) { /* unknown: show it */ }
    }
    return false;
  }
  function getNote() {
    var ta = document.getElementById('f-note');
    return ta && ta.tagName === 'TEXTAREA' && ta.name === 'note' && ta.closest && ta.closest('form') ? ta : null;
  }
  function limitOf(ta) {
    var m = parseInt(ta.getAttribute('maxlength'), 10);
    return m > 0 && m < LIMIT ? m : LIMIT;
  }
  function find(v) {
    var m = new RegExp(LINE_SRC).exec(v);
    return m ? { lat: m[2], lng: m[3] } : null;
  }
  /* Remove every location line, plus ONE separator next to it (the space before it, or after it when it opens the
   * note). Nothing else in the customer's text is touched. */
  function strip(v) {
    var re = new RegExp(LINE_SRC, 'g'), out = '', pos = 0, m;
    while ((m = re.exec(v))) {
      var s = m.index, e = s + m[0].length;
      if (s > 0 && /\s/.test(v.charAt(s - 1))) s--;
      else if (s === 0 && e < v.length && /\s/.test(v.charAt(e))) e++;
      if (s < pos) s = pos;
      out += v.slice(pos, s);
      pos = e;
    }
    return out + v.slice(pos);
  }
  function setNote(ta, v) {
    writing = true;
    try {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } finally { writing = false; }
  }

  /* ---------- the line is never persisted ---------- */
  var SP = window.Storage && window.Storage.prototype;
  var rawGet = SP && SP.getItem, rawSet = SP && SP.setItem;
  /* The saved-details value is JSON whose note field is the customer's text. Returns the SAME string when there is
   * nothing to take out (byte-identical, so an unrelated or unparsable value is never re-serialised). */
  function clean(v) {
    if (typeof v !== 'string' || v.indexOf('google.com/maps') < 0) return v;
    var data;
    try { data = JSON.parse(v); } catch (e) { return v; }
    var changed = false;
    (function walk(x, depth) {
      if (!x || typeof x !== 'object' || depth > 4) return;
      Object.keys(x).forEach(function (k) {
        var val = x[k];
        if (k === 'note' && typeof val === 'string') {
          var out = strip(val);
          if (out !== val) { x[k] = out; changed = true; }
        } else walk(val, depth + 1);
      });
    })(data, 0);
    return changed ? JSON.stringify(data) : v;
  }
  function isKey(k) { try { return k === STORE_KEY || String(k) === STORE_KEY; } catch (e) { return false; } }
  /* Narrow wrappers: ONLY the saved-details key is looked at; everything else is forwarded with the caller's own
   * arguments and `this`, and the native return value or exception comes straight back. */
  function install() {
    if (!SP || typeof rawSet !== 'function' || typeof rawGet !== 'function') return;
    if (SP.setItem.__sportaLoc) return;
    var set = function (k, v) {
      var a = arguments;
      if (a.length > 1 && isKey(k)) {
        try { var c = clean(v); if (c !== v) a = [k, c]; } catch (e) { /* store the original rather than lose the save */ }
      }
      return rawSet.apply(this, a);
    };
    var get = function (k) {
      var r = rawGet.apply(this, arguments);
      if (typeof r === 'string' && isKey(k)) { try { return clean(r); } catch (e) { return r; } }
      return r;
    };
    set.__sportaLoc = true; get.__sportaLoc = true;
    SP.setItem = set; SP.getItem = get;
  }
  /* Rewrite what is already stored (a customer who ticked "remember" since the control went live). Says whether it
   * changed anything. */
  function scrubStored() {
    var changed = false;
    if (!rawGet || !rawSet) return changed;
    ['localStorage', 'sessionStorage'].forEach(function (name) {
      try {
        var st = window[name], v = st && rawGet.call(st, STORE_KEY);
        if (typeof v !== 'string') return;
        var c = clean(v);
        if (c !== v) { rawSet.call(st, STORE_KEY, c); changed = true; }
      } catch (e) { /* storage blocked or full: nothing to scrub, and nothing was written by us */ }
    });
    return changed;
  }
  install();
  /* A LATE START. Normally this file runs before the app draws anything, and the scrub above is all that is needed: the
   * app then reads clean details. If this one file is slow to arrive (a bad mobile connection delays it past the app's
   * own start), the quick checkout (saved details, no fields to edit) may already have been drawn from the OLD stored
   * value and keep its pin in memory, and the next order would carry it. The storage is clean now, so reload once: the
   * page then reads clean details (a second pass finds nothing to scrub, so it cannot loop). Only for the quick
   * checkout, where nothing has been typed; in the full form the pin is in the note box where the control shows it. */
  if (scrubStored() && onCheckout() && document.querySelector('.purchase-quick')) {
    try { location.reload(); } catch (e) { /* stay on the page */ }
  }

  /* ---------- the control ---------- */
  var BTN = 'min-height:44px;padding:0 16px;border:1px solid var(--line-strong,#7b8793);border-radius:12px;background:var(--surface,#fff);color:var(--ink,#171a1e);font:inherit;font-size:14px;font-weight:700;line-height:1.3;cursor:pointer;max-width:100%;text-align:center';
  var LNK = 'display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 8px;color:var(--ink,#171a1e);font-size:14px;font-weight:700;text-decoration:underline;text-underline-offset:3px';
  /* status and hint at 14px (MOBILE-1112B: they were 13 and 12, the smallest text on the checkout) */
  var ST_ON = 'flex:1 1 200px;min-width:0;margin:0;font-size:14px;line-height:1.5;color:var(--ink,#171a1e)';
  var ST_OFF = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
  var HINT = 'flex:1 1 100%;margin:0;font-size:14px;line-height:1.5;color:var(--text-muted,#596571)';

  function el(tag, id, css) {
    var e = document.createElement(tag);
    e.id = id;
    e.setAttribute('style', css);
    return e;
  }
  function build() {
    var n = el('div', NS, 'grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:2px');
    n.setAttribute('data-sporta-loc', '1');
    n.setAttribute('role', 'group');
    var btn = el('button', NS + '-btn', BTN);
    btn.type = 'button';
    btn.setAttribute('aria-describedby', NS + '-hint');
    var open = el('a', NS + '-open', LNK + ';display:none');
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    var retry = el('button', NS + '-retry', BTN + ';display:none');
    retry.type = 'button';
    var st = el('p', NS + '-status', ST_OFF);
    st.setAttribute('role', 'status');
    st.setAttribute('aria-live', 'polite');
    var hint = el('p', NS + '-hint', HINT);
    n.appendChild(btn); n.appendChild(open); n.appendChild(retry); n.appendChild(st); n.appendChild(hint);
    btn.addEventListener('click', function () { if (btn.getAttribute('data-act') === 'remove') remove(); else share(); });
    /* A retry exists because the first fix was poor: a cached one (maximumAge) would just be handed back. */
    retry.addEventListener('click', function () { share(true); });
    /* A visible ring for keyboard users only (:focus-visible cannot be written in an inline style). */
    n.addEventListener('focusin', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches(':focus-visible')) { t.style.outline = '3px solid var(--brand,#e0561c)'; t.style.outlineOffset = '2px'; }
    });
    n.addEventListener('focusout', function (e) {
      if (e.target && e.target.style) { e.target.style.outline = ''; e.target.style.outlineOffset = ''; }
    });
    return n;
  }
  function put(node, text) { if (node.textContent !== text) node.textContent = text; }
  function css(node, text) { if (node.getAttribute('style') !== text) node.setAttribute('style', text); }
  /* setAttribute with an unchanged value still counts as a DOM mutation; only write what differs. */
  function attr(node, name, v) { if (v === null) { if (node.hasAttribute(name)) node.removeAttribute(name); } else if (node.getAttribute(name) !== v) node.setAttribute(name, v); }

  function render() {
    var n = document.getElementById(NS);
    if (!n) return;
    var L = S[lang()];
    var ta = getNote();
    var cur = ta ? find(ta.value) : null;
    var btn = n.querySelector('#' + NS + '-btn'), open = n.querySelector('#' + NS + '-open');
    var retry = n.querySelector('#' + NS + '-retry'), st = n.querySelector('#' + NS + '-status');
    put(n.querySelector('#' + NS + '-hint'), L.hint);
    attr(n, 'aria-label', L.region);
    var status = '', act = 'share', label = L.share, weak = false, showOpen = false;
    if (btn.disabled !== busy) btn.disabled = busy;
    attr(btn, 'aria-busy', busy ? 'true' : null);
    if (busy) {
      label = L.locating;
      status = L.locating;
    } else if (cur) {
      act = 'remove';
      label = L.remove;
      showOpen = true;
      if (last && last.lat === cur.lat && last.lng === cur.lng && last.acc !== null) {
        weak = last.acc > WEAK_M;
        status = (weak ? L.doneWeak : L.done).replace('{n}', String(last.acc));
      } else {
        status = L.doneOld;
      }
      if (msg && msg !== 'removed') status = L[msg] || status;
    } else if (msg) {
      status = L[msg] || '';
    }
    put(btn, label);
    attr(btn, 'data-act', act);
    attr(btn, 'aria-label', act === 'remove' ? L.removeLabel : null);
    put(open, L.open);
    css(open, LNK + (showOpen ? '' : ';display:none'));
    attr(open, 'href', showOpen ? MAPS + cur.lat + ',' + cur.lng : null);
    put(retry, L.retry);
    css(retry, BTN + (weak ? '' : ';display:none'));
    put(st, status);
    css(st, status ? ST_ON : ST_OFF);
    if (!busy && refocus) {
      refocus = false;
      if (!document.activeElement || document.activeElement === document.body) btn.focus();
    }
  }

  /* ---------- actions ---------- */
  function share(fresh) {
    if (busy || !getNote()) return;
    busy = true; msg = null;
    /* A disabled button drops keyboard focus; remember it was ours so it can be given back. */
    var box = document.getElementById(NS);
    refocus = !!(box && box.contains(document.activeElement));
    var mine = ++token;
    /* The note field this lookup was started for. A late answer is written only into that same field: if the checkout was
     * left and mounted again meanwhile (a new field), the answer belongs to a page that is gone and writes nothing. */
    var target = getNote();
    guarded(render);
    var geo = null;
    try { geo = navigator.geolocation; } catch (e) { geo = null; }
    if (!geo || typeof geo.getCurrentPosition !== 'function') { finish(mine, 'fail'); return; }
    /* Nothing else ends the "Finding your location" state if neither callback ever fires (in-app browsers, an
     * unanswered iOS prompt). Bumping the token makes a very late answer harmless. */
    clearTimeout(dog);
    dog = setTimeout(function () { dog = null; if (mine === token && busy) { token++; finish(token, 'fail'); } }, WATCHDOG_MS);
    var ask = function (high, ms, retried) {
      try {
        geo.getCurrentPosition(function (pos) { arrived(mine, pos, target); }, function (err) {
          if (err && err.code === 3 && !retried && mine === token) { ask(false, 10000, true); return; }
          finish(mine, err && err.code === 1 ? 'denied' : 'fail');
        }, { enableHighAccuracy: high, timeout: ms, maximumAge: fresh === true ? 0 : 60000 });
      } catch (e) { finish(mine, 'fail'); }
    };
    ask(true, 12000, false);
  }
  function finish(mine, kind) {
    if (mine !== token) return;
    clearTimeout(dog); dog = null;
    busy = false; msg = kind;
    guarded(render);
  }
  function arrived(mine, pos, target) {
    if (mine !== token) return;
    clearTimeout(dog); dog = null;
    var c = pos && pos.coords, lat = c && Number(c.latitude), lng = c && Number(c.longitude);
    /* null becomes 0 in some webviews: exactly 0,0 (the Gulf of Guinea) is never a delivery address. */
    if (!c || c.latitude === null || c.longitude === null || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { finish(mine, 'fail'); return; }
    var ta = getNote();
    if (!ta || ta !== target || !onCheckout()) { busy = false; msg = null; guarded(render); return; }
    var la = lat.toFixed(6), ln = lng.toFixed(6);
    var line = S[lang()].label + MAPS + la + ',' + ln;
    var base = strip(ta.value);
    if (base.length + (base.length ? 1 : 0) + line.length > limitOf(ta)) { finish(mine, 'tooLong'); return; }
    var acc = Number(c.accuracy);
    last = { lat: la, lng: ln, acc: isFinite(acc) ? Math.max(1, Math.round(acc)) : null };
    busy = false; msg = null;
    guarded(function () { setNote(ta, base + (base.length ? ' ' : '') + line); render(); });
  }
  function remove() {
    var ta = getNote();
    msg = 'removed';
    guarded(function () { if (ta) setNote(ta, strip(ta.value)); render(); });
  }

  /* ---------- keeping it in place ---------- */
  function ensure() {
    var n = document.getElementById(NS);
    if (onCheckout()) scrubStored();
    var ta = onCheckout() && !blocked() ? getNote() : null;
    if (!ta) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
      clearTimeout(dog); dog = null;
      busy = false; token++; msg = null;
      return;
    }
    var wrap = ta.parentElement, grid = wrap && wrap.parentElement;
    if (!grid) return;
    if (!n) n = build();
    if (n.parentNode !== grid || n.previousElementSibling !== wrap) grid.insertBefore(n, wrap.nextSibling);
    render();
  }
  function watch() {
    if (!live || !document.body) return;
    if (!obs) obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'dir'] });
  }
  function guarded(fn) {
    if (obs) obs.disconnect();
    try { fn(); } catch (e) { /* the order form must never break because of this control */ }
    watch();
  }
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; guarded(ensure); }, 120);
  }

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (!t || t.id !== 'f-note') return;
    if (!writing) msg = null;
    guarded(render);
  }, true);
  document.addEventListener('focusin', function (e) {
    if (e.target && e.target.id === 'f-note') guarded(render);
  }, true);
  window.addEventListener('popstate', schedule);

  function start() { live = true; guarded(ensure); }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();

/* Sporta checkout: the AREA LIST on a touch screen (MOBILE-1112B, 2026-11-12, owner: "fix"; scripts/mobile-1112b-test.mjs).
 * The compiled area combobox picks a row on POINTERDOWN, so a finger that touched the open list to scroll it picked the
 * row it landed on and closed the list (measured on the captured live checkout: a 150px upward drag from the bottom row
 * set the area to "Bneid Al Gar"). For a touch or pen pointer on a row, the pointerdown is held back at window, before the
 * page sees it (the page's own handler would pick), with preventDefault as that handler does (the field keeps focus and
 * the keyboard stays up). The browser still scrolls the list. When the same finger lifts within 10px of where it went
 * down, the list did not scroll, and the finger is still on that row, the pointerdown is handed to the row then: the page's
 * own handler picks it, exactly as it would have. A drag, a scroll (pointercancel) or a lift elsewhere picks nothing.
 * A mouse is untouched (a click picks at once, as before), and so is the keyboard. */
(function () {
  'use strict';
  var OPT = '.purchase-field [role="listbox"] > [role="option"]';
  var SLOP = 10;
  var down = null;
  var replay = false;
  function row(t) { return t && t.closest ? t.closest(OPT) : null; }
  window.addEventListener('pointerdown', function (e) {
    if (replay || e.pointerType === 'mouse') return;
    var o = row(e.target);
    if (!o) return;
    e.stopPropagation();
    e.preventDefault();
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, el: o, list: o.parentNode, top: o.parentNode.scrollTop, type: e.pointerType };
  }, true);
  window.addEventListener('pointermove', function (e) {
    if (down && e.pointerId === down.id && (Math.abs(e.clientX - down.x) > SLOP || Math.abs(e.clientY - down.y) > SLOP)) down = null;
  }, true);
  window.addEventListener('pointercancel', function (e) {
    if (down && e.pointerId === down.id) down = null;
  }, true);
  window.addEventListener('pointerup', function (e) {
    if (!down || e.pointerId !== down.id) return;
    var d = down;
    down = null;
    if (Math.abs(d.list.scrollTop - d.top) > 2 || !d.el.isConnected) return;
    if (row(document.elementFromPoint(e.clientX, e.clientY)) !== d.el) return;
    replay = true;
    try {
      d.el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerId: d.id, pointerType: d.type, isPrimary: true, clientX: e.clientX, clientY: e.clientY }));
    } catch (err) { /* the row stays unpicked; the shopper can tap again */ }
    replay = false;
  }, true);
})();
