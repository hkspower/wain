/**
 * The three things every bulk uploader on the website's panel needs.
 *
 * WHY IT EXISTS. brand-logos.js carried its own copy of all three, and
 * product-photos.js was about to carry a second. Fifty lines duplicated across
 * two files that do the same job is the drift this project has already paid
 * for once — `components/ui/chip.tsx` says in its own comment that the shared
 * one exists to stop exactly this and did not reach the third screen.
 *
 * It exports one global, `window.sportaUpload`, because these overlays are
 * plain scripts over a bundle with no module system of its own. It is loaded
 * BEFORE both of them in index.html; each checks for it and does nothing
 * rather than throwing if it is missing, so a half-published set degrades to
 * "the card is absent" instead of to a broken panel.
 *
 * IT TOUCHES NOTHING AND STORES NOTHING. No listeners, no DOM, no state — it
 * is three functions.
 */
(function () {
  'use strict'

  var API = '/api/admin.php?r='
  var MAX_BASE64 = 1100000      // store.php, STORE_PRODUCT_IMAGE_MAX
  var LONGEST = 1400
  var QUALITIES = [0.82, 0.72, 0.62, 0.5, 0.4]

  /**
   * The panel's own request shape, read out of the bundle rather than guessed:
   * `/api/admin.php?r=<route>`, `X-Sporta-Admin: 1`, `credentials: include`.
   *
   * The header is not optional — store_require_admin_header() answers 400
   * without it — and the session cookie is `__Host-` + SameSite=Strict, which
   * works here only because this runs on the shop's own origin inside the
   * panel. That is also why none of this needs a credential of its own.
   *
   * A 30s TIMEOUT via AbortController. Without one, a request that stalls on
   * shared hosting or a flaky connection hangs forever rather than failing —
   * which for a bulk upload looks exactly like the tab being "stuck", and the
   * admin who gives up and closes it never learns whether the photograph
   * landed. A network-level failure is marked `.network = true` so callers can
   * tell "the server said no" from "we never heard back" and retry only the
   * second kind — retrying a rejection (bad format, too many images) would
   * only fail again.
   */
  function call(route, method, body) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
    var timer = ctrl ? setTimeout(function () { ctrl.abort() }, 30000) : null
    return fetch(API + route, {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1' },
      credentials: 'include',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return null }).then(function (d) {
        if (!r.ok || (d && d.error)) throw new Error((d && d.error) || ('http ' + r.status))
        return d
      })
    }, function (e) {
      // fetch itself rejected: aborted (timeout), offline, DNS, connection
      // reset — never a response the server sent, so it is always safe to
      // retry.
      var err = new Error(e && e.name === 'AbortError' ? 'timed out' : 'network error')
      err.network = true
      throw err
    }).then(function (d) {
      if (timer) clearTimeout(timer)
      return d
    }, function (e) {
      if (timer) clearTimeout(timer)
      throw e
    })
  }

  /**
   * Fold a filename or a name to the shape a slug has, so `Under Armour (1).PNG`
   * and `under-armour` meet.
   *
   * THE TRAILING GROUP IS DROPPED ON PURPOSE: `-logo`, `-icon`, `-copy`, `-final`
   * and a trailing number are how export tools and photo shoots name files, and
   * none of them is part of the thing being named. That is also what makes a
   * SHOOT work — `nike-tee-1.jpg`, `nike-tee-2.jpg`, `nike-tee-3.jpg` all fold
   * to `nike-tee`, which is the whole reason many photographs can land on one
   * garment without anybody typing.
   */
  function fold(s) {
    return String(s || '')
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/-(logo|icon|mark|brand|final|copy|edit|[0-9]{1,3})$/g, '')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Re-encode to WebP under the server's cap, and report the pixel size the
   * caller has to send with it.
   *
   * QUALITY BEFORE PIXELS: a photograph scaled down cannot be scaled back up,
   * and one at 0.4 quality still sells a garment. The ladder is the app's, so a
   * picture uploaded from a phone and the same picture dropped on a laptop end
   * up the same size in the database.
   *
   * NO WHITE FILL behind the canvas. A logo is usually transparent, and
   * painting white behind it puts a white rectangle on every dark product card.
   */
  function shrink(file, opts) {
    // PRODUCT PHOTOGRAPHS ASK FOR MORE (2026-09-29, "improve product page images
    // ... quality"): product-photos.js passes {longest: 2000, qualities: [...]}
    // so a garment can be pinched to zoom without going soft, while a brand logo
    // — whose own cap on the server is 160 kB — keeps the 1400 / 0.82 it always
    // had. Both stay under the same 1.1 MB ceiling: quality still steps down
    // until it fits.
    var longest = (opts && opts.longest) || LONGEST
    var qualities = (opts && opts.qualities) || QUALITIES
    return createImageBitmap(file).then(
      function (bm) {
        var scale = Math.min(1, longest / Math.max(bm.width, bm.height))
        var w = Math.max(1, Math.round(bm.width * scale))
        var h = Math.max(1, Math.round(bm.height * scale))
        var c = document.createElement('canvas')
        c.width = w
        c.height = h
        var g = c.getContext('2d')
        // The browser's cheap default resampler is what made big photographs
        // shrunk to 1400px look soft; 'high' is its proper filter.
        g.imageSmoothingEnabled = true
        g.imageSmoothingQuality = 'high'
        g.drawImage(bm, 0, 0, w, h)

        // SAFARI (every iPhone and iPad browser is WebKit) CANNOT ENCODE WEBP from a
        // canvas: toDataURL('image/webp') quietly returns a PNG instead. A PNG of a
        // photograph is several times the cap, so the ladder below would end in
        // "still N kB at the lowest quality" for every picture taken on a phone.
        // Ask what came back, and when it is not WebP use the formats Safari CAN
        // write and the server accepts: PNG if it fits (a logo's transparency
        // survives), else JPEG on white (a photograph has no transparency to lose).
        var probe = c.toDataURL('image/webp', qualities[0])
        if (probe.indexOf('data:image/webp') !== 0) {
          if (probe.length <= MAX_BASE64) return { dataUri: probe, width: w, height: h }
          var flat = document.createElement('canvas')
          flat.width = w
          flat.height = h
          var fg = flat.getContext('2d')
          fg.fillStyle = '#ffffff'
          fg.fillRect(0, 0, w, h)
          fg.imageSmoothingEnabled = true
          fg.imageSmoothingQuality = 'high'
          fg.drawImage(bm, 0, 0, w, h)
          for (var j = 0; j < qualities.length; j++) {
            var ju = flat.toDataURL('image/jpeg', qualities[j])
            if (ju.length <= MAX_BASE64) return { dataUri: ju, width: w, height: h }
            if (j === qualities.length - 1) {
              throw new Error('still ' + Math.round(ju.length / 1024) + ' kB at the lowest quality')
            }
          }
        }
        for (var i = 0; i < qualities.length; i++) {
          var uri = c.toDataURL('image/webp', qualities[i])
          if (uri.length <= MAX_BASE64) return { dataUri: uri, width: w, height: h }
          if (i === qualities.length - 1) {
            throw new Error('still ' + Math.round(uri.length / 1024) + ' kB at the lowest quality')
          }
        }
      },
      function () {
        // DECODE IS THE STEP THAT FAILS ON A PHONE, so it says so in words.
        // Every iPhone photograph is HEIC; Safari decodes them and Chrome does
        // not, so the same picture works on one machine and not another with no
        // clue why. The advice is real and specific.
        var heic = /\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)
        throw new Error(heic
          ? 'this browser cannot open HEIC photographs — on the iPhone, Settings, Camera, Formats, Most Compatible saves them as JPEG'
          : 'not a picture this browser can open')
      }
    )
  }

  window.sportaUpload = { call: call, fold: fold, shrink: shrink }
})()
