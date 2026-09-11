# Sporta's Apple Wallet cards

Three kinds, one builder, one certificate:

```
node scripts/make-wallet-pass.mjs --type loyalty  --serial SP-000123 --name "نورة" --points 240
node scripts/make-wallet-pass.mjs --type coupon   --code SUMMER24 --percent 15 --ends 2026-09-01
node scripts/make-wallet-pass.mjs --type giftcard --serial GC-000045 --balance 25.000 --from "أحمد"
node scripts/wallet-test.mjs wallet/SP-000123.pkpass
```

| Kind | Wallet style | What it is |
|---|---|---|
| `loyalty` | `storeCard` | Points, tier, member name. The card kept at the front |
| `coupon` | `coupon` | One discount code, its value and its end date |
| `giftcard` | `generic` | A balance that falls rather than grows |

**The coupon's fields are a row from the `discounts` table** — the same code,
value and end date the promotions manager in `/backends` edits. A coupon sitting
in a customer's Wallet that the shop's own rules do not recognise is worse than
no coupon at all, so it is issued from the rule rather than typed twice.

Gift cards are `generic`, not `storeCard`, deliberately: Wallet's store card is
built around a loyalty balance that grows, and a gift card's only falls.

**One Pass Type ID for all three.** Apple allows a single identifier to carry
every style, and each additional one needs its own certificate — its own CSR,
export and yearly renewal. Three certificates to distinguish a coupon from a
loyalty card is a year of administrative work for nothing a customer sees.

## What is built here, and what only you can do

The builder produces a complete `.pkpass` — `pass.json`, the eight images at
Apple's exact sizes, and a `manifest.json` of SHA-1 hashes — and then signs it,
**if the certificate is present**. It is not, and cannot be: a pass is signed
with a Pass Type ID certificate issued to your Apple Developer account, and iOS
refuses an unsigned or wrongly-signed pass outright with no way to override it.

Without the certificate the script writes everything except the signature and
names what is missing. That is the honest state: the card is designed, built and
checked; it cannot be installed on a phone until it carries your identity.

## Getting the three files

You need an **Apple Developer Program** membership (99 USD/year).

1. **Pass Type ID** — developer.apple.com → Certificates, Identifiers & Profiles
   → Identifiers → **+** → Pass Type IDs. Name it `pass.kw.com.sporta.card` — one identifier serves all three kinds.
2. **The certificate** — on that identifier, Create Certificate. It asks for a
   Certificate Signing Request, which you make on a Mac in Keychain Access
   (Certificate Assistant → Request a Certificate From a Certificate
   Authority). Download the `.cer`, open it, then export it from Keychain as a
   `.p12` **with the private key**.
3. **Apple's intermediate** — the *Worldwide Developer Relations* certificate,
   from developer.apple.com/certificationauthority/AppleWWDRCA.cer

Convert them once:

```
openssl pkcs12 -in Certificates.p12 -clcerts -nokeys -out wallet/certs/pass.pem
openssl pkcs12 -in Certificates.p12 -nocerts -nodes -out wallet/certs/pass.key
openssl x509  -inform DER -in AppleWWDRCA.cer -out wallet/certs/wwdr.pem
```

Then set your team id — the ten characters at the top right of the developer
site:

```
WALLET_TEAM_ID=ABCDE12345 node scripts/make-wallet-pass.mjs --serial SP-000123
```

`wallet/certs/` is git-ignored. **It is the shop's identity to Apple**; anyone
holding it can issue passes in Sporta's name.

## Serving it — `api/wallet.php`

```
/api/wallet.php?r=loyalty&phone=96555512345&track=SP1A2B3C
/api/wallet.php?r=coupon&code=SUMMER24
```

Both answer with a signed `.pkpass`, `Content-Type:
application/vnd.apple.pkpass`, as an attachment and `no-store`. The app opens
the URL in the system browser rather than fetching it, so iOS can hand the
response to Wallet.

**One serial per customer, for ever** — `wallet_passes`, keyed by phone, which
is what the shop already identifies people by. Minting a serial per request
would give a customer who re-added their card two cards with two histories and
a shop assistant no way to tell which is real.

**Points are derived, not stored.** They are computed from that phone's paid
orders at the moment the pass is built — one point per 100 fils — so the number
on the card cannot drift from what was actually spent.

**Identity, and its limit.** A loyalty pass carries a name and a balance, so
issuing one on a phone number alone would let anyone mint a card for anyone
whose number they know. The first issue therefore also wants the `track_id` of
one of that phone's own orders. It is deliberately not a login: the shop has no
customer accounts, and inventing them to protect a points balance would be much
larger than the thing protected.

**The coupon route reads the `discounts` table** and refuses a code that is
inactive (404) or used up (410). A coupon in a Wallet that the checkout will
refuse is worse than none — the customer finds out at the till.

Certificates live **outside the web root**, next to `config.php`:

```php
'wallet_team_id'  => 'ABCDE12345',
'wallet_cert_dir' => '/home/uXXXXXX/wallet-certs',
```

Without them the endpoint answers **503 with a hint**, not a broken file.

Rebuild the pass images after a logo change:

```
node scripts/wallet-assets.mjs
```

## Keeping points up to date

A pass with a points balance that never changes is a pass people delete. Wallet
updates them through a **web service**: `webServiceURL` and
`authenticationToken` in `pass.json`, four endpoints on the server, and an APNs
push when a balance changes. None of that is built. Until it is, the card is
correct at the moment it is issued and static afterwards — which is worth
knowing before it is handed to customers rather than after.

## What the tests cover

`scripts/wallet-test.mjs` asserts what Wallet enforces silently — it never
explains a refusal, the pass just does not open:

- the required files are present, and **at the root of the zip**, not in a
  folder, which is the commonest reason a hand-built pass fails;
- **exactly one style key** — a pass carrying both `storeCard` and `coupon` is
  rejected by Wallet and one carrying neither has no layout at all, and both
  look like perfectly good files from outside the phone;
- `formatVersion`, the `pass.` prefix, a ten-character team id, a description
  (VoiceOver reads it), and colours as `rgb()` rather than hex;
- the barcode carries the serial the till scans;
- every file is in the manifest, every manifest entry exists, and **every hash
  matches its file** — verified by tampering with one and watching it fail;
- the signature is a well-formed detached PKCS#7 over that manifest.
