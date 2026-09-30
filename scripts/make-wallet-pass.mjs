/**
 * Builds Sporta's Apple Wallet passes.
 *
 *   node scripts/make-wallet-pass.mjs --type loyalty  --serial SP-000123 --name "…" --points 240
 *   node scripts/make-wallet-pass.mjs --type coupon   --code SUMMER24 --percent 15 --ends 2026-09-01
 *   node scripts/make-wallet-pass.mjs --type giftcard --serial GC-000045 --balance 25.000
 *
 * THREE KINDS, ONE BUNDLE FORMAT. Wallet distinguishes them by which key
 * pass.json carries — storeCard, coupon or generic — and by little else; the
 * images, the manifest and the signature are identical work. So the difference
 * between them lives in one function and nothing else in this file knows there
 * is more than one.
 *
 * WHAT THIS CAN AND CANNOT DO
 *
 * It produces a complete .pkpass EXCEPT the signature, which no machine but
 * yours can make. A pass is signed with a Pass Type ID certificate issued to
 * your Apple Developer account; iOS refuses an unsigned or wrongly-signed pass
 * outright, with no way to override it. So this writes the bundle, checks it,
 * and either signs it — if the certificate files are present — or stops and
 * says exactly which one is missing and how to get it. See WALLET.md.
 *
 * Everything else IS checked here: the images are generated at the sizes Apple
 * requires, the manifest is the real SHA-1 of every file, and pass.json is
 * validated against the rules Wallet enforces before the zip is written.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : fallback
}

// From your Apple Developer account. Both are on the pass, both are checked by
// iOS against the certificate, and a mismatch is one of the two reasons a pass
// that looks perfect refuses to open.
// ONE identifier for all three kinds, not three. Apple allows a single Pass
// Type ID to carry every pass style, and each additional identifier needs its
// own certificate — its own CSR, its own export, its own renewal every year.
// Three certificates to distinguish a loyalty card from a coupon is a year of
// small administrative pain for nothing the customer can see.
const PASS_TYPE_ID = process.env.WALLET_PASS_TYPE_ID ?? 'pass.kw.com.sporta.card'
const TEAM_ID = process.env.WALLET_TEAM_ID ?? 'TEAMIDXXXX'

const CERTS = {
  cert: process.env.WALLET_CERT ?? 'wallet/certs/pass.pem',
  key: process.env.WALLET_KEY ?? 'wallet/certs/pass.key',
  wwdr: process.env.WALLET_WWDR ?? 'wallet/certs/wwdr.pem',
  password: process.env.WALLET_KEY_PASSWORD ?? '',
}

const OUT_ARG = arg('--out', null)
const WORK = 'wallet/.build'

// ---------------------------------------------------------------- pass.json
const type = arg('--type', 'loyalty')
const KINDS = ['loyalty', 'coupon', 'giftcard']
if (!KINDS.includes(type)) {
  console.error(`--type must be one of: ${KINDS.join(', ')}`)
  process.exit(1)
}

const common = {
  formatVersion: 1,
  passTypeIdentifier: PASS_TYPE_ID,
  teamIdentifier: TEAM_ID,
  organizationName: 'Sporta',
  backgroundColor: 'rgb(43, 49, 56)',
  foregroundColor: 'rgb(255, 255, 255)',
  labelColor: 'rgb(226, 128, 63)',
  logoText: 'SPORTA',
}

/** The QR the till scans. Its message is the only thing the shop needs back. */
const barcode = (message) => [
  { format: 'PKBarcodeFormatQR', message, messageEncoding: 'iso-8859-1', altText: message },
]

const money = (kwd) => `${Number(kwd).toFixed(3)} د.ك`

