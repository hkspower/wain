/**
 * The سبورتا AI launcher and panel header: a dedicated icon instead of the
 * site favicon reused as-is.
 *
 * WHAT WAS THERE. Both the floating launcher button and the open panel's
 * header used `<img src="/favicon-192.png">` — the plain orange "S" mark,
 * the same file the browser tab and the PWA install icon use. Nothing wrong
 * with it structurally, but it gave the assistant no identity of its own:
 * opening the chat looked identical to the tab icon.
 *
 * THE NEW ICON (assets/../assistant-bot.webp, jpg fallback via .png) is a
 * black robot head carrying the SAME orange S mark as its chest panel,
 * built by compositing the real favicon-192.png artwork rather than
 * redrawing the mark by hand — so the brand shape is exactly the one the
 * shop already ships, not an approximation of it.
 *
 * MATCHED STRUCTURALLY, NOT BY ARIA-LABEL TEXT. The launcher's aria-label is
 * "Open the Sporta assistant" in English and "افتح مساعد سبورتا" in
 * Arabic — the two share no substring an attribute selector could catch,
 * which is exactly the trap this project's own CLAUDE.md already records
 * for a route extractor and an admin-gate checker that each missed a case
 * by matching on the wrong thing. `aria-expanded` is present on the
 * launcher in BOTH languages (it is how a screen reader knows the panel's
 * open state), and nothing else fixed to the viewport corner carries it, so
 * that is what is matched here instead.
 *
 * THE PANEL HEADER'S IMG has no distinguishing attribute of its own, so it
 * is matched by walking up from any swapped launcher-style image to find
 * the assistant panel's own fixed, high-z-index wrapper — the same
 * `bottom-24` positioning class the bundle already uses to place it above
 * the launcher it replaces.
 *
 * REVERTS ON ITS OWN if the new file is ever missing: the swap only
 * happens inside the image's own load handler, so a 404 leaves the
 * original favicon showing rather than a broken image icon.
 */
;(function () {
  'use strict'

  var MARK = 'data-sporta-bot-icon'
  var NEW_SRC = '/assistant-bot.webp'

  function swap(img) {
    if (img.hasAttribute(MARK)) return
    img.setAttribute(MARK, '1')
    var probe = new Image()
    probe.onload = function () { img.src = NEW_SRC }
    probe.onerror = function () {}
    probe.src = NEW_SRC
  }

  function place() {
    // The launcher: any element carrying aria-expanded that also renders
    // the shared favicon as its icon.
    document.querySelectorAll('[aria-expanded] img[src*="favicon-192"]').forEach(function (img) {
      swap(img)
    })
    // The open panel's own header icon, found the same way.
    document.querySelectorAll('img[src*="favicon-192"]').forEach(function (img) {
      var header = img.closest('header')
      if (header && header.parentElement && /\bbottom-24\b/.test(header.parentElement.className || '')) {
        swap(img)
      }
    })
  }

  // NOT DEBOUNCED, unlike this project's other overlays. The assistant
  // panel mutates its own DOM continuously while open — a typing indicator,
  // scroll position, message timestamps — so a debounce that waits for
  // mutations to go quiet before running never actually fires: measured,
  // the panel's own churn kept resetting a 120ms timer for as long as it
  // stayed open, and `place()` was never called again after the very first
  // one. Calling it directly on every notification is safe here because
  // `place()` itself is cheap (a handful of querySelectorAll calls) and
  // `swap()` is idempotent past its first successful call on a given image
  // (the MARK attribute), so running it many times a second costs nothing
  // beyond the lookups themselves.
  new MutationObserver(place).observe(document.body, { childList: true, subtree: true })
  place()
})()
