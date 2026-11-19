// ADMIN HIDE EMAIL HINT 1120 (owner 2026-11-19, "remove backends hints email"): on the quick-unlock passcode step of /backends the
// remembered administrator address is hidden, and only there. Proven on the real block of public/sporta-admin-brands.js, in a browser,
// against markup copied from the source of src/admin/AdminApp.jsx (the passcode form and the password form).
//   npm run test:admin-hide-email-hint        (rig-free: a static page, Chromium at /opt/pw-browsers/chromium)
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'public/sporta-admin-brands.js'), 'utf8')
const BEGIN = '/* ===== ADMIN HIDE EMAIL HINT 1120 - begin'
const END = '/* ===== ADMIN HIDE EMAIL HINT 1120 - end'
// The block runs to the closing "*/" of its end marker line, so the slice takes the whole comment.
const BLOCK = SRC.slice(SRC.indexOf(BEGIN), SRC.indexOf('*/', SRC.indexOf(END)) + 2)

let pass = 0, fail = 0
const is = (ok, msg, d = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (d ? '  - ' + d : '')) } }

// The remembered address is a fixture value; it is never a real account.
const REMEMBERED = 'remembered-admin-fixture'
// Markup as AdminApp.jsx renders it: the passcode step (remembered address under the title) and the password step.
const PASSCODE = `<div class="flex min-h-screen"><form aria-labelledby="passcode-title" class="w-full"><div class="text-center">
  <h1 id="passcode-title">Enter your passcode</h1><p dir="ltr" class="mt-1 text-sm">${REMEMBERED}</p></div>
  <div role="alert" class="empty:hidden"></div><div><label for="admin-passcode">Passcode</label>
  <input id="admin-passcode" type="password" dir="ltr" maxlength="6"></div><button type="submit">Unlock</button></form></div>`
const PASSWORD = `<div class="flex min-h-screen"><form class="w-full"><div class="text-center"><h1>Sign in</h1>
  <p class="mt-1 text-sm">Sign in with the admin email and password for this shop.</p></div>
  <div><label for="admin-email">Email</label><input id="admin-email" type="email" dir="ltr"></div>
  <div><label for="admin-password">Password</label><input id="admin-password" type="password" dir="ltr"></div><button type="submit">Sign in</button></form></div>`

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function page(html, path = '/backends', withBlock = true) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } })
  const p = await ctx.newPage()
  await p.route('https://admin.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${html}</body></html>` }))
  await p.goto('https://admin.test' + path)
  if (withBlock) await p.addScriptTag({ content: BLOCK })
  return { ctx, p }
}
const lineState = (p) => p.evaluate((m) => {
  const e = [...document.querySelectorAll('p')].find((x) => x.textContent.trim() === m)
  return { present: !!e, shown: !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0 }
}, REMEMBERED)

// 1. the passcode step hides the remembered address
{
  const { ctx, p } = await page(PASSCODE)
  const s = await lineState(p)
  is(s.present && !s.shown, 'the passcode step no longer shows the remembered address (the line stays in the page, hidden)', JSON.stringify(s))
  await ctx.close()
}
// 2. the password step is untouched
{
  const { ctx, p } = await page(PASSWORD)
  const lead = await p.evaluate(() => getComputedStyle(document.querySelector('form p.text-sm')).display)
  const ruleThere = await p.evaluate(() => !!document.getElementById('sporta-hide-email-hint'))
  is(lead === 'block', 'the password step keeps its sign-in lead text', lead)
  is(ruleThere === false || lead === 'block', 'the password step is not hidden by the rule')
  await ctx.close()
}
// 3. a second copy of the block on the same page adds nothing (guard)
{
  const { ctx, p } = await page(PASSCODE)
  await p.addScriptTag({ content: BLOCK })
  const n = await p.evaluate(() => document.querySelectorAll('#sporta-hide-email-hint').length)
  is(n === 1, 'a second copy of the block adds no second rule (guard)', String(n))
  await ctx.close()
}
// 4. outside /backends the block does nothing
{
  const { ctx, p } = await page(PASSCODE, '/shop')
  const ruleThere = await p.evaluate(() => !!document.getElementById('sporta-hide-email-hint'))
  is(!ruleThere, 'outside /backends the block adds nothing')
  await ctx.close()
}
// 5. mutation: with the rule cut out of the block, the line is visible again (the check can fail)
{
  const cut = BLOCK.replace('form:has(#admin-passcode) > div > p[dir="ltr"] { display: none !important; }', '')
  const ctx = await b.newContext({ viewport: { width: 390, height: 800 } })
  const p = await ctx.newPage()
  await p.route('https://admin.test/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>${PASSCODE}</body></html>` }))
  await p.goto('https://admin.test/backends')
  await p.addScriptTag({ content: cut })
  const s = await lineState(p)
  is(s.shown, 'mutation: with the rule cut out, the remembered address is visible (the test can fail)', JSON.stringify(s))
  await ctx.close()
}
await b.close()
console.log(`\n${pass} ok, ${fail} FAIL`)
process.exit(fail ? 1 : 0)
