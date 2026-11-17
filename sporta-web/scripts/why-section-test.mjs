// The "Why Sporta" band (public/sporta-features.js, the section built by build()) is made with the DOM API, not with
// innerHTML. This proves the two things that matter:
//
//   1. the page is unchanged: the band, rendered in Arabic and in English, is the same as the one recorded from the
//      version that used innerHTML (scripts/fixtures/why-section.{ar,en}.html). Structure, attributes (order aside),
//      text and icon paths are compared.
//   2. the add-on no longer writes markup from a string: no innerHTML / insertAdjacentHTML / outerHTML assignment.
//
//   npm run test:why-section
//   WHY_RECORD=1 WHY_SOURCE=<old features.js> npm run test:why-section    (re-record the fixtures from another file)
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const is = (ok, msg, detail = '') => { if (ok) { pass++; console.log('ok   ' + msg) } else { fail++; console.log('FAIL ' + msg + (detail ? '  - ' + detail : '')) } }

const SOURCE = process.env.WHY_SOURCE ? readFileSync(process.env.WHY_SOURCE, 'utf8') : readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
const RECORD = process.env.WHY_RECORD === '1'

// 2. no markup written from a string
const current = readFileSync(join(ROOT, 'public/sporta-features.js'), 'utf8')
is(!/\.innerHTML\s*=|insertAdjacentHTML|\.outerHTML\s*=/.test(current), 'the add-on writes no markup from a string (no innerHTML, insertAdjacentHTML or outerHTML assignment)')
is(current.includes("createElementNS(SVG_NS, 'svg')") && current.includes('function build()'), 'the band is built with createElement and createElementNS')

// The band, as the page holds it, normalised: attributes sorted, whitespace-only text dropped, text trimmed.
const NORM = `function norm(n) {
  if (n.nodeType === 3) { const t = n.textContent.replace(/\\s+/g, ' ').trim(); return t ? JSON.stringify(t) : '' }
  if (n.nodeType !== 1) return ''
  const attrs = [...n.attributes].map((a) => a.name + '=' + JSON.stringify(a.value)).sort().join(' ')
  const kids = [...n.childNodes].map(norm).filter(Boolean).join(',')
  return '<' + n.localName + (attrs ? ' ' + attrs : '') + '>' + kids + '</' + n.localName + '>'
}`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function render(lang) {
  const page = await browser.newPage()
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Sporta</title></head>` +
    `<body><main><section><div class="campaign-photo-hero">hero</div></section></main></body></html>`
  await page.route('http://sporta.test/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto('http://sporta.test/', { waitUntil: 'load' })
  await page.addScriptTag({ content: SOURCE })
  await page.waitForTimeout(250)
  const out = await page.evaluate(`(() => { ${NORM}\n const s = document.getElementById('sporta-features'); return s ? norm(s) : null })()`)
  await page.close()
  return out
}

for (const lang of ['ar', 'en']) {
  const got = await render(lang)
  is(typeof got === 'string' && got.startsWith('<section') && got.includes('WHY SPORTA'), `${lang}: the band is on the page after the hero`, String(got).slice(0, 80))
  const file = join(ROOT, `scripts/fixtures/why-section.${lang}.html`)
  if (RECORD) {
    writeFileSync(file, got + '\n')
    console.log(`recorded ${file}`)
    continue
  }
  const want = readFileSync(file, 'utf8').trimEnd()
  is(got === want, `${lang}: the band is the same as before the change (structure, attributes, text, icon paths)`,
    got === want ? '' : `first difference at ${[...got].findIndex((c, i) => c !== want[i])}`)
}

await browser.close()
if (RECORD) process.exit(0)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
