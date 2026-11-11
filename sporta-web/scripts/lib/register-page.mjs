// Pages for scripts/register-contact-test.mjs: the LIVE /account register form (signed out) and the LIVE /contact page,
// Arabic and English, built from scripts/fixtures/register (captured 2026-11-11 with scripts/live-capture.mjs: the section's
// markup, its ancestors, and every rule of the live stylesheets that can apply to it), with the live @font-face rules
// (fonts served from public/fonts). The capture holds sporta-shadows.css as it was live; it is taken out and the repo's
// file put in its place, so a test can compare the page with the file up to a marker ("off") and whole ("on").
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FONT_FACES } from '../fixtures/about-page.mjs'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const FX = join(ROOT, 'scripts/fixtures/register')
const read = (f) => readFileSync(join(FX, f), 'utf8')
export const ORIGIN = 'http://sporta.test'
// live.css is "/* ---- <sheet> ---- */" blocks in load order; the live sporta-shadows.css block is dropped and the
// repo's file is inserted at the same place, so the cascade order is the live one.
const BLOCKS = read('live.css').split(/(?=\/\* ---- )/)
const AT = BLOCKS.findIndex((b) => /^\/\* ---- \/sporta-shadows\.css/.test(b))
export const SHADOWS = readFileSync(join(ROOT, 'public/sporta-shadows.css'), 'utf8')

export function doc(page, lang, shadowsCss) {
  const meta = JSON.parse(read(`${page}-out-${lang}.json`))
  const css = [...BLOCKS.slice(0, AT), '/* ---- repo sporta-shadows.css ---- */\n' + shadowsCss + '\n', ...BLOCKS.slice(AT + 1)].join('')
  const close = meta.chain.map((t) => '</' + /^<([a-z]+)/.exec(t)[1] + '>').reverse().join('')
  return `<!doctype html><html ${meta.html}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${FONT_FACES}</style><style>${css}</style></head><body ${meta.body}>`
    + `${meta.chain.join('')}<div style="height:${Math.round(meta.header)}px" data-fixture-header></div>${read(`${page}-out-${lang}.html`)}<footer style="height:400px;background:#111" data-fixture-footer></footer>${close}</body></html>`
}

// Opens a page in a fresh context; fonts from public/fonts; nothing else leaves the browser.
export async function open(browser, page, lang, width, shadowsCss, height = 900) {
  const ctx = await browser.newContext({ viewport: { width, height } })
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.origin !== ORIGIN) return route.abort()
    if (u.pathname.startsWith('/fonts/')) { try { return route.fulfill({ status: 200, contentType: 'font/woff2', body: readFileSync(join(ROOT, 'public', u.pathname)) }) } catch { return route.fulfill({ status: 404 }) } }
    if (u.pathname === '/' + page) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: doc(page, lang, shadowsCss) })
    return route.fulfill({ status: 404, body: '' })
  })
  const p = await ctx.newPage()
  await p.goto(ORIGIN + '/' + page, { waitUntil: 'load' })
  await p.evaluate(() => document.fonts.ready)
  return { p, ctx }
}
