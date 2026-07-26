// Proves /terms and /privacy are real pages and that every footer link reaches
// the thing it names — in both languages.
//
// The audit finding this was written for was that "Terms", "Privacy" and
// "Why Sporta?" all pointed at /about. A 200 from /terms would not have caught
// that, and it does not catch the harder half either: /about#why and
// /terms#delivery need the page to actually MOVE, and React Router does not act
// on a hash by itself. So the hash cases scroll from halfway down /shop and
// assert the target section ends up near the top of the viewport.
//
// Needs the package served on :8188 with SPA routing, the PostgREST shim on
// :8130 and PostgreSQL on :5433.
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--host-resolver-rules=MAP www.sporta.com.kw 127.0.0.1:8188', '--no-proxy-server'] })
const results = []
const ok = (n, pass, extra='') => { results.push(pass); console.log(`${pass?'PASS':'FAIL'}  ${n}${extra?' — '+extra:''}`) }

for (const lang of ['en','ar']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } })
  await ctx.addInitScript((l) => localStorage.setItem('lang', l), lang)
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))

  for (const [path, mustContain] of [['/terms', lang==='ar'?'الشروط':'Terms'], ['/privacy', lang==='ar'?'الخصوصية':'Privacy']]) {
    await p.goto('http://www.sporta.com.kw'+path, { waitUntil: 'networkidle' })
    const h1 = (await p.locator('h1').first().textContent()).trim()
    const sections = await p.locator('h2').count()
    const words = (await p.locator('main').innerText()).split(/\s+/).length
    const dir = await p.evaluate(() => document.documentElement.dir)
    ok(`${path} [${lang}] renders`, h1.includes(mustContain) && sections >= 6 && words > 200,
       `h1="${h1}" ${sections} sections, ${words} words, dir=${dir}`)
    const canon = await p.evaluate(() => document.querySelector('link[rel=canonical]')?.href)
    ok(`${path} [${lang}] canonical`, canon === 'https://www.sporta.com.kw'+path, canon)
    // Each block is its own JSON document. Joining them and parsing once
    // produced two concatenated objects and a guaranteed SyntaxError — the
    // page was fine, the assertion was not.
    const blocks = await p.$$eval('script[type="application/ld+json"]', ss => ss.map(s => s.textContent))
    const parsed = blocks.map(t => { try { return JSON.parse(t) } catch { return null } })
    const allValid = parsed.every(Boolean)
    const hasCrumb = JSON.stringify(parsed).includes('BreadcrumbList')
    const hasPage = JSON.stringify(parsed).includes('"@type":"WebPage"')
    ok(`${path} [${lang}] structured data`, allValid && hasCrumb && hasPage,
       `${blocks.length} blocks, all valid=${allValid}, breadcrumb=${hasCrumb}, webpage=${hasPage}`)
  }

  // Footer links from the home page must land on the right URL.
  await p.goto('http://www.sporta.com.kw/', { waitUntil: 'networkidle' })
  const links = await p.$$eval('footer a[href^="/"]', as => as.map(a => [a.textContent.trim(), a.getAttribute('href')]))
  const want = { Terms:'/terms', Privacy:'/privacy', 'الشروط والأحكام':'/terms', 'سياسة الخصوصية':'/privacy' }
  for (const [text, href] of links) if (want[text]) ok(`footer "${text}" -> ${want[text]}`, href === want[text], href)
  ok(`no footer link still points at /about except About [${lang}]`,
     links.filter(([t,h]) => h === '/about').length === 1, JSON.stringify(links.filter(([t,h])=>h==='/about')))

  // The #hash must actually scroll.
  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  await p.evaluate(() => window.scrollTo(0, 1200))
  await p.locator('footer a[href="/about#why"]').click()
  await p.waitForURL(/#why/, { timeout: 5000 })
  await p.waitForTimeout(1200)
  const y = await p.evaluate(() => {
    const el = document.getElementById('why')
    return el ? Math.round(el.getBoundingClientRect().top) : null
  })
  ok(`/about#why scrolls to the section [${lang}]`, y !== null && Math.abs(y) < 160, `section top at ${y}px`)

  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  await p.evaluate(() => window.scrollTo(0, 1200))
  await p.locator('footer a[href="/terms#delivery"]').click()
  await p.waitForURL(/#delivery/, { timeout: 5000 })
  await p.waitForTimeout(1200)
  const y2 = await p.evaluate(() => {
    const el = document.getElementById('delivery')
    return el ? Math.round(el.getBoundingClientRect().top) : null
  })
  ok(`/terms#delivery scrolls to the section [${lang}]`, y2 !== null && Math.abs(y2) < 160, `section top at ${y2}px`)

  // Plain navigation must reset scroll, which is what ScrollManager also does.
  await p.goto('http://www.sporta.com.kw/shop', { waitUntil: 'networkidle' })
  await p.evaluate(() => window.scrollTo(0, 1500))
  await p.locator('footer a[href="/privacy"]').click()
  await p.waitForURL(/privacy/, { timeout: 5000 })
  await p.waitForTimeout(600)
  ok(`plain navigation starts at the top [${lang}]`, (await p.evaluate(() => window.scrollY)) < 40)

  ok(`no JS errors [${lang}]`, errs.length === 0, errs.join('; '))
  await ctx.close()
}
await b.close()
const f = results.filter(r=>!r).length
console.log(`\n${results.length-f}/${results.length} passed`)
process.exit(f?1:0)
