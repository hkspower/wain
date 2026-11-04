// What stands in for the quick-checkout card while its chunk loads.
//
// It exists to hold the card's SPACE, not to look busy: the page below it (the
// footer) must not jump when the real card arrives, and a layout shift on the
// page where people enter a card number reads as a broken shop.
//
// The heights are the measured heights of the real card (scripts/
// checkout-split-test.mjs measures both and fails when they drift apart by more
// than a few pixels), at the narrowest phone width where the hints wrap to two
// lines: that is the tallest the card gets, so on a wider screen the card can
// only arrive SHORTER than its reserved space, never taller, and nothing visible
// is pushed down.
//
// Same wrapper classes as QuickCheckout's <form>, so it is the same width.
const ADDRESS = 176 // "deliver to" card: name, phone, up to two address lines
const BAG_BASE = 120 // "in your bag" card without its lines: title, total row
const BAG_LINE = 72 // one bag line: 48px photo + padding
const PAY = 316 // payment-method card: legend and three two-line options
const BUTTON = 48 + 12 + 20 // Pay button, the gap above the note, the note

export default function QuickSkeleton({ lines = 1 }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4" aria-hidden="true">
      <div className="skeleton rounded-2xl" style={{ height: ADDRESS }} />
      <div className="skeleton rounded-2xl" style={{ height: BAG_BASE + BAG_LINE * Math.max(1, lines) }} />
      <div className="skeleton rounded-2xl" style={{ height: PAY }} />
      <div style={{ height: BUTTON }} />
    </div>
  )
}
