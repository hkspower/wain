#!/usr/bin/env node
/**
 * The Users screen at /backends (2026-10-08): the shop's shopper accounts and its panel team, and the
 * holes in sign-in that a screen like this would otherwise have opened.
 *
 *   bash scripts/sandbox.sh                       # MariaDB up, the shop served on BASE (default :4300)
 *   node scripts/users-test.mjs                   # both halves
 *   ONLY=api node scripts/users-test.mjs          # the scratch-shop half only;  ONLY=ui — the browser half only
 *   MUTATE=<name> node scripts/users-test.mjs     # one mutation (list below): must FAIL, naming its check
 *   MUTATE=all node scripts/users-test.mjs        # every mutation in turn; passes only if EACH is caught by name
 *
 * WHAT IT GUARDS, and why each is a check rather than a comment:
 *   - REMOVING A COLLEAGUE DID NOT SIGN THEM OUT. Their ledger rows cascade away with the admin_users row,
 *     sec_session_alive() then "adopts" the session, the adoption insert fails on the foreign key, the
 *     error is swallowed — and the browser kept the whole shop for up to seven days. store_session_admin()
 *     reads the row itself now. T11e is that browser; T7c is the switch alone, set with the ledger row
 *     left un-revoked, because Switch off also revokes the ledger and would hide a missing row check.
 *   - locked_until could not hold the owner's lock (five code paths clear it), so the switch is its own
 *     column, disabled_at, refused in store_admin_grant() — the one function every door ends in — and only
 *     AFTER the door has proved the credential: a wrong password still gets the ordinary answer, so
 *     `account_disabled` tells a stranger nothing (T8).
 *   - A SHOP WITH NO ACTIVE ADMIN IS WORSE THAN LOCKED: with no rows `register` reopens to anyone. The
 *     guard can only fire when two admins switch each other off at the same moment — read in order you
 *     cannot switch yourself off, and you are on or your session would have ended — so R makes that race
 *     deterministic: another connection holds the actor's row `for update`, the request is sent, the
 *     actor is switched off, the hold commits, and the request must then count what is really left.
 *   - A SHOPPER'S ORDERS ARE LINKED BY customer_id, NEVER BY PHONE. A registration proves no phone, and a
 *     phone match would show one shopper's name, address and purchases under another shopper's account.
 *     S3a plants a guest order with the SAME phone and no customer_id; it must not appear.
 *   - A shopper's session is a PHP file the panel cannot reach, so Block and Sign out everywhere are
 *     states customer_id() reads on every request. S4 and S6 hold a REAL shopper session (api.php,
 *     same-origin JSON) and require it to end — and require signing in again to work after a sign-out,
 *     because that is not a block.
 *   - The six columns arrive with api/users.mysql.sql, which the live shop may not have run: sign-in on
 *     both sides must go on working without them, and the ten routes must say users_not_ready (N).
 *
 * AND WHAT THE REVIEW FOUND (2026-10-14), each a check that failed before its fix:
 *   - A block ended a session only if that browser asked for something WHILE it stood, so an unblock let a
 *     browser left idle through it back in — the hijacker's, in the case a block is for. A block is a
 *     sign-out everywhere too now (S4i).
 *   - orders-print, labels and invoice-file take store_session_admin(), not the gate, and so served every
 *     order's name and address to a session still on its temporary password (T5c).
 *   - A refused door wrote first: a switched-off colleague's or a blocked shopper's passkey recorded itself
 *     as used, and the right emailed code for a blocked, never-proved shopper ran the pre-hijack wipe — the
 *     password and passkeys Unblock promises back (T8d, S8a-c, with a software passkey and a real code).
 *   - The shopper detail named no columns, a spent-code helper deleted wrong tries the daily cap counts,
 *     "also block the phone" blanked the CRM's reason, a 00965 number found nothing, and "Show more" paged
 *     by offset under a newest-first list (S3e, S4b/S6d, S4j, S2f, S1d).
 *   - migrate-users.php checked the verbs and not the columns, and read names but not types (M1-M3).
 *   - On the screen: a touch rule laid every shopper row out as squeezed columns on a phone, a failed
 *     "Show more" wiped the list, a vanished colleague's reason went with their row, a second press of Users
 *     threw away the temporary password, panel-ux toasted over the screen's own answers, and the save bar
 *     offered "Unsaved changes in undefined." over it (B10d, B68-69, B58b, B49b, B70, B8c, and B4c, B15b,
 *     B17b for the wording and the lit button).
 *
 * TWO HALVES, because each needs what the other cannot give.
 *   API (T, R, S, N) — a SCRATCH COPY of the shop (scripts/scratch-shop.mjs: its own database, its own
 *     copy of api/*.php, its own php -S). It removes team members, switches its own copy of the manager off
 *     for the race, drops the six columns, and every mutation is written into ITS PHP — none of which the
 *     shared sandbox can spare, and a mutation written into the real file would be served to every other
 *     rig on the shared server for as long as it sat on disk. api.php and customer.php are in the copy, so
 *     the shopper half runs there too, against real shopper sessions.
 *   UI (B) — a real browser against BASE and the SHARED sandbox, desktop 1280 and phone 390 (touch), with
 *     NAMED fixtures only (users-rig-*@example.invalid, two order track ids, two phones), every one removed
 *     in `finally`, with the audit and sign-in-log rows this run's own actions wrote. It signs in as the
 *     manager and never alters its row; it checks first that the manager has no second factor, because
 *     every team form would then need a code this rig does not have.
 *
 * EXPECTED VALUES ARE READ FROM THE DATABASE, never from the route under test — a route that answers its
 * own question wrong would otherwise agree with itself. And every check that could pass by finding
 * nothing first asserts that its fixture has the property under test (the guest order really carries the
 * same phone; the planted secrets really are in the table the JSON must not echo).
 *
 * MUTATIONS — written into the scratch copy only; the UI half is skipped under MUTATE. A replacement that
 * matches nothing is refused before anything runs, because a mutation that changes nothing proves nothing.
 *   session-row       store_session_admin() no longer reads the admin row            -> T7c, T11e
 *   grant-disabled    store_admin_grant() no longer refuses a switched-off account    -> T8b
 *   signed-out        customer_id() no longer reads signed_out_at                     -> S6b
 *   customer-blocked  customer_grant() no longer refuses a blocked account            -> S4e
 *   last-active       team_lock / team_remove no longer run the last-active guard     -> R1, R2, R3, R4
 *   orders-by-phone   the shopper detail lists orders by phone, not customer_id       -> S3a
 *   team-secret       the team JSON carries each member's password_hash               -> T2
 *   block-cutoff      shopper_block no longer stamps signed_out_at                     -> S4i
 *   page-must-change  the three navigation pages serve a temporary-password session    -> T5c
 *   shopper-columns   the shopper detail is `select *` again                           -> S3e
 *   codes-delete      Block / Sign out everywhere delete pending codes and their tries -> S4b, S6d
 *   phone-reason      "also block the phone" overwrites the CRM's reason               -> S4j
 *   phone-00          the phone search keeps a leading 00                              -> S2f
 *   paging-offset     the list ignores `before` and pages by offset                    -> S1d
 *   verified-wipe     a blocked account's address proof still wipes it                 -> S8b
 *   pk-bookkeeping    a blocked shopper's refused passkey records itself as used        -> S8a
 *   admin-pk-bookkeeping  a switched-off colleague's refused passkey likewise           -> T8d
 *   migrator-shape    migrate-users.php checks the verbs only                          -> M2
 *   migrator-state    migrate-users.php's STATE reads names only                       -> M3
 * The screen's own fixes cannot be mutated here (the browser half is skipped under MUTATE); each was proved
 * by putting the old code back by hand and watching its check fail.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, createHmac, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { scratchShop } from './scratch-shop.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const BASE = (process.env.BASE ?? 'http://127.0.0.1:4300').replace(/\/$/, '')
const ONLY = process.env.ONLY ?? ''
const MUT = process.env.MUTATE ?? ''
const EXE = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const SHOTS = process.env.SHOTS ?? ''        // a directory for screenshots, when asked for; none by default
const MANAGER = 'manager@sporta.com.kw'
const MANAGER_PW = 'correct horse'

const MUTATIONS = {
  'session-row': {
    what: 'store_session_admin() no longer reads the admin row', file: 'store.php',
    from: "    if ($row === false || store_admin_is_disabled($row)) { store_session_end(); return null; }\n",
    to: '', expect: ['T7c', 'T11e'],
  },
  'grant-disabled': {
    what: 'store_admin_grant() no longer refuses a switched-off account', file: 'store.php',
    from: "    if ($row === false || store_admin_is_disabled($row)) store_fail('account_disabled', 403);\n",
    to: '', expect: ['T8b'],
  },
  'signed-out': {
    what: "customer_id() no longer reads signed_out_at", file: 'customer.php',
    from: "(!empty($row['blocked_at']) || customer_signed_out_since($row, $id))",
    to: "(!empty($row['blocked_at']))", expect: ['S6b'],
  },
  'customer-blocked': {
    what: 'customer_grant() no longer refuses a blocked account', file: 'customer.php',
    from: "    if (is_array($row) && !empty($row['blocked_at'])) store_fail('account_blocked', 403);\n",
    to: '', expect: ['S4e'],
  },
  'last-active': {
    what: 'team_lock and team_remove no longer run the last-active-admin guard', file: 'admin.php',
    from: "    users_guard_last_active($db, (int) $admin['id'], $tid);\n",
    to: '', count: 2, expect: ['R1', 'R2', 'R3', 'R4'],
  },
  'orders-by-phone': {
    what: "the shopper detail lists orders by phone number instead of customer_id", file: 'admin.php',
    from: "from orders where customer_id = ? order by id desc limit 100');\n    $oq->execute([$s['id']]);",
    to: "from orders where customer_phone = ? order by id desc limit 100');\n    $oq->execute([store_phone((string) ($s['phone'] ?? ''))]);",
    expect: ['S3a'],
  },
  'team-secret': {
    what: "the team JSON carries each member's password_hash", file: 'admin.php',
    from: "            'email'         => $u['email'],\n",
    to: "            'email'         => $u['email'],\n            'password_hash' => $db->query('select password_hash from admin_users where id = ' . $id)->fetchColumn(),\n",
    expect: ['T2'],
  },
  // ---- the review's findings (2026-10-14): each fix, taken back out
  'block-cutoff': {
    what: 'shopper_block no longer stamps signed_out_at, so an unblock revives a browser left idle through the block', file: 'admin.php',
    from: 'signed_out_at = now(), blocked_reason = ?', to: 'blocked_reason = ?', expect: ['S4i'],
  },
  'page-must-change': {
    what: 'orders-print, labels and invoice-file serve a session still on its temporary password', file: 'store.php',
    from: "    if (!store_admin_must_change_password((int)($who['id'] ?? 0))) return;\n", to: '    return;\n', expect: ['T5c'],
  },
  'shopper-columns': {
    what: 'the shopper detail is `select *` again, sending every column of the row', file: 'admin.php',
    from: "'select ' . implode(', ', USERS_SHOPPER_COLUMNS) . ' from customers where id = ?'", to: "'select * from customers where id = ?'", expect: ['S3e'],
  },
  'codes-delete': {
    what: "Block and Sign out everywhere DELETE the pending code, and its wrong tries with it", file: 'admin.php',
    from: "'update customer_login_codes set used_at = now() where email = ? and used_at is null'",
    to: "'delete from customer_login_codes where email = ? and used_at is null'", expect: ['S4b', 'S6d'],
  },
  'phone-reason': {
    what: "Block's phone_too overwrites the CRM's reason for the number with an empty one", file: 'admin.php',
    from: "admin_phone_block($db, $phone, 'all', $reason, (string) $admin['email'], true);",
    to: "admin_phone_block($db, $phone, 'all', $reason, (string) $admin['email'], false);", expect: ['S4j'],
  },
  'phone-00': {
    what: 'the phone search no longer drops a leading 00', file: 'admin.php',
    from: "$digits = preg_replace('/^00/', '', preg_replace('/\\D/', '', $ascii));",
    to: "$digits = preg_replace('/\\D/', '', $ascii);", expect: ['S2f'],
  },
  'paging-offset': {
    what: "the shoppers list ignores `before` and pages by offset", file: 'admin.php',
    from: "$before = (int) ($_GET['before'] ?? 0);", to: '$before = 0;', expect: ['S1d'],
  },
  'verified-wipe': {
    what: "proving a BLOCKED account's address by an emailed code wipes its password and passkeys anyway", file: 'customer.php',
    from: "        if (!empty($u['blocked_at'])) return (int) $u['id'];\n", to: '', expect: ['S8b'],
  },
  'pk-bookkeeping': {
    what: "a blocked shopper's refused passkey still records itself as used", file: 'customer.php',
    from: "    if (customer_blocked($db, (int) $k['customer_id'])) store_fail('account_blocked', 403);\n", to: '', expect: ['S8a'],
  },
  'admin-pk-bookkeeping': {
    what: "a switched-off colleague's refused passkey still records itself as used", file: 'security.php',
    from: "    store_admin_refuse_disabled(['id' => (int) $k['admin_id']]);\n", to: '', expect: ['T8d'],
  },
  'migrator-shape': {
    what: 'migrate-users.php checks only that each clause is an ADD COLUMN IF NOT EXISTS, as it first did', file: 'migrate-users.php',
    pairs: [
      ["if (!preg_match('/^\\s*add column if not exists (\\w+)\\s+(timestamp|varchar\\(\\d+\\))\\s+null(?:\\s+default\\s+null)?\\s*$/i', $cl, $c))",
       "if (!preg_match('/^\\s*add column if not exists (\\w+) /i', $cl, $c))"],
      ["if (($WANT[$tables[$i]][strtolower($c[1])] ?? null) !== strtolower($c[2]) || isset($seen[$key]))", 'if (false)'],
      ['if ($shapeOk && count($seen) !== 6) $shapeOk = false;', ''],
    ],
    expect: ['M2'],
  },
  'migrator-state': {
    what: "migrate-users.php's STATE reads column names only, as it first did", file: 'migrate-users.php',
    from: '$got === $type', to: '$got !== null', count: 2, expect: ['M3'],
  },
}

/* ------------------------------------------------------------------ MUTATE=all: every mutation, by name */
if (MUT === 'all') {
  let missed = 0
  for (const [name, m] of Object.entries(MUTATIONS)) {
    const t0 = Date.now()
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, MUTATE: name }, encoding: 'utf8', maxBuffer: 64 << 20 })
    const failed = [...new Set([...r.stdout.matchAll(/^FAIL ([A-Z]\d+[a-z]?)\b/gm)].map((x) => x[1]))]
    // CAUGHT means the run failed AND every check named for this mutation is among the failures: a run
    // that crashed, or failed somewhere else, has not shown that the guard it removed was being watched.
    const caught = r.status === 1 && m.expect.every((id) => failed.includes(id))
    if (!caught) missed++
    console.log(`${caught ? 'ok  ' : 'FAIL'} MUTATE=${name} (${m.what}): ${caught ? 'caught by' : 'NOT caught by'} ${m.expect.join(', ')}` +
      `  [failed: ${failed.join(', ') || 'nothing'}; exit ${r.status}; ${Math.round((Date.now() - t0) / 1000)}s]`)
    if (!caught) console.log(r.stdout.split('\n').slice(-25).join('\n') + (r.stderr || '').slice(-1500))
  }
  console.log(missed ? `${missed} mutation(s) NOT caught by name` : `all ${Object.keys(MUTATIONS).length} mutations caught by name`)
  process.exit(missed ? 1 : 0)
}
if (MUT && !MUTATIONS[MUT]) {
  console.error(`unknown MUTATE=${MUT}; one of: all, ${Object.keys(MUTATIONS).join(', ')}`)
  process.exit(2)
}

