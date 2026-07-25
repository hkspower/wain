#!/usr/bin/env node
// Build the no-build static site (../sporta-html5) into a deployable dist/.
//
// The source is hand-written HTML that runs straight from disk. This build
// produces the version that should actually be uploaded:
//
//   1. minifies app.js / products.js (rolldown) and style.css (lightningcss)
//   2. renames them with a content hash — app.<hash>.js — and rewrites every
//      reference in the HTML. This is the point of the build: with stable
//      filenames the server could never mark assets immutable (a deploy would
//      leave a year of stale JS and PRICES in returning browsers). Hashed
//      names make long-term caching safe, because a change changes the URL.
//   3. copies the KNET PHP endpoints (never config.php — server-only secrets)
//   4. emits a .htaccess whose immutable rule matches the hashed names
//
// Run:  npm run build:html5      (from sporta-web/)

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import { transform as cssTransform } from 'lightningcss'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC = join(root, 'sporta-html5')
const OUT = join(SRC, 'dist')
const PHP = join(root, 'sporta-web', 'dropin', 'php-knet')

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8)
const kb = (n) => `${(n / 1024).toFixed(1)} kB`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'assets'), { recursive: true })

// ---------- 1. JavaScript ----------
// app.js and products.js are classic scripts sharing globals, not modules, so
// each is minified on its own rather than bundled together.
const jsMap = {}
for (const name of ['products.js', 'app.js']) {
  const inPath = join(SRC, 'assets', name)
  const bundle = await rolldown({ input: inPath, logLevel: 'silent' })
  const { output } = await bundle.generate({ format: 'iife', minify: true })
  await bundle.close()
  let code = output[0].code
  // rolldown wraps an IIFE; the source is already a top-level classic script,
  // and its globals (window.SPORTA*) are assigned explicitly, so this is safe.
  const buf = Buffer.from(code, 'utf8')
  const outName = `${name.replace(/\.js$/, '')}.${hash8(buf)}.js`
  writeFileSync(join(OUT, 'assets', outName), buf)
  jsMap[name] = outName
  const before = statSync(inPath).size
  console.log(`  ${name.padEnd(13)} ${kb(before).padStart(9)} -> ${kb(buf.length).padStart(9)}  ${outName}`)
}

// ---------- 2. CSS ----------
const cssIn = readFileSync(join(SRC, 'assets', 'style.css'))
const { code: cssMin } = cssTransform({
  filename: 'style.css',
  code: cssIn,
  minify: true,
  // Match the browsers the site already targets; keeps RTL logical properties.
  targets: { chrome: 100 << 16, firefox: 100 << 16, safari: (15 << 16) | (4 << 8) },
})
const cssName = `style.${hash8(cssMin)}.css`
writeFileSync(join(OUT, 'assets', cssName), cssMin)
console.log(`  style.css     ${kb(cssIn.length).padStart(9)} -> ${kb(cssMin.length).padStart(9)}  ${cssName}`)

// ---------- 3. static assets ----------
for (const f of readdirSync(join(SRC, 'assets'))) {
  if (['app.js', 'products.js', 'style.css'].includes(f)) continue
  cpSync(join(SRC, 'assets', f), join(OUT, 'assets', f))
}

// ---------- 4. HTML: rewrite asset references to the hashed names ----------
const pages = readdirSync(SRC).filter((f) => extname(f) === '.html')
for (const page of pages) {
  let html = readFileSync(join(SRC, page), 'utf8')
  html = html.replace('assets/style.css', `assets/${cssName}`)
  for (const [orig, hashed] of Object.entries(jsMap)) {
    html = html.split(`assets/${orig}`).join(`assets/${hashed}`)
  }
  writeFileSync(join(OUT, page), html)
}
console.log(`  ${pages.length} HTML pages rewritten`)

// ---------- 5. root files ----------
for (const f of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
  if (existsSync(join(SRC, f))) cpSync(join(SRC, f), join(OUT, f))
}

// ---------- 6. KNET PHP endpoints (config.php is server-only) ----------
cpSync(PHP, join(OUT, 'knet'), {
  recursive: true,
  filter: (s) => !['config.php', 'README.md'].includes(s.split('/').pop()),
})

// ---------- 7. .htaccess with hash-aware caching ----------
let ht = readFileSync(join(SRC, '.htaccess'), 'utf8')
ht = ht.replace(
  /  # This site has NO build step[\s\S]*?<\/FilesMatch>\n\n  # Images and fonts[\s\S]*?<\/FilesMatch>/,
  `  # BUILT OUTPUT: app.<hash>.js / style.<hash>.css change name whenever their
  # bytes change, so they are safe to cache forever.
  <FilesMatch "\\\\.[0-9a-f]{8}\\\\.(js|css)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>

  # Anything still on a fixed name must revalidate.
  <FilesMatch "^(app|products|style)\\\\.(js|css)$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>

  <FilesMatch "\\\\.(woff2?|ttf|eot|svg|png|jpe?g|gif|webp|avif|ico)$">
    Header set Cache-Control "public, max-age=2592000"
  </FilesMatch>`,
)
writeFileSync(join(OUT, '.htaccess'), ht)

const count = (dir) => readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(join(dir, e.name)) : 1), 0)
console.log(`\n✓ sporta-html5/dist ready — ${count(OUT)} files`)
