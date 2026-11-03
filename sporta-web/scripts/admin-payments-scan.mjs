// READ-ONLY look at the LIVE /backends Payments screen (the KNET and T-Pay forms).
//
//   node scripts/admin-payments-scan.mjs                 MODE=tree     (default) structure and boxes at 390px
//   MODE=measure node scripts/admin-payments-scan.mjs    checks at 390, 768 and 1280px
//   MODE=dom     node scripts/admin-payments-scan.mjs    exact element tree of the section (full classes), to rebuild it offline
//   MODE=verify CSS_URL=<raw url> node ...               the same page measured before and after the stylesheet is applied
//   CSS_URL=<raw url of a stylesheet> ...                apply it on top first (before/after on one page)
//   BLOCK_ADDON=1 ...                                    any mode with sporta-admin-knet.css refused: the compiled admin alone
//   MODE=colors [SCHEME=dark] [W=390] node ...           text/background contrast of every text element, lowest first (the admin's dark
//                                                        mode is prefers-color-scheme, so SCHEME=dark is what a dark-mode owner sees)
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
const open = async (w, h, withCss = true) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: 'en-US', colorScheme: process.env.SCHEME === 'dark' ? 'dark' : 'light' })
  const pg = await ctx.newPage()
  const errs = []
  pg.on('pageerror', (e) => errs.push(e.message.slice(0, 90)))
  await pg.route('**/api/admin.php**', (route) => {
    const r = new URL(route.request().url()).searchParams.get('r') || ''
    const body = route.request().method() === 'GET' && r in FAKE ? FAKE[r] : r === 'me' ? FAKE.me : route.request().method() === 'GET' ? [] : {}
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  if (process.env.BLOCK_ADDON) await pg.route('**/sporta-admin-knet.css*', (route) => route.abort())  // the admin as the compiled build alone styles it
  await pg.goto(B + '/backends', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(900)
  const target = (await pg.$('a[href*="payment" i]')) || (await pg.$('text=/Payments/i'))
  if (target) { await target.evaluate((el) => el.click()); await pg.waitForTimeout(2500) }
  if (CSS && withCss) { await pg.addStyleTag({ content: CSS }); await pg.waitForTimeout(500) }
  return { ctx, pg, errs, found: !!target }
}
let browser
;(async () => {
  browser = await chromium.launch({ args: ['--no-sandbox'] })
  if (MODE === 'verify') {
    // The same live render measured before and after CSS_URL is applied to it.
    const probe = () => {
      const R = (e) => { if (!e) return 'none'; const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}` }
      const q = (sel, root = document) => root.querySelector(sel)
      const cs = (e) => (e ? getComputedStyle(e) : null)
      const card = q('.payment-gateway-card')
      const dl = card && q(':scope > dl', card)
      const tile = dl && dl.firstElementChild
      const knet = q('.payment-gateway-editor:has(.payment-knet-toggle-row)')
      const tpay = [...document.querySelectorAll('form.payment-gateway-editor')].find((f) => f !== knet)
      const panel = q('[data-sporta-knet-ids]')
      const ips = q('[data-sporta-tpay-ips]')
      const saveIds = panel && q('button', panel)
      const saveKnet = knet && [...knet.querySelectorAll('button')].filter((b) => !b.closest('[data-sporta-knet-ids]')).pop()
      const cbk = tpay && [...tpay.querySelectorAll('label.rounded-2xl')].find((l) => l.querySelector(':scope > input[type=checkbox]'))
      const box = cbk && q('input[type=checkbox]', cbk)
      const sky = tpay && q('p.bg-sky-50', tpay)
      const spans = knet ? [...new Set([...knet.querySelectorAll('label > span:first-child:not(.sr-only)')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().height)))] : []
      const tpaySpans = tpay ? [...new Set([...tpay.querySelectorAll('label > span:first-child:not(.sr-only)')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().height)))] : []
      const small = [...document.querySelectorAll('.payment-settings button, .payment-settings input:not([type=checkbox]), .payment-settings select')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height < 44 }).length
      const hosts = [...document.querySelectorAll('.payment-gateway-card dd.font-mono')]
      const trunc = hosts.filter((h) => h.scrollWidth > h.clientWidth + 0.5).length
      const b = (e) => (e ? `${cs(e).borderTopWidth} ${cs(e).borderTopColor}` : '-')
      return [
        `section ${R(q('.payment-settings'))} | overflow ${document.documentElement.scrollWidth > innerWidth ? 'YES ' + document.documentElement.scrollWidth : 'no'} | controls under 44px ${small}`,
        `status card ${R(card)} | tiles grid [${dl ? cs(dl).gridTemplateColumns.replace(/px/g, '') : '-'}] tile ${R(tile)} border ${b(tile)} | gateway host truncated ${trunc} of ${hosts.length}`,
        `KNET panel ${R(panel)} border ${b(panel)} radius ${panel ? cs(panel).borderTopLeftRadius : '-'} pad ${panel ? cs(panel).paddingTop : '-'}`,
        `Save IDs bg ${saveIds ? cs(saveIds).backgroundColor : '-'} color ${saveIds ? cs(saveIds).color : '-'} border ${b(saveIds)} | Save KNET bg ${saveKnet ? cs(saveKnet).backgroundColor : '-'}`,
        `T-Pay panel ${R(ips)} border ${b(ips)} | sky note ${sky ? cs(sky).display : 'absent'}`,
        `CBK card ${R(cbk)} flex-wrap ${cbk ? cs(cbk).flexWrap : '-'} inside IP panel ${cbk && cbk.closest('[data-sporta-tpay-ips]') ? 'yes' : 'no'} | checkbox ${R(box)} accent ${box ? cs(box).accentColor : '-'}`,
        `label heights KNET [${spans.join(' ')}] T-Pay [${tpaySpans.join(' ')}]`,
      ]
    }
    for (const [w, h] of [[390, 844], [360, 800], [320, 700], [1280, 900]]) {
      const { ctx, pg } = await open(w, h, false)
      const before = await pg.evaluate(probe)
      await pg.addStyleTag({ content: CSS })
      await pg.waitForTimeout(500)
      const after = await pg.evaluate(probe)
      console.log(`\n== ${w}x${h}  (before -> after)`)
      before.forEach((l, i) => { console.log('  - ' + l.slice(0, 230)); console.log('  + ' + after[i].slice(0, 230)) })
      await ctx.close()
    }
  } else if (MODE === 'dom') {
    // The exact element tree of the Payments section: full class lists, text and the few
    // attributes that change how a control looks. Enough to rebuild the screen offline.
    const { ctx, pg } = await open(Number(process.env.W || 390), 844)
    const lines = await pg.evaluate(() => {
      const root = document.querySelector('.payment-settings')
      const out = [`html font-size ${getComputedStyle(document.documentElement).fontSize} dir ${getComputedStyle(root).direction} lang ${document.documentElement.lang}`]
      const walk = (e, d) => {
        if (out.length > 330) return
        const tag = e.tagName.toLowerCase()
        const cls = String(e.getAttribute('class') || '').replace(/\s+/g, ' ').trim()
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
        const at = ['type', 'placeholder', 'aria-pressed', 'aria-checked', 'role', 'value', 'href', 'checked', 'for', 'name']
          .map((a) => (e.hasAttribute(a) ? `${a}=${JSON.stringify(e.getAttribute(a).slice(0, 40))}` : '')).filter(Boolean).join(' ')
        const hid = getComputedStyle(e).display === 'none' ? ' [display:none]' : ''
        out.push(`${'.'.repeat(d)}${tag} {${cls}} ${at}${own ? ' T:' + JSON.stringify(own.slice(0, 80)) : ''}${hid}`)
        for (const c of e.children) walk(c, d + 1)
      }
      if (root) walk(root, 0)
      return out
    })
    lines.forEach((l) => console.log(l.slice(0, 420)))
    await ctx.close()
  } else if (MODE === 'colors') {
    // Contrast of every text-bearing element in the Payments section, lowest first, in the colour scheme
    // given by SCHEME (light | dark). Limits: 4.5:1, or 3:1 for large text (>= 24px, or >= 18.66px bold).
    const { ctx, pg } = await open(Number(process.env.W || 390), 844)
    const out = await pg.evaluate(() => {
      // Any CSS colour (the compiled theme uses lab() and oklch()) to sRGB bytes, by painting one canvas pixel.
      const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1
      const g = cv.getContext('2d', { willReadFrequently: true })
      const num = (str) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = str; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
      const mix = (top, bottom) => { const a = top[3]; return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1] }
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
      const bgOf = (e) => {
        const layers = []
        for (let x = e; x; x = x.parentElement) { const c = num(getComputedStyle(x).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break }
        let col = [255, 255, 255, 1]
        for (let i = layers.length - 1; i >= 0; i--) col = mix(layers[i], col)
        return col
      }
      const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')
      const root = document.querySelector('.payment-settings')
      const rows = []
      for (const e of root ? root.querySelectorAll('*') : []) {
        const cs = getComputedStyle(e)
        if (cs.display === 'none' || cs.visibility === 'hidden' || !e.getBoundingClientRect().width) continue
        const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ')
        const isField = e.tagName === 'INPUT' && e.type !== 'checkbox'
        if (!own && !isField) continue
        const fg = mix(num(cs.color), bgOf(e)), bg = bgOf(e)
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
        const ratio = (a + 0.05) / (b + 0.05)
        const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700
        const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
        const sig = e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        rows.push({ ratio, need, line: `${ratio.toFixed(2)} (need ${need}) ${sig} "${(own || e.value || e.placeholder || '').slice(0, 34)}" fg ${hex(fg)} on ${hex(bg)} ${px.toFixed(0)}px/${cs.fontWeight}${e.closest('[data-sporta-knet-ids],[data-sporta-tpay-ips]') ? ' [panel]' : ''}` })
      }
      rows.sort((x, y) => x.ratio - y.ratio)
      const low = rows.filter((r) => r.ratio < r.need)
      return [`scheme ${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'} width ${innerWidth} | text elements ${rows.length} | under limit ${low.length}`, ...low.slice(0, 28).map((r) => r.line)]
    })
    out.forEach((l) => console.log(l.slice(0, 240)))
    await ctx.close()
  } else if (MODE === 'surface') {
    // Computed surfaces of the Payments screen: what paints the page, the cards, the fields and the text, in the
    // colour scheme given by SCHEME. With BLOCK_ADDON=1 it is the compiled admin alone.
    const { ctx, pg } = await open(Number(process.env.W || 390), 844)
    const out = await pg.evaluate(() => {
      const sels = ['html', 'body', '.admin-shell', '.admin-content', '.payment-settings', 'h1', '.payment-gateway-card', '.payment-gateway-card dl > div', '.payment-gateway-card dd', '.payment-gateway-editor', '.payment-knet-toggle-row', '.payment-secret-field__label', 'label > span.text-xs', 'input.mt-1', 'p.text-sm', 'button.bg-indigo-600', '[data-sporta-knet-ids]', '[data-sporta-tpay-ips]', 'label.rounded-2xl']
      const rows = [`scheme ${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'} | html color-scheme ${getComputedStyle(document.documentElement).colorScheme}`]
      for (const s of sels) {
        const e = document.querySelector(s)
        if (!e) { rows.push(s + ' : none'); continue }
        const c = getComputedStyle(e)
        rows.push(`${s} : bg ${c.backgroundColor} | color ${c.color} | border ${c.borderTopWidth} ${c.borderTopColor} | cls ${String(e.getAttribute('class') || '').split(/\s+/).filter((x) => /^dark:|bg-|text-|border-/.test(x)).slice(0, 8).join(' ')}`)
      }
      return rows
    })
    out.forEach((l) => console.log(l.slice(0, 300)))
    await ctx.close()
  } else if (MODE === 'tree') {
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