function buildPass() {
  if (type === 'coupon') {
    // COUPON, and its fields come straight from a row in the discounts table
    // the promotions manager edits — the same code, the same value, the same
    // end date. A coupon in a customer's Wallet that the shop's own rules do
    // not recognise is worse than no coupon at all.
    const code = arg('--code', 'SUMMER24')
    const percent = arg('--percent', null)
    const off = arg('--off', null)
    const ends = arg('--ends', null)
    return {
      ...common,
      description: `Sporta offer ${code}`,
      serialNumber: code,
      barcodes: barcode(code),
      // Wallet moves an expired pass to the back of the stack and greys it,
      // which is exactly what should happen to an offer that has ended.
      ...(ends ? { expirationDate: `${ends}T23:59:59+03:00` } : {}),
      coupon: {
        headerFields: [
          {
            key: 'value',
            label: 'الخصم',
            value: percent ? `${percent}%` : money(off ?? 0),
          },
        ],
        primaryFields: [{ key: 'code', label: 'الكود', value: code }],
        secondaryFields: [
          ...(ends ? [{ key: 'ends', label: 'ينتهي', value: ends }] : []),
          { key: 'where', label: 'أين', value: 'المتجر والتطبيق' },
        ],
        backFields: [
          { key: 'how', label: 'كيف تستخدمه', value: 'أدخل الكود عند إتمام الطلب.' },
          { key: 'terms', label: 'الشروط', value: 'لا يُجمع مع عروض أخرى. الكمية محدودة.' },
          { key: 'shop', label: 'المتجر', value: 'www.sporta.com.kw' },
        ],
      },
    }
  }

  if (type === 'giftcard') {
    // GENERIC, not storeCard. Wallet's storeCard is built around a loyalty
    // balance that grows; a gift card's balance only falls, and generic is the
    // layout that does not imply otherwise.
    const serial = arg('--serial', 'GC-DEMO-0001')
    const balance = arg('--balance', '25.000')
    const from = arg('--from', null)
    return {
      ...common,
      description: 'Sporta gift card',
      serialNumber: serial,
      barcodes: barcode(serial),
      generic: {
        headerFields: [{ key: 'balance', label: 'الرصيد', value: money(balance), changeMessage: 'رصيد بطاقتك الآن %@' }],
        primaryFields: [{ key: 'title', label: 'بطاقة هدية', value: 'سبورتا' }],
        secondaryFields: [
          ...(from ? [{ key: 'from', label: 'من', value: from }] : []),
          { key: 'serial', label: 'رقم البطاقة', value: serial },
        ],
        backFields: [
          { key: 'how', label: 'كيف تستخدمها', value: 'اعرض الرمز عند الدفع، أو أدخل رقم البطاقة في التطبيق.' },
          { key: 'terms', label: 'الشروط', value: 'غير قابلة للاستبدال نقداً ولا تُرد.' },
          { key: 'shop', label: 'المتجر', value: 'www.sporta.com.kw' },
        ],
      },
    }
  }

  // LOYALTY — storeCard, which is the one Wallet keeps at the front with a
  // barcode the till can read.
  const serial = arg('--serial', 'SP-DEMO-0001')
  const holder = arg('--name', 'عميل سبورتا')
  const points = Number(arg('--points', '0'))
  return {
    ...common,
    description: 'Sporta loyalty card',
    serialNumber: serial,
    barcodes: barcode(serial),
    storeCard: {
      headerFields: [
        { key: 'points', label: 'النقاط', value: points, changeMessage: 'رصيدك الآن %@ نقطة' },
      ],
      primaryFields: [{ key: 'holder', label: 'العضو', value: holder }],
      secondaryFields: [
        { key: 'tier', label: 'المستوى', value: points >= 500 ? 'ذهبي' : points >= 200 ? 'فضي' : 'أساسي' },
        { key: 'since', label: 'عضو منذ', value: new Date().getFullYear().toString() },
      ],
      backFields: [
        { key: 'how', label: 'كيف تجمع النقاط', value: 'نقطة واحدة لكل ١٠٠ فلس تنفقها في سبورتا.' },
        { key: 'shop', label: 'المتجر', value: 'www.sporta.com.kw' },
        { key: 'contact', label: 'خدمة العملاء', value: 'cs@sporta.com.kw' },
        { key: 'terms', label: 'الشروط', value: 'النقاط غير قابلة للتحويل ولا تُستبدل نقداً.' },
      ],
    },
  }
}

const pass = buildPass()

// ------------------------------------------------------------------ images
//
// Apple's required sizes. icon is the one Wallet shows in notifications and on
// the lock screen; without it the pass is rejected before anything else is
// looked at.
const IMAGES = [
  { name: 'icon.png', w: 29, h: 29, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'icon@2x.png', w: 58, h: 58, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'icon@3x.png', w: 87, h: 87, source: 'favicon.png', fit: 'contain', bg: '#2b3138' },
  { name: 'logo.png', w: 160, h: 50, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@2x.png', w: 320, h: 100, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'logo@3x.png', w: 480, h: 150, source: 'logo-white.png', fit: 'contain', bg: 'transparent' },
  { name: 'strip.png', w: 375, h: 123, source: 'og-image.png', fit: 'cover', bg: '#2b3138' },
  { name: 'strip@2x.png', w: 750, h: 246, source: 'og-image.png', fit: 'cover', bg: '#2b3138' },
]

async function renderImages(dir) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await b.newPage()
  for (const img of IMAGES) {
    const src = `data:image/png;base64,${readFileSync(join('sporta-site/public_html', img.source)).toString('base64')}`
    const data = await page.evaluate(
      async ({ src, w, h, fit, bg }) => {
        const image = new Image()
        image.src = src
        await image.decode()
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (bg !== 'transparent') {
          ctx.fillStyle = bg
          ctx.fillRect(0, 0, w, h)
        }
        // contain keeps the whole mark inside the box; cover fills it. A logo
        // cropped by a millimetre is a logo nobody signed off.
        const scale =
          fit === 'cover'
            ? Math.max(w / image.width, h / image.height)
            : Math.min(w / image.width, h / image.height)
        const dw = image.width * scale
        const dh = image.height * scale
        ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
        return c.toDataURL('image/png')
      },
      { src, w: img.w, h: img.h, fit: img.fit, bg: img.bg },
    )
    writeFileSync(join(dir, img.name), Buffer.from(data.split(',')[1], 'base64'))
  }
  await b.close()
}

