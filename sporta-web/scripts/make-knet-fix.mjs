// Builds SPORTA-KNET-FIX.zip — the SMALL upload: only the server files the
// KNET fix actually changed, not the 1.8 MB site.
//
// It exists as a script for the same reason make-package.mjs does. A
// hand-assembled zip goes stale the moment the source moves, and this project
// has already paid for that lesson once: the previous hand-made package
// carried a payment-losing callback bug for weeks because nobody rebuilt it.
// Anything the owner uploads has to be reproducible from the repo by one
// command, or it is a snapshot of a moment nobody can identify later.
//
//   node scripts/make-knet-fix.mjs      (or npm run package:knet)
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(web, '..')
const stage = '/tmp/sporta-knet-fix'
const out = join(root, 'SPORTA-KNET-FIX.zip')

// The files this fix changes on the server, and where each lands under
// public_html. Kept explicit: a glob would quietly start shipping whatever
// else lands in the folder, and one of those things is config.php.
const FILES = [
  ['dropin/php-knet/callback.php', 'knet/callback.php'],
  ['dropin/php-knet/knet.php', 'knet/knet.php'],
  ['dropin/php-knet/pay.php', 'knet/pay.php'],
  ['dropin/php-knet/selftest.php', 'knet/selftest.php'],
  ['dropin/php-knet/config.example.php', 'knet/config.example.php'],
  ['dropin/php-store/admin.php', 'api/admin.php'],
]

const README = `SPORTA — KNET fix. Upload these 6 files, nothing else.
======================================================

WHERE THEY GO (hPanel -> File Manager -> public_html)

  knet/callback.php        overwrite
  knet/knet.php            overwrite
  knet/pay.php             overwrite
  knet/selftest.php        overwrite
  knet/config.example.php  overwrite   (reference only)
  api/admin.php            overwrite

DO **NOT** touch knet/config.php or api/config.php. Those hold your
credentials, they are not in this zip, and nothing here overwrites them.


THEN — THE ONE EDIT THAT MAKES CARDS WORK
-----------------------------------------
Only if config.js says  backend: 'php'  (the native MySQL backend).

Open  knet/config.php  and add these five lines inside the list, using the
SAME database values that are already in api/config.php:

    'store'      => 'mysql',
    'mysql_host' => 'localhost',
    'mysql_name' => 'YOUR_DB_NAME',
    'mysql_user' => 'YOUR_DB_USER',
    'mysql_pass' => 'YOUR_DB_PASSWORD',

Without this every card payment is refused with "400 Invalid amount".


CHECK IT
--------
Open  https://www.sporta.com.kw/knet/selftest.php

You want to see:

    orders DB   : MySQL (native backend)
    mysql       : connected, orders table readable (N orders)  OK
    callback    : REDIRECT= token + HTML  OK  (works with either KPG style)

If it says "*** NONE CONFIGURED ***", the five lines above are missing or
the database details are wrong.

DELETE knet/selftest.php when you are done. It reports which credentials
are set and has no business staying on a live server.


ONE QUESTION FOR CBK
--------------------
Ask them: after a payment, does KNET redirect the customer's browser to our
responseURL, or does it call it server-to-server and read a REDIRECT= line
out of the reply?

These files answer BOTH ways, so you are covered either way. Only if CBK
says "browser redirect" may you optionally set, in knet/config.php:

    'callback_response' => 'redirect',


NOT INCLUDED
------------
The admin's new "confirm paid" button for a card the bank took but never
reported. That is part of the website itself — it arrives with the next
full SPORTA-GO-LIVE.zip upload. The payment fixes above do not need it.
`

rmSync(stage, { recursive: true, force: true })
for (const [from, to] of FILES) {
  const src = join(web, from)
  if (!existsSync(src)) {
    console.error(`missing source: ${from}`)
    process.exit(1)
  }
  mkdirSync(dirname(join(stage, to)), { recursive: true })
  cpSync(src, join(stage, to))
}
writeFileSync(join(stage, 'README-FIRST.txt'), README)

// The same refusal make-package.mjs makes. A real config.php in an uploadable
// zip is how live credentials end up somewhere they were never meant to be —
// and one of these files is knet/config.example.php, whose name is one
// deletion away from the real thing.
for (const [, to] of FILES) {
  const body = readFileSync(join(stage, to), 'utf8')
  if (/^﻿/.test(body)) {
    console.error(`${to} starts with a BOM — PHP would emit it before any header`)
    process.exit(1)
  }
}
const staged = execFileSync('find', [stage, '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')
const forbidden = staged.filter((f) => /\/config\.php$/.test(f) || /\.env$/.test(f))
if (forbidden.length) {
  console.error('REFUSING to write the zip — it contains credentials:\n  ' + forbidden.join('\n  '))
  process.exit(1)
}

rmSync(out, { force: true })
execFileSync('zip', ['-qr', out, '.'], { cwd: stage })
const kb = Math.round(execFileSync('stat', ['-c%s', out], { encoding: 'utf8' }).trim() / 1024)
console.log(`\n${out}  (${kb} kB, ${staged.length} files)`)
for (const [, to] of FILES) console.log(`  public_html/${to}`)
