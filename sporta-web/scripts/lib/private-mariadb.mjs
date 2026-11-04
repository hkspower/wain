// A PRIVATE MariaDB for suites that must never touch the shared test rig.
//
//   const inst = await startPrivateMariadb({ label: 'bk', portFrom: 33560, logBin: true })
//   await inst.sql('select 1', null)             // root over the unix socket, no password
//   inst.stop()                                   // also runs on process exit
//
// Own datadir under a fresh temp directory, own port (scanned upward from `portFrom`), own unix
// socket, bound to 127.0.0.1, `--no-defaults`. It never reads /etc/mysql, never connects to the
// default socket and never uses the database name `sporta` unless the caller creates it inside
// ITS OWN instance. Every password a suite uses is generated at run time by the suite.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
export const toolsPresent = () => {
  const installDb = ['mariadb-install-db', 'mysql_install_db'].find(have)
  const missing = [['mariadbd', have('mariadbd')], ['mariadb', have('mariadb')], ['mariadb-dump', have('mariadb-dump')], ['mariadb-install-db', !!installDb]]
    .filter(([, ok]) => !ok).map(([n]) => n)
  return { installDb, missing }
}

const isFree = (p) => new Promise((res) => {
  const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(p, '127.0.0.1')
})
export const freePort = async (from) => { for (let p = from; p < from + 120; p++) if (await isFree(p)) return p; throw new Error('no free port') }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const registry = []
const asRoot = typeof process.getuid === 'function' && process.getuid() === 0
let hooked = false
export function stopAll() {
  for (const i of registry.splice(0)) i.stop()
}
function hook() {
  if (hooked) return
  hooked = true
  process.on('exit', stopAll)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))
}

export async function startPrivateMariadb({ label = 'db', portFrom = 33560, logBin = false, extraArgs = [], root = null } = {}) {
  hook()
  const { installDb, missing } = toolsPresent()
  if (missing.length) throw Object.assign(new Error(`missing: ${missing.join(', ')}`), { skip: true })
  const dir = root || mkdtempSync(join(tmpdir(), `sporta-${label}-`))
  const datadir = join(dir, 'data')
  mkdirSync(datadir, { recursive: true })
  // a unix socket path must stay under ~100 bytes
  let sockDir = dir
  if (join(dir, `${label}.sock`).length > 90) sockDir = mkdtempSync('/tmp/sp-')
  const sock = join(sockDir, `${label}.sock`)
  const r = spawnSync(installDb, ['--no-defaults', `--datadir=${datadir}`, '--auth-root-authentication-method=normal', '--skip-test-db',
    ...(asRoot ? ['--user=root'] : [])], { stdio: 'ignore' })
  if (r.status !== 0) throw Object.assign(new Error('could not initialise a private data directory'), { skip: true })
  const port = await freePort(portFrom)
  const logFile = join(dir, 'mariadbd.log')
  const secure = join(dir, 'secure'); mkdirSync(secure, { recursive: true })
  const args = ['--no-defaults', `--datadir=${datadir}`, `--port=${port}`, `--socket=${sock}`, '--bind-address=127.0.0.1',
    '--skip-name-resolve', `--pid-file=${join(dir, `${label}.pid`)}`, '--innodb-flush-log-at-trx-commit=0',
    '--max-allowed-packet=64M', '--local-infile=0', `--secure-file-priv=${secure}`, '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci', '--innodb-buffer-pool-size=64M', '--skip-log-warnings',
    ...(logBin ? [`--log-bin=${join(dir, 'binlog')}`, '--binlog-format=ROW', '--server-id=77', '--expire-logs-days=14'] : []),
    ...(asRoot ? ['--user=root'] : []), ...extraArgs]
  const child = spawn('mariadbd', args, { stdio: ['ignore', 'ignore', openSync(logFile, 'a')], detached: true })
  const inst = {
    label, dir, datadir, sock, port, logFile, pid: child.pid, binlogBase: join(dir, 'binlog'),
    // run SQL as root over the socket. `db` null = no default database. Returns trimmed stdout.
    sql(text, db = null, extra = []) {
      return new Promise((resolve, reject) => {
        const p = spawn('mariadb', ['--no-defaults', '-S', sock, '-uroot', '--default-character-set=utf8mb4', ...extra, ...(db ? [db] : []), '-N', '-B'])
        let out = '', err = ''
        p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { err += d })
        p.on('close', (code) => (code === 0 ? resolve(out.replace(/\n$/, '')) : reject(new Error(err.trim() || `mariadb exit ${code}`))))
        p.stdin.on('error', () => { /* the client exited first; its exit code says why */ })
        p.stdin.end(text)
      })
    },
    // run a file through the client (migrations)
    sqlFile(file, db) {
      const r2 = spawnSync('mariadb', ['--no-defaults', '-S', sock, '-uroot', '--default-character-set=utf8mb4', db], { input: readFileSync(file), encoding: 'utf8' })
      if (r2.status !== 0) throw new Error(`${file}: ${(r2.stderr || '').trim().slice(0, 300)}`)
    },
    stop() {
      try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill() } catch { /* gone */ } }
      const alive = () => { try { process.kill(-child.pid, 0); return true } catch { return false } }
      for (let i = 0; i < 60 && alive(); i++) spawnSync('sleep', ['0.25'])
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
      if (!process.env.KEEP) { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } if (sockDir !== dir) { try { rmSync(sockDir, { recursive: true, force: true }) } catch { /* ignore */ } } }
      else console.log(`KEEP=1: ${dir}`)
    },
  }
  registry.push(inst)
  let up = false
  for (let i = 0; i < 200 && !up; i++) { try { await inst.sql('select 1'); up = true } catch { await sleep(150) } }
  if (!up) {
    const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').slice(-2).join(' | ').slice(0, 200) : 'no log'
    inst.stop()
    throw Object.assign(new Error(`the private MariaDB did not start (${tail})`), { skip: true })
  }
  inst.version = await inst.sql('select version()')
  return inst
}
