/**
 * The owner's theme, applied over the built stylesheet.
 *
 * WHAT THIS IS. The shop's look is compiled into a bundle whose source is not
 * in this repository, so nothing here edits it. This appends a small stylesheet
 * of overrides and the built one keeps working exactly as it did.
 *
 * EMPTY MEANS LEAVE IT ALONE. Every field defaults to '' and an empty field
 * emits nothing. A shop that has never opened the theme editor is
 * pixel-identical to one without this file, which is the only safe default when
 * the thing being overridden cannot be read back.
 *
 * EVERY TARGET BELOW WAS MEASURED IN THE BUILT CSS, and the first draft of this
 * file got three of them wrong — which is the whole argument for looking:
 *
 *   --brand                            exists on :root, and IS ALMOST NEVER
 *                                      READ. Measured 2026-09-09: Tailwind v4
 *                                      compiled the colour to literal hex in
 *                                      every utility class — 51 occurrences —
 *                                      and `var(--brand)` appears once, in the
 *                                      skip link. sporta-ui.css now re-states
 *                                      those rules in terms of the token (see
 *                                      scripts/make-brand-tokens.mjs), and this
 *                                      file also writes --brand-dark and
 *                                      --brand-bright, which that block needs.
 *   --primary                          THE OTHER HALF, and the one that was
 *                                      missed entirely. Every primary button is
 *                                      `hsl(var(--primary))`, in HSL CHANNELS
 *                                      — `18 78% 49%`, not a hex — so writing
 *                                      --brand alone left the shop's main call
 *                                      to action orange under a blue theme.
 *   --accent                           EXISTS AND IS READ NOWHERE. `.text-accent`
 *                                      resolves to --accent-text; nothing in
 *                                      any stylesheet reads var(--accent). It
 *                                      was a control that did nothing, and it
 *                                      is gone from this file.
 *   --accent-text                      exists on :root and IS read.           ok
 *   --font-display / --font-sans       DO NOT EXIST. The bundle hardcodes
 *                                      `font-family: Alexandria, ...` on the
 *                                      elements, so a font change has to be a
 *                                      font-family RULE, not a variable.
 *   --radius                           DOES NOT EXIST as a bare name. There
 *                                      are three: --radius-md/-lg/-xl at
 *                                      .375/.5/.75rem. One knob has to set all
 *                                      three and keep their proportions, or
 *                                      the design's rhythm goes.
 *   --space                            DOES NOT EXIST. Tailwind's base is
 *                                      `--spacing: .25rem`, and EVERY padding
 *                                      and margin utility is a multiple of it.
 *   .dark                              WRONG SELECTOR. Dark is
 *                                      `[data-theme=dark]`, used 30 times.
 *
 * WHY THE <style> GOES IN BEFORE THE ANSWER ARRIVES. It is created and appended
 * immediately, empty, then filled. That keeps the override LAST in the document
 * for the life of the page, which is the only thing making these rules win —
 * they carry no !important, deliberately, so the owner's theme can never beat a
 * rule the design depends on.
 */
