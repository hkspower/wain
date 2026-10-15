/**
 * test:fulfilment-transitions — BL-02 (2026-10-14, owner's choice: forward only).
 *
 * An order's fulfilment status moves forward through unfulfilled → packed → shipped → delivered;
 * it may be cancelled from any step short of delivery; a cancelled order may be reopened to
 * unfulfilled. Anything else answers 409 bad_transition and writes nothing.
 *
 * Run `bash scripts/sandbox.sh` first. The order's status is restored after the checks.
 * MUTATE=1 removes the guard in admin.php and the checks must fail.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4300'
const ROOT = new URL('..', import.meta.url).pathname
const adminFile = ROOT + 'sporta-site/public_html/api/admin.php'
const sql = (q) => execFileSync('mariadb', ['-u', 'sporta', '-plocaldev', 'sporta', '--default-character-set=utf8mb4', '-N', '-e', q], { encoding: 'utf8' }).replace(/\n$/, '')

let fails = 0
const check = (ok, what, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `   ${detail}` : ''}`) }

const adminOrig = readFileSync(adminFile, 'utf8')
if (process.env.MUTATE) {
  // Remove the guard: every move is accepted, as before BL-02.
  writeFileSync(adminFile, adminOrig.replace("if ($from !== $status && !in_array($status, $allowed[$from] ?? [], true)) {", 'if (false) {'))
}

let cookie = ''
const api = async (route, data) => {
  const r = await fetch(`${BASE}/api/admin.php?r=${route}`, {
    method: data ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Sporta-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  })
  const set = r.headers.get('set-cookie')
  if (set && !cookie) cookie = set.split(';')[0]
  return { status: r.status, text: await r.text() }
}

const orderId = sql("select id from orders order by id limit 1")
const orig = sql(`select fulfilment_status from orders where id = ${orderId}`)

const setFrom = (s) => sql(`update orders set fulfilment_status = '${s}' where id = ${orderId}`)
const now = () => sql(`select fulfilment_status from orders where id = ${orderId}`)
const move = (to) => api('fulfilment', { order_id: Number(orderId), status: to })

// Each row: from, to, allowed?
const table = [
  ['unfulfilled', 'packed', true], ['unfulfilled', 'cancelled', true], ['unfulfilled', 'shipped', false], ['unfulfilled', 'delivered', false],
  ['packed', 'shipped', true], ['packed', 'cancelled', true], ['packed', 'unfulfilled', false],
  ['shipped', 'delivered', true], ['shipped', 'cancelled', true], ['shipped', 'packed', false],
  ['delivered', 'cancelled', false], ['delivered', 'unfulfilled', false],
  ['cancelled', 'unfulfilled', true], ['cancelled', 'packed', false],
]

try {
  sql('delete from rate_limit; delete from rate_bucket')
  const login = await api('login', { email: 'manager@sporta.com.kw', password: 'correct horse' })
  check(login.status === 200, 'signed in to the panel', `status ${login.status}`)

  for (const [from, to, ok] of table) {
    setFrom(from)
    const r = await move(to)
    const after = now()
    if (ok) {
      check(r.status === 200 && after === to, `${from} → ${to} is allowed`, `status ${r.status}, now ${after}`)
    } else {
      check(r.status === 409 && /bad_transition/.test(r.text) && after === from,
        `${from} → ${to} is refused and changes nothing`, `status ${r.status}, now ${after}`)
    }
  }

  // Re-marking the same status is a no-op, not an error.
  setFrom('packed')
  const same = await move('packed')
  check(same.status === 200 && now() === 'packed', 're-marking packed as packed is accepted and changes nothing', `status ${same.status}`)

  // A stale screen cannot move a delivered order backwards (N05's case).
  setFrom('delivered')
  const stale = await move('packed')
  check(stale.status === 409 && now() === 'delivered', 'a stale screen cannot move a delivered order back to packed', `status ${stale.status}`)

  // An unknown order is refused by name.
  const none = await api('fulfilment', { order_id: 999999999, status: 'packed' })
  check(none.status === 404, 'an unknown order is not found', `status ${none.status}`)
} finally {
  if (process.env.MUTATE) writeFileSync(adminFile, adminOrig)
  setFrom(orig)
  console.log(fails ? `\n${fails} FAILED` : '\nall fulfilment-transition checks passed')
  process.exitCode = fails ? 1 : 0
}