/* ------------------------------------------------------------------ helpers */
let fails = 0
const failedIds = []
const check = (id, ok, what, extra = '') => {
  if (!ok) { fails++; failedIds.push(id) }
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${ok || extra === '' ? '' : ' — ' + String(extra).slice(0, 400)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha = (s) => createHash('sha256').update(s).digest('hex')
const hex = (n) => randomBytes(n).toString('hex')
// A SQL string literal, for values this rig wrote itself (bcrypt hashes carry `$` and `/`, never a quote).
const lit = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
const php = (code, ...args) => execFileSync('php', ['-r', code, ...args], { encoding: 'utf8' })
const hashOf = (pw) => php('echo password_hash($argv[1], PASSWORD_DEFAULT);', pw)
const verifies = (pw, hash) => php('echo password_verify($argv[1], $argv[2]) ? "1" : "0";', pw, hash) === '1'
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// RFC 6238, computed here rather than asked of the shop: a code the server under test produced would
// pass whether or not it checks codes at all.
function totp(b32, offsetSteps = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const ch of b32.replace(/=+$/, '')) bits += A.indexOf(ch).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
  const ctr = Buffer.alloc(8)
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps))
  const h = createHmac('sha1', key).update(ctr).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

// The two session clocks, read out of store.php's source rather than restated, so the "signed-in
// browsers" count the Team tab shows is checked against the limits store_session_admin() enforces.
function sessionClocks() {
  const src = readFileSync(ROOT + 'sporta-site/public_html/api/store.php', 'utf8')
  const read = (name) => {
    const m = src.match(new RegExp('const ' + name + '\\s*=\\s*([\\d\\s*]+);'))
    if (!m) throw new Error('could not read ' + name + ' from store.php')
    return m[1].split('*').reduce((a, x) => a * Number(x.trim()), 1)
  }
  return [read('STORE_ADMIN_IDLE_SECONDS'), read('STORE_ADMIN_ABSOLUTE_SECONDS')]
}

// One browser's cookie jar, kept as a browser keeps it: a cookie the server expires is dropped, so
// "signed out on its next request" is measured on the very jar that was signed in.
function jarClient(base, file, headers) {
  const jar = {}
  const send = async (url, body, hdrs) => {
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...hdrs,
        ...(Object.keys(jar).length ? { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = r.headers.getSetCookie?.() ?? []
    for (const c of set) {
      const [kv] = c.split(';')
      const i = kv.indexOf('=')
      const k = kv.slice(0, i), v = kv.slice(i + 1)
      if (/expires=Thu, 01[ -]Jan[ -]1970|max-age=0\b/i.test(c) || v === '' || v === 'deleted') delete jar[k]
      else jar[k] = v
    }
    const text = await r.text()
    let json
    try { json = JSON.parse(text) } catch { json = undefined }
    return { status: r.status, body: json, text, setCookie: set }
  }
  const c = (route, body) => send(`${base}/api/${file}?r=${route}`, body, headers)
  // A NAVIGATION on the same jar — a plain GET with no custom header, the way a browser opens orders-print.php.
  c.page = (path) => send(base + path, undefined, {})
  return c
}

// A SOFTWARE PASSKEY, so a sign-in door can be driven without a browser: an ES256 key whose public half is stored as
// the PEM the server verifies with (what security.php's COSE conversion writes at registration), and an assertion
// signed over authenticatorData || sha256(clientDataJSON) for this base. sec_rp_id() is the Host header without its
// port and sec_origin() the Host with it, so an IP base is as good as a name here (a browser would refuse the IP).
function softKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), credHex: hex(16), privateKey }
}
function assertion(base, key, challenge, counter = 1) {
  const ad = Buffer.concat([createHash('sha256').update(new URL(base).hostname).digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])])
  const cdj = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: base }))
  const sig = createSign('SHA256').update(Buffer.concat([ad, createHash('sha256').update(cdj).digest()])).sign(key.privateKey)
  return { id: Buffer.from(key.credHex, 'hex').toString('base64url'),
    response: { clientDataJSON: cdj.toString('base64url'), authenticatorData: ad.toString('base64url'), signature: sig.toString('base64url') } }
}
const panel = (base) => jarClient(base, 'admin.php', { 'X-Sporta-Admin': '1' })
// Same-origin JSON, as the storefront's own sheet sends it: api.php refuses a customer_* write with any
// other Origin (the login-CSRF guard), so a rig without the header would be testing a different door.
const shopper = (base) => jarClient(base, 'api.php', { Origin: base })
async function signIn(base, email, password) {
  const c = panel(base)
  const r = await c('login', { email, password })
  if (r.status !== 200 || r.body?.need_code) throw new Error(`sign-in as ${email} failed: ${r.status} ${r.text.slice(0, 200)}`)
  return c
}

