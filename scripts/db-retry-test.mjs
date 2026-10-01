/**
 * The database connection retries when the server is BUSY, and only then.
 *
 *   bash scripts/sandbox.sh
 *   node scripts/db-retry-test.mjs
 *
 * WHY. A load test of the live shop (2026-10-01) found that with about ten requests in flight
 * the PHP endpoints started answering {"error":"db_unreachable","cause":"db_host"}: shared hosting
 * caps one account's MySQL connections and refuses the ones over the limit rather than queueing
 * them. store_db_connect() now waits a moment and asks again. This holds the three properties that
 * matter, each measured by TIME because the retry is invisible except in how long a call takes:
 *
 *   1. A refusal that clears is RIDDEN OUT — a listener that appears 300ms late is reached.
 *   2. A refusal that does not clear still FAILS, after waiting — never an endless loop.
 *   3. A wrong password does NOT wait. It is a fault in config.php and will never improve;
 *      retrying it would only delay the message the owner needs.
 *
 * Mutation-tested: retrying every error (3 goes slow), and retrying nothing (1 fails).
 */
import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileP = promisify(execFile)
import net from 'node:net'

const ROOT = new URL('..', import.meta.url).pathname
let fails = 0
const check = (ok, what, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? '   ' + extra : ''}`) }

/** Run store_db_connect() in PHP and report {ms, code, ok}. */
// ASYNC, not execFileSync: case 1 needs this process's event loop free to start the listener
// while PHP is waiting, and a synchronous child would freeze the very timer it depends on.
const probe = async (host, user, pass, waits) => JSON.parse((await execFileP('php', ['-r', `
  require "${ROOT}sporta-site/public_html/api/store.php";
  $c = store_config();
  $c['db_host'] = ${JSON.stringify(host)};
  $c['db_user'] = ${JSON.stringify(user)} ?: $c['db_user'];
  $c['db_pass'] = ${JSON.stringify(pass)} ?: $c['db_pass'];
  $t = microtime(true);
  try { store_db_connect($c, ${JSON.stringify(waits)}); $ok = true; $code = 0; }
  catch (PDOException $e) { $ok = false; $code = (int) ($e->errorInfo[1] ?? 0); }
  echo json_encode(["ms" => (int) round((microtime(true) - $t) * 1000), "ok" => $ok, "code" => $code]);
`], { encoding: 'utf8' })).stdout)

// the sandbox's real database port, to forward to
const dbPort = Number(execFileSync('mariadb', ['-uroot', '-N', '-e', 'select @@port'], { encoding: 'utf8' }).trim())

// a port nothing listens on yet
const free = await new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const host = `127.0.0.1;port=${free}`

// 1. the listener appears after ~300ms; four retries spaced 150ms must reach it
const proxy = net.createServer((c) => { const u = net.connect(dbPort, '127.0.0.1'); c.pipe(u); u.pipe(c); c.on('error', () => {}); u.on('error', () => {}) })
setTimeout(() => proxy.listen(free, '127.0.0.1'), 300)
const late = await probe(host, '', '', [150, 150, 150, 150, 150, 150])
check(late.ok && late.ms >= 200, 'a refusal that clears is ridden out (the server came up 300ms late)', JSON.stringify(late))
proxy.close()

// 2. nothing ever listens: it must fail, and only after waiting out its retries
const never = await probe(`127.0.0.1;port=${free}`, '', '', [120, 120, 120])
check(!never.ok && never.code === 2002 && never.ms >= 270, 'a refusal that never clears still fails, after waiting', JSON.stringify(never))
const none = await probe(`127.0.0.1;port=${free}`, '', '', [])
check(!none.ok && none.ms < 150, 'with no waits it fails at once (so the waits are what take the time)', JSON.stringify(none))

// 3. wrong password: reported immediately, never retried
const bad = await probe('127.0.0.1', 'sporta', 'definitely-wrong', [400, 400, 400])
check(!bad.ok && bad.code === 1045 && bad.ms < 300, 'a wrong password is reported at once, not retried', JSON.stringify(bad))

console.log(fails ? `\n${fails} failed` : '\nall ok — busy is retried, broken is not')
process.exit(fails ? 1 : 0)
