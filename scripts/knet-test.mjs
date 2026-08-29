/**
 * KNET: which of the two integrations this shop is on, and that both work.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/knet-test.mjs
 *
 * THERE ARE TWO WAYS TO TAKE A KNET PAYMENT and this shop is nominated for the
 * second one:
 *
 *   LEGACY TRANPORTAL   a Tranportal ID, a Tranportal password and a 16-byte
 *                       Terminal Resource Key; an AES-128-CBC `trandata` blob;
 *                       the shopper posted to kpay.com.kw/kpg. knet/ implements
 *                       it in full.
 *   THE OFFICIAL CBK    client_id + client_secret + encrp_key from the
 *   HOSTED PAGE         activation email; an AccessToken; the shopper posted to
 *                       pg.cbk.com with `tij_MerchPayType=1`. pay/ implements
 *                       it in full and has been taking T-Pay money through it.
 *
 * They are the same gateway and the same merchant account — pay/cbk.php calls
 * itself "CBK Hosted KNET & T-Pay" and pay/config.example.php spells the
 * parameter out: "'1' = KNET only, '2' = T-Pay QR only". KNET was never
 * missing from this shop. It was one parameter away, behind pay/, while
 * knet/config.example.php waited on credentials with three unanswered
 * questions attached to them.
 *
 * WHAT THIS RIG IS FOR. knet_mode() decides between the two, and the decision
 * is the dangerous part: get it wrong in the safe direction and a shop keeps a
 * dropin that works; get it wrong in the other and a shop with real Tranportal
 * credentials is moved off a live integration. So the decision table is
 * asserted case by case, and then BOTH routes are driven over HTTP.
 *
 * IT EDITS knet/config.php TO DO THAT, and it will not run unless that file is
 * the sandbox's own — the word SANDBOX has to be in it. A real config.php holds
 * bank credentials and is never a thing to rewrite from a test. The original is
 * restored in a finally block and the restoration is itself asserted at the
 * end, because a rig that leaves the sandbox unable to take a payment has done
 * more damage than the bug it was looking for.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('../sporta-site/public_html/', import.meta.url).pathname
const CFG = ROOT + 'knet/config.php'

let fails = 0
const check = (ok, what, extra = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${!ok && extra ? ` — ${extra}` : ''}`)
  return ok
}

// Every request says X-Forwarded-Proto: https. Both dropins refuse plain HTTP
// outright — correctly — and the sandbox has no TLS, so without this header
// every single one of these is a 403 and the rig proves nothing.
const curl = (path, args = []) =>
  execFileSync('curl', ['-s', '-H', 'X-Forwarded-Proto: https', ...args, BASE + path],
    { encoding: 'utf8' })
const head = (path) => {
  const out = curl(path, ['-o', '/dev/null', '-w', '%{http_code} %{redirect_url}'])
  const [status, ...rest] = out.trim().split(' ')
  return { status: +status, location: rest.join(' ') }
}

// ===================================================== the decision, in isolation
console.log('--- which integration, and why')
{
  // A LEGACY BLOCK COUNTS ONLY IF IT COULD TAKE A PAYMENT. The 16-byte case is
  // the one worth having: AES-128 needs exactly 16, knet_assert_key() throws on
  // anything else, so a key of the wrong length is a dropin that answers every
  // shopper "Payment init failed". Reading that as "configured" would pin a
  // shop to an integration that cannot complete one transaction.
  const table = JSON.parse(execFileSync('php', ['-r', `
    require "${ROOT}knet/knet.php";
    $ok = ["tranportal_id"=>"T","tranportal_password"=>"P","resource_key"=>"1234567890123456"];
    $out = [
      "a filled-in Tranportal block"       => knet_mode($ok),
      "an empty one"                       => knet_mode(["tranportal_id"=>"","tranportal_password"=>"","resource_key"=>""]),
      "the example's placeholders"         => knet_mode(["tranportal_id"=>"YOUR_TRANPORTAL_ID","tranportal_password"=>"YOUR_TRANPORTAL_PASSWORD","resource_key"=>"YOUR_TERMINAL_RESOURCE_KEY"]),
      "a key AES-128 cannot use"           => knet_mode(array_merge($ok, ["resource_key"=>"tooshort"])),
      "mode pinned to official"            => knet_mode(array_merge($ok, ["mode"=>"official"])),
      "mode pinned to legacy, block empty" => knet_mode(["tranportal_id"=>"","mode"=>"legacy"]),
    ];
    echo json_encode($out);
  `], { encoding: 'utf8' }))

  const want = {
    // The safe direction: a shop that HOLDS Tranportal credentials keeps the
    // integration it is running. This is the case that must never flip.
    'a filled-in Tranportal block': 'legacy',
    'an empty one': 'official',
    "the example's placeholders": 'official',
    'a key AES-128 cannot use': 'official',
    'mode pinned to official': 'official',
    'mode pinned to legacy, block empty': 'legacy',
  }
  for (const [name, expect] of Object.entries(want)) {
    check(table[name] === expect, `${name} -> ${expect}`, `got ${table[name]}`)
  }
}

// A track id to drive the real thing with. Unpaid, or pay.php quite rightly
// refuses to charge it twice.
const db = (q) => execFileSync('mariadb',
  ['-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e', q], { encoding: 'utf8' }).trim()
const TRACK = db(`select track_id from orders
                    where payment_method='knet' and payment_status='pending'
                    order by id desc limit 1`)
if (!TRACK) {
  console.log('\nno unpaid KNET order in the sandbox — run scripts/checkout-test.mjs first')
  process.exit(1)
}

const original = readFileSync(CFG, 'utf8')
if (!original.includes('SANDBOX')) {
  console.log(`\nrefusing to run: ${CFG} is not the sandbox's config.`)
  console.log('This rig rewrites that file, and a real one holds bank credentials.')
  process.exit(1)
}

// Rewrite the legacy block through PHP rather than by hand, so what is written
// back is whatever the file actually evaluates to and not a guess at its shape.
const setLegacy = (on) => execFileSync('php', ['-r', `
  $c = require "${CFG}";
  foreach (["tranportal_id","tranportal_password","resource_key"] as $k) {
    $c[$k] = ${on ? '$c[$k] ?: "SANDBOX"' : '""'};
  }
  ${on ? '$c["resource_key"] = "SANDBOX_NOT_REAL";' : ''}
  file_put_contents("${CFG}", "<?php\\nreturn " . var_export($c, true) . ";\\n");
`])

try {
  // ================================================== the shop's own KNET link
  console.log('\n--- the door')
  {
    // EVERYTHING HERE DEPENDS ON THIS URL NOT MOVING. The website's compiled
    // bundle builds `/knet/pay.php?trackid=…` itself and this repo does not
    // hold its source, so /knet/pay.php has to stay the KNET door whichever
    // integration is behind it. That is why the official route is a redirect
    // from this path rather than a new link nobody can be made to use.
    const store = readFileSync(ROOT + 'api/store.php', 'utf8')
    check(/'knet' => "\/knet\/pay\.php/.test(store),
      'the shop still sends KNET to /knet/pay.php, whichever integration is behind it')

    // THE OWNER'S DECISION, GUARDED. Sporta pays through the Tranportal
    // values, and the shipped example pins 'legacy' so the shop cannot drift
    // onto the other gateway because a credential was mistyped or blanked.
    // This is asserted from the EXAMPLE rather than from config.php, because
    // the example is what a fresh deploy copies and the only one of the two
    // this repo holds.
    const shipped = JSON.parse(execFileSync('php', ['-r', `
      require "${ROOT}knet/knet.php";
      $c = require "${ROOT}knet/config.example.php";
      echo json_encode(["mode" => knet_mode($c), "id" => (string) $c["tranportal_id"]]);
    `], { encoding: 'utf8' }))
    check(shipped.mode === 'legacy',
      "the shipped example pins the Tranportal integration", `got ${shipped.mode}`)
    check(shipped.id === '626101',
      'and carries the terminal id from the nomination letter', `got "${shipped.id}"`)
  }

  // ============================================================ legacy, live
  console.log('\n--- with Tranportal credentials: unchanged')
  {
    setLegacy(true)
    const r = head(`/knet/pay.php?trackid=${TRACK}&lang=ar`)
    check(r.status === 302, `the shopper is redirected (${r.status})`)
    check(/kpg\/PaymentHTTP\.htm/.test(r.location), 'to the Tranportal gateway', r.location.slice(0, 60))
    check(/[?&]trandata=[0-9A-F]+/.test(r.location), 'carrying an AES trandata blob in uppercase hex')
    check(!/[?&](amt|amount)=/.test(r.location), 'and no amount in the link for anyone to edit')
  }

  // ========================================================== official, live
  console.log('\n--- without them: the official CBK hosted page, as KNET')
  {
    setLegacy(false)
    const r = head(`/knet/pay.php?trackid=${TRACK}&lang=ar`)
    check(r.status === 303, `the shopper is redirected (${r.status})`)
    check(/\/pay\/pay\.php\?/.test(r.location), 'to the gateway pay/ already talks to', r.location)
    check(/[?&]paytype=1(&|$)/.test(r.location), 'asking for the KNET face of it, not the chooser')
    check(r.location.includes(`trackid=${TRACK}`), 'carrying THIS order')
    check(!/[?&](amt|amount)=/.test(r.location), 'and no amount in the link for anyone to edit')

    // NOT A PARAMETER THE CALLER SETS. This endpoint is the KNET door; a
    // paytype read off the query string would make it a way to reach any face
    // of the gateway through a URL the shop advertises as KNET.
    const forced = head(`/knet/pay.php?trackid=${TRACK}&lang=ar&paytype=2`)
    check(/[?&]paytype=1(&|$)/.test(forced.location),
      'and a paytype in the URL cannot change that', forced.location)

    // PRICE AUTHORITY SURVIVES THE HOP, which is the thing a redirect could
    // plausibly have thrown away. pay/pay.php refuses an order it cannot
    // confirm, exactly as this dropin does.
    const ghost = curl('/knet/pay.php?trackid=NOSUCHORDER123&lang=ar', ['-L'])
    check(/Unknown order/.test(ghost),
      'and an order the database cannot confirm is still refused', ghost.slice(0, 60))
  }
} finally {
  writeFileSync(CFG, original)
}

// A rig that leaves the sandbox unable to take a payment has done more damage
// than the bug it was looking for. Assert the file is back, byte for byte.
console.log('\n--- afterwards')
check(readFileSync(CFG, 'utf8') === original, 'knet/config.php is back exactly as it was')

console.log(fails ? `\n${fails} failed` : '\nall ok')
process.exit(fails ? 1 : 0)
