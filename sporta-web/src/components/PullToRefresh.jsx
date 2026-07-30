import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n/LanguageContext'

// Pull down at the top of the page to reload — ONLY in an installed PWA.
//
// WHY IT IS CONDITIONAL
// In a browser tab the platform already does this, and doing it again would mean
// two gestures fighting over the same drag. But a PWA launched from the home
// screen has no browser chrome: no reload button, no address bar, and no native
// pull-to-refresh. Now that there is a service worker, a shopper can be looking
// at a cached page with no way to ask for a fresh one. That is the gap this
// fills, and it is the only place it appears.
//
// The display-mode query is re-evaluated on change rather than read once: a page
// can be opened in a tab and later installed, and iOS reports standalone through
// navigator.standalone instead of the media query.
const REACH = 72 // px of pull that commits to a refresh
const MAX = 96 // px the indicator will travel, so the drag has an end

export default function PullToRefresh() {
  const { t } = useLang()
  const [standalone, setStandalone] = useState(false)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const start = useRef(null)

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)')
    const read = () => setStandalone(mq.matches || window.navigator.standalone === true)
    read()
    mq.addEventListener?.('change', read)
    return () => mq.removeEventListener?.('change', read)
  }, [])

  useEffect(() => {
    if (!standalone) return

    const onStart = (e) => {
      // Only from a genuine rest at the top, and only a single finger — a
      // two-finger gesture is a zoom, and mid-scroll momentum is not a pull.
      if (window.scrollY > 0 || e.touches.length !== 1 || busy) return
      start.current = { y: e.touches[0].clientY, x: e.touches[0].clientX, decided: false, own: false }
    }

    const onMove = (e) => {
      const s = start.current
      if (!s) return
      const dy = e.touches[0].clientY - s.y
      const dx = e.touches[0].clientX - s.x
      // Decide once, on the first few pixels, whether this drag is ours. A
      // horizontal swipe belongs to the page (image carousels, the drawer), and
      // an upward drag is an ordinary scroll.
      if (!s.decided) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return
        s.decided = true
        s.own = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.5
        if (!s.own) start.current = null
        if (!s.own) return
      }
      if (dy <= 0) {
        setPull(0)
        return
      }
      // Resistance, so the indicator does not track the finger one-to-one and
      // the gesture has a felt limit rather than an abrupt stop.
      setPull(Math.min(MAX, dy * 0.5))
      // Only once we own the gesture, and only while the browser still lets us:
      // a passive listener cannot preventDefault, so this listener is passive:
      // false — set at registration below — and calling it stops the page
      // rubber-banding underneath the indicator.
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      const committed = pull >= REACH
      start.current = null
      if (!committed) {
        setPull(0)
        return
      }
      setBusy(true)
      setPull(REACH)
      // A frame to paint the committed state, so the refresh is not a silent jump.
      requestAnimationFrame(() => window.location.reload())
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [standalone, busy, pull])

  if (!standalone || pull === 0) return null

  const ready = pull >= REACH
  return (
    <div
      // Announced, because the indicator is the only feedback the gesture has.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center"
      style={{ transform: `translateY(${pull - 40}px)` }}
    >
      <span
        className={`flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-xs font-bold text-ink shadow-lg transition-opacity ${
          ready ? 'opacity-100' : 'opacity-80'
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          width="15"
          height="15"
          aria-hidden
          className={busy ? 'animate-spin' : ''}
          style={{ transform: busy ? undefined : `rotate(${Math.min(180, (pull / REACH) * 180)}deg)` }}
        >
          <path
            d="M12 5v14M6 13l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {busy ? t.pull.refreshing : ready ? t.pull.release : t.pull.pull}
      </span>
    </div>
  )
}
