/**
 * A THROWAWAY COPY OF THE SHOP for rigs that must write what the shared sandbox cannot spare.
 *
 *   import { scratchShop } from './scratch-shop.mjs'
 *
 * A MODULE, NOT A RIG — and deliberately not named with a leading underscore: .gitignore drops
 * scripts/_*.mjs as scratch, and a shared helper under that name would be silently left out of every
 * commit while three rigs import it (the trap .gitignore's own comment records for _theme-seed.mjs).
 *   const shop = await scratchShop('rename')        // { base, db, apiDir, dir, sql, rows, stop }
 *   try { ... } finally { await shop.stop() }
 *
 * WHY. The sandbox database `sporta` is used by other rigs at the same time. A rig that restores a
 * backup (delete-then-insert of thirty-odd tables), borrows a singleton row (home_banner, the `crawl`
 * settings row) or MUTATES admin.php to prove its own checks fail cannot do any of that there without
 * wrecking somebody else's run — and a mutation written into the real admin.php is served by the shared
 * php -S on :4300 to every other rig for as long as it is on disk.
 *
 * WHAT IT MAKES:
 *   - a database `sporta_fix_<pid>_<tag>`, created as root and loaded from a dump of `sporta` (READ only
 *     — the sandbox is never written), dropped again by stop();
 *   - a docroot in the OS temp directory holding a COPY of every api/*.php, so a rig may edit the copy
 *     and only its own server sees it, plus a config.php that `require`s the real one and points it at
 *     the scratch database (root over the unix socket, which needs no password for the root OS user) and
 *     at a scratch backup directory;
 *   - its own `php -S` on a free port, with E_ALL logged to <dir>/php.log, room for a large backup in a
 *     POST body (post_max_size 256M), and opcache OFF, because the rigs rewrite PHP between requests.
 * stop() kills the server, drops the database and removes the directory, and is also run on exit, so a
 * rig that throws halfway leaves nothing behind.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'

const ROOT = new URL('../', import.meta.url).pathname
const API = ROOT + 'sporta-site/public_html/api/'
const SOURCE_DB = process.env.SANDBOX_DB_NAME ?? 'sporta'

const phpStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"

function root(db, q) {
  const r = spawnSync('mariadb', ['-u', 'root', '--default-character-set=utf8mb4', '--batch', '--raw', '-N',
    ...(db ? [db] : []), '-e', q], { encoding: 'utf8', maxBuffer: 256 << 20 })
  if (r.status !== 0) throw new Error(`mariadb (${db ?? 'server'}): ${(r.stderr || '').trim()} — ${q.slice(0, 200)}`)
  return r.stdout
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.on('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  })
}

export async function scratchShop(tag) {
  if (!/^[a-z0-9_]{1,20}$/.test(tag)) throw new Error('scratchShop: tag must be [a-z0-9_]{1,20}')
  const db = `sporta_fix_${process.pid}_${tag}`
  const dir = mkdtempSync(join(tmpdir(), `sporta-fix-${tag}-`))
  const docroot = join(dir, 'public_html')
  const apiDir = join(docroot, 'api')
  let server = null
  let stopped = false

  const stop = async () => {
    if (stopped) return
    stopped = true
    if (server && server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise((r) => { server.once('exit', r); setTimeout(r, 2000) })
    }
    try { root(null, `drop database if exists \`${db}\``) } catch (e) { console.error(String(e.message || e)) }
    rmSync(dir, { recursive: true, force: true })
  }
  const onExit = () => {
    if (stopped) return
    try { server?.kill('SIGKILL') } catch {}
    try { spawnSync('mariadb', ['-u', 'root', '-e', `drop database if exists \`${db}\``]) } catch {}
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }
  process.once('exit', onExit)
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { onExit(); process.exit(130) })

  try {
    mkdirSync(apiDir, { recursive: true })
    root(null, `drop database if exists \`${db}\`; create database \`${db}\` character set utf8mb4 collate utf8mb4_unicode_ci`)
    const dump = spawnSync('bash', ['-c',
      `set -o pipefail; mariadb-dump -u root --single-transaction --default-character-set=utf8mb4 --no-tablespaces ${SOURCE_DB}` +
      ` | mariadb -u root --default-character-set=utf8mb4 ${db}`], { encoding: 'utf8', maxBuffer: 64 << 20 })
    if (dump.status !== 0) throw new Error('copying the sandbox into the scratch database failed: ' + dump.stderr)

    for (const f of readdirSync(API)) {
      if (f.endsWith('.php') && f !== 'config.php') copyFileSync(API + f, join(apiDir, f))
    }
    writeFileSync(join(apiDir, 'config.php'), [
      '<?php',
      '// SCRATCH — written by scripts/scratch-shop.mjs, removed with the directory.',
      `$c = require ${phpStr(API + 'config.php')};`,
      "$c['db_host'] = 'localhost';",
      `$c['db_name'] = ${phpStr(db)};`,
      "$c['db_user'] = 'root';",
      "$c['db_pass'] = '';",
      `$c['backup_dir'] = ${phpStr(join(dir, 'backups'))};`,
      'return $c;', '',
    ].join('\n'))

    const port = await freePort()
    server = spawn('php', ['-d', 'error_reporting=E_ALL', '-d', 'log_errors=1', '-d', `error_log=${join(dir, 'php.log')}`,
      '-d', 'display_errors=0', '-d', 'post_max_size=256M', '-d', 'memory_limit=1G',
      // OPCACHE OFF. The built-in server is not the `cli` SAPI, so opcache.enable_cli=Off does not
      // apply to it and opcache.enable=On does: with the default revalidate_freq=2 a file rewritten by
      // a mutation is served from the STALE compiled copy for up to two seconds, and a mutation that
      // "passes" is a mutation that never ran. Measured: backup-test.mjs's two backup-build.php
      // mutations went uncaught for exactly that reason. These rigs rewrite PHP between requests.
      '-d', 'opcache.enable=0',
      '-S', `127.0.0.1:${port}`, '-t', docroot], { stdio: 'ignore' })
    const base = `http://127.0.0.1:${port}`
    let up = false
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise((r) => setTimeout(r, 100))
      try { up = (await fetch(base + '/api/admin.php?r=me', { headers: { 'X-Sporta-Admin': '1' } })).status < 500 } catch {}
    }
    if (!up) throw new Error('the scratch php server did not answer')

    const sql = (q) => root(db, q)
    // Rows as objects, for a query whose columns are named.
    const rows = (q) => {
      const r = spawnSync('mariadb', ['-u', 'root', '--default-character-set=utf8mb4', '--batch', '--raw', db, '-e', q],
        { encoding: 'utf8', maxBuffer: 256 << 20 })
      if (r.status !== 0) throw new Error(`mariadb (${db}): ${r.stderr.trim()} — ${q.slice(0, 200)}`)
      const lines = r.stdout.split('\n').filter((l) => l !== '')
      if (!lines.length) return []
      const head = lines[0].split('\t')
      return lines.slice(1).map((l) => Object.fromEntries(l.split('\t').map((v, i) => [head[i], v === 'NULL' ? null : v])))
    }
    return { base, db, dir, apiDir, sql, rows, stop }
  } catch (e) {
    await stop()
    throw e
  }
}

/** A signed-in admin client against a base URL: call(route, body?) -> { status, body, text }. */
export async function adminClient(base, email = 'manager@sporta.com.kw', password = 'correct horse') {
  let jar = ''
  const call = async (route, body) => {
    const r = await fetch(base + '/api/admin.php?r=' + route, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Sporta-Admin': '1', ...(jar ? { Cookie: jar } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const set = r.headers.getSetCookie?.() ?? []
    if (set.length) jar = set.map((c) => c.split(';')[0]).join('; ')
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: r.status, body: json, text }
  }
  const login = await call('login', { email, password })
  if (login.status !== 200) throw new Error('sign-in to the scratch panel failed: ' + login.text.slice(0, 200))
  return call
}

/** Every table and column a fully-migrated install has, read from the GENERATED manifest. */
export function schemaManifest() {
  const src = readFileSync(ROOT + 'scripts/live/live-schema-full.php', 'utf8')
  const m = src.match(/\$MANIFEST_JSON = <<<'JSON'\n([\s\S]*?)\nJSON;/)
  if (!m) throw new Error('could not find $MANIFEST_JSON in scripts/live/live-schema-full.php')
  const j = JSON.parse(m[1])
  if (!j.tables || Object.keys(j.tables).length < 40) throw new Error('the schema manifest parsed to too few tables')
  return j.tables
}
