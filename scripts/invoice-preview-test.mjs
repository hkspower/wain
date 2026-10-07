/**
 * test:invoice-preview — the invoice drawn on the order-confirmation page, with a PDF download.
 *
 * assets/invoice-preview.js draws the whole invoice on /payment/result?trackid=… from ?r=invoice,
 * and offers api/invoice-download.php. The EXPECTED values here come from the database (the order's
 * amount, its number of lines, its payment status), never from the script or from ?r=invoice, so a
 * script that draws the wrong order's numbers cannot certify itself.
 *
 *   - the sheet shows this order's number, total, status and one row per line, in BOTH languages
 *   - the Download button points at this order and the file really is a PDF, as an attachment
 *   - the PDF is drawn fresh: it says what the order says today (PAID/UNPAID stamp follows the row)
 *   - an unknown order and a mangled id are refused; the download is throttled
 *   - nothing is drawn without a trackid, or on any other page
 *
 * Run `bash scripts/sandbox.sh` first. MUTATE=1 draws nothing (the script is blocked) and must fail.
 */
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const sql = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '--batch', '--raw', '-N', '-e', q],
  { encoding: 'utf8' }).trim()

let fails = 0
const check = (ok, what, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`)
}

sql('delete from rate_limit; delete from rate_bucket')

// The order is chosen by a property the rig needs (it has lines, and an amount), not by position.
const [track, amount, lines, status] = sql(
  `select o.track_id, o.amount, (select count(*) from order_items i where i.order_id = o.id), o.payment_status
     from orders o where (select count(*) from order_items i where i.order_id = o.id) >= 1
       and o.track_id regexp '^[A-Za-z0-9]{6,30}$' order by o.id desc limit 1`).split('\t')
check(!!track, 'the sandbox has an order with lines to draw', track)
const money = (v) => Number(v).toFixed(3)

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})

async function sheet(lang, width, query = `status=cod&trackid=${track}`) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } })
  await ctx.addInitScript((l) => { try { localStorage.setItem('lang', l) } catch (e) {} }, lang)
  if (process.env.MUTATE === '1') await ctx.route('**/assets/invoice-preview.js', (r) => r.abort())
  const p = await ctx.newPage()
  await p.goto(`${BASE}/payment/result?${query}`, { waitUntil: 'networkidle' })
  await p.waitForTimeout(1200)
  return { ctx, p }
}

try {
  for (const [lang, width] of [['en', 1280], ['ar', 390]]) {
    const { ctx, p } = await sheet(lang, width)
    const s = p.locator('section.ivp:not(.ivp-wait)')
    check(await s.count() === 1, `[${lang} ${width}] exactly one invoice sheet is drawn`, String(await s.count()))
    if (await s.count() === 1) {
      const text = (await s.innerText()).replace(/ /g, ' ')
      check(text.includes(track), `[${lang}] it names this order`, track)
      check(text.includes(money(amount)), `[${lang}] the grand total is the order's amount from the database`, money(amount))
      check(await s.locator('.ivp-it:not(.ivp-th)').count() === Number(lines),
        `[${lang}] one row per line of the order`, `${lines}`)
      const paid = status === 'paid'
      check(await s.locator(paid ? '.ivp-paid' : '.ivp-unpaid').count() === 1,
        `[${lang}] the status chip follows the row (${status})`)
      check((await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)),
        `[${lang} ${width}] the page does not scroll sideways`)
      check(await s.getAttribute('dir') === (lang === 'ar' ? 'rtl' : 'ltr'), `[${lang}] the sheet reads in its own direction`)
      const dl = s.locator('a.ivp-dl')
      check(await dl.getAttribute('href') === `/api/invoice-download.php?id=${track}`, `[${lang}] the button points at this order's PDF`)
      const box = await dl.boundingBox()
      check(box && box.height >= 44, `[${lang}] the button is at least 44px tall`, box ? `${Math.round(box.height)}px` : '')
      // Above the page's own Home button, never after it.
      const order = await p.evaluate(() => {
        const sh = document.querySelector('section.ivp'), row = sh && sh.parentNode.querySelector(':scope > div.mt-6')
        return !!(sh && row && (sh.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING))
      })
      check(order, `[${lang}] it sits above the page's own buttons`)
    }
    await ctx.close()
  }

  const none = await sheet('en', 1280, 'status=error')
  check(await none.p.locator('section.ivp').count() === 0, 'no trackid, no sheet')
  await none.ctx.close()
  const unknown = await sheet('en', 1280, 'status=cod&trackid=NOSUCHORDER99')
  check(await unknown.p.locator('section.ivp:not(.ivp-wait)').count() === 0, 'an unknown order draws nothing')
  check(await unknown.p.locator('section.ivp-wait').count() === 0, 'and the loading line does not stay on screen')
  await unknown.ctx.close()
  const home = await browser.newContext(); const hp = await home.newPage()
  await hp.goto(`${BASE}/`, { waitUntil: 'networkidle' }); await hp.waitForTimeout(800)
  check(await hp.locator('section.ivp').count() === 0, 'the home page has no invoice sheet')
  await home.close()

  // --- the download -------------------------------------------------------------------
  const res = await fetch(`${BASE}/api/invoice-download.php?id=${track}`)
  const buf = Buffer.from(await res.arrayBuffer())
  check(res.status === 200, 'the download answers 200', String(res.status))
  check((res.headers.get('content-type') || '').includes('application/pdf'), 'as a PDF', res.headers.get('content-type'))
  check(/^attachment;/.test(res.headers.get('content-disposition') || ''), 'as an attachment', res.headers.get('content-disposition'))
  check(buf.subarray(0, 5).toString('latin1') === '%PDF-', 'and the bytes are a real PDF')
  check(/no-store/.test(res.headers.get('cache-control') || ''), 'never cached (a customer\'s name and address)')
  check(!res.headers.get('set-cookie'), 'and it sets no cookie on the storefront')

  const miss = await fetch(`${BASE}/api/invoice-download.php?id=NOSUCHORDER99`)
  check(miss.status === 404, 'an unknown order is a plain 404', String(miss.status))
  const bad = await fetch(`${BASE}/api/invoice-download.php?id=${encodeURIComponent('../../etc/passwd')}`)
  check(bad.status === 404 || bad.status === 400, 'a path-shaped id is refused, not opened', String(bad.status))
  const none2 = await fetch(`${BASE}/api/invoice-download.php`)
  check(none2.status === 400, 'no id is a 400', String(none2.status))

  // Fresh, not archived: the archived file must be REWRITTEN by a download (its mtime moves),
  // because the PDF prints PAID/UNPAID and an old copy would carry a stale stamp.
  const archive = execFileSync('find', ['/home/user', '/tmp', '-name', `${track.toUpperCase()}.pdf`, '-path', '*invoices*'],
    { encoding: 'utf8' }).trim().split('\n')[0]
  check(!!archive, 'the archived copy exists on disk', archive)
  if (archive) {
    const mt = () => Number(execFileSync('stat', ['-c', '%Y', archive], { encoding: 'utf8' }))
    const before = mt()
    await new Promise((r) => setTimeout(r, 1100))
    const r2 = await fetch(`${BASE}/api/invoice-download.php?id=${track}`)
    check(r2.status === 200 && mt() > before, 'a download draws the PDF again rather than reading the archive',
      `mtime ${before} -> ${mt()}`)
  }

  // Throttled: more than 20 in ten minutes from one address is refused.
  let limited = 0
  for (let i = 0; i < 24; i++) { const r = await fetch(`${BASE}/api/invoice-download.php?id=${track}`); if (r.status === 429) limited++ }
  check(limited > 0, 'the download is throttled per address', `${limited} refused of 24`)
} finally {
  sql('delete from rate_limit; delete from rate_bucket')
  await browser.close()
}

console.log(fails ? `\n${fails} failed` : '\nall ok — the confirmation page shows the invoice and offers the PDF')
process.exit(fails ? 1 : 0)
