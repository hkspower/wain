// Builds SPORTA-GO-LIVE.zip — everything needed to run the store, uploadable
// through a browser file manager with no Node, no terminal and no rebuild.
//
// This exists because the previous package was assembled by hand and went
// stale: it sat in the repo carrying a callback.php that wrote the wrong
// column names, so it would have deployed a store that lost every payment.
// A package you cannot regenerate is a package you cannot trust.
//
//   node scripts/make-package.mjs
//
// Deliberately NOT included: knet/config.php (live bank credentials) and any
// .env. Credentials are entered on the server, never shipped.

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = join(dirname(fileURLToPath(import.meta.url)), '..')
const root = join(web, '..')
const out = join(root, 'SPORTA-GO-LIVE.zip')
const stage = join(root, '.package-stage')

// ---- 1. a fresh production build --------------------------------------------
// No VITE_ variables on purpose: the package configures itself at runtime from
// config.js. Baking in this machine's values would ship the wrong project.
console.log('building…')
execFileSync('npm', ['run', 'release'], { cwd: web, stdio: 'inherit', env: { ...process.env, VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', VITE_PAY_BASE_URL: '' } })

rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'public_html'), { recursive: true })

// ---- 2. the site + PHP endpoints --------------------------------------------
cpSync(join(web, 'dist'), join(stage, 'public_html'), { recursive: true })

// npm run release bundles the PHP into dist/knet already; make sure the two
// files that must never ship are absent even if something upstream changes.
for (const forbidden of ['knet/config.php', '.env', '.env.deploy']) {
  const p = join(stage, 'public_html', forbidden)
  if (existsSync(p)) { rmSync(p); console.log(`removed ${forbidden} from the package`) }
}

// ---- 3. the SQL, so the database can be set up without the repo -------------
mkdirSync(join(stage, 'supabase-sql'), { recursive: true })
const ORDER = ['schema', 'admin-migration', 'checkout-migration', 'passcode-migration', 'seed-products']
ORDER.forEach((name, i) => {
  cpSync(join(web, 'supabase', `${name}.sql`), join(stage, 'supabase-sql', `${i + 1}-${name}.sql`))
})

// The Mac-side checker travels with the package so there is one thing to keep,
// not two.
cpSync(join(web, 'scripts', 'mac-check.sh'), join(stage, 'sporta-mac-check.sh'))

// The sporta-html5 fallback is deliberately NOT packaged. It is a second copy
// of the store that nobody is meant to upload, it carried its own build output
// as well as its source (1.1 MB of the package for something the README told
// you to ignore), and a folder full of .html files sitting next to the real
// site is an invitation to upload the wrong one. It still lives in the repo.

// ---- 5. instructions ---------------------------------------------------------
writeFileSync(join(stage, 'README-FIRST.txt'), `SPORTA — go live
================================================================================
Everything here is uploaded through hPanel -> File Manager. No Node, no npm,
no SSH, no terminal.

--------------------------------------------------------------------------------
1. UPLOAD
--------------------------------------------------------------------------------
Upload EVERYTHING inside this zip's  public_html/  folder into your server's
public_html/ folder.

  !! .htaccess is a HIDDEN file. Turn on "show hidden files" in File Manager
     and confirm it arrived — twice: once in public_html/ and once in
     public_html/knet/. Without it: no HTTPS redirect, no security headers,
     and /shop shows "404 Not Found".

--------------------------------------------------------------------------------
2. SET YOUR SUPABASE KEYS  (2 lines — the site will not sell anything until you do)
--------------------------------------------------------------------------------
In File Manager, open  public_html/config.js  and replace the two placeholders.
Get both from Supabase -> Project Settings -> API:

    supabaseUrl      = Project URL
    supabaseAnonKey  = the "anon" / "public" key      <- NOT the service key

Save. Reload the site. That is the whole configuration step.

--------------------------------------------------------------------------------
3. DATABASE  (Supabase -> SQL Editor)
--------------------------------------------------------------------------------
Open the  supabase-sql/  folder in this zip and run the five files IN ORDER,
pasting each into the Supabase SQL Editor:

    1-schema.sql
    2-admin-migration.sql
    3-checkout-migration.sql
    4-passcode-migration.sql
    5-seed-products.sql

All five are safe to re-run. Until 3 and 5 have run, every checkout is refused.

--------------------------------------------------------------------------------
4. PAYMENT CREDENTIALS  (server-side only — never in config.js)
--------------------------------------------------------------------------------
In File Manager: copy  public_html/knet/config.example.php  to
public_html/knet/config.php , fill in the five values, set permissions to 600.

Then open  https://www.sporta.com.kw/knet/selftest.php  in a browser. It checks
the two mistakes that fail silently and cost money:
  - a resource key that is not exactly 16 bytes (a stray space breaks every
    transaction with no useful error)
  - the Supabase SERVICE key vs the anon key pasted in the wrong place

When every line reads OK, DELETE these two files from the server:
    public_html/knet/selftest.php
    public_html/knet/setup-config.php

--------------------------------------------------------------------------------
5. CHECK — open this in a browser
--------------------------------------------------------------------------------

    https://www.sporta.com.kw/go-live.html

It tests every step above for real: config.js, Supabase, the products table,
the checkout function, the admin passcode, .htaccess, the payment endpoint,
sitemap and manifest. Each failure names the exact file to fix.

When it says "Sporta is live and can take orders", make one real 0.100 KWD
test payment, then confirm that order shows as PAID in the admin -- a green
result page only proves the redirect worked; only the order row proves the
money was recorded.

Then delete these three files from the server:
    public_html/go-live.html
    public_html/knet/selftest.php
    public_html/knet/setup-config.php

--------------------------------------------------------------------------------
sporta-mac-check.sh  tests your own Mac and this server from Terminal:
    bash sporta-mac-check.sh
Optional. It never asks for a password and changes nothing.
================================================================================
`)

// ---- 6. zip ------------------------------------------------------------------
rmSync(out, { force: true })
execFileSync('zip', ['-qr', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })

const size = (statSync(out).size / 1048576).toFixed(1)
console.log(`\n${out}  (${size} MB)`)
