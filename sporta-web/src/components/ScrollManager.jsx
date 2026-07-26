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

export default function ScrollManager() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }

    let frame = 0
    let raf = 0
    const id = decodeURIComponent(hash.slice(1))

    const tryScroll = () => {
      const el = document.getElementById(id)
      if (el) {
        // Honour a reduced-motion preference; smooth scrolling is a comfort
        // setting, not a feature to impose.
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
        return
      }
      if (++frame < MAX_FRAMES) raf = requestAnimationFrame(tryScroll)
    }
    raf = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(raf)
  }, [pathname, hash])

  return null
}
