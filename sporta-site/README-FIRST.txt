SPORTA — go live
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
2. THE DATABASE  (hPanel -> Databases -> MySQL Databases)
--------------------------------------------------------------------------------
Create a database and a user, and give that user ALL privileges on it. Write
down the four values -- host (localhost), database name, user, password. Every
part of the site reads the SAME four.

Then hPanel -> Databases -> phpMyAdmin -> Import, and run ONE file:

    database-sql/IMPORT-THIS-ONE.sql

That is the whole database step. It is the four files below joined in the
right order, so there is no order to get wrong.

The parts are still here for a shop that needs only one of them re-run:

    database-sql/1-schema.mysql.sql   the tables
    database-sql/2-seed.mysql.sql     the 46 products and the stock
    database-sql/3-brands.mysql.sql   the brands
    database-sql/4-promo.mysql.sql    home slides, promotions and discounts

Safe to re-run. Re-seeding updates prices and names in place; it never
duplicates a product and never overwrites your stock counts.

--------------------------------------------------------------------------------
3. CONNECT THE SITE TO IT  (3 files, the same 4 values in each)
--------------------------------------------------------------------------------
In File Manager, copy each example to its real name and fill in the four
mysql_ values from step 2:

    public_html/api/config.example.php   ->  api/config.php     <- required
    public_html/knet/config.example.php  ->  knet/config.php    <- see step 4
    public_html/pay/config.example.php   ->  pay/config.php     <- see step 4b

Set each one's permissions to 600.

  !! api/config.php is what makes the shop work at all. Without it the
     catalogue is empty and every checkout is refused.

Then create your admin sign-in: open

    https://www.sporta.com.kw/api/setup-admin.php

and follow it. That is the account you use at
https://www.sporta.com.kw/backends -- DELETE setup-admin.php afterwards.

--------------------------------------------------------------------------------
4. PAYMENT CREDENTIALS  (server-side only — never in config.js)
--------------------------------------------------------------------------------
In File Manager: copy  public_html/knet/config.example.php  to
public_html/knet/config.php , fill in the five values, set permissions to 600.

Then open  https://www.sporta.com.kw/knet/selftest.php  in a browser. It checks
the two mistakes that fail silently and cost money:
  - a resource key that is not exactly 16 bytes (a stray space breaks every
    transaction with no useful error)
  - an orders database that is not actually reachable (without it the server
    has no authority over the price and every card payment is refused)

When every line reads OK, DELETE these two files from the server:
    public_html/knet/selftest.php
    public_html/knet/setup-config.php

--------------------------------------------------------------------------------
4b. T-PAY  (optional — CBK's online payment link)
--------------------------------------------------------------------------------
T-Pay runs on a DIFFERENT CBK product from the KNET endpoints above, with
DIFFERENT credentials. It cannot work through knet/.

  1. Copy  public_html/pay/config.example.php  to  public_html/pay/config.php
  2. Fill in what CBK sends on activation:
       test_base / production_base  (the gateway hosts)
       client_id, client_secret, encrp_key
       the four mysql_ values   (the same ones as api/config.php)
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
4d. THE TWO CRON JOBS  (hPanel -> Advanced -> Cron Jobs)  -- NOT optional
--------------------------------------------------------------------------------
The shop works without these in the sense that pages load and orders are
taken. It does not work in the sense that matters:

  WITHOUT cron-fulfilment.php  no order email ever reaches the warehouse.
     Orders pile up in the database and nobody packs them. The message is
     written the moment the order is, so nothing is lost -- it just sits
     there until this runs.

  WITHOUT cron-stock.php  stock reserved by an abandoned checkout is never
     put back. Every shopper who opens the bank page and closes it takes
     that size off the shelf permanently, and the shop slowly sells out of
     things it has in the stockroom.

Add both, replacing YOUR_CRON_KEY with the cron_key from api/config.php:

  every 5 minutes:
    wget -qO- "https://www.sporta.com.kw/api/cron-fulfilment.php?key=YOUR_CRON_KEY"

  every 15 minutes:
    wget -qO- "https://www.sporta.com.kw/api/cron-stock.php?key=YOUR_CRON_KEY"

  every 5 minutes, IF سبورتا AI hands off to n8n:
    wget -qO- "https://www.sporta.com.kw/api/cron-assistant.php?key=YOUR_CRON_KEY"

     Without it the assistant still answers, and every question it CANNOT
     answer still lands in assistant_outbox where /backends -> Sporta AI shows
     it -- so nobody is lost. What stops is the automatic hand-off to n8n:
     the queue simply fills up and waits.

The warehouse mail also needs the SPF, DKIM and DMARC records from
DNS-EMAIL-RECORDS.txt published on the domain, or it is delivered to spam --
which looks exactly like the cron not running.

There are two more cron files in api/ (cron-voice.php, cron-whatsapp.php).
Both are optional and only do anything once their features are configured.

--------------------------------------------------------------------------------
5. CHECK — open this in a browser
--------------------------------------------------------------------------------

    https://www.sporta.com.kw/go-live.html

It tests every step above for real: the /api backend, the products table, the
checkout endpoint, .htaccess, private files, the payment endpoint, sitemap and
manifest. Each failure names the exact file to fix.

When it says "Sporta is live and can take orders", make one real 0.100 KWD
test payment, then confirm that order shows as PAID in the admin -- a green
result page only proves the redirect worked; only the order row proves the
money was recorded.

Then delete these files from the server. Each one is reachable by anyone
who knows the name, and none of them has any business on a live shop:

    public_html/go-live.html
    public_html/knet/selftest.php
    public_html/knet/setup-config.php
    public_html/api/setup-admin.php     <- creates the admin account
    public_html/api/reset-admin.php     <- CHANGES the admin password
    public_html/api/preflight.php       <- reports your configuration

  !! reset-admin.php is the one to be strict about. Its only authority is the
     cron_key from api/config.php, so for as long as it sits there, anybody
     who can read that file can take the admin account. It exists for the day
     you lose the password or the phone holding your two-factor codes --
     upload it again then, use it, delete it again.

--------------------------------------------------------------------------------
sporta-mac-check.sh  tests your own Mac and this server from Terminal:
    bash sporta-mac-check.sh
Optional. It never asks for a password and changes nothing.
================================================================================
