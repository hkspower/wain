// Test harness only (bundled by scripts/lib/gallery-page.mjs, never shipped): mounts the LIVE product gallery
// (live-gallery.mjs, a verbatim excerpt of the compiled build) with React into a captured product page, in place of the
// static gallery markup the capture holds. The strings are the live build's own (a11y.imageN / gallery / close and the
// hero arrows' prev / next, ar and en). window.__fxMount({ images, alt, lang }) renders; it can be called again.
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { createRoot } from 'react-dom/client'
import * as runtime from 'react/jsx-runtime'
import { liveGallery } from './live-gallery.mjs'

const T = {
  en: { a11y: { imageN: 'Image {n} of {total}', gallery: 'Product images', close: 'Close' }, heroSlides: { prev: 'Previous slide', next: 'Next slide' } },
  ar: { a11y: { imageN: 'صورة {n} من {total}', gallery: 'صور المنتج', close: 'إغلاق' }, heroSlides: { prev: 'الشريحة السابقة', next: 'الشريحة التالية' } },
}
let lang = 'en', root = null
const useT = () => ({ t: T[lang], lang })
const Gallery = liveGallery(React, runtime, ReactDOM, useT)

window.__fxMount = ({ images, alt, lang: l }) => {
  lang = l
  const host = document.querySelector('.catalog-product-visual')
  if (!root) { host.textContent = ''; root = createRoot(host) }
  ReactDOM.flushSync(() => root.render(runtime.jsx(Gallery, { images, alt })))
}
