/**
 * The footer's social icons, from the Social media card in /backends (2026-10-01).
 *
 * WHY AN OVERLAY. The storefront is a prebuilt bundle with no source in this repository; its
 * footer draws three round icon links — Instagram, TikTok, WhatsApp — and nothing in it can
 * grow a fourth. This reads the shop's social links from ?r=social and, in the footer's own
 * icon row, points the three it has at the owner's links and adds Snapchat and YouTube beside
 * them, cloned from an existing icon so they take the same size, ring and hover.
 *
 * ORDER: Instagram, Snapchat, TikTok, YouTube, WhatsApp.
 *
 * WHAT AN EMPTY LINK DOES. Snapchat and YouTube have no icon until their link is filled in. For
 * Instagram, TikTok and WhatsApp an empty box leaves the footer exactly as the shop had it (the
 * contact details still drive them, via contact.js) — so a shop that has never opened the card is
 * unchanged, and nothing here can blank a link the footer already had.
 *
 * It only ever touches anchors INSIDE the footer, ignores a link that is not https, and does
 * nothing at all if the icon row cannot be found (a bundle change must never break the footer).
 */
(function () {
  'use strict'

  var MARK = 'data-sporta-social'
  var ORDER = ['instagram', 'snapchat', 'tiktok', 'youtube', 'whatsapp']
  var AR = function () { return document.documentElement.lang === 'ar' }
  var NAMES = {
    instagram: ['Instagram', 'إنستغرام'], snapchat: ['Snapchat', 'سناب شات'], tiktok: ['TikTok', 'تيك توك'],
    youtube: ['YouTube', 'يوتيوب'], whatsapp: ['WhatsApp Business', 'واتساب للأعمال'],
  }
  var FIND = {
    instagram: 'a[href*="instagram.com"]', tiktok: 'a[href*="tiktok.com"]',
    whatsapp: 'a[href*="wa.me"], a[href*="whatsapp.com"], a[href*="wa.link"]',
    snapchat: 'a[href*="snapchat.com"]', youtube: 'a[href*="youtube.com"], a[href*="youtu.be"]',
  }

  /* Hand-drawn outline glyphs for the two networks the bundle has no icon for. 24x24, drawn in
     currentColor with the stroke the bundle's own icons use, so they sit in the same ring. */
  var SVG_NS = 'http://www.w3.org/2000/svg'
  function icon(paths) {
    var s = document.createElementNS(SVG_NS, 'svg')
    s.setAttribute('viewBox', '0 0 24 24')
    s.setAttribute('width', '20'); s.setAttribute('height', '20')
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor')
    s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round')
    s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false')
    paths.forEach(function (d) { var p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.appendChild(p) })
    return s
  }
  var GLYPH = {
    youtube: function () { return icon(['M3.2 8.2c.2-1.6 1.4-2.8 3-3 3.5-.4 7.1-.4 10.6 0 1.6.2 2.8 1.4 3 3 .4 2.5.4 5.1 0 7.6-.2 1.6-1.4 2.8-3 3-3.5.4-7.1.4-10.6 0-1.6-.2-2.8-1.4-3-3-.4-2.5-.4-5.1 0-7.6z', 'M10 9.2v5.6l4.8-2.8z']) },
    snapchat: function () { return icon(['M12 3.2c-2.9 0-4.8 2.1-4.8 4.8v1.9c-.7-.1-1.6.2-2 .7.7.5 1.4.6 2 .6-.4 1.3-1.6 2.2-2.9 2.5.5.8 1.7 1 2.5 1.1.2.4.3.8.7 1 1 .6 1.7-.3 2.5-.3s1.5.9 2.5.3c.4-.2.5-.6.7-1 .8-.1 2-.3 2.5-1.1-1.3-.3-2.5-1.2-2.9-2.5.6 0 1.3-.1 2-.6-.4-.5-1.3-.8-2-.7V8c0-2.7-1.9-4.8-4.8-4.8z']) },
  }

  var api = ((window.SPORTA_CONFIG && window.SPORTA_CONFIG.phpApiUrl) || '/api').replace(/\/$/, '')
  var cfg = null, fetching = false

  function https(u) { return typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : '' }

  function footerRow() {
    var f = document.querySelector('footer')
    if (!f) return null
    var any = f.querySelector(FIND.instagram + ',' + FIND.tiktok + ',' + FIND.whatsapp)
    return any && any.parentElement ? { footer: f, row: any.parentElement, template: any } : null
  }

  /** The icon for one network if it is already in the footer (ours, by its mark, or the bundle's). */
  function existing(ctx, kind) {
    return ctx.footer.querySelector('[' + MARK + '="' + kind + '"]') || ctx.footer.querySelector(FIND[kind])
  }

  /** A new icon for Snapchat or YouTube, cloned from one already there so it takes the same ring,
   *  size and hover. It is MARKED before it is inserted — a clone still carrying the template's
   *  Instagram link would otherwise be found by nothing, and made again on every pass. */
  function create(ctx, kind) {
    var a = ctx.template.cloneNode(true)
    while (a.firstChild) a.removeChild(a.firstChild)
    a.setAttribute(MARK, kind)
    a.appendChild(GLYPH[kind]())
    ctx.row.appendChild(a)
    return a
  }

  function apply() {
    if (!cfg) return
    var ctx = footerRow()
    if (!ctx) return
    var ar = AR() ? 1 : 0
    ORDER.forEach(function (kind) {
      var url = https(cfg[kind])
      var a = existing(ctx, kind)
      if (!url) {
        // Empty: the two new networks have no icon (one made earlier is hidden, never made again);
        // Instagram, TikTok and WhatsApp keep the shop's own link, untouched.
        if (a && a.getAttribute(MARK) && (kind === 'snapchat' || kind === 'youtube')) a.hidden = true
        return
      }
      if (!a) {
        if (kind !== 'snapchat' && kind !== 'youtube') return
        a = create(ctx, kind)
      }
      a.hidden = false
      if (a.getAttribute('href') !== url) a.setAttribute('href', url)
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
      a.setAttribute('aria-label', NAMES[kind][ar])
      a.setAttribute('title', NAMES[kind][ar])
      a.setAttribute(MARK, kind)
    })
    // put them in the shop's order, touching the DOM only if it is not already in that order
    var want = ORDER.map(function (k) { return existing(ctx, k) }).filter(function (n) { return n && !n.hidden })
    var cur = Array.prototype.filter.call(ctx.row.children, function (n) { return want.indexOf(n) >= 0 })
    var same = cur.length === want.length && want.every(function (n, i) { return cur[i] === n })
    if (!same) want.forEach(function (n) { ctx.row.appendChild(n) })
  }

  function load() {
    if (cfg || fetching) return
    fetching = true
    fetch(api + '/api.php?r=social', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) { cfg = j && typeof j === 'object' ? j : {}; apply() })
      .catch(function () { cfg = {} })
  }

  // The footer is drawn by the bundle after this runs and again on navigation, and the bundle can
  // put its own hrefs back, so re-apply (throttled to a frame) whenever the page changes.
  var queued = false
  function schedule() {
    if (queued) return
    queued = true
    requestAnimationFrame(function () { queued = false; if (cfg) apply(); else load() })
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  schedule()
})()
