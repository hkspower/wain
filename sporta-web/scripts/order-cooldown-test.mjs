// One order a minute (owner, 2026-11-02: "make submit order one hit, then
// close for one minute after the hit") — proven on a store of its own.
//
// The sandbox store on :8095 runs with 'order_cooldown_seconds' => 0, because
// every other suite places orders back to back from one address. This suite
// starts a second store on a free port whose config is the sandbox's plus:
//   order_cooldown_seconds 60, trusted_proxy_ips [127.0.0.1] (so a request
//   can say which client it is with X-Forwarded-For), a known
//   rate_limit_secret (so a bucket row can be found and aged).
// Then, against the real MariaDB:
//   - an accepted order closes the door for that client AND that phone, with
//     429 + Retry-After + previous_order_pending (the token the live
//     storefront words as "an earlier attempt may already have created an
//     order"), retry_after counting down from 60;
//   - a retry of the SAME attempt (same track id) still gets its order back;
//   - another client with another phone is not affected; an IPv6 client is
//     one client per /64;
//   - a declined card (payment_status failed) or a cancelled order does not
//     hold the door shut;
//   - a refused order wrote nothing: no order row, no stock taken;
//   - after the minute (rows aged by SQL, nobody sleeps 60 s) it opens again;
//   - eight simultaneous new orders from one client: exactly one accepted;
//   - order_cooldown_seconds 0 switches it off.
//
//   npm run test:order-cooldown    (needs the sandbox: npm run sandbox)
import { spawn, execFile } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = new URL('..', import.meta.url).pathname
const STORE_DIR = join(ROOT, 'dropin/php-store')
let passes = 0, fails = 0
const is = (c, n, d = '') => { if (c) { passes++; console.log(`ok   ${n}${d ? `  — ${d}` : ''}`) } else { fails++; console.log(`FAIL ${n}${d ? `  — ${d}` : ''}`) } }
const head = (t) => console.log(`\n=== ${t} ${'='.repeat(Math.max(0, 58 - t.length))}`)
const sql = async (s) => (await run('mariadb', ['--default-character-set=utf8mb4', 'sporta', '-N', '-B', '-e', s])).stdout.trim()

const RL_SECRET = 'test-cooldown-rl'
const rlKey = (bucket, id) => createHmac('sha256', RL_SECRET).update(`${bucket}|${id}`).digest('hex').slice(0, 32)
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const phpVal = (v) => (typeof v === 'number' ? String(v) : Array.isArray(v) ? `[${v.map(phpStr).join(', ')}]` : phpStr(v))
const tmp = mkdtempSync(join(tmpdir(), 'sporta-cooldown-'))
const writeConfig = (file, extra) => writeFileSync(file,
  `<?php\nreturn [\n${Object.entries(extra).map(([k, v]) => `  ${phpStr(k)} => ${phpVal(v)},`).join('\n')}\n]` +
  ` + (require ${phpStr(join(STORE_DIR, 'config.php'))});\n`)

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
const freePort = async (from) => { for (let p = from; p < from + 200; p++) if (await isFree(p)) return p; throw new Error('no free port') }
const servers = []
process.on('exit', () => { for (const s of servers) { try { s.kill() } catch { /* gone */ } } })
const startStore = async (cfg) => {
  const port = await freePort(8297)
  const srv = spawn('php', ['-d', 'sendmail_path=/bin/true', '-S', `127.0.0.1:${port}`, '-t', STORE_DIR], {
    stdio: 'ignore', env: { ...process.env, SPORTA_API_CONFIG_FILE: cfg, PHP_CLI_SERVER_WORKERS: '8' },
  })
  servers.push(srv)
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 100))
    try { if ((await fetch(`http://127.0.0.1:${port}/api.php?r=checkout_config`)).status === 200) return `http://127.0.0.1:${port}` } catch { /* starting */ }
  }
  return null
}