(function () {
  'use strict'

  var el = document.createElement('style')
  el.setAttribute('data-sporta-theme', '')
  document.head.appendChild(el)

  /* #rrggbb -> [h, s, l], or null. Deliberately strict: a value that is not a
     plain six-digit hex is a value this file must not try to interpret. */
  function hsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
    if (!m) return null
    var n = parseInt(m[1], 16)
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
    var l = (mx + mn) / 2
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
    var h = 0
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6
      else if (mx === g) h = (b - r) / d + 2
      else h = (r - g) / d + 4
      h *= 60
      if (h < 0) h += 360
    }
    return [h, s * 100, l * 100]
  }

  function toHex(h, s, l) {
    h = ((h % 360) + 360) % 360
    s = Math.min(100, Math.max(0, s)) / 100
    l = Math.min(100, Math.max(0, l)) / 100
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
    var v = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
    return '#' + v.map(function (u) {
      return ('0' + Math.round((u + m) * 255).toString(16)).slice(-2)
    }).join('')
  }

  /* THE FAMILY, FROM ONE COLOUR. The shop uses three related oranges and the
     owner picks one of them, so the other two are derived — by the deltas
     MEASURED between the shipped values rather than by numbers chosen here:

       brand   H 17.8  S 77.8%  L 49.4%   #E0561C
       dark    H 18.5  S 84.9%  L 39.0%   #B8430F    H +0.7  S +7.1  L -10.4
       bright  H 25.9  S 100%   L 54.5%   #FF7B17    H +8.1  S +22.2 L +5.1

     Fed the default brand these reproduce the shipped pair almost exactly,
     which is what brand-token-test.mjs asserts — so the derivation is checked
     against the design rather than trusted. */
  function family(hex) {
    var c = hsl(hex)
    if (!c) return ''
    var h = c[0], s = c[1], l = c[2]
    return '  --brand: ' + hex.trim() + ';\n' +
           '  --brand-dark: ' + toHex(h + 0.7, s + 7.1, l - 10.4) + ';\n' +
           '  --brand-bright: ' + toHex(h + 8.1, s + 22.2, l + 5.1) + ';\n' +
           /* Channels, not a colour: the bundle writes hsl(var(--primary)) and
              hsl(var(--primary) / .6), so a hex here would break both. */
           '  --primary: ' + (Math.round(h * 10) / 10) + ' ' +
           (Math.round(s * 10) / 10) + '% ' + (Math.round(l * 10) / 10) + '%;\n'
  }

  /* A declaration, or nothing at all when the field is empty. */
  function line(name, value) {
    return value ? '  ' + name + ': ' + value + ';\n' : ''
  }

  /* A six-digit hex with its hash, or ''. The same strictness as hsl() above
     and for the same reason: a value this file cannot interpret is a value it
     must not emit. admin.php checks these too — this is the second of the two
     guards, not the only one. */
  function hex6(v) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(v || '').trim())
    return m ? '#' + m[1] : ''
  }

  /* THE TAB BAR, FROM THE ONE COLOUR THE OWNER PICKS.
     Two more values have to move with it or the bar stops being readable: the
     hairline along its top edge, and the items that are NOT current. Both are
     derived rather than asked for — a fifth and sixth picker for a border
     nobody thinks about is how a theme editor turns into a form. */
  function tabbar(bg) {
    var c = hsl(bg)
    if (!c) return ''
    var h = c[0], s = c[1], l = c[2]
    var dark = l < 50
    return '  --sp-tabbar-bg: ' + bg + ';\n' +
      /* The hairline. The shipped pair is #ffffff against #e2e8f0 — a step of
         about 11 points of lightness — and keeping that distance rather than
         a fixed grey is what lets the edge read on a dark bar as well as a
         light one. */
      '  --sp-tabbar-border: ' + toHex(h, s, dark ? l + 11 : l - 11) + ';\n' +
      /* The inactive labels. The shipped #64748b is 4.76:1 on white; going to
         the far end of the lightness scale rather than to a fixed slate is
         what stops a dark bar rendering slate on slate. Saturation is capped
         because a label is not a brand surface — a fully saturated one at
         0.7rem reads as an error state. */
      '  --sp-tabbar-text: ' + toHex(h, Math.min(s, 20), dark ? 72 : 42) + ';\n'
  }

  /* One radius, kept in the built proportions. The bundle ships
     .375 / .5 / .75rem — 0.75x, 1x, 1.5x — so a single number scales the set
     instead of flattening three different corners into one. */
  function radii(base) {
    var m = /^([0-9.]+)(px|rem)$/.exec(base)
    if (!m) return ''
    var n = parseFloat(m[1]), u = m[2]
    if (!(n >= 0)) return ''
    var r = function (k) { return Math.round(n * k * 1000) / 1000 + u }
    return '  --radius-md: ' + r(0.75) + ';\n' +
           '  --radius-lg: ' + r(1) + ';\n' +
           '  --radius-xl: ' + r(1.5) + ';\n'
  }

  /* The built stack, kept behind the owner's choice: a face that fails to load
     falls back to what the shop uses today rather than to Times. Arabic is not
     optional here — dropping IBM Plex Sans Arabic would leave every Arabic page
     rendering in a system fallback. */
  var STACK = 'Alexandria, "Alexandria Fallback", "IBM Plex Sans Arabic", ' +
              '"Plex Arabic Fallback", system-ui, sans-serif'

  fetch('/api/api.php?r=theme', { credentials: 'omit' })
    .then(function (r) { return r.ok ? r.json() : null })
    .then(function (t) {
      if (!t || typeof t !== 'object') return

      var root =
        family(t.brand) +
        line('--accent-text', t.accent_text_light) +
        line('--spacing', t.space) +
        radii(t.radius) +
        /* THE FOUR SURFACES --brand NEVER REACHED, measured 2026-09-19.
           The header's charcoal is a literal inside `@layer utilities` with
           !important — and for important declarations the cascade REVERSES
           layer order, so a layered important beats the unlayered rules this
           file writes. Nothing emitted here could ever have won it. The tab
           bar is worse: its background, its hairline and its current item
           (#4f46e5, Tailwind's stock indigo, a colour in no palette in this
           repository) live in the compiled bundle, which has no source here.
           The dark theme's secondary fill was --sp-silver, which is also the
           prose colour in four other rules.
           So each of those declarations now reads `var(--x, <the literal>)`
           in the stylesheet that owns it, and this file only ever sets the
           variable. An empty field emits nothing and the shipped literal
           stands — which is what keeps theme-test.mjs's pixel-identical case
           true. */
        line('--sp-header-bg', hex6(t.header_bg)) +
        line('--sp-secondary-bg', hex6(t.secondary_bg)) +
        line('--sp-tabbar-active', hex6(t.tabbar_active)) +
        tabbar(hex6(t.tabbar_bg))

      var css = ''
      if (root) css += ':root {\n' + root + '}\n'

      /* Dark mode gets only the value that differs. The built stylesheet keeps
         a separate accent-text for the dark ground — 24 100% 66% against
         19 88% 34% — because one value cannot be readable on both. */
      if (t.accent_text_dark) {
        css += '[data-theme=dark] {\n' + line('--accent-text', t.accent_text_dark) + '}\n'
      }

      /* FONTS ARE A RULE, NOT A VARIABLE, because the bundle hardcodes the
         family. body carries the reading face; the display face is applied to
         headings only, which is where the bundle's own display styling lives. */
      if (t.font_body) {
        css += 'body { font-family: "' + t.font_body + '", ' + STACK + '; }\n'
      }
      if (t.font_head) {
        css += 'h1, h2, h3, .font-display { font-family: "' + t.font_head + '", ' +
               STACK + '; }\n'
      }

      /* THE ADMIN PANEL'S OWN CHROME. Measured in AdminApp-*.js: it is built
         entirely from hardcoded Tailwind indigo classes — bg-indigo-600,
         hover:bg-indigo-700, text-indigo-700, border-indigo-500 and their
         kin — and reads none of --brand, --primary or any other token this
         file writes. So the theme editor could recolour the whole storefront
         and the panel the owner used to do it in stayed indigo regardless of
         what they picked. This maps that fixed indigo scale onto the SAME
         brand the owner already chose, rather than adding a second colour
         picker for a second surface.
         UNLIKE the custom-CSS block below, this is NOT skipped on /backends —
         it is the one thing on this page that IS meant for the panel, and it
         cannot lock anyone out: it only ever recolours, never hides, and the
         indigo classes it targets do not exist in any other bundle (checked
         2026-09-17), so this rule is inert everywhere else on the site.
         Attribute selectors, not class selectors: `[class~="…"]` needs no
         escaping for the colon in `hover:bg-indigo-700`, which a literal
         `.hover\:bg-indigo-700` selector would. Unlayered and un-`!important`,
         same as everything else in this file — Tailwind's own utilities are
         wrapped in `@layer utilities{}`, and an unlayered normal declaration
         already outranks a layered one, which is what let the very first
         version of the header-colour override skip !important entirely once
         it was moved out of an unlayered context; the reasoning is the same
         here and was re-verified rather than assumed. */
      if (t.brand) {
        css +=
          '[class~="bg-indigo-600"],[class~="bg-indigo-500"],' +
          '.group:hover [class~="group-hover:bg-indigo-600"],' +
          '[class~="accent-indigo-600"]' +
          '{ background-color: var(--brand); accent-color: var(--brand); }\n' +
          '[class~="hover:bg-indigo-700"]:hover,[class~="bg-indigo-700"]' +
          '{ background-color: var(--brand-dark); }\n' +
          '[class~="text-indigo-600"],[class~="text-indigo-700"],' +
          '[class~="text-indigo-800"],[class~="text-indigo-900"],' +
          '[class~="hover:text-indigo-600"]:hover' +
          '{ color: var(--brand-dark); }\n' +
          '[class~="border-indigo-200"],[class~="border-indigo-500"],' +
          '[class~="focus:border-indigo-400"]:focus,' +
          '[class~="focus:border-indigo-500"]:focus,' +
          '[class~="hover:border-indigo-400"]:hover' +
          '{ border-color: var(--brand); }\n' +
          '[class~="bg-indigo-50"],[class~="bg-indigo-100"]' +
          '{ background-color: color-mix(in srgb, var(--brand) 12%, white); }\n'
      }

      /* THE OWNER'S OWN CSS, LAST, so it wins over everything above without
         needing !important — and appended to the same <style>, so there is one
         override element on the page rather than two racing each other.

         NOT ON /backends. This is arbitrary CSS and it can hide anything,
         including the box it was typed into. Skipping it on the panel means
         the way back is always reachable: whatever it does to the shop, the
         field that clears it still works. A theme editor that can lock you out
         of the theme editor is not a feature.

         textContent, never innerHTML: assigning to a <style> element's
         textContent sets the stylesheet and parses no markup at all, so
         `</style>` in the value cannot end the element. admin.php refuses `</`
         as well — two guards for one hole, because this is the one field with
         no shape to check. */
      var onPanel = /^\/backends(\/|$)/.test(location.pathname)
      if (t.css && !onPanel) css += '\n/* custom */\n' + t.css + '\n'

      el.textContent = css
    })
    .catch(function () { /* No theme is the built theme. Never a broken page. */ })
})()
