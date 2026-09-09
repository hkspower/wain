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
 *   --brand, --accent, --accent-text   exist on :root.                     ok
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
        line('--brand', t.brand) +
        line('--accent', t.accent) +
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
