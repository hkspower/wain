/* Sporta — bigger touch targets on the website panel, on a phone.
 *
 * ---------------------------------------------------------------- WHY AT ALL
 *
 * Asked for on 2026-09-17 as "make admin full mobile use". Measured first,
 * the way this project always does before touching layout: at 390x844,
 * `hasTouch: true, isMobile: true` (the shape a real phone reports, not a
 * mouse-driven headless default — see this file's own sibling finding about
 * `pointer: coarse` rules being invisible to a fine-pointer test), every
 * screen in the panel already fits with no horizontal scroll. The gap is
 * narrower than a redesign: four controls on the Settings screen's own
 * cards are under the 44px touch target Apple and WCAG 2.5.5 ask for —
 *
 *     .srl-chip   37px   the size/fit/governorate chips (rules.js)
 *     .scc-chip   36px   "Undo my edits" / "Clear" (custom-css.js)
 *     .scc-go     40px   "Save" (custom-css.js)
 *
 * — each measured on the real element a tap actually lands on (a `<label>`
 * wrapping the checkbox for `.srl-chip`, since that is what toggles it, not
 * the 13px checkbox alone), not read off the markup and assumed. `.spc` and
 * `.sle` — the contact and policy-pages cards — already clear 44px with
 * their own padding and are left alone.
 *
 * WHY AN OVERLAY OF ITS OWN, rather than a fifth card or an edit inside
 * rules.js/custom-css.js. Both of those files are read and re-published as
 * a whole; changing three numbers in each would work exactly the same as
 * this, but it would scatter one small fix across two unrelated files' own
 * histories. This is a single, separately named enhancement — matching
 * `sporta-ui.css`'s existing "carousel targets" block, which does the same
 * job for the storefront's hero controls and is the block this one is
 * modelled on.
 *
 * `@media (pointer: coarse)` — SAME AS THE STOREFRONT'S CAROUSEL FIX, for
 * the same reason: a mouse is precise and a thumb is not, and a headless
 * browser's DEFAULT context reports a FINE pointer, so this rule correctly
 * does not fire under Playwright's default `newPage()` — only a context
 * built with `hasTouch: true, isMobile: true` matches it, which is why the
 * measurements above needed that flag to see the gap at all.
 *
 * `min-height` ONLY, not a redesign. Each of the three rules raises the
 * value already declared in its own file's stylesheet; nothing else about
 * the shape, colour or spacing of any control changes on a mouse, and only
 * the height changes on a touchscreen. The chip's WIDTH is untouched
 * everywhere — unlike the storefront's carousel dots, these chips do not
 * sit edge to edge, so there is no "wrong neighbour" hazard to weigh here.
 *
 * `!important` IS NEEDED HERE, and measuring said so rather than habit.
 * rules.js's and custom-css.js's own cards are not mounted at parse time —
 * they wait for the Settings screen to render, which needs React to mount
 * and the panel to navigate there — so their `<style>` tags land in <head>
 * AFTER this one, and an unlayered rule with equal specificity that comes
 * LATER in the document wins regardless of which file asked for the
 * override. Confirmed by measuring `.scc-go`'s computed height stay at 40px
 * under `pointer: coarse` with this rule present and un-`!important`ed,
 * before adding it fixed the same measurement.
 */
;(function () {
  'use strict'

  var CSS = ''
    + '@media (pointer: coarse) {'
    + '  .srl-chip { min-height: 44px !important; }'
    + '  .scc-chip { min-height: 44px !important; }'
    + '  .scc-go   { min-height: 44px !important; }'
    + '}'

  var onPanel = /^\/backends(\/|$)/.test(location.pathname)
  if (!onPanel) return

  if (document.getElementById('sam-css')) return
  var s = document.createElement('style')
  s.id = 'sam-css'
  s.textContent = CSS
  document.head.appendChild(s)
})()
