import { useEffect, useRef } from 'react'

// Calls onIdle() after `timeoutMs` of no user activity (default 15 min).
// Also fires when the tab is hidden and later re-shown past the timeout.
export function useIdleLock(onIdle, timeoutMs = 15 * 60 * 1000) {
  const timer = useRef(null)
  const lastActive = useRef(Date.now())

  useEffect(() => {
    const bump = () => {
      lastActive.current = Date.now()
      clearTimeout(timer.current)
      timer.current = setTimeout(onIdle, timeoutMs)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastActive.current >= timeoutMs) onIdle()
        else bump()
      }
    }

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'pointerdown']
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    bump()

    return () => {
      clearTimeout(timer.current)
      events.forEach((e) => window.removeEventListener(e, bump))
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [onIdle, timeoutMs])
}
