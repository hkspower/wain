import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'

// The product-page image viewer.
//
// ONE IMAGE IS THE NORMAL CASE, and it has to stay free. With a single image
// this renders exactly what was here before — one <img> in a rounded box, no
// thumbnails, no arrows, no extra DOM and no extra bytes. The gallery only
// appears when there is genuinely more than one photograph, which is what the
// admin uploader now makes possible.
//
// LAYOUT SHIFT: the frame is aspect-square and the <img> carries width/height,
// so the box is the right size before a single byte of image has arrived. This
// is the LCP element of the page; a gallery that reflows when the photo loads
// would undo the CLS work done everywhere else.
//
// LOADING: the first image is eager with fetchpriority="high" because it is
// above the fold and the LCP candidate. Every other image is lazy — a shoot of
// eight photographs must not cost eight downloads to look at one.
export default function ProductGallery({ images, alt }) {
  const { t } = useLang()
  const [i, setI] = useState(0)
  const strip = useRef(null)

  // A different product must not open on the previous product's fourth photo.
  useEffect(() => setI(0), [images])

  const total = images.length
  const at = Math.min(i, total - 1)
  const go = (n) => setI((n + total) % total)

  // Arrow keys move between images when the thumbnails have focus. Left/right
  // are swapped in RTL only in appearance: the thumbnails themselves are laid
  // out by the document direction, so "next" is whichever key points at the next
  // thumbnail on screen. Using logical order here and physical order on screen
  // is the mismatch people actually notice.
  const onKey = (e) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
    if (e.key === 'ArrowRight') go(at + (rtl ? -1 : 1))
    else if (e.key === 'ArrowLeft') go(at + (rtl ? 1 : -1))
    else return
    e.preventDefault()
    strip.current?.querySelectorAll('button')[(at + (e.key === 'ArrowRight' ? 1 : -1) + total) % total]?.focus()
  }

  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-2xl bg-slate-50">
        <img
          src={images[at]}
          alt={alt}
          width="600"
          height="600"
          fetchPriority={at === 0 ? 'high' : undefined}
          decoding="async"
          className="h-full w-full object-cover"
        />
      </div>

      {total > 1 && (
        <div
          ref={strip}
          onKeyDown={onKey}
          role="group"
          aria-label={t.a11y.gallery}
          className="mt-3 flex gap-2 overflow-x-auto pb-1"
        >
          {images.map((src, n) => (
            <button
              key={src}
              type="button"
              onClick={() => setI(n)}
              aria-current={n === at}
              aria-label={t.a11y.imageN.replace('{n}', n + 1).replace('{total}', total)}
              className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition ${
                n === at ? 'border-brand' : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <img
                src={src}
                alt=""
                width="64"
                height="64"
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
