import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'

// The product-page image viewer: a swipeable slider with a zoom.
//
// ONE IMAGE IS THE NORMAL CASE, AND IT STAYS FREE. With a single photograph
// this renders one <img> in a rounded box — no track, no arrows, no dots, no
// thumbnails. Every one of those appears only when there is genuinely more than
// one photograph to look at. The shop's catalogue is mostly single-image today,
// so the common path must not pay for the rich one.
//
// LAYOUT SHIFT: the frame is aspect-square and every <img> carries width and
// height, so the box is the right size before a byte has arrived. This is the
// LCP element of the page; a gallery that reflows when the photo loads would
// undo the CLS work done everywhere else.
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
  useEffect(() => { setI(0); setZoom(false) }, [images])

  const total = images.length
  const at = Math.min(i, total - 1)
  const go = useCallback((n) => setI((n + total) % total), [total])

  return (
    <div>
      <Frame
        images={images}
        at={at}
        total={total}
        alt={alt}
        go={go}
        onZoom={() => setZoom(true)}
        t={t}
        rtl={lang === 'ar'}
      />

      {total > 1 && (
        <>
          <Dots at={at} total={total} go={go} t={t} />
          <Thumbs images={images} at={at} setI={setI} go={go} total={total} t={t} />
        </>
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
        className="group relative aspect-square cursor-zoom-in touch-pan-y overflow-hidden rounded-2xl bg-slate-50"
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
              alt={n === 0 ? alt : ''}
              width="600"
              height="600"
              fetchPriority={n === 0 ? 'high' : undefined}
              loading={n === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable="false"
              className="h-full w-full shrink-0 object-cover"
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

      {/* Arrows on a pointer device only. On a phone the swipe is the control,
          and two more 44px targets over the photograph is two fewer places to
          put a thumb. */}
      {total > 1 && (
        <>
          <Arrow side="start" onClick={() => go(at - 1)} label={t.heroSlides.prev} />
          <Arrow side="end" onClick={() => go(at + 1)} label={t.heroSlides.next} />
        </>
      )}
    </div>
  )
}

function Arrow({ side, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-ink shadow-md backdrop-blur transition hover:bg-white lg:grid ${
        side === 'start' ? 'start-3' : 'end-3'
      }`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"
           className={side === 'start' ? 'rtl:rotate-180' : 'rotate-180 rtl:rotate-0'}>
        <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

// Position, at a glance, for a slider whose thumbnails may be scrolled out of
// view. 24px targets around the pills — the same rule as the hero's dots.
function Dots({ at, total, go, t }) {
  return (
    <div className="mt-3 flex justify-center gap-0.5 lg:hidden">
      {Array.from({ length: total }, (_, n) => (
        <button
          key={n}
          type="button"
          onClick={() => go(n)}
          aria-label={t.a11y.imageN.replace('{n}', n + 1).replace('{total}', total)}
          aria-current={n === at || undefined}
          className="group/dot grid h-6 min-w-6 place-items-center"
        >
          <span
            aria-hidden="true"
            className={`block h-1.5 rounded-full transition-all ${
              n === at ? 'w-5 bg-ink dark:bg-white' : 'w-1.5 bg-slate-300 group-hover/dot:bg-slate-400'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

function Thumbs({ images, at, setI, go, total, t }) {
    // Arrow keys move between images when the thumbnails have focus. Left and
    // right are read against the RENDERED direction, not the logical one: the
    // thumbnails are laid out by the document's direction, so "next" is
    // whichever key points at the next thumbnail on screen. Using logical order
    // here and physical order there is the mismatch people actually notice.
    const onKey = (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      const rtl = getComputedStyle(e.currentTarget).direction === 'rtl'
      const step = (e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1)
      go(at + step)
      e.preventDefault()
      e.currentTarget.querySelectorAll('button')[(at + step + total) % total]?.focus()
    }
  return (
      <div
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
            <img src={src} alt="" width="64" height="64" loading="lazy" decoding="async"
                 className="h-full w-full object-cover" />
          </button>
        ))}
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
