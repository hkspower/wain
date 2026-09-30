/**
 * Checkout: Enter moves to the next field instead of sending the form.
 *
 * On a phone the keyboard's action key is the fastest way through a form, and
 * in a form Enter means SUBMIT: pressing it after the name posts a form with
 * nine empty fields. This makes Enter (the keyboard's "Next") jump to the next
 * field in reading order, labels the key "Next" / "Done", and on the very last
 * field does nothing special so the normal submit still works. Textareas keep
 * their newline; buttons, the discount box and anything hidden are skipped.
 * Only on /checkout, and only adds a listener: no field, value or request is changed.
 */
(function () {
  'use strict'
  if (!/^\/checkout(\/|$)/.test(location.pathname)) return

  function fields(form) {
    return [].filter.call(form.querySelectorAll('input, select'), function (e) {
      if (e.disabled || e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio' || e.type === 'submit' || e.type === 'button') return false
      if (e.closest('[hidden]') || e.getAttribute('aria-hidden') === 'true') return false
      var r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
  }

  function label(form) {
    var list = fields(form)
    list.forEach(function (e, i) {
      if (e.tagName === 'INPUT') e.setAttribute('enterkeyhint', i === list.length - 1 ? 'done' : 'next')
    })
  }

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' || ev.isComposing || ev.shiftKey || ev.ctrlKey || ev.metaKey) return
    var t = ev.target
    if (!t || t.tagName !== 'INPUT' || t.type === 'submit' || t.type === 'button') return
    var form = t.closest('form')
    if (!form || t.closest('[data-checkout-speed-skip]')) return
    var list = fields(form)
    var i = list.indexOf(t)
    // The discount box is a separate control with its own Apply button.
    if (i < 0 || /discount|code|promo/i.test((t.id || '') + (t.name || '') + (t.placeholder || ''))) return
    if (i === list.length - 1) return       // the last field: let Enter submit as it always did
    ev.preventDefault()
    var next = list[i + 1]
    next.focus()
    if (next.select && next.tagName === 'INPUT' && next.type === 'text') try { next.select() } catch (e) {}
  }, true)

  var t = null
  new MutationObserver(function () {
    clearTimeout(t)
    t = setTimeout(function () { document.querySelectorAll('form').forEach(label) }, 150)
  }).observe(document.body, { childList: true, subtree: true })
})()
