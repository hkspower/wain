import { useEffect, useRef } from 'react'

// Keyboard behaviour every overlay on this site needs, in one place.
//
// WHAT WAS WRONG
// Measured on the homepage: the cart drawer stays mounted and slides off-canvas
// when closed, so its two buttons were live tab stops at positions 44 and 45 of
// 46. A keyboard user tabbing to the end of the page landed on the close button
// of an invisible panel, then on a link inside it — with no way to know where
// they were. `pointer-events-none` stops a mouse; it does nothing to Tab.
//
// Opening it was no better: focus stayed on the bag button behind the backdrop,
// so the first Tab went into the page underneath rather than into the dialog,
// and on close focus was wherever it happened to have wandered.
//
// WHAT THIS DOES
//   * `inert` on the container while closed. One attribute removes the subtree
//     from the tab order, from the accessibility tree and from hit-testing —
//     which is the whole problem, and it degrades to "still tabbable" on a
//     browser too old to know it rather than breaking anything.
//   * Moves focus into the dialog when it opens, preferring the first control
//     that is actually useful (an input to type in, else the close button).
//   * Traps Tab and Shift+Tab inside while open, wrapping at both ends.
//   * Escape closes.
//   * Restores focus to whatever was focused before opening, so closing a drawer
//     puts the cursor back on the bag button that opened it and not at the top
//     of the document.
//
// It deliberately does NOT use <dialog>: these overlays animate with transforms
// and the drawer must remain in the DOM to slide, which showModal() forbids.
export function useDialog({ open, onClose, containerRef, initialFocusRef }) {
  // Captured before focus moves, and read on close.
  const returnTo = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (!open) {
      // Closed: out of the tab order entirely.
      el.setAttribute('inert', '')
      el.setAttribute('aria-hidden', 'true')
      return
    }

    el.removeAttribute('inert')
    el.removeAttribute('aria-hidden')
    returnTo.current = document.activeElement

    // A frame's delay so focus lands after the open transition starts; without
    // it Safari occasionally focuses an element it is still animating.
    const focusIn = requestAnimationFrame(() => {
      const target =
        initialFocusRef?.current ??
        el.querySelector('input:not([type=hidden]), textarea, select') ??
        el.querySelector('button, [href], [tabindex]:not([tabindex="-1"])')
      target?.focus()
    })

    const focusable = () =>
      [...el.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((n) => n.offsetParent !== null || n === document.activeElement)

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      // Wrap at both ends, and pull focus back in if it has escaped somehow
      // (a click on the backdrop, a browser quirk, a late-rendered child).
      if (!el.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    // The page behind must not scroll under an open overlay.
    const scrollY = window.scrollY
    document.body.style.overflow = 'hidden'

    return () => {
      cancelAnimationFrame(focusIn)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // Chrome sometimes restores scroll a frame late after overflow is cleared.
      window.scrollTo({ top: scrollY, behavior: 'instant' })
      const back = returnTo.current
      if (back && document.contains(back) && typeof back.focus === 'function') back.focus()
    }
  }, [open, onClose, containerRef, initialFocusRef])
}
