// READ-ONLY look at the LIVE /backends Payments screen (the KNET and T-Pay forms).
//
//   node scripts/admin-payments-scan.mjs                 MODE=tree     (default) structure and boxes at 390px
//   MODE=measure node scripts/admin-payments-scan.mjs    checks at 390, 768 and 1280px
//   CSS_URL=<raw url of a stylesheet> ...                apply it on top first (before/after on one page)
//
// Every admin API call is answered HERE with made-up data; nothing reaches the real
// admin.php, nothing is saved, no credential is typed. The Payments link is triggered
// from script because the phone layout hides it behind the menu button.
//
// It exists because the live admin is a compiled build whose source is missing: its
// layout can only be changed by add-on CSS (public/sporta-admin-knet.css), and a rule
// written without seeing the real DOM is a guess. Run on the VPS in the Playwright image
// (npm i playwright@1.49.0, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), the same way as
// admin-style-scan.mjs.
import { chromium } from 'playwright'
const B = 'https://www.sporta.com.kw'
// CSS_URL: a stylesheet fetched and applied on top of the live page, so BEFORE and AFTER are
// measured on the same render. Unset = the page exactly as served.
const CSS = process.env.CSS_URL ? await (await fetch(process.env.CSS_URL)).text() : ''
const MODE = process.env.MODE || 'tree' // tree = structure dump at 390, measure = checks at several widths
const FAKE = {
  me: { email: 'owner@example.com' },
  payment_config: {
    knet: { installed: true, env: 'test', test_url: 'https://kpaytest.com.kw/kpg/PaymentHTTP.htm', production_url: 'https://www.kpay.com.kw/kpg/PaymentHTTP.htm', response_url: B + '/knet/callback.php', error_url: B + '/knet/callback.php', result_page_url: B + '/payment-result', has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false, credentials: { test: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false }, production: { has_tranportal_id: false, has_tranportal_password: false, has_resource_key: false } } },
    tpay: { installed: true, env: 'test', test_base: 'https://pgtest.cbk.com', production_base: 'https://pg.cbk.com', return_url: B + '/pay/callback.php', result_page_url: B + '/payment-result', has_client_id: false, has_client_secret: false, has_encrp_key: false },
  },
  payment_status: {
    knet: { installed: true, ready: false, mode: 'test', gateway_host: 'kpaytest.com.kw', checks: { merchant_credentials: false, resource_key: false, return_urls: true, orders_database: true, environment: true } },
    tpay: { installed: true, ready: false, mode: 'test', gateway_host: 'pgtest.cbk.com', checks: { merchant_credentials: false, encrypted_account_key: false, return_urls: true, orders_database: true, environment: true } },
  },
  payment_identifiers: { env: 'test', test: { merchant_id: '', terminal_id: '' }, production: { merchant_id: '', terminal_id: '' } },
  payment_server_ips: { server_ip_1: '', server_ip_2: '' },
  payment_knet_via_cbk: { enabled: false, tpay_ready: false },
}
const open = async (w, h) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'en-US' })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message.slice(0, 90)))
  await pg.route('**/api/admin.php**', (route) => {
    const r = new URL(route.request().url()).searchParams.get('r') || ''
    const body = route.request().method() === 'GET' && r in FAKE ? FAKE[r] : r === 'me' ? FAKE.me : route.request().method() === 'GET' ? [] : {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await pg.goto(B + '/backends', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(900)
  const target = (await pg.$('a[href*="payment" i]')) || (await pg.$('text=/Payments/i'))
  if (target) { await target.evaluate((el) => el.click()); await pg.waitForTimeout(2500) }
  if (CSS) { await pg.addStyleTag({ content: CSS }); await pg.waitForTimeout(500) }
  return { ctx, pg, errs, found: !!target }
}
let browser
;(async () => {
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  if (MODE === 'tree') {
    const { ctx, pg, errs, found } = await open(390, 844)
    console.log(`PAYMENTS LINK ${found} ERR ${errs.length} ${errs.join(' | ')}`)
    const lines = await pg.evaluate(() => {
      const R = (e) => { const b = e.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top + scrollY)} ${Math.round(b.width)}x${Math.round(b.height)}` }
      const out = [`dir=${document.documentElement.dir || 'ltr'} scrollW=${document.documentElement.scrollWidth}/${innerWidth}`]
      const content = document.querySelector('.admin-content') || document.querySelector('main')
      if (!content) return out.concat(['NO .admin-content'])
      out.push(`CONTENT @${R(content)} children=${content.children.length}`)
      const walk = (e, d, cap) => {
        if (d > cap.depth || out.length > cap.max) return
        const cls = String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').slice(0, 34)
        const cs = getComputedStyle(e)
        const tag = e.tagName.toLowerCase()
        const inter = ['input', 'select', 'button', 'a', 'textarea'].includes(tag)
        const info = own || inter ? ` fs${parseFloat(cs.fontSize)} fw${cs.fontWeight}${inter ? ' bd' + cs.borderTopWidth + ' r' + cs.borderTopLeftRadius : ''}` : (cs.display === 'grid' ? ` grid[${cs.gridTemplateColumns.replace(/px/g, '')}] gap${cs.rowGap}/${cs.columnGap}` : cs.display === 'flex' ? ` flex ${cs.flexDirection} gap${cs.rowGap}` : '')
        const extra = tag === 'input' ? ` type=${e.type} ph="${(e.placeholder || '').slice(0, 14)}"` : ''
        out.push(`${'.'.repeat(d)}${tag}${cls ? '.' + cls : ''}${extra}${own ? ' "' + own + '"' : ''} @${R(e)}${info}`)
        for (const c of e.children) walk(c, d + 1, cap)
      }
      walk(content, 0, { depth: 7, max: 200 })
      return out
    })
    lines.forEach((l) => console.log(l.slice(0, 260)))
    await ctx.close()
  } else {
    for (const [w, h] of [[390, 844], [768, 1024], [1280, 900]]) {
      const { ctx, pg } = await open(w, h)
      const r = await pg.evaluate(() => {
        const R = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top + scrollY), w: Math.round(b.width), h: Math.round(b.height) } }
        const out = []
        const forms = [...document.querySelectorAll('form.payment-gateway-editor')]
        out.push(`forms ${forms.length} scrollW ${document.documentElement.scrollWidth}/${innerWidth}`)
        forms.forEach((f, i) => {
          const fr = R(f), fc = getComputedStyle(f)
          const name = f.querySelector('.payment-knet-toggle-row') ? 'KNET' : 'T-Pay'
          const pad = parseFloat(fc.paddingLeft) + parseFloat(fc.paddingRight)
          const over = [...f.querySelectorAll('*')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > fr.r + 1 || b.left < fr.l - 1) }).slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} ${Math.round(e.getBoundingClientRect().left)}-${Math.round(e.getBoundingClientRect().right)}`)
          const ctrls = [...f.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, button, textarea')]
          const small = ctrls.filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height < 44 }).map((e) => `${e.tagName.toLowerCase()}:${Math.round(e.getBoundingClientRect().height)}`)
          const inputsFs = [...new Set(ctrls.filter((e) => /input|select|textarea/i.test(e.tagName)).map((e) => parseFloat(getComputedStyle(e).fontSize)))]
          const labels = [...f.querySelectorAll('label')]
          const clipped = [...f.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && e.clientWidth > 0).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`)
          out.push(`${name} form ${fr.w}x${fr.h} pad${pad / 2} | controls ${ctrls.length} under44px [${[...new Set(small)].join(' ')}] | input font sizes ${inputsFs.join('/')} | labels ${labels.length} | outside-form [${over.join(' ; ')}] | clipped [${clipped.join(' ; ')}]`)
        })
        return out
      })
      console.log(`\n== ${w}x${h}`)
      r.forEach((l) => console.log(l.slice(0, 330)))
      await ctx.close()
    }
  }
  await browser.close()
})().catch((e) => { console.log('KN_FAIL ' + String(e.message).slice(0, 300)); process.exit(1) })