// ------------------------------------------------------------- validation
//
// The rules Wallet enforces silently: it does not explain a refusal, it simply
// does not open the pass. Checking them here is the difference between a
// two-minute fix and an afternoon.
function validate(p) {
  const problems = []
  if (p.formatVersion !== 1) problems.push('formatVersion must be 1')
  if (!/^pass\./.test(p.passTypeIdentifier))
    problems.push(`passTypeIdentifier must begin with "pass." — got ${p.passTypeIdentifier}`)
  if (!/^[A-Z0-9]{10}$/.test(p.teamIdentifier))
    problems.push(`teamIdentifier must be the 10-character Apple team id — got ${p.teamIdentifier}`)
  if (!p.serialNumber) problems.push('serialNumber is required')
  if (!p.description) problems.push('description is required — VoiceOver reads it')
  if (!p.organizationName) problems.push('organizationName is required')
  for (const c of ['backgroundColor', 'foregroundColor', 'labelColor'])
    if (p[c] && !/^rgb\(\d+, ?\d+, ?\d+\)$/.test(p[c]))
      problems.push(`${c} must be rgb(r, g, b) — hex is not accepted`)
  // EXACTLY ONE style key. A pass carrying both storeCard and coupon is
  // rejected, and a pass carrying neither has no layout at all — both look
  // like a perfectly good file from outside.
  const styles = ['storeCard', 'coupon', 'generic', 'eventTicket', 'boardingPass'].filter((k) => k in p)
  if (styles.length !== 1) problems.push(`exactly one style key is required — found ${styles.length ? styles.join(', ') : 'none'}`)
  const fields = p[styles[0]]?.headerFields ?? []
  if (fields.length > 3) problems.push('a pass may carry at most 3 header fields')
  if (p.expirationDate && !/^\d{4}-\d{2}-\d{2}T/.test(p.expirationDate))
    problems.push('expirationDate must be a W3C date-time, e.g. 2026-09-01T23:59:59+03:00')
  return problems
}

// ------------------------------------------------------------------- build
const OUT = OUT_ARG ?? `wallet/${pass.serialNumber}.pkpass`

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

const problems = validate(pass)
if (problems.length) {
  console.error('pass.json is not valid:')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

writeFileSync(join(WORK, 'pass.json'), JSON.stringify(pass, null, 2))
await renderImages(WORK)

// manifest.json: SHA-1 of every file in the bundle. Apple still specifies
// SHA-1 here — it is an integrity check inside a signed envelope, not a
// security boundary of its own.
const files = ['pass.json', ...IMAGES.map((i) => i.name)]
const manifest = Object.fromEntries(
  files.map((f) => [f, createHash('sha1').update(readFileSync(join(WORK, f))).digest('hex')]),
)
writeFileSync(join(WORK, 'manifest.json'), JSON.stringify(manifest, null, 2))

// signature: PKCS#7, detached, over manifest.json.
const haveCerts = existsSync(CERTS.cert) && existsSync(CERTS.key) && existsSync(CERTS.wwdr)
if (haveCerts) {
  execFileSync('openssl', [
    'smime', '-binary', '-sign',
    '-certfile', CERTS.wwdr,
    '-signer', CERTS.cert,
    '-inkey', CERTS.key,
    '-in', join(WORK, 'manifest.json'),
    '-out', join(WORK, 'signature'),
    '-outform', 'DER',
    ...(CERTS.password ? ['-passin', `pass:${CERTS.password}`] : []),
  ])
  files.push('manifest.json', 'signature')
  execFileSync('zip', ['-q', '-j', '-X', `../../${OUT}`, ...files], { cwd: WORK })
  console.log(`\n${OUT} — signed and ready to install`)
} else {
  files.push('manifest.json')
  execFileSync('zip', ['-q', '-j', '-X', `../../${OUT.replace(/\.pkpass$/, '-UNSIGNED.zip')}`, ...files], { cwd: WORK })
  console.log(`\n${OUT.replace(/\.pkpass$/, '-UNSIGNED.zip')} — everything but the signature`)
  console.log('\nMissing:')
  for (const [k, v] of Object.entries(CERTS))
    if (k !== 'password' && !existsSync(v)) console.log(`  ${k.padEnd(5)} ${v}`)
  console.log('\niOS will refuse this until it is signed. See WALLET.md.')
}

console.log(`\nbundle: ${files.length} files`)
for (const f of files) console.log(`  ${f.padEnd(16)} ${manifest[f] ? manifest[f].slice(0, 12) : '(signature)'}`)
