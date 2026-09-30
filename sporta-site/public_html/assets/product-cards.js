/**
 * Sporta — product cards: the pictures a grid asks for are thumbnails, not originals.
 *
 * ON THE SHOP GRID'S CARDS ONLY (`article > a[aspect-…] > img`). The storefront
 * asks every card for the ORIGINAL upload — up to 2000px and about a megabyte —
 * to draw a picture 175px wide, and for the second photograph the bundle keeps
 * under it for hover. The server has always been able to send a resized copy
 * (`?r=product_image&w=400|600`, stored in product_image_thumbs once made) and
 * nothing asked. This gives each card picture a srcset of those, so a phone takes
 * the 400 or 600 the screen needs and a grid of thirty stops being thirty
 * megabytes.
 *
 * THE SRC IS CHANGED, NOT ADDED TO: the bundle's lazy <img> has not started
 * loading when this runs (a MutationObserver callback is a microtask, before the
 * first layout), so the original is never fetched. A picture the server declines
 * to resize (smaller than 400px, or no GD) answers with the original, so this can
 * only save bytes, never break a picture.
 *
 * A SECOND PHOTOGRAPH ON HOVER IS NOT ADDED HERE, and was written and then
 * removed: the bundle already renders one (an absolutely positioned, opacity-0
 * <img> under the main one, shown by `group-hover`). Measured, not assumed — a
 * card with two photographs had THREE images in it after this script's own
 * hover picture was added, and the same two photographs faded over each other.
 *
 * NEVER TOUCHES A PLACEHOLDER (`data:` images) OR THE PRODUCT PAGE'S GALLERY.
 */
(function () {
  'use strict'

  var SEL = 'article > a[class*="aspect-"] > img'

  function isPhoto(img) {
    var s = img.getAttribute('src') || ''
    return s.indexOf('product_image') !== -1 && s.indexOf('data:') !== 0
  }

  function withWidth(src, w) {
    return src.replace(/([?&])w=\d+/, '$1w=' + w) + (/[?&]w=\d+/.test(src) ? '' : '&w=' + w)
  }

  function thumb(img) {
    if (img.__sportaThumb || !isPhoto(img)) return
    var src = img.getAttribute('src')
    if (/[?&]w=\d+/.test(src)) { img.__sportaThumb = 1; return }
    img.__sportaThumb = 1
    img.setAttribute('srcset', withWidth(src, 400) + ' 400w, ' + withWidth(src, 600) + ' 600w')
    img.setAttribute('sizes', '(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw')
    img.setAttribute('src', withWidth(src, 400))
  }

  function scan(root) {
    var imgs = (root.querySelectorAll ? root.querySelectorAll(SEL) : [])
    for (var i = 0; i < imgs.length; i++) thumb(imgs[i])
    if (root.matches && root.matches(SEL)) thumb(root)
  }

  function start() {
    scan(document)
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) scan(added[j])
        if (muts[i].type === 'attributes' && muts[i].target.matches && muts[i].target.matches(SEL)) {
          muts[i].target.__sportaThumb = muts[i].target.__sportaThumb && /[?&]w=\d+/.test(muts[i].target.getAttribute('src') || '')
          thumb(muts[i].target)
        }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
