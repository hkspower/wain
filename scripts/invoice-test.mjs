/**
 * The invoice, as it comes out of a printer.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/invoice-test.mjs
 *
 * The invoice is the one page in this shop whose real output is not a screen.
 * A customer saves it as a PDF and a shop keeps it for its books, so the thing
 * to check is the PAPER, and nothing did.
 *
 * WHAT IT MEASURES, and why each one is here rather than being a matter of
 * taste. All of it is done with print media emulated and at the PDF's real
 * content box — A4 is 794 CSS px at 96dpi, less the `@page { margin: 14mm }`
 * the build sets, so 688px. Measuring at the browser's window width instead
 * is how you convince yourself of a clipping bug that is not there; that
 * happened while this was being written, and the fix for it would have been
 * to "correct" a margin the shop already had right.
 *
 *   NOTHING IS position: fixed. On screen a fixed element floats above the
 *     page. On paper there is no above — it is printed ONTO the document,
 *     wherever it happens to sit. Four of them were: the cart drawer, its
 *     full-page scrim, the skip link and the floating button.
 *
 *   NOTHING PAINTS OUTSIDE THE PAGE. The drawer's right edge sat at exactly
 *     x=0 and it is a thousand pixels tall, so it printed as a rule down the
 *     whole page and covered the leftmost glyphs of the left-hand column —
 *     which in an RTL invoice is the money column. The subtotal, the
 *     delivery and the total all lost their currency to it.
 *
 *   WITH THE BAG OPEN TOO, which is the case that would have been worst and
 *     is the reason this rig opens it. The scrim is 60% of the ink colour
 *     over the entire sheet and it does not paint while the drawer is shut.
 *     Open the bag, press Ctrl+P — an ordinary sequence — and the build's own
 *     `print-color-adjust: exact` on `*` tells the printer to lay all of it
 *     down.
 *
 *   THE DOCUMENT STILL SAYS WHAT AN INVOICE HAS TO SAY. Hiding things is a
 *     blunt instrument and the failure mode of a blunt instrument is hiding
 *     one thing too many, so the order number, the date, the customer, the
 *     total and its currency are all asserted to survive.
 *
 *   AND IT IS STILL BLACK ON WHITE. The shop defaults to a dark theme and a
 *     previous fix stopped invoices printing as a black page. That fix lives
 *     in the same stylesheet as this one, so it is re-checked here rather
 *     than trusted.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
// A4 at 96dpi, less the @page margin the build sets. See the note above.
const BOX = 688

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

const track = execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e',
   'select track_id from orders order by id desc limit 1'], { encoding: 'utf8' }).trim()
if (!track) {
  console.log('no orders in the sandbox — run scripts/checkout-test.mjs first')
  process.exit(1)
}
console.log(`--- invoice for ${track}, printed`)

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

/** Load the invoice at paper width, optionally with the bag open, in print media. */
const openInvoice = async (withBag) => {
  const ctx = await browser.newContext({ viewport: { width: BOX, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/invoice/${track}`)
  await page.waitForTimeout(2500)
  if (withBag) {
    const bag = page.locator('button').filter({ hasText: /حقيبة|السلة/ }).first()
    if (await bag.count()) await bag.click().catch(() => {})
    await page.waitForTimeout(900)
  }
  await page.emulateMedia({ media: 'print' })
  await page.waitForTimeout(300)
  return { ctx, page }
}

/** Everything the printer would actually be asked to lay down. */
const survey = (page) => page.evaluate(() => {
  const bw = document.documentElement.clientWidth
  const fixed = [], outside = []
  document.querySelectorAll('body *').forEach((e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e)
    if (!r.width || !r.height || s.display === 'none' || s.visibility === 'hidden') return
    const name = `${e.tagName.toLowerCase()}.${(e.className || '').toString().slice(0, 40)}`
    if (s.position === 'fixed') fixed.push(`${Math.round(r.width)}x${Math.round(r.height)} ${name}`)
    if (r.left < -1 || r.right > bw + 1) outside.push(`L${Math.round(r.left)} R${Math.round(r.right)} ${name}`)
  })
  return { fixed, outside, text: document.body.innerText, bg: getComputedStyle(document.body).backgroundColor }
})

for (const withBag of [false, true]) {
  const label = withBag ? 'with the bag open' : 'as it loads'
  const { ctx, page } = await openInvoice(withBag)
  const s = await survey(page)

  check(s.fixed.length === 0,
    `${label}: nothing is position:fixed, so nothing is printed over the document`,
    s.fixed.join(' | '))
  check(s.outside.length === 0,
    `${label}: nothing paints outside the ${BOX}px page`,
    s.outside.join(' | '))

  if (!withBag) {
    // HIDING THINGS IS BLUNT. These are what must survive it.
    check(s.text.includes(track), 'the order number is on the paper', 'no track id in the printed text')
    check(/\d{4}-\d{2}-\d{2}/.test(s.text), 'and the date')
    check(/د\.ك/.test(s.text), 'and the amounts carry their currency')
    check(/الإجمالي/.test(s.text), 'and the total is labelled')
    check(/فاتورة/.test(s.text), 'and it still calls itself an invoice')

    // The dark-theme fix in the same stylesheet, re-checked rather than trusted.
    const white = ['#ffffff', 'rgb(255, 255, 255)'].includes(s.bg.toLowerCase())
    check(white, 'and it prints black on white, not the shop\'s dark ground', s.bg)

    // ---- ONE EDGE, NOT TWO -------------------------------------------------
    // The storefront marks Latin runs dir="ltr" so they shape correctly inside
    // an Arabic page. On a BLOCK that also redefines `text-align: start` to
    // mean the left edge, so the customer's name and the English product name
    // sat adrift in the middle of a column whose every other line was flush
    // right. Asserted as glyph boxes, because element boxes are full-width and
    // look identical whether this is right or wrong.
    const edges = await page.evaluate(() => {
      const find = (re) => {
        const w = document.createTreeWalker(document.querySelector('.invoice'), NodeFilter.SHOW_TEXT)
        let n
        while ((n = w.nextNode())) {
          if (!re.test(n.textContent.trim())) continue
          const r = document.createRange(); r.selectNodeContents(n)
          const b = r.getBoundingClientRect()
          if (b.width) return Math.round(b.right)
        }
        return null
      }
      const blocksAlignedLeft = [...document.querySelectorAll('.invoice [dir="ltr"]')]
        .filter((e) => getComputedStyle(e).display !== 'inline')
        .filter((e) => ['left', 'start'].includes(getComputedStyle(e).textAlign))
        .map((e) => e.textContent.trim().slice(0, 24))
      // FOUND STRUCTURALLY, NOT BY FIXTURE TEXT. This asked for /^Rig/ and
      // /^Cagliari/ — the customer and garment that happened to be on the
      // newest order the day it was written. Every other rig in this suite
      // places orders, so the newest one is somebody else's within a run or
      // two and both lookups returned null, failing on the fixture rather than
      // on the alignment. The Latin runs are what this measures, so find them
      // by BEING Latin inside an Arabic invoice, and compare each against the
      // Arabic line it is supposed to line up with.
      const latinBlocks = [...document.querySelectorAll('.invoice [dir="ltr"]')]
        .filter((e) => getComputedStyle(e).display !== 'inline')
      const edge = (e) => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return b.width ? Math.round(b.right) : null }
      return { heading: find(/^فاتورة إلى$/), addr: find(/^قطعة/), ar: find(/^سويت|^حقيبة|^سويت شيرت/),
        latin: latinBlocks.map((e) => ({ t: e.textContent.trim().slice(0, 22), R: edge(e) })),
        blocksAlignedLeft }
    })
    // Every Latin block in the invoice must end on the document's start edge,
    // which in this RTL page is the same right edge the address ends on.
    const stray = edges.latin.filter((l) => l.R !== null && l.R !== edges.addr)
    check(edges.latin.length > 0,
      `the invoice has Latin blocks to check (${edges.latin.length})`)
    check(stray.length === 0,
      'every Latin block ends on the same edge as the Arabic beside it',
      stray.map((l) => `"${l.t}" R${l.R} vs R${edges.addr}`).join(' | '))
    check(edges.blocksAlignedLeft.length === 0,
      'no Latin block in an Arabic invoice is left-aligned by its own dir',
      edges.blocksAlignedLeft.join(' | '))

    // ---- ROOM AT THE TOP AND THE BOTTOM ------------------------------------
    // The title used to start at y=0, the first pixel of the page's content
    // box, because the build strips the invoice's padding and leaves the
    // spacing entirely to @page. The bottom is the half that matters on an
    // invoice long enough to fill the sheet.
    const pad = await page.evaluate(() => {
      const inv = document.querySelector('.invoice')
      const s = getComputedStyle(inv)
      const w = document.createTreeWalker(inv, NodeFilter.SHOW_TEXT)
      let n, top = Infinity
      while ((n = w.nextNode())) {
        if (!n.textContent.trim()) continue
        const r = document.createRange(); r.selectNodeContents(n)
        const b = r.getBoundingClientRect()
        if (b.height) top = Math.min(top, Math.round(b.top))
      }
      return { top, padTop: s.paddingTop, padBottom: s.paddingBottom }
    })
    check(pad.top >= 20, 'the title is not printed hard against the top of the page', `first glyph y=${pad.top}`)
    check(parseFloat(pad.padBottom) >= 20,
      'and a full-page invoice would not finish hard against the bottom',
      `padding-bottom ${pad.padBottom}`)
  }
  await ctx.close()
}

await browser.close()
console.log(fails ? `\n${fails} failed` : '\nall ok — the invoice prints as a document, not a screenshot')
process.exit(fails ? 1 : 0)