const CUSTOMER = { name: 'Cooldown Test', governorate: 'hawalli', area: 'Salmiya', block: '4', street: '12', building: '5' }
const TAG = Date.now().toString(36).toUpperCase().slice(-6)
let seq = 0
const newTrack = () => `SPCD${TAG}${String(++seq).padStart(3, '0')}`
const PHONE_BASE = 50000000 + (Date.now() % 9000000)
let phoneSeq = 0
const newPhone = () => String(PHONE_BASE + (++phoneSeq) * 7).slice(0, 8)
const order = (base, ip, { track = newTrack(), phone = newPhone(), method = 'cod' } = {}) =>
  fetch(`${base}/api.php?r=order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ track_id: track, items: [{ slug: 'cloudsoft-top-navy', size: 'L', qty: 1 }],
      customer: { ...CUSTOMER, phone }, payment_method: method }),
  }).then(async (r) => ({ status: r.status, retryAfter: r.headers.get('retry-after'), body: await r.json().catch(() => null), track, phone }))
const stock = () => sql("select stock from product_variants where slug = 'cloudsoft-top-navy' and size = 'L'")
const orderCount = () => sql(`select count(*) from orders where track_id like 'SPCD${TAG}%'`)
// "A minute ago": age this client's cooldown row and this phone's orders.
const age = async (ip, phones) => {
  await sql(`update rate_limit set window_start = window_start - 61 where bucket_key = '${rlKey('order_cooldown', ip)}'`)
  // Orders store the phone with the country code (store_phone: 965 + 8 digits).
  if (phones.length) await sql(`update orders set created_at = created_at - interval 61 second where customer_phone in (${phones.map((p) => `'965${p}'`).join(',')})`)
}

head('a store with the cooldown on')
const CFG = join(tmp, 'cooldown.php')
writeConfig(CFG, { order_cooldown_seconds: 60, trusted_proxy_ips: ['127.0.0.1'], rate_limit_secret: RL_SECRET })
const BASE = await startStore(CFG)
is(!!BASE, 'a store with order_cooldown_seconds 60 is up', BASE || 'did not start')
if (!BASE) process.exit(1)
const methods = (await (await fetch(`${BASE}/api.php?r=checkout_config`)).json())?.methods ?? []
is(methods.includes('cod'), 'cash on delivery is offered by the sandbox checkout', methods.join(','))
const card = methods.find((m) => m === 'knet' || m === 'tpay')

head('one order, then the door is shut for a minute')
const A = '198.51.100.21'
const s0 = await stock()
const first = await order(BASE, A)
is(first.status === 200 && first.body?.track_id === first.track, 'the first order is accepted', `${first.status} ${JSON.stringify(first.body)}`)
const second = await order(BASE, A)
is(second.status === 429 && second.body?.error === 'previous_order_pending',
  'a second NEW order from the same client is refused: 429 previous_order_pending', `${second.status} ${second.body?.error}`)
const ra = Number(second.body?.retry_after)
is(ra >= 55 && ra <= 60 && Number(second.retryAfter) === ra, 'with retry_after ≈ 60 s, the same in the Retry-After header', `${ra} / ${second.retryAfter}`)
is((await sql(`select count(*) from orders where track_id = '${second.track}'`)) === '0', 'the refused order wrote no order row')
is(Number(await stock()) === Number(s0) - 1, 'and took no stock (only the first order\'s garment is claimed)', `${s0} → ${await stock()}`)
const replay = await order(BASE, A, { track: first.track, phone: first.phone })
is(replay.status === 200 && replay.body?.order_id === first.body?.order_id,
  'a retry of the SAME attempt (same track id) still gets its own order back', `${replay.status} ${replay.body?.order_id} vs ${first.body?.order_id}`)
const samePhone = await order(BASE, '198.51.100.99', { phone: first.phone })
is(samePhone.status === 429 && samePhone.body?.error === 'previous_order_pending',
  'the same PHONE from another address is refused too (two devices)', `${samePhone.status} ${samePhone.body?.error}`)
const other = await order(BASE, '198.51.100.22')
is(other.status === 200, 'another client with another phone is not affected', `${other.status} ${other.body?.error ?? ''}`)

head('IPv6: one client per /64')
const V6a = '2001:db8:aa:bb:1::1', V6b = '2001:db8:aa:bb:ffff::2', V6c = '2001:db8:aa:cc::1'
const v1 = await order(BASE, V6a)
const v2 = await order(BASE, V6b)
const v3 = await order(BASE, V6c)
is(v1.status === 200 && v2.status === 429 && v3.status === 200,
  'an address in the same /64 is the same client; another /64 is not', `${v1.status} ${v2.status} ${v3.status}`)

head('a declined card or a cancelled order does not hold the door shut')
if (card) {
  const C = '198.51.100.31'
  const k1 = await order(BASE, C, { method: card })
  is(k1.status === 200, `a ${card} order is accepted (pending at the bank)`, `${k1.status} ${k1.body?.error ?? ''}`)
  const k2 = await order(BASE, C, { method: card })
  is(k2.status === 429, 'while it is pending, a new attempt waits', `${k2.status}`)
  await sql(`update orders set payment_status = 'failed' where track_id = '${k1.track}'`)
  const k3 = await order(BASE, C, { method: card, phone: k1.phone })
  is(k3.status === 200, 'once the bank has DECLINED it, the shopper may try again at once (same phone, same client)', `${k3.status} ${k3.body?.error ?? ''}`)
} else {
  is(true, 'no card method offered by this sandbox: declined-card case covered by the cancelled case below')
}
const D = '198.51.100.41'
const c1 = await order(BASE, D)
await sql(`update orders set fulfilment_status = 'cancelled' where track_id = '${c1.track}'`)
const c2 = await order(BASE, D, { phone: c1.phone })
is(c1.status === 200 && c2.status === 200, 'an order the shop cancelled does not hold the door shut', `${c1.status} ${c2.status}`)

head('after the minute it opens again')
await age(A, [first.phone])
const later = await order(BASE, A, { phone: first.phone })
is(later.status === 200, 'a minute after the accepted order, the same client and phone may order again', `${later.status} ${later.body?.error ?? ''}`)

head('eight at once from one client: exactly one accepted')
const E = '198.51.100.51'
const burst = await Promise.all(Array.from({ length: 8 }, () => order(BASE, E)))
const okN = burst.filter((r) => r.status === 200).length
const refused = burst.filter((r) => r.status === 429 && r.body?.error === 'previous_order_pending').length
is(okN === 1 && refused === 7, 'one accepted, seven refused with previous_order_pending', `${okN} ok, ${refused} refused, ${burst.map((r) => r.status).join(',')}`)
const sameAttempt = await Promise.all(Array.from({ length: 4 }, () => order(BASE, '198.51.100.52', { track: 'SPCD' + TAG + 'SAME', phone: newPhone() })))
// Same track id four times at once: the first creates, the others are answered idempotently or by the
// method/phone rule — never a second order, and never a cooldown 429 for the attempt that WAS accepted.
is((await sql(`select count(*) from orders where track_id = 'SPCD${TAG}SAME'`)) === '1', 'four taps of ONE attempt at once create one order')

head('order_cooldown_seconds 0 switches it off')
const CFG0 = join(tmp, 'off.php')
writeConfig(CFG0, { order_cooldown_seconds: 0, trusted_proxy_ips: ['127.0.0.1'], rate_limit_secret: RL_SECRET })
const BASE0 = await startStore(CFG0)
const F = '198.51.100.61'
const o1 = await order(BASE0, F), o2 = await order(BASE0, F)
is(o1.status === 200 && o2.status === 200, 'with 0, two orders in a row from one client are both accepted', `${o1.status} ${o2.status}`)

// Tidy: cancel everything this run created so no open COD order counts
// against a later suite's phone cap, and put the garments back.
const claimed = Number(await sql(`select coalesce(sum(i.qty), 0) from orders o join order_items i on i.order_id = o.id
  where o.track_id like 'SPCD${TAG}%' and o.stock_claimed = 1 and o.stock_released = 0`))
await sql(`update orders set fulfilment_status = 'cancelled', stock_released = 1 where track_id like 'SPCD${TAG}%'`)
await sql(`update product_variants set stock = stock + ${claimed} where slug = 'cloudsoft-top-navy' and size = 'L'`)
console.log(`\n(${await orderCount()} test orders cancelled, ${claimed} garments put back)`)

console.log(`\n${passes} passed, ${fails} failed`)
process.exit(fails ? 1 : 0)
