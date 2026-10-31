/* Sporta — tap-to-call link in the footer (add-on for the compiled live bundle).
 *
 * The footer's only way to reach the shop is a WhatsApp link: no phone number
 * and no tel: link, so a phone user who wants to call has to copy the number
 * from somewhere else. This clones the footer's own WhatsApp link (so it inherits
 * the exact styling, spacing and tap size), points the clone at tel:, swaps the
 * label, and drops the WhatsApp icon. A MutationObserver puts it back when React
 * re-renders the footer or the language changes. External file on purpose: the
 * CSP allows scripts from 'self' only.
 *
 * Number: 22091914 (the same one the WhatsApp links and the AI assistant use).
 */
(function () {
  'use strict'
  var ID = 'sporta-footer-call'
  var TEL = 'tel:+96522091914'
  var LABEL = { ar: 'اتصل بنا 22091914', en: 'Call us 22091914' }

  function lang() { return (document.documentElement.lang || 'ar').slice(0, 2) === 'en' ? 'en' : 'ar' }

  function mount() {
    var footer = document.querySelector('footer')
    if (!footer) return
    var wa = footer.querySelector('a[href^="https://wa.me/"]')
    if (!wa || !wa.parentNode) return
    var existing = document.getElementById(ID)
    if (existing && existing.getAttribute('data-lang') === lang() && existing.previousElementSibling === wa) return
    if (existing) existing.remove()
    var a = wa.cloneNode(true)
    a.id = ID
    a.setAttribute('href', TEL)
    a.removeAttribute('target')
    a.removeAttribute('rel')
    a.setAttribute('data-lang', lang())
    a.setAttribute('aria-label', LABEL[lang()])
    var svgs = a.querySelectorAll('svg, img')
    for (var i = 0; i < svgs.length; i++) svgs[i].remove()
    a.textContent = LABEL[lang()]
    wa.parentNode.insertBefore(a, wa.nextSibling)
  }

  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; mount() })
  }
  function start() {
    mount()
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
    new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
})()
