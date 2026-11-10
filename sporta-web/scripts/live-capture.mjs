// Captures, from the LIVE storefront, what a fixture needs: the markup of one section of a page and every rule of
// the live stylesheets that can apply to it. Used to build scripts/fixtures/* so an add-on CSS change is proven on
// the live markup under the live rules, not on a reconstruction.
//
// READ-ONLY for the page it captures: it loads the page and reads the DOM and the CSSOM. With ACCOUNT_EMAIL and
// ACCOUNT_PASSWORD (the owner-approved test account, see live-page-audit.mjs) it also captures the signed-in
// state of the same page; the sign-in is the only request it sends that is not a GET.
//
//   PATHS     pages, comma separated            (default /account)
//   SELECTOR  the section to keep               (default main > section, the first one)
//
// Output: lines "CAP <file> <i>/<n> <base64 of gzip>", 6000 characters each (the job log keeps 300 entries), then
// CAPTURE_DONE. scripts/live-capture-unpack.mjs turns a saved log into files.
import { chromium } from 'playwright'
import { gzipSync } from 'node:zlib'
const B = process.env.BASE || 'https://www.sporta.com.kw'
const PATHS = (process.env.PATHS || '/account').split(',').map((s) => s.trim()).filter(Boolean)
const SELECTOR = process.env.SELECTOR || 'main > section'

const emit = (file, text) => {
  const b64 = gzipSync(Buffer.from(text, 'utf8')).toString('base64')
  const n = Math.ceil(b64.length / 6000)
  for (let i = 0; i < n; i++) console.log('CAP ' + file + ' ' + (i + 1) + '/' + n + ' ' + b64.slice(i * 6000, (i + 1) * 6000))
}

// Runs in the page. Every rule (with its @media / @supports / @layer wrappers, in source order) whose selector,
// with pseudo-classes and pseudo-elements removed, matches <html>, <body>, an ancestor of the section or anything
// inside it. A rule that cannot be tested (an unsupported selector) is kept: too much CSS is harmless here.
const collect = (selector) => {
  const sec = document.querySelector(selector)
  if (!sec) return { html: '', css: '', attrs: '', note: 'selector not found' }
  const scope = [document.documentElement, document.body]
  for (let n = sec.parentElement; n && n !== document.body; n = n.parentElement) scope.push(n)
  const inside = [sec, ...sec.querySelectorAll('*')]
  const strip = (s) => s.replace(/::?[a-zA-Z-]+(\([^()]*(\([^()]*\))?[^()]*\))?/g, (m) => (/^:(not|is|where|has|lang|dir|nth-|first-|last-|only-|root|empty|checked|disabled|required)/.test(m) ? m : ''))
  const hit = (sel) => {
    for (const part of sel.split(',')) {
      const s = strip(part).trim() || '*'
      try { if (scope.some((e) => e.matches(s)) || inside.some((e) => e.matches(s))) return true } catch (e) { return true }
    }
    return false
  }
  const out = []
  // one rule per line, always: cssText of @keyframes (and of some at-rules) spans several lines, and the union
  // across states is de-duplicated BY LINE, which once dropped the closing braces of every @keyframes block
  // and silently disabled each rule after the first one (the fixture "passed" with the page's CSS half dead)
  const one = (t) => t.replace(/\s*\n\s*/g, ' ')
  const walk = (rules, wrap) => {
    for (const r of rules) {
      if (r.type === 1) { if (hit(r.selectorText)) out.push(wrap.map((w) => w + '{').join('') + one(r.cssText) + '}'.repeat(wrap.length)) } else if (r.cssRules && r.type !== 7 && r.type !== 5) {
        const headText = r.cssText.slice(0, r.cssText.indexOf('{')).trim()
        walk(r.cssRules, [...wrap, headText])
      } else if (r.type === 7) out.push(wrap.map((w) => w + '{').join('') + one(r.cssText) + '}'.repeat(wrap.length))
    }
  }
  const sheets = []
  for (const sh of document.styleSheets) {
    let rules = null
    try { rules = sh.cssRules } catch (e) { continue }
    const before = out.length
    out.push('/* ---- ' + (sh.href ? sh.href.replace(location.origin, '') : 'inline <style ' + (sh.ownerNode && sh.ownerNode.id ? '#' + sh.ownerNode.id : '') + '>') + ' ---- */')
    walk(rules, [])
    sheets.push((sh.href ? sh.href.replace(location.origin, '') : 'inline') + ':' + (out.length - before - 1))
  }
  const a = (e) => [...e.attributes].map((x) => x.name + '="' + x.value.replace(/"/g, '&quot;') + '"').join(' ')
  const chain = []
  for (let n = sec.parentElement; n && n !== document.body; n = n.parentElement) chain.unshift('<' + n.tagName.toLowerCase() + ' ' + a(n) + '>')
  return { html: sec.outerHTML, css: out.join('\n'), attrs: JSON.stringify({ html: a(document.documentElement), body: a(document.body), chain, sheets, header: (document.querySelector('header') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height }), note: 'ok' }
}

const b = await chromium.launch()
const css = new Map()
for (const lang of ['ar', 'en']) {
  for (const state of process.env.ACCOUNT_EMAIL ? ['out', 'in'] : ['out']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const q = lang === 'en' ? '?lang=en' : ''
    if (state === 'in') {
      await page.goto(B + '/account' + q, { waitUntil: 'networkidle' })
      const st = await page.evaluate(async ([e, p]) => { const r = await fetch('/api/customer.php?r=login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Sporta-Customer': '1' }, body: JSON.stringify({ email: e, password: p }) }); return r.status }, [process.env.ACCOUNT_EMAIL, process.env.ACCOUNT_PASSWORD])
      console.log('SIGNIN ' + lang + ' ' + st)
    }
    for (const path of PATHS) {
      await page.goto(B + path + q, { waitUntil: 'networkidle' })
      await page.waitForTimeout(1500)
      const r = await page.evaluate(collect, SELECTOR)
      const name = path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home'
      console.log('STATE ' + name + ' ' + state + ' ' + lang + ' ' + r.note + ' html=' + r.html.length + ' css=' + r.css.length)
      if (r.note !== 'ok') continue
      emit(name + '-' + state + '-' + lang + '.html', r.html)
      emit(name + '-' + state + '-' + lang + '.json', r.attrs)
      for (const line of r.css.split('\n')) css.set(line, true)
    }
    await ctx.close()
  }
}
// one stylesheet for every state: the union, in first-seen order (source order within each state)
emit('live.css', [...css.keys()].join('\n'))
await b.close()
console.log('CAPTURE_DONE')
