/**
 * Product photo viewer — pinch, double-tap, drag, swipe. 2026-09-29, "improve
 * product page images ... zooming".
 *
 * WHAT WAS WRONG, measured on a real product with two photographs. Tapping the
 * gallery opens the bundle's own lightbox, and it opened on a GREY SQUARE saying
 * "Image 1 of 3" for a product with two photos: the bundle's photograph list
 * starts with its placeholder (the first <img> in the slider is the shop's grey
 * gradient, 0px wide), the lightbox opens at index 0, and so a shopper who tapped
 * the photo they were looking at was shown a blank card. There is no source for
 * the bundle here, so this is an overlay: a capture-phase click listener on the
 * gallery that takes the tap BEFORE the bundle's handler (stopImmediatePropagation
 * on document, which is ancestor of the React root), and opens this viewer with
 * the real photographs only.
 *
 * WHAT IT DOES
 *   - starts on the photograph that is actually showing (the one nearest the
 *     gallery's centre), not on index 0;
 *   - pinch to zoom around the fingers, double-tap / double-click to toggle
 *     2.5x at the point tapped, drag to pan when zoomed (clamped to the picture's
 *     edges), mouse wheel / ctrl-wheel to zoom on a desktop;
 *   - swipe sideways at 1x to change photograph (direction follows the page's
 *     dir, so Arabic swipes the other way), swipe down to close, tap outside the
 *     picture to close;
 *   - Escape closes, arrows change photograph (swapped in RTL), + - 0 zoom, Tab
 *     stays inside, focus returns to where it was, the page behind does not scroll;
 *   - always the FULL photograph: any &w= hint is stripped, so zooming shows the
 *     sharpest copy the shop holds;
 *   - honours prefers-reduced-motion.
 *
 * IT TOUCHES NOTHING THAT EXISTS. With no real photograph in the gallery it does
 * nothing and the bundle behaves as it always did; taps on buttons and links are
 * left alone; the thumbnails and the swipe on the gallery itself are untouched
 * (only the resulting CLICK is taken). Product pages only.
 */
