#!/usr/bin/env node
// Stage JUST the backend panel and the API it talks to, ready to drop into
// public_html.
//
// WHY THIS EXISTS SEPARATELY FROM make-package.mjs
//
// SPORTA-GO-LIVE.zip is the whole site — 2.2 MB, ~110 files, every product
// photo and font. When the shop is ALREADY LIVE and only the admin is missing,
// re-uploading all of it over a slow connection to fix one route is a long,
// risky operation whose failure mode is a half-uploaded site. This is the
// small, targeted alternative: the panel, the API, and the one hidden file
// whose absence is the usual cause.
//
// WHAT IS IN IT, AND WHY EACH PIECE
//
//   .htaccess     THE ROUTE. /backends is not a file on disk — it is a URL the
//                 single-page app claims — so without the rewrite Apache
//                 answers its own 404 and the panel appears "not deployed"
//                 while sitting right there. This file is HIDDEN in File
//                 Manager, which is why it is the single most-missed upload.
//   index.html    The app shell every route is served as.
//   assets/       The panel's own chunk plus everything the shell loads. The
//                 filenames carry content hashes, so these are matched to THIS
//                 index.html and cannot be mixed with an older upload.
//   api/          The PHP the panel calls. Without it the panel loads and then
//                 says the backend is not configured — which is true.
//
// WHAT IS DELIBERATELY NOT IN IT
//
//   api/config.php    Real database credentials. It lives ONLY on the server,
//                     is never committed and never shipped. If this bundle
//                     carried one it would overwrite the live one and take the
//                     whole shop down, which is a worse outcome than the
//                     problem being fixed.
//   knet/, pay/       Payment endpoints with their own server-only configs.
//                     Nothing here changes them, so nothing here should touch
//                     them.
//   products, photos  Already on the server. Re-uploading them is the slow,
//                     risky operation this exists to avoid.
//
// It is generated, never hand-assembled: the last hand-made bundle went stale
// and carried a payment-losing callback bug for weeks. Run:
//
//   npm run package:backend      (after npm run release / npm run package)

import { cp, mkdir, rm, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const run = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = dirname(HERE)
const DIST = join(WEB, 'dist')
const OUT = join(dirname(WEB), 'SPORTA-BACKEND-UPLOAD')

// The bundle is only as current as dist/. A stale dist would produce a bundle
// whose index.html asks for asset hashes that are not in it — a white screen,
// and a confusing one, because every file "looks right".
if (!existsSync(join(DIST, 'api', 'api.php'))) {
  console.error(
    'dist/ has no api/ — this looks like a bare `vite build`.\n' +
    'Run `npm run package` first; this bundle is cut from the audited output.',
  )
  process.exit(1)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

// ---------------------------------------------------------------- the payload
await cp(join(DIST, 'index.html'), join(OUT, 'index.html'))
await cp(join(DIST, '.htaccess'), join(OUT, '.htaccess'))
await cp(join(DIST, 'assets'), join(OUT, 'assets'), { recursive: true })
await cp(join(DIST, 'api'), join(OUT, 'api'), { recursive: true })

// config.php is server-only. It is not in dist/ and must never be in here, but
// asserting it is a one-line check against the day someone "helpfully" adds it.
for (const forbidden of ['api/config.php', 'knet', 'pay']) {
  if (existsSync(join(OUT, forbidden))) {
    console.error(`REFUSING to write: ${forbidden} must not be in this bundle.`)
    process.exit(1)
  }
}

// The panel's chunk, by name, so the instructions can say "this file is the
// admin" and the reader can verify it arrived.
const assets = await readdir(join(OUT, 'assets'))
const adminChunk = assets.find((f) => f.startsWith('AdminApp-') && f.endsWith('.js'))
if (!adminChunk) {
  console.error('REFUSING to write: no AdminApp-*.js in assets/ — the panel is not in this build.')
  process.exit(1)
}

// EVERY asset index.html asks for must be present. This is the check that
// catches a partial or stale copy, and it is the difference between "the panel
// is missing" and a white screen nobody can explain.
const html = await readFile(join(OUT, 'index.html'), 'utf8')
const wanted = [...html.matchAll(/\/assets\/([A-Za-z0-9._-]+)/g)].map((m) => m[1])
const missing = wanted.filter((f) => !assets.includes(f))
if (missing.length) {
  console.error('REFUSING to write: index.html asks for files that are not here:\n  ' + missing.join('\n  '))
  process.exit(1)
}

// ------------------------------------------------------------------ the note
// Written INTO the folder, because the person reading it is in File Manager on
// a phone and not in this terminal.
await writeFile(join(OUT, 'READ-ME-FIRST.txt'), `SPORTA — the backend panel, ready to upload
============================================

Drop the CONTENTS of this folder into public_html, keeping the folder
structure. Nothing here overwrites your database credentials, your payment
settings or your product photos.

BEFORE YOU START — turn on hidden files
---------------------------------------
hPanel -> File Manager -> Settings -> "Show hidden files".

Do this FIRST. The file called .htaccess starts with a dot, so File Manager
hides it by default, and it will not be uploaded if you cannot see it. That
file is what makes the address /backends work at all: the panel is not a file
on disk, it is a URL the app claims, so without .htaccess the server answers
its own "404 Not Found" and the panel looks like it was never uploaded.

WHAT TO UPLOAD
--------------
  .htaccess        -> public_html/.htaccess          (the route; hidden file)
  index.html       -> public_html/index.html
  assets/          -> public_html/assets/            (merge with what is there)
  api/             -> public_html/api/               (merge)

The admin panel itself is assets/${adminChunk}.
If that file is on the server and /backends still does not open, the problem
is .htaccess, not the panel.

AFTER UPLOADING
---------------
1. In phpMyAdmin, import api/payattempt.mysql.sql.
   Until you do, a customer whose card is declined cannot try again.

2. Open https://www.sporta.com.kw/backends

   It opens and asks you to sign in ................ done.
   It shows an orange setup page ................... it IS installed; the page
       names which of the four values in api/config.php is wrong. Fix that one.
   It shows "404 Not Found" ........................ .htaccess did not upload.
       Turn on hidden files and send it again.

WHAT IS NOT IN HERE, ON PURPOSE
-------------------------------
api/config.php — your database credentials. That file lives only on the
server. If this bundle carried one it would overwrite yours and take the whole
shop down.

knet/ and pay/ — the payment endpoints, which have their own server-only
credentials. Nothing here changes them, so nothing here touches them.

Your products, photos and orders are in the database and on the server
already. This bundle does not contain and cannot affect them.
`)

// ------------------------------------------------------------------- the zip
await run('zip', ['-rq', '-X', join(dirname(WEB), 'SPORTA-BACKEND.zip'), '.'], { cwd: OUT })

const size = async (p) => Math.round((await stat(p)).size / 1024)
console.log(`\nSPORTA-BACKEND-UPLOAD/   (folder, ready for File Manager)`)
console.log(`  .htaccess              ${await size(join(OUT, '.htaccess'))} kB   the route — HIDDEN FILE`)
console.log(`  index.html             ${await size(join(OUT, 'index.html'))} kB`)
console.log(`  assets/                ${assets.length} files`)
console.log(`    ${adminChunk}  <- the panel itself`)
console.log(`  api/                   ${(await readdir(join(OUT, 'api'))).length} files`)
console.log(`  READ-ME-FIRST.txt`)
console.log(`\nSPORTA-BACKEND.zip       ${await size(join(dirname(WEB), 'SPORTA-BACKEND.zip'))} kB  (same thing, zipped)\n`)
