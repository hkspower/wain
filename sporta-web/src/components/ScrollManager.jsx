import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// React Router changes the URL without touching the scroll position, and it
// does not act on the #hash either — that is the browser's native behaviour on
// a full page load, and a client-side route change is not one.
//
// So this had to exist before the footer could link to /about#why: the URL
// would have changed, the page would not have moved, and the link would look
// broken in exactly the way that is hard to report. It also fixes the plainer
// bug that came free with it — following a footer link from halfway down /shop
// used to land you halfway down /about.
//
// Pages are lazily loaded, so the target element is usually not in the DOM on
// the tick the location changes. Hence the retry: a few animation frames, then
// give up rather than scroll to something that never appeared.
const MAX_FRAMES = 30

// HOW FAR OFF COUNTS AS WRONG. Sub-pixel rounding and a sticky header's own
// settling are not misses; most of a screen is.
const SETTLE_PX = 8
// How long to keep watching after the scroll. Long enough for a font swap on a
// slow connection, short enough that it cannot fight a visitor who has started
// scrolling themselves.
const SETTLE_MS = 1200

export default function ScrollManager() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }

    let frame = 0
    let raf = 0
    let settleTimer = 0
    let cancelled = false
    const id = decodeURIComponent(hash.slice(1))

    // Honour a reduced-motion preference; smooth scrolling is a comfort
    // setting, not a feature to impose.
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // THE ARABIC BUG THIS GUARDS. Scrolling as soon as the element exists aims
    // at a position measured BEFORE the web font has swapped in. On a long
    // legal page the swap re-flows every paragraph and the section slides
    // hundreds of pixels down — measured: /terms#delivery landed 917px short in
    // Arabic while English, whose fallback metrics nearly match the real font,
    // was correct. `behavior: smooth` hides it from the developer and makes it
    // worse for the visitor: the animation is aimed once, at the old position.
    //
    // So: scroll, then keep checking until the target stops moving. The
    // re-scroll is silent (`auto`) because a second smooth animation on top of
    // the first reads as the page fighting itself.
    const settle = (el, until) => {
      if (cancelled) return
      const off = Math.round(el.getBoundingClientRect().top)
      if (Math.abs(off) > SETTLE_PX) el.scrollIntoView({ behavior: 'auto', block: 'start' })
      if (performance.now() < until) settleTimer = setTimeout(() => settle(el, until), 100)
    }

    const tryScroll = () => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
        // document.fonts.ready is the one signal that says the re-flow is done
        // rather than guessing at a delay. The polling continues past it because
        // a lazily-decoded image above the section moves things too, and that
        // resolves on its own schedule.
        const start = () => settle(el, performance.now() + SETTLE_MS)
        if (document.fonts?.ready) document.fonts.ready.then(start).catch(start)
        else start()
        return
      }
      if (++frame < MAX_FRAMES) raf = requestAnimationFrame(tryScroll)
    }
    raf = requestAnimationFrame(tryScroll)

    // THE VISITOR OUTRANKS THE CORRECTION. A settle loop that keeps pulling the
    // page back for a second would fight anyone who started reading and scrolled
    // away — which is worse than the misplacement it fixes. The first deliberate
    // gesture ends it.
    const stop = () => { cancelled = true; clearTimeout(settleTimer) }
    const opts = { passive: true, once: true }
    for (const ev of ['wheel', 'touchstart', 'keydown']) addEventListener(ev, stop, opts)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      clearTimeout(settleTimer)
      for (const ev of ['wheel', 'touchstart', 'keydown']) removeEventListener(ev, stop)
    }
  }, [pathname, hash])

  return null
}
