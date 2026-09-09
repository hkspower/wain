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
        radii(t.radius)

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

      el.textContent = css
    })
    .catch(function () { /* No theme is the built theme. Never a broken page. */ })
})()
