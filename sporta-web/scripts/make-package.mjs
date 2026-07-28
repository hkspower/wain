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
// SETUP-ALL.sql first, because running the five separately in the wrong order
// is the most common way this setup fails — and it fails quietly, leaving a
// storefront that renders and a checkout that refuses everything.
execFileSync('node', [join(web, 'scripts', 'generate-setup-sql.mjs')], { stdio: 'inherit' })
cpSync(join(web, 'supabase', 'SETUP-ALL.sql'), join(stage, 'supabase-sql', 'SETUP-ALL.sql'))
const ORDER = ['schema', 'admin-migration', 'checkout-migration', 'passcode-migration',
               'payment-method-migration', 'seed-products']
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

  !! DELETE these from public_html/ if they are there. Uploading does not
     remove them, and each one is readable by anyone on the internet:

         .env                    <- if present, ROTATE every key in it
         .DS_Store               <- lists your folder contents
         .deploy-manifest.json
         .git/  (whole folder)   <- the entire source, reconstructible
         _headers                <- Netlify file, does nothing on Apache
         config-dist.php

     The .htaccess in this package blocks all of them, so once it is uploaded
     they are 403 rather than downloadable — but delete them anyway. Step 5
     checks each one for real and names any that are still readable.

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
Open  supabase-sql/SETUP-ALL.sql  , paste ALL of it into the Supabase SQL
Editor, and press Run. That is the whole database step.

It ends by printing a report. Read it:

    products_on_sale    46    the catalogue
    checkout_function    1    0 means every checkout fails
    passcode_function    1    0 means admin quick-unlock cannot work
    admin_users          1+   0 means NOBODY CAN SIGN IN to /admin

If admin_users is 0, go to Authentication -> Users -> Add user. Any email
works; it does not need to be a real inbox. That is the account you use at
https://www.sporta.com.kw/admin

Safe to run again whenever the catalogue changes.

(The same five migrations are also in that folder numbered 1-5, if you would
rather run them one at a time. They MUST go in that order.)

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
4b. T-PAY  (optional — only if you want the QR payment method)
--------------------------------------------------------------------------------
T-Pay runs on a DIFFERENT CBK product from the KNET endpoints above, with
DIFFERENT credentials. It cannot work through knet/.

  1. Copy  public_html/pay/config.example.php  to  public_html/pay/config.php
  2. Fill in what CBK sends on activation:
       test_base / production_base  (the gateway hosts)
       client_id, client_secret, encrp_key
       supabase_url + supabase SERVICE key   (same pair as knet/config.php)
  3. Set its permissions to 600
  4. Tell CBK your return URL:  https://www.sporta.com.kw/pay/callback.php
     and give them your server IP if they filter by it (max 2)
  5. Leave 'env' => 'test' until a test payment works, then switch to production

Until that file exists, choosing T-Pay at checkout records the order and then
fails at the gateway. If you are not using T-Pay, nothing to do — KNET and cash
work without it.

--------------------------------------------------------------------------------
4c. CATEGORY PHOTOS  (optional — 4 files, no rebuild needed)
--------------------------------------------------------------------------------
The four category tiles on the home page (Men, Women, Accessories, Sporta
Outlet) ship with designed artwork (the cats/art-*.jpg files) and will swap to
a real photo the moment one exists on the server. Nothing looks broken if you
skip this — but your real photography always wins.

In File Manager, create  public_html/cats/  and upload exactly these names,
all lowercase, .jpg:

    cats/men.jpg
    cats/women.jpg
    cats/accessories.jpg
    cats/outlet.jpg

  - Landscape, around 1600x1000. Bigger is wasted; smaller looks soft.
  - The subject should sit in the MIDDLE of the frame. The tile crops to fill,
    so anything near an edge gets cut.
  - Any brightness works. The title sits over a dark scrim, so a bright studio
    shot stays readable.
  - Keep each one under about 300 kB or the home page gets slow on mobile data.

Reload the page and they appear. No rebuild, no redeploy — same as config.js.
To go back to the artwork, delete the file again.

  !! Lowercase names matter. The server is Linux: Men.jpg is a different file
     from men.jpg and will not be found.

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

// ---- 6. audit the staged tree, and refuse to zip a broken one ----------------
// The zip IS the deliverable — the user drags it into File Manager and that is
// the site. Auditing after packaging would be too late, so it happens here,
// against the exact bytes about to be sealed in.
try {
  execFileSync('node', [new URL('file-audit.mjs', import.meta.url).pathname,
                        join(stage, 'public_html')], { stdio: 'inherit' })
} catch {
  console.error('\nfile audit failed — package NOT written')
  process.exit(1)
}

// ---- 7. zip ------------------------------------------------------------------
rmSync(out, { force: true })
execFileSync('zip', ['-qr', out, '.'], { cwd: stage })
rmSync(stage, { recursive: true, force: true })

const size = (statSync(out).size / 1048576).toFixed(1)
console.log(`\n${out}  (${size} MB)`)
