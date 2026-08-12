/* =========================================================================
   موصول — MAWSOOL | سكربت الواجهة
   ========================================================================= */
(function () {
  'use strict';

  /* حزمة اللغة العربية — الأرقام وفواصلها وتمييز العدد.
     تُحمَّل من assets/js/arabic-kit.js قبل هذا الملف. */
  var AR = window.arabicKit;

  /** تنسيق رقم بفاصل الآلاف العربي (٬) وأرقام عربية-هندية */
  function formatCount(n) {
    return AR.number(n);
  }

  /* ------------------------- القائمة على الجوال ------------------------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');

  function closeNav() {
    if (!nav) return;
    nav.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'فتح القائمة');
  }

  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      document.body.classList.toggle('nav-open', open);
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'إغلاق القائمة' : 'فتح القائمة');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) closeNav();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeNav();
    });

    document.addEventListener('click', function (e) {
      if (!nav.classList.contains('is-open')) return;
      if (!nav.contains(e.target) && !burger.contains(e.target)) closeNav();
    });
  }

  /* ------- ظل الهيدر + شريط التقدّم + زر العودة للأعلى (بإطار واحد) ------- */
  var header = document.getElementById('header');
  var progress = document.getElementById('progress');
  var toTop = document.getElementById('toTop');
  var ticking = false;

  function onScrollFrame() {
    var y = window.scrollY;
    var max = document.documentElement.scrollHeight - window.innerHeight;

    if (header) header.classList.toggle('is-stuck', y > 8);
    if (progress) progress.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
    if (toTop) toTop.classList.toggle('is-visible', y > 700);

    ticking = false;
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScrollFrame);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  onScrollFrame();

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* --------------------- إبراز رابط القسم الحالي --------------------- */
  var navLinks = Array.prototype.slice.call(
    document.querySelectorAll('.nav a[href^="#"]:not(.nav__cta)')
  );
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (a) {
          a.classList.toggle('is-current', a.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ------------------------ الظهور التدريجي ------------------------ */
  var revealables = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var revealer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry, i) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.style.transitionDelay = Math.min(i * 70, 280) + 'ms';
        el.classList.add('is-in');
        obs.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    revealables.forEach(function (el) { revealer.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* --------------------------- عدّاد الأرقام --------------------------- */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* عدّاد يحترم تمييز العدد: العدّاد الموسوم بـ data-noun يمرّ أثناء الحركة
     على ٣ و١١ و٥٢، ولكل منها صيغة مختلفة — «٣ دقائق» ثم «١١ دقيقة». بدون هذا
     كان يعرض «٣ دقيقة» طوال الحركة. */
  function counterText(el, value) {
    var noun = el.dataset.noun;
    if (noun) return AR.plural(value, noun, { showNumber: true });
    // السنوات وأرقام الموديل بلا فاصل آلاف: ٢٠٢٢ لا ٢٬٠٢٢
    var body = el.hasAttribute('data-plain') ? AR.digits(value) : formatCount(value);
    return body + (el.dataset.suffix || '');
  }

  function runCounter(el) {
    var target = parseInt(el.dataset.count, 10) || 0;

    if (reduceMotion) {
      el.textContent = counterText(el, target);
      return;
    }

    var duration = 1500;
    var start = null;

    function tick(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = counterText(el, Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var statsBox = document.getElementById('stats');
  if (statsBox) {
    var counters = statsBox.querySelectorAll('[data-count]');
    if ('IntersectionObserver' in window) {
      var statObs = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          counters.forEach(runCounter);
          obs.disconnect();
        });
      }, { threshold: 0.4 });
      statObs.observe(statsBox);
    } else {
      counters.forEach(runCounter);
    }
  }

  /* ------------------------- تبويبات المحافظات ------------------------- */
  var govButtons = document.querySelectorAll('.gov');
  var govName = document.getElementById('govName');
  var govTime = document.getElementById('govTime');
  var govFee = document.getElementById('govFee');
  var govAreas = document.getElementById('govAreas');

  govButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      govButtons.forEach(function (b) {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');

      if (govName) govName.textContent = 'محافظة ' + btn.dataset.name;
      if (govTime) govTime.textContent = btn.dataset.time;
      if (govFee) govFee.textContent = btn.dataset.fee;
      if (govAreas) govAreas.textContent = btn.dataset.areas;
    });
  });

  /* --------------------------- تتبع الطلب --------------------------- */
  var trackForm = document.getElementById('trackForm');
  var trackInput = document.getElementById('trackInput');
  var trackMsg = document.getElementById('trackMsg');
  var timeline = document.getElementById('timeline');

  if (trackForm) {
    trackForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = (trackInput.value || '').trim().toUpperCase();

      if (!value) {
        trackMsg.textContent = 'الرجاء إدخال رقم الطلب.';
        trackMsg.className = 'form-msg is-bad';
        timeline.hidden = true;
        return;
      }

      if (!/^MW-?\d{3,6}$/i.test(value)) {
        trackMsg.textContent = 'رقم الطلب يبدأ بـ MW متبوعًا بأرقام — مثال: MW-4821';
        trackMsg.className = 'form-msg is-bad';
        timeline.hidden = true;
        return;
      }

      var normalized = value.replace(/^MW-?/, 'MW-');
      trackMsg.textContent = 'تم العثور على الشحنة.';
      trackMsg.className = 'form-msg is-ok';

      document.getElementById('tOrder').textContent = normalized;
      document.getElementById('tState').textContent = 'الشحنة في الطريق إليك';
      timeline.hidden = false;
      timeline.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    });
  }

  /* --------------------------- نموذج الطلب --------------------------- */
  var orderForm = document.getElementById('orderForm');
  var orderMsg = document.getElementById('orderMsg');

  function setError(input, message) {
    var field = input.closest('.field');
    var slot = field ? field.querySelector('.err') : null;
    field && field.classList.toggle('has-error', Boolean(message));
    if (slot) slot.textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validate(input) {
    var value = (input.value || '').trim();

    if (!value) {
      setError(input, 'هذا الحقل مطلوب.');
      return false;
    }
    if (input.id === 'name' && value.length < 3) {
      setError(input, 'الرجاء كتابة الاسم كاملًا.');
      return false;
    }
    if (input.id === 'phone') {
      var digits = value.replace(/[^\d]/g, '');
      if (digits.length < 8) {
        setError(input, 'رقم الهاتف يجب أن يتكون من ٨ أرقام على الأقل.');
        return false;
      }
    }
    if ((input.id === 'pickup' || input.id === 'dropoff') && value.length < 5) {
      setError(input, 'الرجاء كتابة عنوان أوضح (المنطقة والقطعة والشارع).');
      return false;
    }
    setError(input, '');
    return true;
  }

  if (orderForm) {
    var required = orderForm.querySelectorAll('[required]');

    required.forEach(function (input) {
      input.addEventListener('blur', function () { validate(input); });
      input.addEventListener('input', function () {
        if (input.closest('.field').classList.contains('has-error')) validate(input);
      });
    });

    orderForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      var first = null;

      required.forEach(function (input) {
        if (validate(input)) return;
        ok = false;
        if (!first) first = input;
      });

      if (!ok) {
        orderMsg.textContent = 'الرجاء تصحيح الحقول المظللة بالأحمر.';
        orderMsg.className = 'form-msg is-bad';
        if (first) first.focus();
        return;
      }

      // نموذج تجريبي بدون خادم — يُستبدل هنا باستدعاء واجهة برمجية حقيقية
      var ref = 'MW-' + Math.floor(1000 + Math.random() * 9000);
      orderMsg.textContent = 'تم استلام طلبك بنجاح ✅ رقم الطلب ' + ref +
        ' — سيتصل بك فريقنا خلال دقائق لتأكيد التفاصيل.';
      orderMsg.className = 'form-msg is-ok';
      orderForm.reset();
      required.forEach(function (input) { setError(input, ''); });
    });
  }

  /* ------------------------------ السنة ------------------------------ */
  var year = document.getElementById('year');
  if (year) year.textContent = AR.digits(new Date().getFullYear());
})();
