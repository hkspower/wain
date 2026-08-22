# The Sporta loyalty card, in Apple Wallet

```
node scripts/make-wallet-pass.mjs --serial SP-000123 --name "نورة" --points 240
node scripts/wallet-test.mjs wallet/SP-000123.pkpass
```

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
   → Identifiers → **+** → Pass Type IDs. Name it `pass.kw.com.sporta.loyalty`.
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

## Serving it

The app's Account screen links to `{apiBase}/wallet.php?r=pass`, opened in the
system browser rather than fetched — iOS recognises the response and hands it to
Wallet itself. That endpoint does not exist yet; it needs to:

- identify the customer, and issue **one serial per customer**, stored;
- return the bytes with `Content-Type: application/vnd.apple.pkpass`;
- send `Content-Disposition: attachment; filename="sporta.pkpass"`.

The signing step is the same three OpenSSL inputs, so the certificate has to
live on the server, outside the web root, alongside `api/config.php`.

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
- `formatVersion`, the `pass.` prefix, a ten-character team id, a description
  (VoiceOver reads it), and colours as `rgb()` rather than hex;
- the barcode carries the serial the till scans;
- every file is in the manifest, every manifest entry exists, and **every hash
  matches its file** — verified by tampering with one and watching it fail;
- the signature is a well-formed detached PKCS#7 over that manifest.