;(function () {
  'use strict'

  var MAX_SCALE = 5
  var DOUBLE_SCALE = 2.5
  var TAP_SLOP = 8
  var DOUBLE_MS = 320
  var SWIPE_PX = 60
  var CLOSE_SWIPE_PX = 110
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  var LABELS = {
    close: { en: 'Close', ar: 'إغلاق' },
    prev: { en: 'Previous photograph', ar: 'الصورة السابقة' },
    next: { en: 'Next photograph', ar: 'الصورة التالية' },
    of: { en: ' / ', ar: ' / ' },
  }
  function lang() { return document.documentElement.lang === 'ar' ? 'ar' : 'en' }
  function label(k) { return LABELS[k][lang()] }
  function isRtl() { return document.documentElement.dir === 'rtl' }
  function isProductPage() { return /^\/product\//.test(location.pathname) }

  function fullUrl(src) { return src.replace(/([?&])w=\d+&?/, '$1').replace(/[?&]$/, '') }

  function photosOf(gallery) {
    var out = []
    var seen = {}
    var box = gallery.getBoundingClientRect()
    var cx = box.left + box.width / 2
    var nearest = 0
    var best = Infinity
    var imgs = gallery.querySelectorAll('img')
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].currentSrc || imgs[i].getAttribute('src') || ''
      if (!src || src.indexOf('data:') === 0) continue          // the shop's placeholder
      var url = fullUrl(src)
      if (seen[url]) continue
      seen[url] = true
      var r = imgs[i].getBoundingClientRect()
      if (r.width > 0) {
        var d = Math.abs(r.left + r.width / 2 - cx)
        if (d < best) { best = d; nearest = out.length }
      }
      out.push(url)
    }
    return { urls: out, start: nearest }
  }

  function el(tag, css, text) {
    var e = document.createElement(tag)
    if (css) e.style.cssText = css
    if (text != null) e.textContent = text
    return e
  }

  var openViewer = null

  function open(gallery, name) {
    if (openViewer) return
    var set = photosOf(gallery)
    var urls = set.urls
    if (!urls.length) return false
    var idx = set.start
    var previouslyFocused = document.activeElement

    var overlay = el('div', 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(9,10,12,.985);overscroll-behavior:contain;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('aria-label', name || 'Photograph')
    overlay.setAttribute('data-sporta-zoom', '1')

    var stage = el('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;touch-action:none;cursor:zoom-in')
    var img = el('img', 'max-width:100%;max-height:100%;object-fit:contain;transform-origin:50% 50%;will-change:transform;pointer-events:none;-webkit-user-drag:none')
    img.alt = name || ''
    img.draggable = false
    stage.appendChild(img)
    overlay.appendChild(stage)

    var btnCss = 'position:absolute;z-index:2;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font:600 22px/1 system-ui,sans-serif;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)'
    var close = el('button', btnCss + ';top:16px;inset-inline-end:16px', '✕')
    close.type = 'button'
    close.setAttribute('aria-label', label('close'))
    overlay.appendChild(close)

    var prev = null
    var next = null
    var counter = null
    if (urls.length > 1) {
      prev = el('button', btnCss + ';top:50%;margin-top:-22px;inset-inline-start:12px', isRtl() ? '›' : '‹')
      next = el('button', btnCss + ';top:50%;margin-top:-22px;inset-inline-end:12px', isRtl() ? '‹' : '›')
      prev.type = next.type = 'button'
      prev.setAttribute('aria-label', label('prev'))
      next.setAttribute('aria-label', label('next'))
      counter = el('div', 'position:absolute;bottom:22px;left:0;right:0;text-align:center;color:rgba(255,255,255,.85);font:600 14px/1 system-ui,sans-serif;pointer-events:none;font-variant-numeric:tabular-nums')
      overlay.appendChild(prev)
      overlay.appendChild(next)
      overlay.appendChild(counter)
    }

    // ------------------------------------------------------------ transform
    var s = 1, tx = 0, ty = 0
    function bounds() {
      var iw = img.clientWidth, ih = img.clientHeight
      var W = stage.clientWidth, H = stage.clientHeight
      return { x: Math.max(0, (iw * s - W) / 2), y: Math.max(0, (ih * s - H) / 2) }
    }
    function clampPan() {
      var b = bounds()
      tx = Math.max(-b.x, Math.min(b.x, tx))
      ty = Math.max(-b.y, Math.min(b.y, ty))
    }
    function apply(animate) {
      img.style.transition = animate && !reduce ? 'transform 200ms ease' : 'none'
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')'
      stage.style.cursor = s > 1 ? 'grab' : 'zoom-in'
    }
    // Zoom to `ns` keeping the picture point under (px, py) — measured from the
    // stage's centre — where it was.
    function zoomAt(ns, px, py, animate) {
      ns = Math.max(1, Math.min(MAX_SCALE, ns))
      tx = px - (px - tx) * (ns / s)
      ty = py - (py - ty) * (ns / s)
      s = ns
      if (s <= 1.001) { s = 1; tx = 0; ty = 0 }
      clampPan()
      apply(animate)
    }
    function rel(x, y) {
      var r = stage.getBoundingClientRect()
      return { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) }
    }

    function show(i, dir) {
      idx = Math.max(0, Math.min(urls.length - 1, i))
      s = 1; tx = 0; ty = 0
      img.src = urls[idx]
      apply(false)
      if (counter) counter.textContent = (idx + 1) + label('of') + urls.length
      if (prev) prev.style.visibility = idx === 0 ? 'hidden' : 'visible'
      if (next) next.style.visibility = idx === urls.length - 1 ? 'hidden' : 'visible'
      // The neighbours are fetched now, so a swipe lands on a picture, not a blank.
      for (var n = idx - 1; n <= idx + 1; n += 2) {
        if (n >= 0 && n < urls.length) { var pre = new Image(); pre.src = urls[n] }
      }
    }
    // "forward" is the way a swipe or an arrow moves through the shoot — the
    // reading direction of the page.
    function step(delta) { show(idx + delta) }

    // -------------------------------------------------------------- pointers
    var pts = {}
    var base = null          // gesture baseline
    var lastTap = { t: 0, x: 0, y: 0 }
    var swipeDx = 0

    function count() { var c = 0; for (var k in pts) if (Object.prototype.hasOwnProperty.call(pts, k)) c++; return c }
    function two() {
      var a = []
      for (var k in pts) if (Object.prototype.hasOwnProperty.call(pts, k)) a.push(pts[k])
      return a
    }

    stage.addEventListener('pointerdown', function (e) {
      try { stage.setPointerCapture(e.pointerId) } catch (x) { /* synthetic pointers */ }
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }
      var c = count()
      if (c === 1) {
        base = { x: e.clientX, y: e.clientY, tx: tx, ty: ty, t: Date.now(), moved: 0, pinch: false }
        swipeDx = 0
      } else if (c === 2) {
        var p = two()
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1
        var m = rel((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2)
        base = { d: d, s: s, tx: tx, ty: ty, mx: m.x, my: m.y, moved: 99, pinch: true }
      }
    })

    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId] || !base) return
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }
      var c = count()
      if (c >= 2 && base.pinch) {
        var p = two()
        var d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) || 1
        var m = rel((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2)
        var ns = Math.max(1, Math.min(MAX_SCALE, base.s * d / base.d))
        tx = m.x - (base.mx - base.tx) * (ns / base.s)
        ty = m.y - (base.my - base.ty) * (ns / base.s)
        s = ns
        clampPan()
        apply(false)
        return
      }
      if (c === 1 && !base.pinch) {
        var dx = e.clientX - base.x
        var dy = e.clientY - base.y
        base.moved = Math.max(base.moved, Math.hypot(dx, dy))
        if (s > 1) {
          tx = base.tx + dx
          ty = base.ty + dy
          clampPan()
          apply(false)
        } else {
          // At 1x the picture follows the finger a little: it is the swipe.
          swipeDx = dx
          img.style.transition = 'none'
          img.style.transform = 'translate(' + dx * 0.6 + 'px,' + Math.max(0, dy) * 0.4 + 'px) scale(1)'
        }
      }
    })

    function end(e) {
      if (!pts[e.pointerId]) return
      var wasPinch = base && base.pinch
      delete pts[e.pointerId]
      var c = count()
      if (wasPinch) {
        if (c === 0) { if (s < 1.02) { s = 1; tx = 0; ty = 0 } apply(true); base = null }
        else if (c === 1) {
          // one finger lifted: carry on as a pan from where the other one is
          var rest = two()[0]
          base = { x: rest.x, y: rest.y, tx: tx, ty: ty, t: Date.now(), moved: 99, pinch: false }
        }
        return
      }
      if (c !== 0 || !base) return
      var dx = e.clientX - base.x
      var dy = e.clientY - base.y
      var tap = base.moved < TAP_SLOP && Date.now() - base.t < 400
      base = null
      if (tap) {
        var now = Date.now()
        var near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40
        if (now - lastTap.t < DOUBLE_MS && near) {
          var pr = rel(e.clientX, e.clientY)
          zoomAt(s > 1 ? 1 : DOUBLE_SCALE, pr.x, pr.y, true)
          lastTap = { t: 0, x: 0, y: 0 }
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY }
          // a tap in the empty space round the picture closes it
          if (s === 1) {
            var r = img.getBoundingClientRect()
            var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
            if (!inside) closeViewer()
          }
        }
        return
      }
      if (s === 1) {
        if (dy > CLOSE_SWIPE_PX && Math.abs(dy) > Math.abs(dx) * 1.4) { closeViewer(); return }
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
          // Swiping toward the start edge moves forward: left in English, right in Arabic.
          var forward = isRtl() ? dx > 0 : dx < 0
          var to = idx + (forward ? 1 : -1)
          if (to >= 0 && to < urls.length) { show(to); return }
        }
        apply(true)      // not far enough: settle back
      } else {
        apply(true)
      }
    }
    stage.addEventListener('pointerup', end)
    stage.addEventListener('pointercancel', end)

    stage.addEventListener('wheel', function (e) {
      e.preventDefault()
      var pr = rel(e.clientX, e.clientY)
      zoomAt(s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), pr.x, pr.y, false)
    }, { passive: false })

    // Safari's own gesture events would otherwise zoom the whole page.
    ;['gesturestart', 'gesturechange'].forEach(function (t) {
      overlay.addEventListener(t, function (e) { e.preventDefault() }, { passive: false })
    })

    // -------------------------------------------------------------- controls
    close.addEventListener('click', closeViewer)
    if (prev) prev.addEventListener('click', function () { step(-1) })
    if (next) next.addEventListener('click', function () { step(1) })

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); closeViewer(); return }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (s > 1) return
        e.preventDefault()
        var fwd = (e.key === 'ArrowRight') !== isRtl()
        var to = idx + (fwd ? 1 : -1)
        if (to >= 0 && to < urls.length) show(to)
        return
      }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(s * 1.4, 0, 0, true); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(s / 1.4, 0, 0, true); return }
      if (e.key === '0') { e.preventDefault(); zoomAt(1, 0, 0, true); return }
      if (e.key === 'Tab') {
        var f = [close, prev, next].filter(function (b) { return b && b.style.visibility !== 'hidden' })
        var i = f.indexOf(document.activeElement)
        e.preventDefault()
        f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)

    var prevOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'

    function closeViewer() {
      if (!openViewer) return
      document.removeEventListener('keydown', onKey, true)
      document.documentElement.style.overflow = prevOverflow
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
      openViewer = null
      try { if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true }) } catch (x) {}
    }

    document.body.appendChild(overlay)
    openViewer = closeViewer
    show(idx)
    close.focus({ preventScroll: true })
    return true
  }

  // ----------------------------------------------------------------- the tap
  // Capture phase on document runs before React's root listeners, so the
  // bundle's own lightbox never sees the click.
  document.addEventListener('click', function (e) {
    if (!isProductPage() || openViewer) return
    var t = e.target
    if (!t || !t.closest) return
    var gallery = t.closest('.group.aspect-square')
    if (!gallery) return
    // The gallery ITSELF is role=button in the bundle, so only an interactive
    // element INSIDE it (an arrow, a link) is left alone.
    var inner = t.closest('button, a, [role="button"]')
    if (inner && inner !== gallery && gallery.contains(inner)) return
    var h1 = document.querySelector('h1.product-title')
    if (open(gallery, h1 ? h1.textContent.trim() : '')) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
  }, true)
})()
