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
 *
 * ------------------------------------------------------- 2026-09-18: EVERY SCREEN
 *
 * Asked directly this time — "improve backend text size and icon size and
 * spacing" — rather than found on the way past. A pass over all fifteen
 * panel screens (Overview through Security), measured the same way as
 * above (`hasTouch: true, isMobile: true`, never the fine-pointer default),
 * found the three controls this file already fixed were the SMALL end of a
 * much bigger gap: every action button on every screen this shop's owner
 * actually presses — status filter chips (Orders, Reviews), row actions
 * ("Edit" on Brands, 27x17), primary buttons ("Add a product/brand/slide",
 * "Push 46 products", "New discount"), even the "Refresh" and "Show them"
 * links — sits between 17px and 40px tall. None of it is a redesign: every
 * one of these buttons keeps its own colour, shape and text; only the
 * TAPPABLE HEIGHT changes, and only for a thumb.
 *
 * A GENERAL RULE, NOT A GROWING LIST OF CLASS NAMES, unlike the three above.
 * Naming each button individually — the way `.srl-chip`/`.scc-chip`/
 * `.scc-go` do — is safe on three controls from two files, and stops being
 * safe at fifteen screens' worth of Tailwind utility combinations that this
 * repository does not own and cannot enumerate correctly: a button added to
 * the bundle tomorrow would silently miss a hand-written list the same way
 * `sw.js`'s own fixed-asset list has drifted more than once. `.admin-shell
 * button` catches every one of them, present and future, because every
 * control this pass found IS a `<button>` — confirmed, not assumed, by the
 * measurement above.
 *
 * SAFE TO GROW WITHOUT A ROW-OVERLAP HAZARD, unlike the storefront's
 * carousel dots. Those sit at a fixed pitch and cannot grow without
 * overlapping their neighbour, which is why that fix used a transparent
 * overlay instead of resizing the dot. Every control here lives in ordinary
 * document flow — a table row, a card, a flex toolbar — so growing one
 * child's min-height grows the row around it; nothing to overlap.
 *
 * `inline-flex` + `align-items: center` + `justify-content: center` is
 * what keeps a tiny 17px text link ("Edit") from floating at the top of a
 * suddenly-44px box: without it, the box grows but the text does not
 * re-centre, which looks like a rendering bug rather than a bigger button.
 *
 * THE CHECKBOX LABELS ARE THE SAME GAP IN A DIFFERENT SHAPE. Every bare
 * `<input type="checkbox">` on the panel is 13-16px, and — checked, not
 * assumed, per this file's own standing rule about measuring the element a
 * tap actually lands on — each is wrapped in a `<label>` that is the REAL
 * target, and that label is only 23px tall. `label:has(> input[...])`
 * matches the wrapper without needing to touch the checkbox itself.
 *
 * THE TEXT-SIZE HALF IS NOT POINTER-GATED, AND THAT IS DELIBERATE. The only
 * text under 11px anywhere in the panel is `text-[10px]` on the revenue
 * chart's date-axis labels (Overview) — a readability problem for anyone's
 * eyes, mouse or thumb, not a touch-target problem, so it applies always.
 * Scoped to `.admin-shell` because Tailwind compiles that exact utility into
 * the ONE shared stylesheet the storefront also loads; unscoped, this would
 * have reached past the panel into whatever else in the shop happens to use
 * a 10px label.
 */
;(function () {
  'use strict'

  var CSS = ''
    + '.admin-shell .text-\\[10px\\] { font-size: 11px; }'
    + '@media (pointer: coarse) {'
    + '  .srl-chip { min-height: 44px !important; }'
    + '  .scc-chip { min-height: 44px !important; }'
    + '  .scc-go   { min-height: 44px !important; }'
    + '  .admin-shell button {'
    + '    min-height: 44px;'
    + '    display: inline-flex;'
    + '    align-items: center;'
    + '    justify-content: center;'
    + '  }'
    + '  .admin-shell label:has(> input[type="checkbox"]) {'
    + '    min-height: 44px;'
    + '    display: flex;'
    + '    align-items: center;'
    + '  }'
    + '}'

  var onPanel = /^\/backends(\/|$)/.test(location.pathname)
  if (!onPanel) return

  if (document.getElementById('sam-css')) return
  var s = document.createElement('style')
  s.id = 'sam-css'
  s.textContent = CSS
  document.head.appendChild(s)
})()
