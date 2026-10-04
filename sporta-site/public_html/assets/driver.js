/* The driver's page (api/driver.php): sends the phone's position for one order every 15 seconds while
 * "sharing" is on and the page is open. The server decides whether it is accepted (signed link, order
 * still on its way); this script only reports what it was told. */
(function () {
  'use strict'
  var body = document.body
  if (body.getAttribute('data-valid') !== '1') return
  var T = {
    title: ['Share delivery location', 'مشاركة موقع التوصيل'], order: ['Order', 'الطلب'],
    help: ['Press "Start sharing" and keep this page open while delivering. The customer sees your position on a map only while the order is on its way.',
           'اضغط «ابدأ المشاركة» واترك هذه الصفحة مفتوحة أثناء التوصيل. يرى العميل موقعك على الخريطة فقط ما دام الطلب في الطريق.'],
    start: ['Start sharing', 'ابدأ المشاركة'], stop: ['Stop sharing', 'إيقاف المشاركة'],
    bad: ['This link is not valid. Ask the shop for a new one.', 'هذا الرابط غير صالح. اطلب رابطًا جديدًا من المتجر.'],
    on: ['Sharing — last sent ', 'المشاركة فعّالة — آخر إرسال '], off: ['Sharing stopped.', 'تم إيقاف المشاركة.'],
    denied: ['Location permission was refused. Allow it in the browser settings and try again.', 'تم رفض إذن الموقع. اسمح به من إعدادات المتصفح ثم حاول مجددًا.'],
    closed: ['This order is no longer on its way; sharing has ended.', 'هذا الطلب لم يعد في الطريق؛ انتهت المشاركة.'],
    nogeo: ['This browser cannot share a location.', 'هذا المتصفح لا يدعم مشاركة الموقع.'],
    fail: ['Could not send the position. Trying again…', 'تعذّر إرسال الموقع. سنحاول مجددًا…'],
    lang: ['العربية', 'English'],
  }
  var lang = 'ar'
  function t(k) { return T[k][lang === 'ar' ? 1 : 0] }
  function applyLang() {
    document.documentElement.lang = lang; document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) })
    document.querySelector('.drv-lang').textContent = t('lang')
  }
  var start = document.querySelector('.drv-start'), stop = document.querySelector('.drv-stop'), status = document.querySelector('.drv-status')
  var url = location.pathname + location.search
  var watch = null, timer = null, last = null, ended = false
  function say(kind, text) { status.setAttribute('data-kind', kind); status.textContent = text }
  function send(payload) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j } }) })
  }
  function push() {
    if (!last || ended) return
    send({ lat: last.lat, lng: last.lng, acc: last.acc }).then(function (r) {
      if (r.s === 410) { end(); say('err', t('closed')); return }
      if (r.s !== 200) { say('err', t('fail')); return }
      say('on', t('on') + new Date().toLocaleTimeString(lang === 'ar' ? 'ar-KW' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }).catch(function () { say('err', t('fail')) })
  }
  function end() {
    ended = true
    if (watch !== null) navigator.geolocation.clearWatch(watch)
    if (timer) clearInterval(timer)
    watch = null; timer = null
    start.hidden = false; stop.hidden = true
  }
  start.addEventListener('click', function () {
    if (!navigator.geolocation) { say('err', t('nogeo')); return }
    ended = false; start.hidden = true; stop.hidden = false; say('', '…')
    watch = navigator.geolocation.watchPosition(function (p) {
      var first = !last
      last = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }
      if (first) push()
    }, function () { end(); say('err', t('denied')) }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 })
    timer = setInterval(push, 15000)
  })
  stop.addEventListener('click', function () {
    end(); last = null
    send({ stop: 1 }).then(function () { say('', t('off')) }).catch(function () { say('', t('off')) })
  })
  document.querySelector('.drv-lang').addEventListener('click', function () { lang = lang === 'ar' ? 'en' : 'ar'; applyLang() })
  // Keep going in the background on phones that allow it; when the tab returns, send at once.
  document.addEventListener('visibilitychange', function () { if (!document.hidden) push() })
  window.addEventListener('pagehide', function () { if (!ended && last) { try { navigator.sendBeacon(url, new Blob([JSON.stringify({ lat: last.lat, lng: last.lng, acc: last.acc })], { type: 'application/json' })) } catch (e) {} } })
  applyLang()
})()
