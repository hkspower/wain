import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'
import { photoFit } from '../lib/productImage'

// The product-page image viewer: one photograph, or a set of them, with a
// full-screen view on any of them.
//
// SEVERAL PHOTOGRAPHS (2026-11-14, the gallery spec):
//   - From md up, a vertical stack two to a row in a box that scrolls on its own
//     (Grid). Fashion and lifestyle are read as a set.
//   - Below md, a full-bleed track that snaps one photograph at a time, with a
//     "n / total" counter in the corner (Carousel). One thumb swipes it.
// Both open the full-screen view on the photograph that was tapped.
//
// ONE IMAGE IS THE NORMAL CASE, AND IT STAYS FREE. With a single photograph
// this renders one <img> in a rounded box (Frame) — no track, no grid, no
// counter, no thumbnails. Those appear only when there is genuinely more than
// one photograph to look at. The shop's catalogue is mostly single-image today,
// so the common path must not pay for the rich one.
//
// LAYOUT SHIFT: the frame has a fixed aspect ratio and every <img> carries width
// and height, so the box is the right size before a byte has arrived. This is
// the LCP element of the page; a gallery that reflows when the photo loads would
// undo the CLS work done everywhere else.
//
// THE FRAME IS 4:5, THE SAME AS THE GRID CARD. It used to be square, which
// cropped a portrait photograph top and bottom, and it gave the "photo
// unavailable" picture (public/product-photo-unavailable.svg, 600x750) a box of
// the wrong shape. One ratio on the grid and on the product page means a
// photograph is framed the same way wherever a shopper meets it.
//
// THE PHOTOGRAPH FITS WITH object-contain (lib/productImage.js), so nothing is
// cropped off a model; a gap is the beige token behind it.
//
// LOADING: the first image is eager with fetchpriority="high" because it is
// above the fold and the LCP candidate. Every other image is lazy — a shoot of
// eight photographs must not cost eight downloads to look at one.
//
// NO CAROUSEL LIBRARY. The shop ships three production dependencies (react,
// react-dom, react-router-dom) and that is a deliberate figure. A slider is a
// translated track, a drag handler and a keydown handler; importing 40 kB to
// avoid writing them would cost more than it saves on a page whose image budget
// is already the tightest thing about it.
export default function ProductGallery({ images, alt }) {
  const { t, lang } = useLang()
  const [i, setI] = useState(0)
  const [zoom, setZoom] = useState(false)

  // A different product must not open on the previous product's fourth photo.
  // Keyed on the photographs' addresses, not on the array: productImages() builds
  // a new array on every render, so keying on the array reset an open full-screen
  // view to the first photograph whenever the page re-rendered (stock arriving,
  // the cart changing).
  const key = images.join('\n')
  useEffect(() => { setI(0); setZoom(false) }, [key])

  const total = images.length
  const at = Math.min(i, total - 1)
  const go = useCallback((n) => setI((n + total) % total), [total])
  // Opening a photograph from the grid or the carousel selects it and opens the
  // full-screen view on it, so the lightbox's arrows continue from there.
  const open = useCallback((n) => { setI(n); setZoom(true) }, [])
  const rtl = lang === 'ar'

  return (
    <div>
      {total > 1 ? (
        <>
          <Grid images={images} alt={alt} onOpen={open} t={t} />
          <Carousel images={images} at={at} setI={setI} onOpen={open} t={t} rtl={rtl} />
        </>
      ) : (
        <Frame
          images={images}
          at={at}
          total={total}
          alt={alt}
          go={go}
          onZoom={() => setZoom(true)}
          t={t}
          rtl={rtl}
        />
      )}

      {zoom && (
        <Lightbox images={images} at={at} alt={alt} go={go} total={total} onClose={() => setZoom(false)} t={t} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------- the frame
//
// One clipped box holding a track of all the images side by side. Sliding is a
// transform on the track, which the compositor can do without laying anything
// out again — animating `left` or swapping `src` both cost a frame the phone
// does not have while a finger is moving.
function Frame({ images, at, total, alt, go, onZoom, t, rtl }) {
  const [drag, setDrag] = useState(null)   // { x0, dx } while a finger is down
  const box = useRef(null)
  // WHETHER THE FINGER MOVED, in a ref rather than in state, because the click
  // that follows a tap needs the answer SYNCHRONOUSLY. `drag` is state: at the
  // moment the click handler runs, React has not yet flushed the setDrag(null)
  // from pointerup, so a guard on `!drag` was false on every touch and tapping
  // the photograph never opened it. It worked with a mouse — where the drag
  // handler bails out early — which is exactly why it survived being looked at.
  const moved = useRef(false)
  const [lens, setLens] = useState(null)   // { x, y } in % — desktop hover zoom

  // POINTER EVENTS, not touch events: one code path covers finger, pen and
  // mouse, and setPointerCapture means a drag that leaves the box still ends
  // properly instead of sticking half-slid.
  const down = (e) => {
    if (total < 2 || e.pointerType === 'mouse') return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    moved.current = false
    setDrag({ x0: e.clientX, dx: 0 })
  }
  const move = (e) => {
    if (!drag) return
    const dx = e.clientX - drag.x0
    // A few pixels of travel is a tap with a shaky thumb, not a swipe.
    if (Math.abs(dx) > 8) moved.current = true
    setDrag((d) => (d ? { ...d, dx } : d))
  }
  const up = () => {
    if (!drag) return
    const w = box.current?.clientWidth ?? 1
    // A quarter of the frame is the commit point. Less and a scroll that
    // wandered sideways flips the photo; more and a deliberate swipe does not.
    if (Math.abs(drag.dx) > w * 0.25) go(at + (drag.dx < 0 ? 1 : -1) * (rtl ? -1 : 1))
    setDrag(null)
  }

  // DESKTOP ZOOM — the "magic view". The image is scaled 2.5x and its
  // transform-origin follows the cursor, so the part under the pointer is the
  // part that grows. A second copy of the image at higher resolution would be
  // sharper and would also be a second download of the page's largest asset;
  // this stays within the bytes already spent.
  const hover = (e) => {
    if (drag) return
    const r = e.currentTarget.getBoundingClientRect()
    setLens({
      x: ((e.clientX - r.left) / r.width) * 100,
      y: ((e.clientY - r.top) / r.height) * 100,
    })
  }

  // THE SIGN IS THE DIRECTION, and it was LTR-only.
  //
  // A flex row in an RTL document lays its items right to left, so the first
  // photograph sits at the RIGHT edge and the second is to its left. Moving the
  // track by -100% therefore slides it away from the frame in Arabic: choosing
  // the second photograph left NO image under the viewport at all — a blank
  // square, on the largest element of the page, in the shop's default language.
  //
  // Measured rather than reasoned about: in Arabic, "which image occupies the
  // frame" answered -1. The thumbnails and the dots kept working, which is why
  // it looked like a slider that had simply gone blank.
  const dir = rtl ? 1 : -1
  const offset = dir * at * 100
  const dragPct = drag && box.current ? (drag.dx / box.current.clientWidth) * 100 : 0

  return (
    <div className="relative">
      <div
        ref={box}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // The lens only runs where a pointer genuinely hovers. On a phone a
        // `mousemove` is SYNTHESISED after a tap, and acting on it would leave
        // the photo stuck mid-zoom with nothing to move it back. `hover: hover`
        // is the only reliable way to ask; MouseEvent carries no pointerType.
        onMouseMove={(e) => window.matchMedia('(hover: hover)').matches && hover(e)}
        onMouseLeave={() => setLens(null)}
        onClick={() => { if (!moved.current) onZoom(); moved.current = false }}
        // 4:5 matches the photographs (and the card). From md up this column is
        // sticky, with the thumbnails and the brand plate under the frame, so the
        // frame's height is capped to what is left of the screen: uncapped, the
        // block was taller than a 800px laptop window and its lower part could
        // never be scrolled into view while it stuck. Width follows the ratio.
        className="group relative aspect-[4/5] cursor-zoom-in touch-pan-y overflow-hidden rounded-2xl bg-sand-light md:mx-auto md:h-[clamp(22rem,calc(100svh_-_21rem),44rem)] md:max-w-full"
      >
        <div
          className="flex h-full w-full"
          style={{
            transform: `translateX(${offset + dragPct}%)`,
            // No easing WHILE dragging: the photo has to sit under the finger.
            transition: drag ? 'none' : 'transform 380ms cubic-bezier(.22,.61,.36,1)',
          }}
        >
          {images.map((src, n) => (
            <img
              key={src}
              src={src}
              // Every photograph is a real view of the product, so every one has
              // a description. Only the one on screen is announced, though: the
              // rest sit in the same track, off to the side, and a screen reader
              // reading the whole track would recite the photographs in turn.
              alt={n === 0 ? alt : `${alt} · ${t.a11y.imageN.replace('{n}', n + 1).replace('{total}', total)}`}
              aria-hidden={n === at ? undefined : true}
              width="600"
              height="750"
              fetchPriority={n === 0 ? 'high' : undefined}
              loading={n === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable="false"
              className={`h-full w-full shrink-0 ${photoFit(src)} bg-sand-light`}
              style={
                lens && n === at
                  ? { transform: 'scale(2.5)', transformOrigin: `${lens.x}% ${lens.y}%` }
                  : { transform: 'scale(1)', transformOrigin: 'center' }
              }
            />
          ))}
        </div>

        {/* Says the photo does more than sit there. Hidden from assistive tech:
            the frame's own button role and label carry the meaning. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-3 end-3 rounded-full bg-black/45 px-2.5 py-1 text-xs font-semibold text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"
        >
          ⤢
        </span>
      </div>
    </div>
  )
}

// ----------------------------------------------------- the desktop grid (md up)
//
// From md up the photographs are a vertical stack, two to a row, in a box that
// scrolls on its own. Fashion and lifestyle are read as a set: every frame is in
// view as the shopper scrolls, instead of one photograph at a time behind arrows
// and dots. The box is capped to what is left of the window, so the column above
// the fold still fits a short laptop screen.
//
// Every frame opens the full-screen view on that photograph. The hover zoom of
// the single-photograph frame is kept as a gentle lift, not a lens: a lens over a
// two-column grid would magnify a frame that is a third of the width it was.
function Grid({ images, alt, onOpen, t }) {
  const total = images.length
  return (
    <div
      role="list"
      aria-label={t.a11y.gallery}
      className="hidden md:grid md:max-h-[min(44rem,calc(100svh-10rem))] md:grid-cols-2 md:gap-3 md:overflow-y-auto md:pe-1"
    >
      {images.map((src, n) => (
        <div role="listitem" key={src}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            aria-label={t.a11y.imageN.replace('{n}', n + 1).replace('{total}', total)}
            className="group relative block aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-2xl bg-sand-light"
          >
            {/* Decorative: the button's aria-label already names the photograph. */}
            <img
              src={src}
              alt=""
              width="600"
              height="750"
              loading="lazy"
              decoding="async"
              draggable="false"
              className={`h-full w-full ${photoFit(src)} transition duration-300 group-hover:scale-[1.04]`}
            />
          </button>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------- the phone carousel (below md)
//
// Below md the photographs are a horizontal track that snaps one photograph at a
// time, edge to edge, so one thumb swipes it. The track is the browser's own
// scroller: nothing here follows the finger, which is why it is smooth and works
// the same in either direction. A small counter in the corner says where you are.
//
// The counter reads the nearest slide as an absolute distance from the start, so
// an Arabic track (right to left, scrolled to negative offsets) counts the same
// as an English one.
function Carousel({ images, at, setI, onOpen, t, rtl }) {
  const track = useRef(null)
  const total = images.length

  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    const n = Math.min(total - 1, Math.round(Math.abs(el.scrollLeft) / el.clientWidth))
    if (n !== at) setI(n)
  }

  // A change made elsewhere (the full-screen view's arrows, a new product) moves
  // the track to match. It is done only when the track is not already there, so
  // a swipe in progress is never fought.
  useEffect(() => {
    const el = track.current
    if (!el || !el.clientWidth) return
    if (Math.round(Math.abs(el.scrollLeft) / el.clientWidth) !== at) {
      el.scrollTo({ left: (rtl ? -1 : 1) * at * el.clientWidth })
    }
  }, [at, rtl])

  return (
    <div className="relative md:hidden">
      <div
        ref={track}
        onScroll={onScroll}
        role="group"
        aria-roledescription="carousel"
        aria-label={t.a11y.gallery}
        tabIndex={0}
        className="-mx-4 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        style={{ scrollbarWidth: 'none' }}
      >
        {images.map((src, n) => (
          <button
            key={src}
            type="button"
            onClick={() => onOpen(n)}
            aria-roledescription="slide"
            aria-label={t.a11y.imageN.replace('{n}', n + 1).replace('{total}', total)}
            className="relative aspect-[4/5] w-full shrink-0 snap-center bg-sand-light"
          >
            {/* Decorative: the button's aria-label already names the photograph. */}
            <img
              src={src}
              alt=""
              width="600"
              height="750"
              loading={n === 0 ? 'eager' : 'lazy'}
              fetchPriority={n === 0 ? 'high' : undefined}
              decoding="async"
              draggable="false"
              className={`h-full w-full ${photoFit(src)}`}
            />
          </button>
        ))}
      </div>
      <span
        aria-hidden="true"
        dir="ltr"
        className="pointer-events-none absolute bottom-3 end-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white"
      >
        {at + 1} / {total}
      </span>
    </div>
  )
}

// ------------------------------------------------------------- the lightbox
//
// Tap the photo and it fills the screen. THIS is the zoom on a phone: a hover
// lens needs a pointer that hovers, and a finger does not. Pinch is the
// browser's own — `touch-action: pinch-zoom` hands the gesture to the platform,
// which does it better than any handler here would and keeps working with
// assistive zoom.
function Lightbox({ images, at, alt, go, total, onClose, t }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(at + 1)
      else if (e.key === 'ArrowLeft') go(at - 1)
    }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll while a full-screen photo is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [at, go, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/92 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t.a11y.close}
        className="absolute end-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-2xl text-white backdrop-blur transition hover:bg-white/20"
      >
        ✕
      </button>

      <img
        src={images[at]}
        alt={alt}
        // Stop the backdrop's click from closing it when the photo itself is
        // tapped — the one place a tap should do nothing.
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full touch-pinch-zoom object-contain"
      />

      {total > 1 && (
        <p className="pointer-events-none absolute bottom-6 text-sm font-semibold tabular-nums text-white/80">
          {t.a11y.imageN.replace('{n}', at + 1).replace('{total}', total)}
        </p>
      )}
    </div>
  )
}