/* ================================================================== API half: the scratch shop */
async function apiHalf() {
  const shop = await scratchShop('users')
  const { base, sql, rows } = shop
  const one = (s) => sql(s).trim().split('\n')[0] ?? ''
  const num = (s) => Number(one(s))
  const fresh = () => sql('delete from rate_limit; delete from rate_bucket')
  try {
    // THE MIGRATOR, COPIED, pointed at the copy: its $root is the live server's path, and the copy's
    // api/ holds a config.php aimed at the scratch database. The M section runs it against files it writes there.
    const MIGRATOR = shop.dir + '/migrate-users.php'
    {
      const src = readFileSync(ROOT + 'scripts/publish/migrate-users.php', 'utf8')
      const live = "$root = '/home/u130124229/domains/sporta.com.kw/public_html';"
      if (!src.includes(live)) throw new Error("migrate-users.php no longer carries the live $root line this rig re-points")
      writeFileSync(MIGRATOR, src.replace(live, '$root = ' + lit(shop.dir + '/public_html') + ';'))
    }
    if (MUT) {
      const m = MUTATIONS[MUT]
      const file = m.file === 'migrate-users.php' ? MIGRATOR : shop.apiDir + '/' + m.file
      let src = readFileSync(file, 'utf8')
      for (const [from, to] of m.pairs ?? [[m.from, m.to]]) {
        const n = src.split(from).length - 1
        if (n !== (m.pairs ? 1 : m.count ?? 1)) throw new Error(`MUTATE=${MUT}: the replacement matched ${n} time(s) in ${m.file}, not ${m.pairs ? 1 : m.count ?? 1} — a mutation that changes nothing proves nothing`)
        src = src.split(from).join(to)
      }
      writeFileSync(file, src)
      console.log(`     MUTATE=${MUT}: ${m.what} (written into the scratch copy of ${m.file} only)`)
    }

    // THE COPY'S TEAM, MADE KNOWN. Only the manager is kept, with no second factor and nothing switched
    // off — in this throwaway copy; the shared sandbox's rows are never written. Without this the race
    // below would count whatever other admins the sandbox happened to hold when it was copied.
    sql("delete from admin_users where email <> 'manager@sporta.com.kw'")
    sql(`update admin_users set disabled_at = null, failed_attempts = 0, locked_until = null, totp_enabled = 0, totp_secret = null,
                email_otp_enabled = 0, must_change_password = 0 where email = 'manager@sporta.com.kw'`)
    sql("delete from customers where email like 'users%rig%@example.invalid'")
    fresh()
    const mgrId = num("select id from admin_users where email = 'manager@sporta.com.kw'")
    if (!mgrId) throw new Error('the scratch copy has no manager@sporta.com.kw — run bash scripts/sandbox.sh')
    let mgr = await signIn(base, MANAGER, MANAGER_PW)
    const [IDLE, ABS] = sessionClocks()

    /* ---------------------------------------------------------------- T. the team */
    const PW = 'users-rig-' + hex(8)                 // the password of every member this rig plants
    const H = hashOf(PW)
    const TOTP_SECRET = 'JBSWY3DPEHPK3PXPUSERSRIGTOTPAAAA'
    const OTP_HASH = sha('users-rig-email-otp')
    sql(`insert into admin_users (email, password_hash, totp_secret, totp_enabled, email_otp_hash, locked_until, added_by) values
         ('users-rig-secret@example.invalid', ${lit(H)}, ${lit(TOTP_SECRET)}, 1, ${lit(OTP_HASH)}, now() + interval 1 hour, 'users-rig-owner@example.invalid'),
         ('users-rig-past@example.invalid', ${lit(H)}, null, 0, null, now() - interval 1 hour, null)`)
    sql("update admin_users set email_otp_enabled = 1, failed_attempts = 5 where email = 'users-rig-past@example.invalid'")
    const secId = num("select id from admin_users where email = 'users-rig-secret@example.invalid'")
    sql(`insert into admin_passkeys (admin_id, credential_id, public_key, alg, label) values (${secId}, unhex('A1B2C3D4E5'), 'rig', -7, 'rig key')`)
    // One live browser, one revoked, one past the idle clock: the Team tab must count exactly one.
    sql(`insert into admin_sessions (sid_hash, admin_id, created_at, last_seen, revoked_at) values
         (sha2('users-rig-live', 256), ${secId}, now(), now(), null),
         (sha2('users-rig-revoked', 256), ${secId}, now(), now(), now()),
         (sha2('users-rig-idle', 256), ${secId}, now() - interval 4 day, now() - interval 4 day, null)`)
    const dbTeam = () => rows(`select u.id, u.email, u.added_by, u.disabled_at, (u.locked_until > now()) as locked_future,
        case when u.totp_enabled = 1 and coalesce(u.totp_secret, '') <> '' then 'app' when u.email_otp_enabled = 1 then 'email' else '' end as tf,
        (select count(*) from admin_passkeys p where p.admin_id = u.id) as pk,
        (select count(*) from admin_sessions s where s.admin_id = u.id and s.revoked_at is null
            and s.last_seen > now() - interval ${IDLE} second and s.created_at > now() - interval ${ABS} second) as live
        from admin_users u order by u.id`)

    let r = await mgr('team')
    const want = dbTeam()
    const got = r.body?.team ?? []
    let mismatch = ''
    want.forEach((w, i) => {
      const g = got[i] ?? {}
      const same = g.id === Number(w.id) && g.email === w.email && g.you === (Number(w.id) === mgrId) && (g.added_by ?? null) === w.added_by &&
        (g.disabled_at != null) === (w.disabled_at != null) && (g.locked_until != null) === (w.locked_future === '1') &&
        (g.two_factor ?? '') === w.tf && g.passkeys === Number(w.pk) && g.sessions === Number(w.live)
      if (!same && !mismatch) mismatch = `db ${JSON.stringify(w)} vs route ${JSON.stringify(g)}`
    })
    check('T1', r.status === 200 && r.body?.ready === true && want.length === 3 && got.length === want.length && !mismatch,
      `team lists all ${want.length} admin rows in id order, each as the database has it (you, added by, second factor, passkeys, live browsers, lock)`,
      mismatch || r.text.slice(0, 200))
    const sec = got.find((g) => g.id === secId) ?? {}
    const past = got.find((g) => g.email === 'users-rig-past@example.invalid') ?? {}
    check('T1b', sec.two_factor === 'app' && sec.sessions === 1 && sec.passkeys === 1 && sec.locked_until != null && sec.added_by === 'users-rig-owner@example.invalid' &&
      past.two_factor === 'email' && past.locked_until === null,
      'the planted members read right: an authenticator, ONE live browser of three ledger rows, a future lock shown, a past lock not', JSON.stringify({ sec, past }))
    // NO SECRET, by name or by value. The planted ones must really be in the table first, or "not echoed"
    // would pass on a shop that had nothing to echo.
    const secrets = rows('select password_hash, totp_secret, email_otp_hash from admin_users').flatMap((x) => Object.values(x)).filter(Boolean)
    const leaks = []
    for (const k of ['password_hash', 'totp_secret', 'email_otp_hash', 'totp_last_step', 'email_otp_expires']) if (r.text.includes(`"${k}"`)) leaks.push('key ' + k)
    for (const v of secrets) if (r.text.includes(v) || r.text.includes(v.replace(/\//g, '\\/'))) leaks.push('value ' + v.slice(0, 12) + '…')
    if (/\$2[aby]\$\d\d\$/.test(r.text)) leaks.push('a bcrypt hash')
    check('T2', secrets.includes(TOTP_SECRET) && secrets.includes(OTP_HASH) && secrets.length >= 5 && leaks.length === 0,
      'the team JSON carries no secret field and no secret value (every password hash, the authenticator secret, the emailed-code hash)', leaks.join(', '))

    // ---- add
    fresh()
    const MEMBER = 'users-rig-member@example.invalid'
    const teamCount = () => num('select count(*) from admin_users')
    const before = teamCount()
    r = await mgr('team_add', { email: 'not-an-email', password: MANAGER_PW })
    check('T3a', r.status === 400 && r.body?.error === 'bad_email', 'team_add refuses an address that is not one (bad_email)', r.text)
    r = await mgr('team_add', { email: '  MANAGER@Sporta.com.kw ', password: MANAGER_PW })
    check('T3b', r.status === 409 && r.body?.error === 'member_exists', 'and an address already on the team, in any case (member_exists)', r.text)
    r = await mgr('team_add', { email: MEMBER, password: 'not the password' })
    let r2 = await mgr('team_add', { email: MEMBER })
    check('T3c', r.status === 401 && r.body?.error === 'bad_password' && r2.status === 401 && r2.body?.error === 'bad_password' && teamCount() === before,
      "a wrong or missing password of YOUR OWN is refused (bad_password) and adds nobody", r.text + ' / ' + r2.text)
    r = await mgr('team_add', { email: ' Users-Rig-Member@Example.invalid ', password: MANAGER_PW })
    const temp = r.body?.temp_password ?? ''
    const mRow = rows(`select id, password_hash, must_change_password, added_by from admin_users where email = '${MEMBER}'`)[0]
    check('T3d', r.status === 200 && r.body?.member?.email === MEMBER && !!mRow && teamCount() === before + 1,
      'with the right password the member is added, the address trimmed and lowercased', r.text.slice(0, 200))
    check('T3e', /^[A-Za-z2-9]{16}$/.test(temp) && !/[0O1lIo]/.test(temp) && !!mRow && verifies(temp, mRow.password_hash),
      'the answer carries a 16-character temporary password with no look-alike characters, and it is the one stored (password_verify)', temp)
    check('T3f', mRow?.must_change_password === '1' && mRow?.added_by === MANAGER,
      'the newcomer must choose their own password at first sign-in, and is recorded as added by the manager', JSON.stringify(mRow))
    const aud = rows("select status_code, admin_email, summary from admin_audit_log where route = 'team_add' order by id desc limit 1")[0]
    check('T3g', !!aud && aud.status_code === '200' && aud.admin_email === MANAGER && aud.summary.toLowerCase().includes('users-rig-member') &&
      !aud.summary.includes(MANAGER_PW) && !aud.summary.includes(temp),
      'the Activity log records the add — without the password that authorised it or the temporary one it minted', JSON.stringify(aud))
    const mid = Number(mRow?.id)

    // ---- the acting admin's second factor counts too
    fresh()
    sql(`insert into admin_users (email, password_hash) values ('users-rig-actor@example.invalid', ${lit(H)})`)
    const actorId = num("select id from admin_users where email = 'users-rig-actor@example.invalid'")
    const actor = await signIn(base, 'users-rig-actor@example.invalid', PW)
    const TOTP2 = 'KRUGS4ZANFZSA3TPOQQGCIDTMVRXEZLU'
    // Switched on AFTER it signed in, so the sign-in needs no code and the re-auth is the only thing asking.
    sql(`update admin_users set totp_secret = ${lit(TOTP2)}, totp_enabled = 1, totp_last_step = null where id = ${actorId}`)
    const near = new Set([-1, 0, 1].map((d) => totp(TOTP2, d)))
    const wrongCode = ['000000', '111111', '222222'].find((c) => !near.has(c))
    const b4 = teamCount()
    r = await actor('team_add', { email: 'users-rig-viaotp@example.invalid', password: PW })
    r2 = await actor('team_add', { email: 'users-rig-viaotp@example.invalid', password: PW, code: wrongCode })
    check('T4a', r.status === 401 && r.body?.error === 'bad_code' && r2.status === 401 && r2.body?.error === 'bad_code' && teamCount() === b4,
      'with an authenticator enrolled, the right password alone is not enough: no code, or a wrong one, is refused (bad_code) and adds nobody', r.text + ' / ' + r2.text)
    r = await actor('team_add', { email: 'users-rig-viaotp@example.invalid', password: PW, code: totp(TOTP2) })
    check('T4b', r.status === 200 && teamCount() === b4 + 1, 'and with the current authenticator code it goes through', r.text.slice(0, 160))
    sql(`update admin_users set totp_enabled = 0, totp_secret = null where id = ${actorId}`)

    // ---- the temporary password
    fresh()
    const member = panel(base)
    r = await member('login', { email: MEMBER, password: temp })
    const me5 = await member('me')
    const gated5 = await member('stats')
    check('T5a', r.status === 200 && !r.body?.need_code && me5.body?.email === MEMBER, 'the temporary password signs the newcomer in', r.text)
    check('T5b', gated5.status === 428 && gated5.body?.error === 'must_change_password' && me5.body?.must_change_password === true,
      'and every other route answers 428 must_change_password until they choose their own', gated5.text)
    // THE PAGES A BROWSER OPENS AS A NAVIGATION take store_session_admin(), not the gate, and so missed its 428:
    // anyone else holding the temporary password could read every order's name, phone and address there without
    // ever changing it (review, 2026-10-14). The manager's own view of the same three pages is the control — a page
    // that refuses everybody would pass the newcomer's half.
    sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_email, customer_area)
         values ('SPUSRPRINT01', 4.000, 'pending', 'cod', 'unfulfilled', 'Users Rig Printed Name', '96555512399', 'users-rig-print@example.invalid', 'x')`)
    const slug5 = one("select slug from products order by id limit 1")
    const PAGES = ['/api/orders-print.php?id=SPUSRPRINT01', '/api/labels.php?slug=' + encodeURIComponent(slug5), '/api/invoice-file.php']
    const asMgr = [], asNew = []
    for (const path of PAGES) { asMgr.push(await mgr.page(path)); asNew.push(await member.page(path)) }
    check('T5c', !!slug5 && asMgr.every((x) => x.status === 200) && asMgr[0].text.includes('Users Rig Printed Name') &&
      asNew.every((x) => x.status === 403 && /Choose your own password/.test(x.text)) && !asNew[0].text.includes('Users Rig Printed Name') &&
      one(`select must_change_password from admin_users where id = ${Number(mRow?.id)}`) === '1',
      'and the three pages opened as a navigation (orders-print, labels, invoice-file) refuse that session too, where the manager reads them',
      PAGES.map((x, i) => `${x.split('?')[0].split('/').pop()} mgr=${asMgr[i].status} new=${asNew[i].status}`).join('; '))

    // ---- switch off
    fresh()
    const plantDoors = () => {
      sql(`insert into admin_devices (admin_id, token_hash, pass_hash, label, expires_at) values (${mid}, sha2('users-rig-device-${hex(4)}', 256), 'x', 'rig', now() + interval 1 day)`)
      sql(`replace into admin_password_resets (admin_id, code_hash, attempts, expires_at) values (${mid}, 'x', 0, now() + interval 1 day)`)
    }
    plantDoors()
    sql(`insert into admin_passkeys (admin_id, credential_id, public_key, alg, label) values (${mid}, unhex('B1B2B3B4B5'), 'rig', -7, 'member key')`)
    r = await mgr('team_lock', { id: mgrId, password: MANAGER_PW })
    check('T6a', r.status === 409 && r.body?.error === 'cannot_lock_self', 'Switch off refuses your own account (cannot_lock_self)', r.text)
    r = await mgr('team_lock', { id: 99999999, password: MANAGER_PW })
    r2 = await mgr('team_unlock', { id: 99999999, password: MANAGER_PW })
    check('T6b', r.status === 404 && r.body?.error === 'member_not_found' && r2.status === 404 && r2.body?.error === 'member_not_found',
      'and an id that is not on the team, as does Switch on (member_not_found)', r.text + ' / ' + r2.text)
    r = await mgr('team_lock', { id: mid, password: 'not the password' })
    check('T6c', r.status === 401 && r.body?.error === 'bad_password' && one(`select disabled_at is null from admin_users where id = ${mid}`) === '1' &&
      (await member('me')).body?.email === MEMBER, 'a wrong password is refused and changes nothing: the member stays on, and signed in', r.text)
    const liveBefore = num(`select count(*) from admin_sessions where admin_id = ${mid} and revoked_at is null`)
    r = await mgr('team_lock', { id: mid, password: MANAGER_PW })
    const st6 = rows(`select disabled_at,
        (select count(*) from admin_sessions where admin_id = ${mid} and revoked_at is null) as live,
        (select count(*) from admin_devices where admin_id = ${mid}) as dev,
        (select count(*) from admin_password_resets where admin_id = ${mid}) as rst,
        (select count(*) from admin_passkeys where admin_id = ${mid}) as pk from admin_users where id = ${mid}`)[0] ?? {}
    check('T6d', r.status === 200 && st6.disabled_at != null && liveBefore >= 1 && r.body?.sessions_ended === liveBefore && st6.live === '0',
      `Switch off sets disabled_at and revokes every signed-in browser of theirs in the ledger (${liveBefore} ended)`, r.text.slice(0, 200) + ' ' + JSON.stringify(st6))
    check('T6e', st6.dev === '0' && st6.rst === '0' && st6.pk === '1',
      'and closes the trusted passcode device and the reset code in flight, KEEPING the passkey for when they are switched back on', JSON.stringify(st6))
    r = await mgr('team')
    check('T6f', (r.body?.team ?? []).find((g) => g.id === mid)?.disabled_at != null, 'the Team list shows them switched off')

    // ---- what a switch-off does to a browser already signed in
    let me = await member('me')
    const gated7 = await member('stats')
    check('T7a', me.status === 200 && me.body === null && gated7.status === 401,
      "the switched-off member's browser, signed in a moment ago, is signed out on its very next request (me -> null, a gated route 401)", me.text + ' / ' + gated7.status)
    sql(`insert into admin_users (email, password_hash) values ('users-rig-quiet@example.invalid', ${lit(H)})`)
    const quietId = num("select id from admin_users where email = 'users-rig-quiet@example.invalid'")
    const quiet = await signIn(base, 'users-rig-quiet@example.invalid', PW)
    const quietOn = (await quiet('me')).body?.email === 'users-rig-quiet@example.invalid'
    sql(`update admin_users set disabled_at = now() where id = ${quietId}`)     // the switch alone, the ledger row left as it was
    const unrevoked = num(`select count(*) from admin_sessions where admin_id = ${quietId} and revoked_at is null`)
    me = await quiet('me')
    check('T7c', quietOn && unrevoked >= 1 && me.status === 200 && me.body === null,
      'disabled_at ALONE — set in the database with the ledger row left un-revoked — ends a signed-in session: the row itself is read on every request',
      `before=${quietOn} unrevoked=${unrevoked} me=${me.text.slice(0, 120)}`)

    // ---- a switched-off member signing in
    fresh()
    sql(`update admin_users set failed_attempts = 0, last_login_at = '2026-01-01 00:00:00' where id = ${mid}`)
    const unknownA = await panel(base)('login', { email: 'users-rig-nobody@example.invalid', password: 'not the password' })
    const wrongA = await panel(base)('login', { email: MEMBER, password: 'not the password' })
    check('T8a', wrongA.status === 401 && wrongA.body?.error === 'bad_credentials' && wrongA.text === unknownA.text,
      'a switched-off member with a WRONG password gets the ordinary answer — the same as an address that is not on the team', wrongA.text + ' / ' + unknownA.text)
    const ledger8 = num(`select count(*) from admin_sessions where admin_id = ${mid}`)
    const m8 = panel(base)
    r = await m8('login', { email: MEMBER, password: temp })
    check('T8b', r.status === 403 && r.body?.error === 'account_disabled', 'with the RIGHT password they are refused: 403 account_disabled', r.text)
    const st8 = rows(`select failed_attempts, last_login_at from admin_users where id = ${mid}`)[0] ?? {}
    const me8 = await m8('me')
    check('T8c', st8.failed_attempts === '1' && st8.last_login_at === '2026-01-01 00:00:00' && num(`select count(*) from admin_sessions where admin_id = ${mid}`) === ledger8 &&
      me8.status === 200 && me8.body === null,
      'and the refusal leaves nothing behind: the failed-attempt count not cleared, no "last sign-in", no ledger row, no session', JSON.stringify(st8) + ' me=' + me8.text)
    // THE PASSKEY DOOR wrote last_used_at and sign_count BEFORE anything asked whether the account is switched off,
    // so the Security screen showed a refused attempt as "last used just now" (review, 2026-10-14). A real
    // assertion, signed by a software key: refused once the signature is proved, and nothing written.
    const mKey = softKey()
    sql(`insert into admin_passkeys (admin_id, credential_id, public_key, alg, sign_count, label) values (${mid}, unhex('${mKey.credHex}'), ${lit(mKey.pem)}, -7, 0, 'rig soft key')`)
    const pk8 = panel(base)
    const opt8 = await pk8('passkey_options_login', {})
    r = await pk8('passkey_login', assertion(base, mKey, opt8.body?.challenge ?? '', 7))
    const k8 = rows(`select sign_count, last_used_at from admin_passkeys where credential_id = unhex('${mKey.credHex}')`)[0] ?? {}
    check('T8d', !!opt8.body?.challenge && r.status === 403 && r.body?.error === 'account_disabled' && k8.sign_count === '0' && k8.last_used_at === null &&
      (await pk8('me')).body === null,
      "a switched-off member's passkey, with a valid signature, is refused (account_disabled) and records nothing: no sign count, no \"last used\"",
      `${r.status} ${r.text.slice(0, 120)} ${JSON.stringify(k8)}`)
    sql(`delete from admin_passkeys where credential_id = unhex('${mKey.credHex}')`)   // T10c counts the member's one planted passkey

    // ---- the password reset cannot get round the switch
    fresh()
    sql(`delete from admin_password_resets where admin_id in (${actorId}, ${mid})`)
    const rqA = await panel(base)('password_reset_request', { email: 'users-rig-actor@example.invalid' })
    const rqM = await panel(base)('password_reset_request', { email: MEMBER })
    const rqN = await panel(base)('password_reset_request', { email: 'users-rig-nobody@example.invalid' })
    check('T9a', rqA.status === 200 && num(`select count(*) from admin_password_resets where admin_id = ${actorId}`) === 1,
      'control: a reset request for a member who is on stores a code', rqA.text)
    check('T9b', rqM.status === 200 && rqM.text === rqN.text && num(`select count(*) from admin_password_resets where admin_id = ${mid}`) === 0,
      'a switched-off member is mailed no code, and is answered exactly as an address that is not on the team', rqM.text + ' / ' + rqN.text)
    const CODE = '12345678'
    const CH = hashOf(CODE)
    sql(`replace into admin_password_resets (admin_id, code_hash, attempts, expires_at) values
         (${actorId}, ${lit(CH)}, 0, now() + interval 1 day), (${mid}, ${lit(CH)}, 0, now() + interval 1 day)`)
    const NEWPW = 'Rig-' + hex(10)
    const hashBefore = one(`select password_hash from admin_users where id = ${mid}`)
    const cA = await panel(base)('password_reset_confirm', { email: 'users-rig-actor@example.invalid', code: CODE, password: NEWPW, password2: NEWPW })
    const cM = await panel(base)('password_reset_confirm', { email: MEMBER, code: CODE, password: NEWPW, password2: NEWPW })
    check('T9c', cA.status === 200 && cA.body?.ok === true, 'control: the same planted code resets a member who is on', cA.text)
    const st9 = rows(`select password_hash, disabled_at, failed_attempts from admin_users where id = ${mid}`)[0] ?? {}
    check('T9d', cM.status === 401 && cM.body?.error === 'reset_refused' && st9.password_hash === hashBefore && st9.disabled_at != null && st9.failed_attempts === '1',
      'and is refused for a switched-off member with the answer a wrong code gets (reset_refused): password unchanged, still off, nothing cleared', cM.text + ' ' + JSON.stringify({ ...st9, password_hash: st9.password_hash === hashBefore }))

    // ---- switch on
    fresh()
    sql(`update admin_users set failed_attempts = 5, locked_until = now() + interval 1 hour where id = ${mid}`)
    r = await mgr('team_unlock', { id: mid, password: 'not the password' })
    check('T10a', r.status === 401 && r.body?.error === 'bad_password' && one(`select disabled_at is not null from admin_users where id = ${mid}`) === '1',
      'Switch on with a wrong password is refused, and the member stays off', r.text)
    r = await mgr('team_unlock', { id: mid, password: MANAGER_PW })
    const st10 = rows(`select disabled_at, failed_attempts, locked_until from admin_users where id = ${mid}`)[0] ?? {}
    check('T10b', r.status === 200 && st10.disabled_at === null && st10.failed_attempts === '0' && st10.locked_until === null,
      'Switch on clears the switch AND the brute-force lock (disabled_at, failed_attempts, locked_until)', r.text.slice(0, 160) + ' ' + JSON.stringify(st10))
    const back = panel(base)
    r = await back('login', { email: MEMBER, password: temp })
    check('T10c', r.status === 200 && (await back('me')).body?.email === MEMBER && num(`select count(*) from admin_passkeys where admin_id = ${mid}`) === 1,
      'and the member signs in again with the password they had, their passkey still there', r.text)

    // ---- remove
    fresh()
    r = await mgr('team_remove', { id: mgrId, password: MANAGER_PW })
    check('T11a', r.status === 409 && r.body?.error === 'cannot_remove_self', 'Remove refuses your own account (cannot_remove_self)', r.text)
    r = await mgr('team_remove', { id: 99999999, password: MANAGER_PW })
    check('T11b', r.status === 404 && r.body?.error === 'member_not_found', 'and an id that is not on the team (member_not_found)', r.text)
    r = await mgr('team_remove', { id: mid, password: 'not the password' })
    check('T11c', r.status === 401 && r.body?.error === 'bad_password' && num(`select count(*) from admin_users where id = ${mid}`) === 1 &&
      (await back('me')).body?.email === MEMBER, 'a wrong password is refused and removes nobody; the member stays signed in', r.text)
    plantDoors()
    const auditTeam = () => num("select count(*) from admin_audit_log where route like 'team\\_%'")
    const auditBefore = auditTeam()
    r = await mgr('team_remove', { id: mid, password: MANAGER_PW })
    const left = rows(`select (select count(*) from admin_users where id = ${mid}) as u, (select count(*) from admin_passkeys where admin_id = ${mid}) as pk,
        (select count(*) from admin_sessions where admin_id = ${mid}) as s, (select count(*) from admin_devices where admin_id = ${mid}) as d,
        (select count(*) from admin_password_resets where admin_id = ${mid}) as rs`)[0] ?? {}
    check('T11d', r.status === 200 && r.body?.removed === mid && Object.values(left).every((v) => v === '0'),
      'Remove deletes the member and everything that could let them back in: passkeys, ledger rows, passcode devices, reset codes', r.text + ' ' + JSON.stringify(left))
    me = await back('me')
    check('T11e', me.status === 200 && me.body === null,
      "the removed member's browser, signed in a moment before, is signed out on its very next request — the ledger rows went with the account, so only the row check can see it", me.text.slice(0, 160))
    const gone = await panel(base)('login', { email: MEMBER, password: temp })
    check('T11f', auditTeam() === auditBefore + 1 && gone.status === 401 && gone.body?.error === 'bad_credentials',
      'the Activity log keeps every earlier team_* row (and gains the removal), and the address no longer signs in', `audit ${auditBefore} -> ${auditTeam()}; ${gone.text}`)

    /* ---------------------------------------------------------------- R. the last-active-admin race */
    fresh()
    sql(`insert into admin_users (email, password_hash) values ('users-rig-race@example.invalid', ${lit(H)})`)
    const bId = num("select id from admin_users where email = 'users-rig-race@example.invalid'")
    // Only the manager and the target on, so the guard has exactly one other active admin to lose.
    sql(`update admin_users set disabled_at = coalesce(disabled_at, now()) where id not in (${mgrId}, ${bId})`)
    const race = async (route) => {
      // A FRESH SIGN-IN first: sec_session_alive() writes last_seen at most once a minute, and that write
      // checks the foreign key against the very row being held — it would queue there instead of at the
      // guard, and the request would end as not_signed_in, which tests nothing.
      mgr = await signIn(base, MANAGER, MANAGER_PW)
      const holder = spawn('mariadb', ['-u', 'root', '--batch', '--unbuffered', '-N', shop.db], { stdio: ['pipe', 'pipe', 'pipe'] })
      let out = ''
      holder.stdout.on('data', (d) => { out += d })
      const exited = new Promise((res) => holder.on('exit', res))
      holder.stdin.write(`begin; select id from admin_users where id = ${mgrId} for update; select 'held';\n`)
      for (let i = 0; i < 50 && !out.includes('held'); i++) await sleep(100)
      if (!out.includes('held')) throw new Error('the race holder never took the row lock')
      const pending = mgr(route, { id: bId, password: MANAGER_PW })
      await sleep(1200)
      holder.stdin.write(`update admin_users set disabled_at = now() where id = ${mgrId}; commit; select 'done';\n`)
      holder.stdin.end()
      const res = await pending
      await exited
      return res
    }
    let rr = await race('team_lock')
    check('R1', rr.status === 409 && rr.body?.error === 'last_active_admin',
      'two admins switching each other off at once: the request that would leave no active admin waits on the row lock, counts again, and is refused (last_active_admin)', rr.text)
    check('R2', one(`select disabled_at is null from admin_users where id = ${bId}`) === '1', 'and the target was NOT switched off')
    sql(`update admin_users set disabled_at = null where id in (${mgrId}, ${bId})`)
    fresh()
    rr = await race('team_remove')
    check('R3', rr.status === 409 && rr.body?.error === 'last_active_admin', 'the same race on Remove is refused the same way', rr.text)
    check('R4', num(`select count(*) from admin_users where id = ${bId}`) === 1, 'and the target still exists')
    sql(`update admin_users set disabled_at = null where id = ${mgrId}`)    // the copy's manager back on for what follows
    mgr = await signIn(base, MANAGER, MANAGER_PW)

    /* ---------------------------------------------------------------- S. shoppers */
    fresh()
    const A = 'users-rig-a@example.invalid'
    const PA = 'users-rig-shopper-' + hex(6)
    const sA = shopper(base)
    r = await sA('customer_register', { email: A, password: PA, name: 'Users Rig Alpha', phone: '55512345' })
    const aId = r.body?.customer?.id
    if (!aId) throw new Error('the scratch shop would not register a shopper: ' + r.text.slice(0, 200))
    const PHONE = one(`select phone from customers where id = ${aId}`)
    const unusable = hashOf('users-rig-unused-' + hex(6))
    sql(`insert into customers (email, phone, name, password_hash, verified_at, last_seen_at) values
         ('users-rig-b@example.invalid', '96566612345', 'ريم عبدالله', ${lit(unusable)}, now(), now()),
         ('users_rig-under@example.invalid', null, 'Underscore', ${lit(unusable)}, null, null)`)
    // Enough accounts for a second page, so paging is measured rather than assumed.
    sql('insert into customers (email, password_hash) values ' +
      Array.from({ length: 55 }, (_, i) => `('users-rig-bulk-${String(i).padStart(2, '0')}@example.invalid', ${lit(unusable)})`).join(', '))
    const bId2 = num("select id from customers where email = 'users-rig-b@example.invalid'")
    const uId = num("select id from customers where email = 'users_rig-under@example.invalid'")
    sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_email, customer_area, customer_id) values
         ('SPUSRAPI0001', 5.000, 'paid', 'knet', 'shipped', 'Users Rig Alpha', '${PHONE}', '${A}', 'x', ${aId}),
         ('SPUSRAPI0002', 7.500, 'pending', 'cod', 'unfulfilled', 'Users Rig Alpha', '${PHONE}', '${A}', 'x', ${aId}),
         ('SPUSRAPI0009', 6.000, 'pending', 'cod', 'unfulfilled', 'Somebody Else', '${PHONE}', 'someone-else@example.invalid', 'x', null)`)
    sql(`insert into customer_passkeys (customer_id, credential_id, public_key, alg, label) values (${aId}, unhex('C1C2C3C4C5'), 'rig', -7, 'Rig phone')`)
    // Each with WRONG TRIES of its own, the unused one too: customer_code_verify()'s twenty-a-day cap sums them all.
    sql(`insert into customer_login_codes (email, code_hash, attempts, expires_at, used_at) values
         ('${A}', sha2('users-rig-code-unused', 256), 4, now() + interval 10 minute, null),
         ('${A}', sha2('users-rig-code-used', 256), 3, now() + interval 10 minute, now())`)
    const tries = () => rows(`select count(*) as n, coalesce(sum(attempts), 0) as sum, coalesce(sum(used_at is null), 0) as unused from customer_login_codes where email = '${A}'`)[0] ?? {}
    const ids = (x) => (x.body?.shoppers ?? []).map((s) => s.id).sort((a, b) => a - b)
    const dbIds = (where) => rows(`select id from customers where ${where} order by id`).map((x) => Number(x.id))

    // ---- the list
    const total = num('select count(*) from customers')
    const p1 = await mgr('shoppers')
    const p2 = await mgr('shoppers&page=2')
    const want1 = rows('select id from customers order by id desc limit 50').map((x) => Number(x.id))
    const want2 = rows('select id from customers order by id desc limit 50 offset 50').map((x) => Number(x.id))
    check('S1a', p1.status === 200 && p1.body?.ready === true && total >= 58 && p1.body.total === total && p1.body.pages === Math.ceil(total / 50) &&
      eq((p1.body.shoppers ?? []).map((s) => s.id), want1),
      `the list is every account, newest first, fifty a page (${total} accounts, ${Math.ceil(total / 50)} pages)`, p1.text.slice(0, 200))
    check('S1b', p2.body?.page === 2 && want2.length > 0 && eq((p2.body.shoppers ?? []).map((s) => s.id), want2), 'page 2 is the next fifty', p2.text.slice(0, 160))
    // A registered first, so the fifty-five newer accounts push it onto page 2.
    const rowA = [...(p1.body?.shoppers ?? []), ...(p2.body?.shoppers ?? [])].find((s) => s.id === aId)
    const dbA = rows(`select email, name, phone, verified_at, last_seen_at, blocked_at,
        (select count(*) from orders o where o.customer_id = c.id) as o, (select count(*) from customer_passkeys p where p.customer_id = c.id) as pk
        from customers c where id = ${aId}`)[0] ?? {}
    check('S1c', !!rowA && rowA.email === dbA.email && rowA.name === dbA.name && rowA.phone === dbA.phone && rowA.orders === Number(dbA.o) && rowA.orders === 2 &&
      rowA.passkeys === Number(dbA.pk) && rowA.passkeys === 1 && rowA.last_signin_at === dbA.last_seen_at && rowA.verified_at === dbA.verified_at &&
      !('password_hash' in rowA) && !/\$2[aby]\$\d\d\$/.test(p1.text + p2.text),
      'a row carries its orders by customer_id (2 — not the guest order on the same phone) and its passkeys, as the database has them, and no hash', JSON.stringify(rowA) ?? 'A is on neither page')
    // "Show more" pages by KEY. An account registering between page 1 and page 2 moved every OFFSET by one, and
    // page 2 began with page 1's last row again (review, 2026-10-14) — so one registers here, between the two.
    const p1ids = (p1.body?.shoppers ?? []).map((x) => x.id)
    const lastP1 = p1ids[p1ids.length - 1]
    sql("insert into customers (email, password_hash) values ('users-rig-late@example.invalid', 'x')")
    const more = await mgr('shoppers&before=' + lastP1)
    const wantMore = rows(`select id from customers where id < ${lastP1} order by id desc limit 50`).map((x) => Number(x.id))
    const twice = (more.body?.shoppers ?? []).map((x) => x.id).filter((id) => p1ids.includes(id))
    check('S1d', p1ids.length === 50 && wantMore.length > 0 && eq((more.body?.shoppers ?? []).map((x) => x.id), wantMore) && twice.length === 0 &&
      more.body?.more === (num(`select count(*) from customers where id < ${lastP1}`) > 50) && p1.body?.more === true,
      'Show more asks for the accounts below the last one drawn: one registering in between neither repeats a row nor hides one, and `more` says whether any are left',
      `shown twice: ${JSON.stringify(twice)}; got ${JSON.stringify((more.body?.shoppers ?? []).map((x) => x.id).slice(0, 4))}… want ${JSON.stringify(wantMore.slice(0, 4))}…`)
    sql("delete from customers where email = 'users-rig-late@example.invalid'")

    // ---- search
    const q = (term) => mgr('shoppers&q=' + encodeURIComponent(term))
    const byPhone = dbIds("email like '%55512345%' or name like '%55512345%' or phone like '%55512345%'")
    const sres = {
      email: await q('users-rig-a@'), name: await q('Rig Alpha'), arabicName: await q('ريم'),
      digits: await q('55512345'), arabicDigits: await q('٥٥٥١٢٣٤٥'), persianDigits: await q('۵۵۵۱۲۳۴۵'), underscore: await q('users_rig'),
    }
    check('S2a', eq(ids(sres.email), [aId]) && eq(ids(sres.email), dbIds("email like '%users-rig-a@%' or name like '%users-rig-a@%'")), 'search finds an account by email', JSON.stringify(ids(sres.email)))
    check('S2b', eq(ids(sres.name), [aId]) && eq(ids(sres.arabicName), dbIds("name like '%ريم%' or email like '%ريم%'")) && ids(sres.arabicName).includes(bId2),
      'and by name, Arabic included', JSON.stringify([ids(sres.name), ids(sres.arabicName)]))
    check('S2c', byPhone.includes(aId) && eq(ids(sres.digits), byPhone), 'and by phone digits', JSON.stringify(ids(sres.digits)))
    check('S2d', eq(ids(sres.arabicDigits), byPhone) && eq(ids(sres.persianDigits), byPhone),
      'and by the same phone typed in Arabic-Indic or Persian digits', JSON.stringify([ids(sres.arabicDigits), ids(sres.persianDigits)]))
    check('S2e', eq(ids(sres.underscore), [uId]) && eq(ids(sres.underscore), dbIds("email like '%users\\_rig%' or name like '%users\\_rig%'")),
      'an underscore in the box is a LITERAL underscore — not LIKE\'s any-character, which would match every users-rig- account', `${ids(sres.underscore).length} found`)
    // 00 is how the international prefix is dialled, and customers.phone (965XXXXXXXX) has no 00 in it.
    const dialled = [await q('00965 5551 2345'), await q('0096555512345')]
    check('S2f', byPhone.length > 0 && dialled.every((x) => eq(ids(x), byPhone)), 'and by the phone written with its 00965 prefix, spaced or not', JSON.stringify(dialled.map(ids)))

    // ---- the detail
    const guest = rows("select customer_id, customer_phone from orders where track_id = 'SPUSRAPI0009'")[0] ?? {}
    const d = await mgr('shopper&id=' + aId)
    const wantOrders = rows(`select track_id from orders where customer_id = ${aId} order by id desc`).map((x) => x.track_id)
    check('S3a', guest.customer_id === null && guest.customer_phone === PHONE && wantOrders.length === 2 && d.status === 200 &&
      eq((d.body?.orders ?? []).map((o) => o.track_id), wantOrders) && !(d.body?.orders ?? []).some((o) => o.track_id === 'SPUSRAPI0009'),
      "the account's orders are found by customer_id ONLY — a guest order placed with the SAME phone and no account does not appear", JSON.stringify((d.body?.orders ?? []).map((o) => o.track_id)))
    const dB = await mgr('shopper&id=' + bId2)
    check('S3b', d.body?.shopper && !('password_hash' in d.body.shopper) && !/\$2[aby]\$\d\d\$/.test(d.text + dB.text) &&
      d.body.shopper.password_usable === (dbA.verified_at === null) && d.body.shopper.password_usable === true && dB.body?.shopper?.password_usable === false,
      '"password usable" is true for an account still on the password it chose and false for one whose address was proved — and no hash travels', JSON.stringify([d.body?.shopper?.password_usable, dB.body?.shopper?.password_usable]))
    const wantKeys = rows(`select label from customer_passkeys where customer_id = ${aId} order by id`).map((x) => x.label)
    check('S3c', wantKeys.length === 1 && eq((d.body?.passkeys ?? []).map((k) => k.label), wantKeys) && d.body?.phone_block === null &&
      num(`select count(*) from blocked_customers where phone = '${PHONE}'`) === 0, 'the detail lists its passkeys, and no phone block where the checkout list has none', JSON.stringify([d.body?.passkeys, d.body?.phone_block]))
    r = await mgr('shopper&id=99999999')
    check('S3d', r.status === 404 && r.body?.error === 'shopper_not_found', 'an unknown account is 404 shopper_not_found', r.text)
    // THE DETAIL NAMES ITS COLUMNS. A column added to customers later — say a reset-token hash — must not reach the
    // panel by default, as it did while the row was `select *` minus the password (review, 2026-10-14). One is added
    // here, in the copy, with a value; the detail must carry exactly the columns the screen shows, and not it.
    sql(`alter table customers add column users_rig_secret varchar(64) null; update customers set users_rig_secret = 'users-rig-secret-value-${hex(4)}' where id = ${aId}`)
    const d3 = await mgr('shopper&id=' + aId)
    const KEYS = 'blocked_at,blocked_by,blocked_reason,created_at,email,id,last_seen_at,last_signin_at,name,password_usable,phone,signed_out_at,verified_at'
    check('S3e', one(`select users_rig_secret from customers where id = ${aId}`).startsWith('users-rig-secret-value-') && d3.status === 200 &&
      Object.keys(d3.body?.shopper ?? {}).sort().join() === KEYS && !d3.text.includes('users-rig-secret-value-') && !d3.text.includes('users_rig_secret'),
      'the detail carries exactly the columns the screen shows — a column added to customers later (planted, with a value) does not travel',
      Object.keys(d3.body?.shopper ?? {}).sort().join())
    sql('alter table customers drop column users_rig_secret')

    // ---- block
    fresh()
    // A SECOND BROWSER, signed in and then left IDLE through the block and the unblock that follows: the hijacker's,
    // in the case the owner blocks for. Signed in a second before the block, so "at or before the cut-off" is clear.
    const sIdle = shopper(base)
    r = await sIdle('customer_login', { email: A, password: PA })
    if (r.status !== 200) throw new Error('the idle browser could not sign in: ' + r.text.slice(0, 160))
    await sleep(1100)
    sql(`update customers set last_seen_at = '2026-01-01 00:00:00' where id = ${aId}`)
    const pre4 = await sA('customer_me')
    r = await mgr('shopper_block', { id: aId, reason: 'users rig reason', phone_too: true })
    const st4 = rows(`select blocked_at, blocked_reason, blocked_by from customers where id = ${aId}`)[0] ?? {}
    const pb = rows(`select scope from blocked_customers where phone = '${PHONE}'`)[0]
    check('S4a', pre4.body?.customer?.id === aId && r.status === 200 && r.body?.phone_blocked === true && st4.blocked_at != null &&
      st4.blocked_reason === 'users rig reason' && st4.blocked_by === MANAGER && pb?.scope === 'all',
      "Block sets blocked_at, the reason and who — and, asked to, puts the phone on the checkout's block list (scope all)", r.text + ' ' + JSON.stringify([st4, pb]))
    const codes4 = tries()
    check('S4b', codes4.n === '2' && codes4.unused === '0' && codes4.sum === '7' && num(`select count(*) from customer_passkeys where customer_id = ${aId}`) === 1,
      "the pending sign-in code is SPENT, not deleted — both rows and all seven wrong tries stay for the day's cap — and the passkey is kept for an unblock", JSON.stringify(codes4))
    const me4 = await sA('customer_me')
    check('S4c', me4.status === 200 && me4.body?.customer === null, "the shopper's own signed-in browser is signed out on its very next request", me4.text)
    const unknownS = await shopper(base)('customer_login', { email: 'users-rig-nobody@example.invalid', password: 'not-the-password-1' })
    const wrongS = await shopper(base)('customer_login', { email: A, password: 'not-the-password-1' })
    check('S4d', wrongS.status === 401 && wrongS.body?.error === 'bad_credentials' && wrongS.text === unknownS.text,
      'a WRONG password for the blocked account gets the ordinary answer — the same as an address with no account', wrongS.text + ' / ' + unknownS.text)
    const right = await shopper(base)('customer_login', { email: A, password: PA })
    check('S4e', right.status === 403 && right.body?.error === 'account_blocked' && right.setCookie.length === 0,
      'the RIGHT password is refused: 403 account_blocked, and no cookie is minted', `${right.status} ${right.text} cookies=${right.setCookie.length}`)
    check('S4f', one(`select last_seen_at from customers where id = ${aId}`) === '2026-01-01 00:00:00', 'and the refused sign-in is not recorded as a "last sign-in"')
    const fb = await mgr('shoppers&filter=blocked')
    const wantBlocked = dbIds('blocked_at is not null')
    check('S4g', wantBlocked.includes(aId) && eq(ids(fb), wantBlocked) && fb.body?.total === wantBlocked.length, 'the Blocked filter lists exactly the blocked accounts', JSON.stringify(ids(fb)))
    const d4 = await mgr('shopper&id=' + aId)
    check('S4h', d4.body?.phone_block?.scope === 'all' && d4.body?.shopper?.blocked_reason === 'users rig reason' && d4.body?.shopper?.blocked_at != null,
      'the detail shows the account block and the phone block', JSON.stringify(d4.body?.phone_block))

    // The NUMBER may already be on the checkout's list, from the CRM card, with the owner's own reason. Blocking the
    // ACCOUNT with no reason typed and "also its phone" ticked replaced that note with nothing (review, 2026-10-14).
    const PB = one(`select phone from customers where id = ${bId2}`)
    sql(`insert into blocked_customers (phone, scope, reason, blocked_by) values ('${PB}', 'cod', 'users rig: three refused COD parcels', 'users-rig')`)
    r = await mgr('shopper_block', { id: bId2, reason: '', phone_too: true })
    const pbB = rows(`select scope, reason from blocked_customers where phone = '${PB}'`)[0] ?? {}
    check('S4j', r.status === 200 && r.body?.phone_blocked === true && pbB.scope === 'all' && pbB.reason === 'users rig: three refused COD parcels',
      "blocking an account with no reason keeps the reason the CRM card wrote for its number (the scope still becomes 'all')", JSON.stringify(pbB))
    await mgr('shopper_unblock', { id: bId2, phone_too: true })

    // ---- unblock
    r = await mgr('shopper_unblock', { id: aId, phone_too: true })
    const st5 = rows(`select blocked_at, blocked_reason, blocked_by from customers where id = ${aId}`)[0] ?? {}
    check('S5a', r.status === 200 && r.body?.phone_unblocked === true && st5.blocked_at === null && st5.blocked_reason === null && st5.blocked_by === null &&
      num(`select count(*) from blocked_customers where phone = '${PHONE}'`) === 0, 'Unblock clears the three columns and, asked to, the phone block', r.text + ' ' + JSON.stringify(st5))
    const idle5 = await sIdle('customer_me')
    check('S4i', idle5.status === 200 && idle5.body?.customer === null,
      'the browser left IDLE through the block — no request while it stood — is still signed out after the unblock: a block is a sign-out everywhere too', idle5.text)
    // The block's cut-off is "signed in at or before", to the second: a sign-in in that same second would end too.
    await sleep(1100)
    const sA2 = shopper(base)
    r = await sA2('customer_login', { email: A, password: PA })
    check('S5b', r.status === 200 && (await sA2('customer_me')).body?.customer?.id === aId, 'and the shopper signs in again, and stays signed in', r.text.slice(0, 120))

    // ---- sign out everywhere
    sql(`insert into customer_login_codes (email, code_hash, attempts, expires_at) values ('${A}', sha2('users-rig-code-2', 256), 2, now() + interval 10 minute)`)
    const pk6 = num(`select count(*) from customer_passkeys where customer_id = ${aId}`)
    const tries6 = tries()
    await sleep(1100)   // the cut-off is "signed in at or before", to the second: a sign-in in the same second is ended too
    r = await mgr('shopper_signout', { id: aId })
    check('S6a', r.status === 200 && pk6 === 1 && r.body?.passkeys_removed === pk6 && r.body?.codes_ended === 1 &&
      num(`select count(*) from customer_passkeys where customer_id = ${aId}`) === 0 &&
      num(`select count(*) from customer_login_codes where email = '${A}' and used_at is null`) === 0 &&
      one(`select signed_out_at is not null from customers where id = ${aId}`) === '1',
      'Sign out everywhere stamps the account, removes its passkeys and spends its pending code', r.text)
    const after6 = tries()
    check('S6d', tries6.unused === '1' && after6.unused === '0' && after6.n === tries6.n && after6.sum === tries6.sum && Number(after6.sum) >= 9,
      "and every code row's wrong tries stay: pressing it does not hand a guesser a fresh allowance under the twenty-a-day cap", JSON.stringify([tries6, after6]))
    const me6 = await sA2('customer_me')
    check('S6b', me6.status === 200 && me6.body?.customer === null, 'the browser that signed in BEFORE it is signed out on its very next request', me6.text)
    await sleep(1100)
    const sA3 = shopper(base)
    r = await sA3('customer_login', { email: A, password: PA })
    check('S6c', r.status === 200 && (await sA3('customer_me')).body?.customer?.id === aId,
      'and signing in AFTER it works, and stays — Sign out everywhere is not a block', r.text.slice(0, 120))

    // ---- delete
    sql(`insert into blocked_customers (phone, scope, reason, blocked_by) values ('${PHONE}', 'cod', 'users rig', 'users-rig') on duplicate key update scope = 'cod'`)
    sql(`insert into customer_passkeys (customer_id, credential_id, public_key, alg, label) values (${aId}, unhex('D1D2D3D4D5'), 'rig', -7, 'Rig phone 2')`)
    sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${A}', sha2('users-rig-code-3', 256), now() + interval 10 minute)`)
    const linked = num(`select count(*) from orders where customer_id = ${aId}`)
    r = await mgr('shopper_delete', { id: aId, email: 'users-rig-b@example.invalid' })
    check('S7a', r.status === 409 && r.body?.error === 'email_mismatch' && num(`select count(*) from customers where id = ${aId}`) === 1 &&
      num(`select count(*) from orders where customer_id = ${aId}`) === linked, "Delete refuses when the typed address is not this account's (email_mismatch), and changes nothing", r.text)
    r = await mgr('shopper_delete', { id: aId, email: '  USERS-RIG-A@example.invalid ' })
    check('S7b', r.status === 200 && linked === 2 && r.body?.orders_unlinked === linked && num(`select count(*) from customers where id = ${aId}`) === 0,
      'with the address typed back (any case) the account is removed, and the answer counts the orders it unlinked', r.text)
    const ords = rows("select track_id, customer_id from orders where track_id like 'SPUSRAPI%' order by track_id")
    check('S7c', ords.length === 3 && ords.every((o) => o.customer_id === null) &&
      num(`select count(*) from customer_passkeys where customer_id = ${aId}`) === 0 && num(`select count(*) from customer_login_codes where email = '${A}'`) === 0 &&
      num(`select count(*) from blocked_customers where phone = '${PHONE}'`) === 1,
      "its orders are KEPT, unlinked; its passkeys and codes go; the phone's own block stays", JSON.stringify(ords))
    const me7 = await sA3('customer_me')
    check('S7d', me7.status === 200 && me7.body?.customer === null, 'the browser still signed in to it is signed out on its next request', me7.text)
    r = await shopper(base)('customer_register', { email: A, password: PA })
    const a2Id = r.body?.customer?.id
    check('S7e', r.status === 200 && !!a2Id && a2Id !== aId, 'and the address may register again — deletion on request is not a ban (Block is)', r.text.slice(0, 120))

    /* ---------------------------------------------------------------- S8. a refused door changes nothing */
    // A BLOCKED account proving itself at a door that is about to refuse it: the passkey door wrote last_used_at and
    // the sign count first, and for an account whose address was never proved the emailed-code door ran the
    // pre-hijack wipe first — a new random password, verified_at, and the passkeys deleted — the very things Unblock
    // promises to give back (review, 2026-10-14). Real credentials: a software passkey and a correctly-made code.
    fresh()
    const CE = 'users-rig-c@example.invalid', PC = 'users-rig-shopper-' + hex(6)
    r = await shopper(base)('customer_register', { email: CE, password: PC })
    const cId = r.body?.customer?.id
    if (!cId) throw new Error('fixture shopper C would not register: ' + r.text.slice(0, 160))
    const cKey = softKey()
    sql(`insert into customer_passkeys (customer_id, credential_id, public_key, alg, sign_count, label) values (${cId}, unhex('${cKey.credHex}'), ${lit(cKey.pem)}, -7, 0, 'rig soft key')`)
    r = await mgr('shopper_block', { id: cId, reason: 'users rig: refused doors', phone_too: false })
    if (r.status !== 200) throw new Error('could not block C: ' + r.text.slice(0, 160))
    const cRow = () => rows(`select c.password_hash, c.verified_at, (select count(*) from customer_passkeys k where k.customer_id = c.id) as pk,
        (select concat(sign_count, '|', ifnull(last_used_at, 'never')) from customer_passkeys k where k.credential_id = unhex('${cKey.credHex}')) as soft
        from customers c where c.id = ${cId}`)[0] ?? {}
    const c0 = cRow()
    const sk = shopper(base)
    const opt = await sk('customer_passkey_options_login', {})
    r = await sk('customer_passkey_login', assertion(base, cKey, opt.body?.challenge ?? '', 5))
    const c1 = cRow()
    check('S8a', !!opt.body?.challenge && r.status === 403 && r.body?.error === 'account_blocked' && c1.soft === '0|never' && (await sk('customer_me')).body?.customer === null,
      "a blocked shopper's passkey, with a valid signature, is refused (account_blocked) and records nothing: no sign count, no \"last used\"",
      `${r.status} ${r.text.slice(0, 100)} soft=${c1.soft}`)
    const cronKey = php('$c = require $argv[1]; echo (string) ($c["cron_key"] ?? "");', shop.apiDir + '/config.php')
    const CODE8 = '246813'
    sql(`insert into customer_login_codes (email, code_hash, expires_at) values ('${CE}', '${createHmac('sha256', cronKey).update(`customer-code|${CE}|${CODE8}`).digest('hex')}', now() + interval 10 minute)`)
    r = await shopper(base)('customer_code_verify', { email: CE, code: CODE8 })
    const c2 = cRow()
    check('S8b', c0.verified_at === null && c0.pk === '1' && r.status === 403 && r.body?.error === 'account_blocked' &&
      c2.password_hash === c0.password_hash && c2.verified_at === null && c2.pk === '1',
      "and the right emailed code for a blocked, never-proved account is refused WITHOUT the pre-hijack wipe: its password, its passkey and its unproved state all kept",
      `${r.status} ${r.text.slice(0, 100)} hash kept=${c2.password_hash === c0.password_hash} verified=${c2.verified_at} passkeys=${c2.pk}`)
    r = await mgr('shopper_unblock', { id: cId, phone_too: false })
    await sleep(1100)   // past the block's cut-off second
    const sC = shopper(base)
    r = await sC('customer_login', { email: CE, password: PC })
    check('S8c', r.status === 200 && (await sC('customer_me')).body?.customer?.id === cId && cRow().pk === '1',
      'so Unblock gives back what it promised: the password signs in again, and the passkey is still there', r.text.slice(0, 120))

    /* ---------------------------------------------------------------- N. before the migration */
    sql(`alter table customers drop column blocked_at, drop column blocked_reason, drop column blocked_by, drop column signed_out_at;
         alter table admin_users drop column disabled_at, drop column added_by`)
    const dropped = num(`select count(*) from information_schema.columns where table_schema = '${shop.db}' and
        ((table_name = 'customers' and column_name in ('blocked_at', 'blocked_reason', 'blocked_by', 'signed_out_at')) or
         (table_name = 'admin_users' and column_name in ('disabled_at', 'added_by')))`)
    fresh()
    const nm = panel(base)
    r = await nm('login', { email: MANAGER, password: MANAGER_PW })
    const nme = await nm('me'), nst = await nm('stats'), old = await mgr('me')
    check('N1', dropped === 0 && r.status === 200 && nme.body?.email === MANAGER && nst.status === 200 && old.body?.email === MANAGER,
      'without the six columns the panel signs in, a browser already signed in stays so, and a gated route answers', `${dropped} left; ${r.text.slice(0, 100)} ${nst.status}`)
    const ns = shopper(base)
    r = await ns('customer_login', { email: A, password: PA })
    const nreg = shopper(base)
    r2 = await nreg('customer_register', { email: 'users-rig-n@example.invalid', password: PA })
    check('N2', r.status === 200 && (await ns('customer_me')).body?.customer?.id === a2Id && r2.status === 200 && (await nreg('customer_me')).body?.customer?.id === r2.body?.customer?.id,
      'and a shopper signs in, or registers, and stays signed in', r.text.slice(0, 100) + ' / ' + r2.text.slice(0, 100))
    const notReady = []
    for (const [route, body] of [['team'], ['shoppers'], ['shopper&id=' + a2Id],
      ['team_add', { email: 'users-rig-x@example.invalid', password: MANAGER_PW }], ['team_lock', { id: bId, password: MANAGER_PW }],
      ['team_unlock', { id: bId, password: MANAGER_PW }], ['team_remove', { id: bId, password: MANAGER_PW }],
      ['shopper_block', { id: a2Id }], ['shopper_unblock', { id: a2Id }], ['shopper_signout', { id: a2Id }], ['shopper_delete', { id: a2Id, email: A }]]) {
      const x = await nm(route, body)
      if (!(x.status === 503 && x.body?.error === 'users_not_ready')) notReady.push(`${route.split('&')[0]}=${x.status} ${x.text.slice(0, 60)}`)
    }
    check('N3', notReady.length === 0 && num(`select count(*) from customers where id = ${a2Id}`) === 1 && num(`select count(*) from admin_users where id = ${bId}`) === 1,
      'every Users route answers 503 users_not_ready until migrate-users.php has run, and writes nothing', notReady.join('; '))

    /* ---------------------------------------------------------------- M. the migrator, on the copy */
    // The copy has none of the six now (N dropped them). migrate-users.php is run as the live server runs it, on the
    // file it finds in api/: the real one must add all six, and four that are not it must change nothing. The first
    // version checked only that every clause was an ADD COLUMN IF NOT EXISTS, and ran each of these, reporting READY
    // (review, 2026-10-14) — so each is one the old check let through.
    const SQLFILE = shop.apiDir + '/users.mysql.sql'
    const GENUINE = readFileSync(ROOT + 'sporta-site/public_html/api/users.mysql.sql', 'utf8')
    const migrate = (body) => { writeFileSync(SQLFILE, body); return spawnSync('php', [MIGRATOR], { encoding: 'utf8' }).stdout }
    const colType = (t, c) => one(`select column_type from information_schema.columns where table_schema = '${shop.db}' and table_name = '${t}' and column_name = '${c}'`)
    const SIX = [['customers', 'blocked_at', 'timestamp'], ['customers', 'blocked_reason', 'varchar(200)'], ['customers', 'blocked_by', 'varchar(120)'],
      ['customers', 'signed_out_at', 'timestamp'], ['admin_users', 'disabled_at', 'timestamp'], ['admin_users', 'added_by', 'varchar(120)']]
    let out = migrate(GENUINE)
    check('M1', /columns=6\/6/.test(out) && /READY —/.test(out) && SIX.every(([t, c, ty]) => colType(t, c) === ty),
      'the real api/users.mysql.sql adds all six columns with their types, and says READY 6/6', out.trim().split('\n').pop())
    const swap = (from, to) => { if (!GENUINE.includes(from)) throw new Error('the M fixture no longer finds: ' + from); return GENUINE.replace(from, to) }
    sql('alter table customers drop column blocked_reason')     // so a wrongly typed blocked_reason would be CREATED, and seen
    const bad = {
      'a seventh column': swap('signed_out_at  timestamp    null default null;', 'signed_out_at  timestamp    null default null,\n  add column if not exists users_rig_extra timestamp null default null;'),
      'NOT NULL with a default': swap('add column if not exists signed_out_at  timestamp    null default null', 'add column if not exists users_rig_nn int not null default 7'),
      'a UNIQUE column': swap('blocked_by     varchar(120) null', 'blocked_by     varchar(120) null unique'),
      'a listed column, wrongly typed': swap('blocked_reason varchar(200) null', 'blocked_reason varchar(1) null'),
    }
    const ran = []
    for (const [what, body] of Object.entries(bad)) { const o = migrate(body); if (!/not the expected statements — nothing done/.test(o)) ran.push(`${what}: ${o.trim().split('\n').pop()}`) }
    const strays = one(`select count(*) from information_schema.columns where table_schema = '${shop.db}' and column_name like 'users\\_rig\\_%'`)
    check('M2', ran.length === 0 && strays === '0' && colType('customers', 'blocked_reason') === '',
      'four files that are not the migration — a seventh column, NOT NULL with a default, UNIQUE, a listed column wrongly typed — are each refused, and change nothing',
      ran.join(' ; ') + ` strays=${strays} blocked_reason=${colType('customers', 'blocked_reason') || 'absent'}`)
    // As a different file might have left it — and whatever M2 did, under a mutation that let a bad file run.
    sql('alter table customers add column if not exists blocked_reason varchar(1) null; alter table customers modify blocked_reason varchar(1) null')
    out = migrate(GENUINE)
    check('M3', /customers\.blocked_reason=wrongtype\(varchar\(1\)\)/.test(out) && /columns=5\/6/.test(out) && /^NOT READY/m.test(out),
      'STATE reads each column\'s TYPE back: a blocked_reason that exists as varchar(1) is wrongtype, and the run is NOT READY', out.trim().split('\n').slice(-2).join(' | '))
  } finally {
    await shop.stop()
  }
}

/* ================================================================== UI half: a real browser on BASE */
async function uiHalf() {
  const { chromium } = await import('playwright')
  // utf8mb4 on the client, or the Arabic fixture name goes in as question marks (CLAUDE.md, 2026-10-02).
  const sql = (s) => execFileSync('mariadb', ['--default-character-set=utf8mb4', '-u', 'sporta', '-plocaldev', 'sporta', '-N', '-B', '-e', s], { encoding: 'utf8' }).trim()
  const MEMBER = 'users-rig-member@example.invalid'
  const OWN_ORDER = 'SPUSRUIOWN01', GUEST_ORDER = 'SPUSRUIPHN01'
  const PHONES = ['96555512301', '96555512302']
  const PA = 'a-good-long-password-1'
  const OUR_ROUTES = "'team_add','team_lock','team_unlock','team_remove','shopper_block','shopper_unblock','shopper_signout','shopper_delete'"
  const auditStart = Number(sql('select coalesce(max(id), 0) from admin_audit_log'))
  const cleanup = () => {
    sql(`delete from orders where track_id in ('${OWN_ORDER}', '${GUEST_ORDER}')`)
    sql("delete p from customer_passkeys p join customers c on c.id = p.customer_id where c.email like 'users-rig-%@example.invalid'")
    sql("delete from customer_login_codes where email like 'users-rig-%@example.invalid'")
    sql(`delete from blocked_customers where phone in (${PHONES.map((p) => `'${p}'`).join(', ')})`)
    sql("delete from customers where email like 'users-rig-%@example.invalid'")
    sql("delete from admin_users where email like 'users-rig-%@example.invalid'")      // ledger, passkeys and known IPs cascade
    sql("delete from admin_login_log where email like 'users-rig-%@example.invalid'")
    // The Activity-log rows THIS run's own presses wrote — newer than the run, on the eight Users routes,
    // which nothing but this screen calls. Nobody else's row is touched.
    sql(`delete from admin_audit_log where id > ${auditStart} and route in (${OUR_ROUTES})`)
  }
  // The rate limiter is the shared sandbox's, so it is cleared only when it actually refuses this run.
  const unthrottle = () => sql('delete from rate_limit; delete from rate_bucket')
  const api = async (c, route, body) => {
    let r = await c(route, body)
    if (r.status === 429) { unthrottle(); r = await c(route, body) }
    return r
  }

  const navState = (p) => p.evaluate(() => ({
    side: [...document.querySelectorAll('.admin-sidebar button')].filter((b) => /(^|\s)bg-indigo-50(\s|$)/.test(b.className)).map((b) => b.textContent.trim().replace(/\d+$/, '')),
    bar: [...document.querySelectorAll('.m-tabbar__item[aria-current="true"]')].map((b) => b.textContent.trim().replace(/\d+$/, '')),
    h1: [...document.querySelectorAll('.admin-content h1')].filter((h) => h.offsetParent !== null).map((h) => h.textContent.trim()),
    title: document.querySelector('.m-header__title')?.textContent.trim() ?? null,
  }))
  // Text against its own ground, WCAG's formula: every visible run of text inside the screen.
  const contrast = (p) => p.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const parse = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map(parseFloat); return { c: a.slice(0, 3), a: a.length > 3 ? a[3] : 1 } }
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const q = parse(getComputedStyle(e).backgroundColor); if (q && q.a > 0.5) return q.c } return [255, 255, 255] }
    const out = []
    let n = 0, min = 99
    for (const el of document.querySelectorAll('[data-spus] *')) {
      const own = [...el.childNodes].filter((x) => x.nodeType === 3 && x.textContent.trim()).map((x) => x.textContent.trim()).join(' ')
      if (!own) continue
      const rc = el.getBoundingClientRect()
      if (rc.width < 2 || rc.height < 2) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.6) continue
      const fg = parse(cs.color)
      if (!fg) continue
      const L1 = lum(fg.c), L2 = lum(bgOf(el)), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
      n++; min = Math.min(min, ratio)
      if (ratio < 3) out.push(`${el.tagName}.${el.className} "${own.slice(0, 30)}" ${ratio.toFixed(2)}`)
    }
    return { n, min: +min.toFixed(2), low: out.slice(0, 6) }
  })
  const layout = (p) => p.evaluate(() => {
    const small = [...document.querySelectorAll('[data-spus] button, [data-spus] input:not([type=checkbox]):not([hidden])')]
      .filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 43.5)
      .map((b) => (b.textContent.trim() || b.getAttribute('aria-label') || b.type) + ':' + Math.round(b.getBoundingClientRect().height))
    const tiny = [...document.querySelectorAll('[data-spus] *')]
      .filter((e) => e.offsetParent !== null && [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 13)
      .map((e) => e.textContent.trim().slice(0, 20) + ':' + getComputedStyle(e).fontSize)
    const labels = [...document.querySelectorAll('[data-spus] button')].map((b) => b.textContent.trim()).filter((t) => /^save/i.test(t))
    return { sw: document.documentElement.scrollWidth, vw: innerWidth, small, tiny: tiny.slice(0, 5), labels,
      acRight: Math.round(document.querySelector('.admin-content').getBoundingClientRect().right) }
  })

  const fixtures = async () => {
    cleanup()
    const reg = await api(shopper(BASE), 'customer_register', { email: 'users-rig-a@example.invalid', password: PA, name: 'Rig Alpha', phone: '55512301' })
    const aId = reg.body?.customer?.id
    if (!aId) throw new Error('fixture shopper A would not register on ' + BASE + ': ' + reg.text.slice(0, 200))
    const hash = hashOf('x-unused-rig-password-1')
    sql(`insert into customers (email, phone, name, password_hash, verified_at, last_seen_at) values
         ('users-rig-b@example.invalid', '${PHONES[1]}', 'ريم عبدالله الكويتية', ${lit(hash)}, now(), now()),
         ('users-rig-c@example.invalid', null, null, ${lit(hash)}, null, null)`)
    sql(`insert into orders (track_id, amount, payment_status, payment_method, fulfilment_status, customer_name, customer_phone, customer_email, customer_area, customer_id) values
         ('${OWN_ORDER}', 12.500, 'paid', 'knet', 'shipped', 'Rig Alpha', '${PHONES[0]}', 'users-rig-a@example.invalid', 'x', ${aId}),
         ('${GUEST_ORDER}', 3.000, 'pending', 'cod', 'unfulfilled', 'Somebody Else', '${PHONES[0]}', 'someone-else@example.invalid', 'x', null)`)
    sql(`insert into admin_users (email, password_hash, failed_attempts, locked_until, added_by) values ('users-rig-locked@example.invalid', ${lit(hash)}, 5, now() + interval 1 hour, '${MANAGER}')`)
    sql(`insert into admin_users (email, password_hash, disabled_at, added_by) values ('users-rig-switchedoff-with-a-long-address@example.invalid', ${lit(hash)}, now(), '${MANAGER}')`)
    sql(`insert into customer_passkeys (customer_id, credential_id, public_key, alg, label) values (${aId}, unhex('A1B2C3D4E5F60718'), 'rig', -7, 'iPhone (rig)')`)
    return {
      aId,
      lockedId: Number(sql("select id from admin_users where email = 'users-rig-locked@example.invalid'")),
      offId: Number(sql("select id from admin_users where email = 'users-rig-switchedoff-with-a-long-address@example.invalid'")),
    }
  }

  const tf = sql(`select concat(totp_enabled, email_otp_enabled, disabled_at is null) from admin_users where email = '${MANAGER}'`)
  check('B0', tf === '001', "the shared sandbox's manager is on and has no second factor (every team form would otherwise need a code this rig has not got)", tf)
  if (tf !== '001') return

  const b = await chromium.launch({ executablePath: EXE })
  try {
    for (const [w, h, tag] of [[1280, 900, 'desktop'], [390, 844, 'phone']]) {
      const fx = await fixtures()
      const aId = fx.aId
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, isMobile: w < 500 })
      if (tag === 'desktop') {
        // Google and Apple sign-in switched ON in this browser only (nothing written): their overlays look
        // for "the login form" by a password box, and the Team tab's forms have one.
        await ctx.route(/admin\.php\?r=google_config/, (r) => r.fulfill({ contentType: 'application/json', body: '{"enabled":true,"client_id":"123-rig.apps.googleusercontent.com"}' }))
        await ctx.route(/admin\.php\?r=apple_config/, (r) => r.fulfill({ contentType: 'application/json', body: '{"enabled":true,"client_id":"kw.rig.web"}' }))
        await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.google={accounts:{id:{initialize(){},renderButton(h){var b=document.createElement("div");b.textContent="GSI-STUB";h.appendChild(b)},prompt(){}}}}' }))
        await ctx.route('https://appleid.cdn-apple.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.AppleID={auth:{init(){},signIn(){return Promise.reject()}}}' }))
      }
      const p = await ctx.newPage()
      const errors = []
      p.on('pageerror', (e) => errors.push(String(e)))
      const signInUi = async () => {
        await p.goto(BASE + '/backends?lang=en', { waitUntil: 'networkidle' })
        if (await p.locator('input[type=password]').count()) {
          await p.fill('input[autocomplete^=username], input[type=email]', MANAGER)
          await p.fill('input[type=password]', MANAGER_PW)
          await p.locator('form button[type=submit], form button').first().click()
        }
        return p.waitForSelector('[data-spus-nav]', { state: 'attached', timeout: 15000 }).then(() => true, () => false)
      }
      await p.goto(BASE + '/backends?lang=en', { waitUntil: 'networkidle' })
      if (tag === 'desktop') {
        await p.waitForTimeout(600)
        check('B1', await p.locator('[data-sporta-gsi]').count() === 1 && await p.locator('[data-sporta-asi]').count() === 1,
          'desktop: (switched on in the browser) the Google and Apple buttons still mount on the login form')
      }
      if (!(await signInUi())) { unthrottle(); if (!(await signInUi())) throw new Error(`${tag}: could not sign in to ${BASE}/backends as the manager`) }
      await p.waitForTimeout(600)
      // EVERY panel-ux toast raised while Users is open, kept in the page. The screen reports each result in its own
      // words beside the button; panel-ux's verb test toasted half of its eight actions and none of the rest, and put
      // "Couldn't save — Bad password" over a refused REMOVE (review, 2026-10-14). Read before the reload at B65.
      const watchToasts = () => p.evaluate(() => {
        window.__spusToasts = []
        new MutationObserver(() => {
          const t = document.querySelector('.spux-toast')
          if (!t || !/spux-toast--in/.test(t.className) || t.textContent === window.__spusLast) return
          window.__spusLast = t.textContent
          if (document.querySelector('.admin-content.spus-on')) window.__spusToasts.push(t.textContent)
        }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] })
      })
      await watchToasts()
      const nav = (name) => tag === 'phone'
        ? p.locator('.m-tabbar__item').filter({ hasText: new RegExp('^\\s*' + name + '\\s*\\d*$') }).first()
        : p.locator('.admin-sidebar button').filter({ hasText: new RegExp('^\\s*' + name + '\\s*\\d*$') }).first()
      const go = async (name, wait = 900) => { await nav(name).click(); await p.waitForTimeout(wait) }
      // A TEAM FORM PRESSED as the owner presses it — and once more if the shared sandbox's limiter answered instead of
      // the route. Every re-authenticated press spends one of this IP's ten `account` tokens (users_reauth's throttle),
      // this rig spends ten a run, and other rigs share the table: two runs inside five minutes meet the limiter, not
      // the code (measured, "Too many tries" on the phone's Switch off). It is cleared only when it has refused.
      // `again` re-arms what the first press needed (Remove's confirm dialog).
      const pressTeam = async (form, again) => {
        await form.locator('[data-spus-go]').click()
        for (let i = 0; i < 60; i++) {
          await p.waitForTimeout(100)
          if (!(await form.count())) return                       // gone with the list it was drawn in: done
          const t = (await form.locator('.spus-note').last().innerText().catch(() => '')).trim()
          if (t === 'Checking…') continue
          if (/Too many tries/.test(t)) { unthrottle(); if (again) again(); await form.locator('[data-spus-go]').click() }
          return
        }
      }

      check('B2', await p.locator('.admin-sidebar [data-spus-nav]').count() === 1 && await p.locator('.m-tabbar [data-spus-nav]').count() === 1,
        `${tag}: one Users button in the sidebar and one in the phone tab bar`)
      const order = await p.evaluate(() => [...document.querySelectorAll('.admin-sidebar nav button')].map((x) => x.textContent.trim()).join(','))
      check('B3', /Settings,Payments,SEO,Setup,Users,/.test(order), `${tag}: Users sits after the other own screens`, order)

      // ---- the nav, both directions, against every other own screen
      await go('Users')
      let s = await navState(p)
      check('B4', s.side.join() === 'Users' && s.bar.join() === 'Users' && s.h1.join() === 'Users', `${tag}: Users opens one h1 "Users", and only Users is lit`, JSON.stringify(s))
      if (tag === 'phone') check('B4b', s.title === 'Users', 'phone: the header title says Users', String(s.title))
      const usersCls = () => p.evaluate(() => document.querySelector('.admin-sidebar [data-spus-nav]')?.className ?? '')
      if (tag === 'desktop') check('B4c', !/hover:bg-slate-50/.test(await usersCls()), 'desktop: the lit Users button carries no hover:bg-slate-50, like every other lit button (it turned grey under the pointer)', await usersCls())
      for (const [other, h1] of [['SEO', 'SEO'], ['Setup', 'Setup checklist'], ['Payments', 'Payments']]) {
        await go(other, 1600)
        s = await navState(p)
        check('B5', s.side.join() === other && s.bar.join() === other && s.h1.join() === h1, `${tag}: Users -> ${other} lights only ${other}`, JSON.stringify(s))
        await go('Users')
        s = await navState(p)
        check('B5', s.side.join() === 'Users' && s.bar.join() === 'Users' && s.h1.join() === 'Users', `${tag}: ${other} -> Users lights only Users`, JSON.stringify(s))
      }
      await go('Users')   // a second press must not snapshot the screen's own state as "the bundle's"
      await go('Orders', 1500)
      s = await navState(p)
      check('B6', s.side.join() === 'Orders' && s.bar.join() === 'Orders' && s.h1.join() === 'Orders' && !(await p.locator('[data-spus]').count()),
        `${tag}: Users (pressed twice) -> Orders gives the bundle's screen back, only Orders lit`, JSON.stringify(s))
      if (tag === 'phone') check('B6b', s.title === 'Orders', "phone: and the header title is the bundle's again", String(s.title))
      if (tag === 'desktop') check('B6c', /hover:bg-slate-50/.test(await usersCls()) && !/bg-indigo-50/.test(await usersCls()), 'desktop: and the unlit Users button has its hover back', await usersCls())
      await go('Users'); await go('SEO', 1500); await go('Overview', 1500)
      s = await navState(p)
      check('B7', s.side.join() === 'Overview' && s.bar.join() === 'Overview', `${tag}: Users -> SEO -> Overview leaves only Overview lit (no stale Users)`, JSON.stringify(s))
      await go('Users'); await go('Setup', 1500); await go('Users'); await go('Overview', 1500)
      s = await navState(p)
      check('B7b', s.side.join() === 'Overview' && s.bar.join() === 'Overview', `${tag}: Users -> Setup -> Users -> Overview leaves only Overview lit`, JSON.stringify(s))
      if (tag === 'desktop') {
        await go('Users')
        await p.locator('[data-sppl-switch]').click(); await p.waitForTimeout(400)
        check('B8', await p.locator('[data-spus]').count() === 1, 'desktop: the Dark panel switch does not close Users')
        await p.locator('[data-sppl-switch]').click(); await p.waitForTimeout(400)
        check('B8b', await p.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'light', 'desktop: and switches back to the light panel')
        // AN UNSAVED SETTINGS EDIT, THEN USERS. The bundle's Settings screen is hidden, not unmounted, so the edit is
        // still on panel-save-bar's dirty list — and it put "Unsaved changes in undefined." over Users, with a button
        // that pressed nothing and went away, the edit still unsaved (review, 2026-10-14). Nothing is saved here: the
        // page is reloaded afterwards, which throws the typed letter away.
        await go('Settings', 1500)
        // `display`, not offsetParent: the bar is position:fixed, and a fixed element's offsetParent is null when it shows.
        const bar = () => p.evaluate(() => { const b = document.querySelector('.spsb'); return b ? { shown: !b.hidden && getComputedStyle(b).display !== 'none', text: b.textContent } : { shown: false, text: '' } })
        const marked = await p.evaluate(() => {
          for (const btn of document.querySelectorAll('.admin-content button')) {
            if (!/^save/i.test(btn.textContent.trim()) || btn.offsetParent === null) continue
            for (let c = btn.parentElement; c && !c.classList.contains('admin-content'); c = c.parentElement) {
              const i = [...c.querySelectorAll('input[type=text], input:not([type])')].find((x) => x.offsetParent !== null && !x.readOnly && !x.disabled)
              if (i) { i.setAttribute('data-rig-dirty', '1'); return btn.textContent.trim() }
            }
          }
          return false
        })
        // Typed as a person types. The bar takes an edit only once its own debounced discovery has found the cards, and
        // in this busy context (the Google and Apple cards, the colour switch just pressed) that can still be settling a
        // second and a half after the screen opened — so if the first letter was not counted, one more is typed once
        // the screen is quiet. Both are thrown away by the reload below.
        let onSettings = { shown: false, text: '' }
        for (let attempt = 0; marked && attempt < 2 && !onSettings.shown; attempt++) {
          if (attempt) await p.waitForTimeout(2000)
          await p.locator('[data-rig-dirty]').click(); await p.keyboard.press('End'); await p.keyboard.type('Z')
          for (let i = 0; i < 20 && !(onSettings = await bar()).shown; i++) await p.waitForTimeout(100)
        }
        await go('Users', 900)
        const onUsers = await bar()
        await go('Settings', 1500)
        const backOn = await bar()
        check('B8c', marked && onSettings.shown && /Unsaved changes in /.test(onSettings.text) && !/undefined/.test(onSettings.text) &&
          !onUsers.shown && backOn.shown && /Unsaved changes in /.test(backOn.text) && !/undefined/.test(backOn.text),
          'desktop: an unsaved Settings edit raises the save bar there; Users wears no bar offering to save a card it is not showing; back on Settings the bar names the card again', JSON.stringify({ marked, onSettings, onUsers, backOn }))
        await p.reload({ waitUntil: 'networkidle' })
        await p.waitForSelector('[data-spus-nav]', { state: 'attached', timeout: 15000 }); await p.waitForTimeout(800)
        await watchToasts()
      }

      // ---- Shoppers
      await p.evaluate(() => sessionStorage.removeItem('spus-tab'))
      await go('Users', 1200)
      check('B9', await p.locator('[data-spus-tab="shoppers"][aria-selected="true"]').count() === 1 && await p.locator('[data-spus-pane="team"]').isHidden(),
        `${tag}: Shoppers is the default tab`)
      const fixtureCount = Number(sql("select count(*) from customers where email like '%users-rig%'"))
      await p.fill('[data-spus-search]', 'users-rig'); await p.waitForTimeout(1200)
      check('B10', fixtureCount === 3 && await p.locator('[data-spus-shopper]').count() === fixtureCount, `${tag}: search by email finds exactly the ${fixtureCount} fixtures the database holds`,
        String(await p.locator('[data-spus-shopper]').count()))
      check('B10b', new RegExp('^' + fixtureCount + ' accounts').test(await p.locator('[data-spus-total]').innerText()), `${tag}: and says "${fixtureCount} accounts"`, await p.locator('[data-spus-total]').innerText())
      check('B10c', await p.locator('[data-spus-shopper] [dir=rtl]').filter({ hasText: 'ريم عبدالله الكويتية' }).count() === 1, `${tag}: an Arabic name is printed right-to-left`)
      // A ROW'S LINES STACK. Under (pointer: coarse) admin-mobile.js makes every panel button inline-flex and centred,
      // and that out-ranked the row's display:block, so on phones and touch tablets the email, the name and the dates
      // were three squeezed columns (review, 2026-10-14). Measured BEFORE any screenshot — a full-page capture drops
      // the touch emulation for the rest of the page — and with the condition asserted, or this would pass on a
      // phone context that had quietly become a mouse.
      const rowShape = await p.evaluate(() => {
        const r = document.querySelector('[data-spus-shopper]'), rr = r.getBoundingClientRect(), kids = [...r.children].map((k) => k.getBoundingClientRect())
        return { coarse: matchMedia('(pointer: coarse)').matches, display: getComputedStyle(r).display, n: kids.length,
          stacked: kids.every((k, i) => i === 0 || k.top >= kids[i - 1].bottom - 1), full: kids.every((k) => k.width >= (rr.width - 16) * 0.9) }
      })
      check('B10d', rowShape.coarse === (tag === 'phone') && rowShape.display === 'block' && rowShape.n >= 2 && rowShape.stacked && rowShape.full,
        `${tag}: a shopper row's lines stack, each the row's full width${tag === 'phone' ? ', with the touch rules in force' : ''}`, JSON.stringify(rowShape))
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/users-shoppers-${tag}.png`, fullPage: true })
      let c = await contrast(p), l = await layout(p)
      check('B11', c.n > 10 && c.low.length === 0, `${tag}: Shoppers text is at least 3:1 on the light panel (${c.n} runs, min ${c.min})`, c.low.join(' ; '))
      check('B12', l.sw <= l.vw && l.acRight <= l.vw, `${tag}: no sideways scroll on the list (${l.sw} in ${l.vw})`)
      check('B13', l.labels.length === 0, `${tag}: no button on the screen starts with "Save" (the save bar would take it for a card's own)`, l.labels.join(', '))
      if (tag === 'phone') {
        check('B14', l.small.length === 0, 'phone: every control is at least 44px tall', l.small.join(', '))
        check('B14b', l.tiny.length === 0, 'phone: no text under 13px', l.tiny.join(', '))
      }
      await p.fill('[data-spus-search]', '٥٥٥١٢٣٠١'); await p.waitForTimeout(1200)
      check('B15', await p.locator('[data-spus-shopper]').count() === 1 && await p.locator(`[data-spus-shopper="${aId}"]`).count() === 1,
        `${tag}: A's phone typed in Arabic-Indic digits finds A, and only A`)
      check('B15b', /^1 account matches "/.test(await p.locator('[data-spus-total]').innerText()), `${tag}: and says "1 account matches", not "1 account match"`, await p.locator('[data-spus-total]').innerText())
      await p.fill('[data-spus-search]', 'users-rig'); await p.waitForTimeout(1200)
      await p.locator('[data-spus-filter="blocked"]').click(); await p.waitForTimeout(900)
      check('B16', await p.locator('[data-spus-shopper]').count() === Number(sql("select count(*) from customers where email like '%users-rig%' and blocked_at is not null")),
        `${tag}: the Blocked filter shows as many fixtures as the database has blocked (none yet)`)
      await p.locator('[data-spus-filter="all"]').click(); await p.waitForTimeout(900)

      // ---- A's detail
      await p.locator(`[data-spus-shopper="${aId}"]`).click(); await p.waitForSelector('[data-spus-account]')
      check('B17', await p.locator('[data-spus-order]').count() === 1 && await p.locator(`[data-spus-order="${OWN_ORDER}"]`).count() === 1,
        `${tag}: the detail lists A's own order and not the guest order placed with the same phone`)
      check('B17b', /Paid \(KNET\)/.test(await p.locator(`[data-spus-order="${OWN_ORDER}"]`).innerText()), `${tag}: and names the payment method as the shop does ("Paid (KNET)", not "Paid (Knet)")`,
        await p.locator(`[data-spus-order="${OWN_ORDER}"]`).innerText())
      check('B18', await p.locator('[data-spus-passkey]').count() === 1, `${tag}: and the passkey`)
      check('B19', /Set at registration/.test(await p.locator('[data-spus-signin]').innerText()), `${tag}: the password reads "Set at registration" for an account that has not proved its address`)
      if (SHOTS) await p.screenshot({ path: `${SHOTS}/users-shopper-detail-${tag}.png`, fullPage: true })
      c = await contrast(p); l = await layout(p)
      check('B20', c.n > 10 && c.low.length === 0, `${tag}: detail text is at least 3:1 (${c.n} runs, min ${c.min})`, c.low.join(' ; '))
      check('B21', l.sw <= l.vw, `${tag}: no sideways scroll on the detail (${l.sw} in ${l.vw})`)
      if (tag === 'phone') check('B22', l.small.length === 0, 'phone: detail controls are at least 44px tall', l.small.join(', '))

      if (tag === 'desktop') {
        const shopA = shopper(BASE)
        await api(shopA, 'customer_login', { email: 'users-rig-a@example.invalid', password: PA })
        check('B23', (await shopA('customer_me')).body?.customer?.id === aId, 'desktop: A is signed in, in a browser of its own, before the block')
        await p.fill('[data-spus-reason]', 'rig reason')
        await p.locator('[data-spus-act="block"] [data-spus-phone-too]').check()
        await p.locator('[data-spus-go="block"]').click(); await p.waitForSelector('[data-spus-act="unblock"]')
        check('B24', sql(`select concat_ws('|', blocked_reason, blocked_by) from customers where id = ${aId}`) === `rig reason|${MANAGER}`, 'desktop: Block account writes the reason and who')
        check('B25', sql(`select scope from blocked_customers where phone = '${PHONES[0]}'`) === 'all', "desktop: and, ticked, puts the phone on the checkout's block list (scope all)")
        check('B26', (await shopA('customer_me')).body?.customer === null, "desktop: A's own browser is signed out")
        check('B27', /Blocked/.test(await p.locator('[data-spus-detail-note]').innerText()) &&
          await p.locator('[data-spus-detail-note]').evaluate((n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }),
          'desktop: the screen says so, on screen rather than scrolled away')
        await p.locator('[data-spus-act="unblock"] [data-spus-phone-too]').check()
        await p.locator('[data-spus-go="unblock"]').click(); await p.waitForSelector('[data-spus-act="block"]')
        check('B28', sql(`select ifnull(blocked_at, 'null') from customers where id = ${aId}`) === 'null' && sql(`select count(*) from blocked_customers where phone = '${PHONES[0]}'`) === '0',
          'desktop: Unblock clears the account and, ticked, the phone block')
        await sleep(1100)   // a block is a sign-out everywhere too, "at or before" to the second
        const shopA2 = shopper(BASE)
        await api(shopA2, 'customer_login', { email: 'users-rig-a@example.invalid', password: PA })
        check('B29', (await shopA2('customer_me')).body?.customer?.id === aId, 'desktop: A signs in again after the unblock')
        await sleep(1100)   // the cut-off is "signed in at or before", to the second
        p.once('dialog', (dg) => dg.accept())
        await p.locator('[data-spus-go="signout"]').click(); await p.waitForSelector('[data-spus-detail-note]')
        await p.waitForTimeout(500)
        check('B30', (await shopA2('customer_me')).body?.customer === null, 'desktop: Sign out everywhere ends that session')
        check('B31', sql(`select count(*) from customer_passkeys where customer_id = ${aId}`) === '0', 'desktop: and removes the passkey')
        const del = p.locator('[data-spus-go="delete"]')
        check('B32', await del.isDisabled(), 'desktop: Delete account stays off until the address is typed')
        await p.fill('[data-spus-confirm-email]', 'users-rig-b@example.invalid')
        check('B33', await del.isDisabled(), "desktop: and stays off for another account's address")
        await p.fill('[data-spus-confirm-email]', 'USERS-RIG-A@example.invalid')
        check('B34', await del.isEnabled(), "desktop: and comes on for this account's address, in any case")
        await del.click(); await p.waitForSelector('[data-spus-view="list"]:not([hidden])'); await p.waitForTimeout(1200)
        check('B35', sql(`select count(*) from customers where id = ${aId}`) === '0', 'desktop: the account is gone')
        check('B36', sql(`select ifnull(customer_id, 'null') from orders where track_id = '${OWN_ORDER}'`) === 'null', 'desktop: its order is kept, unlinked')
        check('B37', /Deleted users-rig-a@example.invalid/.test(await p.locator('[data-spus-flash]').innerText()) && await p.locator('[data-spus-shopper]').count() === 2,
          'desktop: back on the list with a note, two fixtures left')
      } else {
        await p.locator('[data-spus-reason]').fill('rig reason phone')
        await p.locator('[data-spus-go="block"]').scrollIntoViewIfNeeded()
        await p.locator('[data-spus-go="block"]').click(); await p.waitForSelector('[data-spus-act="unblock"]')
        check('B24', sql(`select blocked_reason from customers where id = ${aId}`) === 'rig reason phone', 'phone: Block account writes the reason')
        check('B27', await p.locator('[data-spus-detail-note]').evaluate((n) => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight }),
          'phone: after Block account the message is on screen, not scrolled away')
        l = await layout(p)
        check('B21', l.sw <= l.vw, `phone: no sideways scroll on a blocked account's detail (${l.sw} in ${l.vw})`)
        await p.locator('[data-spus-go="unblock"]').click(); await p.waitForSelector('[data-spus-act="block"]')
        check('B28', sql(`select ifnull(blocked_at, 'null') from customers where id = ${aId}`) === 'null', 'phone: Unblock clears it')
        await p.locator('[data-spus-back]').first().click(); await p.waitForTimeout(500)
        check('B38', await p.locator('[data-spus-view="list"]').isVisible(), 'phone: Back returns to the list')
      }

      // ---- Team
      await p.locator('[data-spus-tab="team"]').click(); await p.waitForSelector('[data-spus-member]')
      const memberRows = await p.locator('[data-spus-member]').count()
      check('B39', memberRows === Number(sql('select count(*) from admin_users')) && await p.locator('[data-spus-member] [data-spus-badge="you"]').count() === 1,
        `${tag}: Team lists every account the database holds (${memberRows}), with one "You"`)
      check('B40', await p.locator('[data-spus-member]:has([data-spus-badge="you"]) [data-spus-action]').count() === 0, `${tag}: your own row has no Switch off or Remove`)
      check('B41', await p.locator(`[data-spus-member="${fx.lockedId}"] [data-spus-badge="locked"]`).count() === 1 && await p.locator(`[data-spus-member="${fx.offId}"] [data-spus-badge="off"]`).count() === 1,
        `${tag}: the locked member and the switched-off member wear their badges`)
      {
        const lt = await layout(p)
        const bw = await p.locator(`[data-spus-member="${fx.lockedId}"] [data-spus-badge="locked"]`).evaluate((n) => {
          const r = n.getBoundingClientRect(), cc = n.closest('.spus-sec').getBoundingClientRect(); return [Math.round(r.right), Math.round(cc.right)]
        })
        check('B42', lt.sw <= lt.vw && bw[0] <= bw[1], `${tag}: no sideways scroll with the long Locked badge (page ${lt.sw} in ${lt.vw}, badge right ${bw[0]} in card ${bw[1]})`)
      }
      if (tag === 'desktop') check('B43', await p.locator('[data-spus] [data-sporta-gsi], [data-spus] [data-sporta-asi]').count() === 0, 'desktop: (switched on) no Google or Apple button inside the Users screen')
      await p.fill('[data-spus-add-email]', MEMBER)
      await p.fill('[data-spus-auth="add"] [data-spus-pw]', 'not my password')
      await pressTeam(p.locator('[data-spus-auth="add"]')); await p.waitForTimeout(900)
      check('B44', /not your password/.test(await p.locator('[data-spus-auth="add"] .spus-note').innerText()) && sql(`select count(*) from admin_users where email = '${MEMBER}'`) === '0',
        `${tag}: a wrong password is refused in words and adds nobody`)
      check('B45', await p.locator('[data-spus-add-email]').inputValue() === MEMBER, `${tag}: and what was typed stays`)
      await p.fill('[data-spus-auth="add"] [data-spus-pw]', MANAGER_PW)
      await pressTeam(p.locator('[data-spus-auth="add"]')); await p.waitForSelector('[data-spus-temp]')
      const temp = await p.locator('[data-spus-temp-value]').innerText()
      const mHash = sql(`select password_hash from admin_users where email = '${MEMBER}'`)
      check('B46', /^[A-Za-z2-9]{16}$/.test(temp) && !!mHash && verifies(temp, mHash), `${tag}: the temporary password is shown — 16 characters, and the one stored`, temp)
      check('B47', sql(`select concat(must_change_password, '|', added_by) from admin_users where email = '${MEMBER}'`) === `1|${MANAGER}`, `${tag}: the member must change it, added by the manager`)
      {
        const m = panel(BASE)
        const li = await api(m, 'login', { email: MEMBER, password: temp })
        const g = await m('stats')
        check('B48', li.status === 200 && g.status === 428 && g.body?.error === 'must_change_password', `${tag}: that password signs the member in, and they are made to choose their own (428)`, li.text + ' / ' + g.text)
      }
      check('B49', !(await p.evaluate((t) => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }), temp)).includes(temp), `${tag}: the temporary password is kept in no browser storage`)
      // Shown ONCE and never again — and a second press of Users rebuilt the screen and threw it away (review, 2026-10-14).
      await go('Users', 900)
      check('B49b', await p.locator('[data-spus-temp-value]').count() === 1 && await p.locator('[data-spus-temp-value]').innerText() === temp &&
        await p.locator('[data-spus-tab="team"][aria-selected="true"]').count() === 1, `${tag}: pressing Users again while it is shown keeps the temporary password on screen`)
      await p.waitForTimeout(600)
      if (SHOTS) { await p.locator('[data-spus-temp]').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${SHOTS}/users-team-add-${tag}.png`, fullPage: true }) }
      c = await contrast(p); l = await layout(p)
      check('B50', c.n > 10 && c.low.length === 0, `${tag}: Team text is at least 3:1 (${c.n} runs, min ${c.min})`, c.low.join(' ; '))
      check('B51', l.sw <= l.vw, `${tag}: no sideways scroll on Team (${l.sw} in ${l.vw})`)
      if (tag === 'phone') check('B52', l.small.length === 0, 'phone: Team controls are at least 44px tall', l.small.join(', '))
      const mid = sql(`select id from admin_users where email = '${MEMBER}'`)
      const row = p.locator(`[data-spus-member="${mid}"]`)
      await row.locator('[data-spus-action="lock"]').click()
      await row.locator('[data-spus-pw]').fill(MANAGER_PW); await pressTeam(row.locator('[data-spus-auth]'))
      await p.waitForSelector(`[data-spus-member="${mid}"] [data-spus-badge="off"]`, { timeout: 15000 })
        .catch(async (e) => { throw new Error(`${tag}: Switch off did not finish — the row says: ${await p.locator(`[data-spus-member="${mid}"]`).innerText().catch(() => '(gone)')}`) })
      check('B53', sql(`select disabled_at is not null from admin_users where id = ${mid}`) === '1', `${tag}: Switch off sets disabled_at`)
      await p.locator(`[data-spus-member="${mid}"] [data-spus-action="unlock"]`).click()
      await p.locator(`[data-spus-member="${mid}"] [data-spus-pw]`).fill(MANAGER_PW); await pressTeam(p.locator(`[data-spus-member="${mid}"] [data-spus-auth]`))
      await p.waitForSelector(`[data-spus-member="${mid}"] [data-spus-action="lock"]`, { timeout: 15000 })
        .catch(async (e) => { throw new Error(`${tag}: Switch on did not finish — the row says: ${await p.locator(`[data-spus-member="${mid}"]`).innerText().catch(() => '(gone)')}`) })
      check('B54', sql(`select disabled_at is null from admin_users where id = ${mid}`) === '1', `${tag}: Switch on clears it`)
      await p.locator(`[data-spus-member="${mid}"] [data-spus-action="remove"]`).click()
      await p.locator(`[data-spus-member="${mid}"] [data-spus-pw]`).fill(MANAGER_PW)
      p.once('dialog', (dg) => dg.dismiss())
      await p.locator(`[data-spus-member="${mid}"] [data-spus-go]`).click(); await p.waitForTimeout(600)
      check('B55', sql(`select count(*) from admin_users where id = ${mid}`) === '1' && await p.locator(`[data-spus-member="${mid}"] [data-spus-pw]`).inputValue() === MANAGER_PW,
        `${tag}: cancelling Remove's confirm keeps the member and the typed password`)
      const acceptOnce = () => p.once('dialog', (dg) => dg.accept())
      acceptOnce()
      await pressTeam(p.locator(`[data-spus-member="${mid}"] [data-spus-auth]`), acceptOnce)
      await p.waitForSelector(`[data-spus-member="${mid}"]`, { state: 'detached' })
      check('B56', sql(`select count(*) from admin_users where id = ${mid}`) === '0', `${tag}: Remove deletes the member`)
      check('B57', await p.locator('[data-spus-temp]').count() === 1, `${tag}: the temporary-password box survives the list reload until Done`)
      await p.locator('[data-spus-temp-done]').click()
      check('B58', await p.locator('[data-spus-temp]').count() === 0 && !(await p.locator('[data-spus]').innerText()).includes(temp), `${tag}: Done hides it, and it is nowhere on the screen`)

      if (tag === 'desktop') {
        // A MEMBER REMOVED ELSEWHERE while their Switch off form is open: the refusal was written into that form, and
        // the reload that followed removed the row and the form with it — the colleague vanished with no reason given
        // (review, 2026-10-14). The reason belongs in the Team note, which the reload keeps, and on screen.
        sql(`insert into admin_users (email, password_hash, added_by) values ('users-rig-gone@example.invalid', 'x', '${MANAGER}')`)
        const goneId = sql("select id from admin_users where email = 'users-rig-gone@example.invalid'")
        await go('Overview', 900); await go('Users', 900)
        await p.locator('[data-spus-tab="team"]').click(); await p.waitForSelector(`[data-spus-member="${goneId}"]`)
        await p.locator(`[data-spus-member="${goneId}"] [data-spus-action="lock"]`).click()
        await p.locator(`[data-spus-member="${goneId}"] [data-spus-pw]`).fill(MANAGER_PW)
        sql(`delete from admin_users where id = ${goneId}`)
        await p.locator(`[data-spus-member="${goneId}"] [data-spus-go]`).click()
        await p.waitForSelector(`[data-spus-member="${goneId}"]`, { state: 'detached' }); await p.waitForTimeout(500)
        const tnote = p.locator('[data-spus-team] > .spus-note')
        check('B58b', /no longer exists/.test(await tnote.innerText()) && await tnote.evaluate((n) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= innerHeight }),
          'desktop: a member removed elsewhere while their form was open is explained in the Team note, on screen, once the row has gone', await tnote.innerText())
        await p.locator('[data-sppl-switch]').click(); await p.waitForTimeout(400)
        let cd = await contrast(p)
        check('B59', cd.n > 10 && cd.low.length === 0, `desktop: Team text is at least 3:1 on the DARK panel too (${cd.n} runs, min ${cd.min})`, cd.low.join(' ; '))
        await p.locator('[data-spus-tab="shoppers"]').click(); await p.waitForTimeout(900)
        cd = await contrast(p)
        check('B59', cd.n > 10 && cd.low.length === 0, `desktop: Shoppers text is at least 3:1 on the DARK panel (${cd.n} runs, min ${cd.min})`, cd.low.join(' ; '))
        await p.locator('[data-sppl-switch]').click(); await p.waitForTimeout(400)
        // An emailed-code account, made so in THIS browser only by rewriting the team answer: the form must
        // offer a code box and "Email me a code", and send exactly email, password and code.
        let sentBody = null, otpCalls = 0
        await p.route(/admin\.php\?r=team$/, async (rt) => { const res = await rt.fetch(); const j = await res.json(); j.team.forEach((m) => { if (m.you) m.two_factor = 'email' }); await rt.fulfill({ response: res, body: JSON.stringify(j) }) })
        await p.route(/admin\.php\?r=otp_send/, (rt) => { otpCalls++; rt.fulfill({ contentType: 'application/json', body: '{"sent":true,"to":"m***@sporta.com.kw"}' }) })
        await p.route(/admin\.php\?r=team_add/, (rt) => { sentBody = rt.request().postDataJSON(); rt.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"bad_code"}' }) })
        await go('Overview', 900); await go('Users', 900)
        await p.locator('[data-spus-tab="team"]').click(); await p.waitForSelector('[data-spus-auth="add"] [data-spus-code]')
        const lab = await p.locator('[data-spus-auth="add"] label:has-text("code")').innerText()
        check('B60', /email/i.test(lab) && await p.locator('[data-spus-auth="add"] [data-spus-sendcode]').count() === 1, 'desktop: an emailed-code account gets a code box and "Email me a code"', lab)
        await p.locator('[data-spus-auth="add"] [data-spus-sendcode]').click(); await p.waitForTimeout(500)
        check('B61', otpCalls === 1 && /sent to m\*\*\*@sporta\.com\.kw/.test(await p.locator('[data-spus-auth="add"] .spus-note').innerText()), 'desktop: "Email me a code" calls otp_send and says where it went')
        await p.fill('[data-spus-add-email]', 'users-rig-never@example.invalid')
        await p.fill('[data-spus-auth="add"] [data-spus-pw]', MANAGER_PW); await p.fill('[data-spus-auth="add"] [data-spus-code]', '١٢٣٤٥٦')
        await p.locator('[data-spus-auth="add"] [data-spus-go]').click(); await p.waitForTimeout(600)
        check('B62', !!sentBody && Object.keys(sentBody).sort().join() === 'code,email,password' && sentBody.code === '123456',
          'desktop: the add request carries exactly email, password and code (Arabic digits sent as 0-9) — the two names the Activity log blanks', JSON.stringify(sentBody && Object.keys(sentBody)))
        check('B63', /code is wrong/.test(await p.locator('[data-spus-auth="add"] .spus-note').innerText()) && await p.locator('[data-spus-auth="add"] [data-spus-pw]').inputValue() === MANAGER_PW,
          'desktop: bad_code is explained in words and what was typed stays')
        await p.unroute(/admin\.php\?r=team$/); await p.unroute(/admin\.php\?r=otp_send/); await p.unroute(/admin\.php\?r=team_add/)
        // The migration not yet run: both tabs say so in words, naming what to run.
        await p.route(/admin\.php\?r=(shoppers|team)(&|$)/, (rt) => rt.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"users_not_ready"}' }))
        await go('Overview', 900); await go('Users', 900)
        const nr1 = await p.locator('[data-spus-pane="team"]').innerText()
        await p.locator('[data-spus-tab="shoppers"]').click(); await p.waitForTimeout(500)
        const nr2 = await p.locator('[data-spus-pane="shoppers"]').innerText()
        check('B64', /migrate-users\.php/.test(nr1) && /migrate-users\.php/.test(nr2), 'desktop: users_not_ready is explained on both tabs')
        await p.unroute(/admin\.php\?r=(shoppers|team)(&|$)/)
        // A "SHOW MORE" THAT FAILS keeps every row already drawn and the total, says why beside the button, and the
        // next press carries on below the last row (review, 2026-10-14: the failure wiped the list and the total and
        // left the button, and the retry drew rows 51-100 with 1-50 gone). The answers are made up in this browser —
        // 120 accounts, the first "Show more" cut off — so nothing is planted, and the request must page by `before`.
        const fake = (top, n) => Array.from({ length: n }, (_, i) => ({ id: top - i, email: `users-rig-fake-${top - i}@example.invalid`, name: null, phone: null,
          created_at: '2026-10-01 10:00:00', verified_at: null, last_signin_at: null, blocked_at: null, orders: 0, passkeys: 0 }))
        const befores = []
        await p.route(/admin\.php\?r=shoppers(&|$)/, (rt) => {
          const before = new URL(rt.request().url()).searchParams.get('before')
          if (!before) return rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ shoppers: fake(900100, 50), total: 120, page: 1, pages: 3, more: true, ready: true }) })
          befores.push(before)
          if (befores.length === 1) return rt.abort('failed')
          return rt.fulfill({ contentType: 'application/json', body: JSON.stringify({ shoppers: fake(Number(before) - 1, 50), total: 120, page: 2, pages: 3, more: true, ready: true }) })
        })
        await go('Overview', 900); await go('Users', 900)
        await p.locator('[data-spus-tab="shoppers"]').click(); await p.waitForSelector('[data-spus-more]:not([hidden])')
        const listNow = () => p.evaluate(() => ({ ids: [...document.querySelectorAll('[data-spus-shopper]')].map((r) => +r.getAttribute('data-spus-shopper')),
          total: document.querySelector('[data-spus-total]')?.textContent ?? '', note: document.querySelector('[data-spus-more-note]')?.textContent ?? null,
          noteShown: !!document.querySelector('[data-spus-more-note]')?.offsetParent, more: !document.querySelector('[data-spus-more]').hidden }))
        await p.locator('[data-spus-more]').click(); await p.waitForTimeout(700)
        const failed = await listNow()
        check('B68', failed.ids.length === 50 && failed.ids[0] === 900100 && /^120 accounts/.test(failed.total) && /did not reach the shop/.test(failed.note ?? '') && failed.noteShown && failed.more,
          'desktop: a failed "Show more" keeps the fifty rows and the total, and says why beside the button, which stays', JSON.stringify({ ...failed, ids: failed.ids.length }))
        await p.locator('[data-spus-more]').click(); await p.waitForTimeout(700)
        const retried = await listNow()
        check('B69', retried.ids.length === 100 && retried.ids[0] === 900100 && retried.ids[50] === 900050 && new Set(retried.ids).size === 100 && retried.note === '' &&
          befores.length === 2 && befores.every((b) => b === '900051'),
          'desktop: and pressing it again appends the next fifty below them, asked for by key (before=the last id drawn), the error cleared', JSON.stringify({ n: retried.ids.length, first: retried.ids[0], at50: retried.ids[50], note: retried.note, befores }))
        await p.unroute(/admin\.php\?r=shoppers(&|$)/)
        await p.locator('[data-spus-tab="team"]').click(); await p.waitForTimeout(300)
      }

      const toasts = await p.evaluate(() => window.__spusToasts ?? null)
      check('B70', Array.isArray(toasts) && toasts.length === 0, `${tag}: no panel-ux toast over the Users screen — it says every result, and every refusal, in its own words`, JSON.stringify(toasts))

      // ---- a pull-to-refresh reload reopens Users on the remembered tab
      await p.evaluate(() => sessionStorage.setItem('spux-screen', 'Users'))
      await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(2500)
      s = await navState(p)
      check('B65', s.h1.join() === 'Users' && s.side.join() === 'Users' && await p.locator('[data-spus-tab="team"][aria-selected="true"]').count() === 1 &&
        await p.locator('[data-spus-temp]').count() === 0, `${tag}: a pull-to-refresh reload reopens Users on the Team tab, with no temporary password shown`, JSON.stringify(s))
      check('B66', errors.length === 0, `${tag}: no page errors`, errors.join(' | '))
      await ctx.close()
    }
  } finally {
    try { cleanup() } catch (e) { console.error('cleanup: ' + (e.message || e)) }
    await b.close()
  }
}

/* ================================================================== run */
if (ONLY !== 'ui') await apiHalf()
if (MUT) console.log('     (the browser half is skipped under MUTATE: every mutation lives in the scratch copy, which no browser here is pointed at)')
else if (ONLY !== 'api') await uiHalf()

if (MUT) {
  const m = MUTATIONS[MUT]
  const missing = m.expect.filter((id) => !failedIds.includes(id))
  console.log(missing.length ? `MUTATE=${MUT}: NOT caught by ${missing.join(', ')}` : `MUTATE=${MUT}: caught by ${m.expect.join(', ')}`)
}
console.log(fails ? `${fails} FAILED` : 'all ok')
process.exit(fails ? 1 : 0)
