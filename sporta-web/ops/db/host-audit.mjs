#!/usr/bin/env node
// HOST AUDIT for the database — the facts the SQL cannot see, read from the
// VPS the way the project's other jobs read it: ONE read-only one-shot job.
//
//   node ops/db/host-audit.mjs --root /h --probe        (what the compose job runs)
//   node ops/db/host-audit.mjs --root <fixture> --json   (what the test suite runs)
//
// WHAT IT READS (everything through read-only bind mounts, nothing else)
//   <root>/containers/<id>/config.v2.json + hostconfig.json   the RUNTIME truth about every container
//                                                            (host /var/lib/docker/containers)
//   <root>/volumes/<name>/_data                              the database volume (host /var/lib/docker/volumes)
//   <root>/docker/...                                        compose files, backups, private config (host /docker)
//   /proc/net/tcp, /proc/net/tcp6 (and /proc/<pid>/status)   what the host is really listening on
//   and, with --probe, one TCP connect to each of a short list of addresses on port 3306.
//
// It never opens the Docker socket, never writes, never prints a value from a
// file or an environment variable: only names, ports, modes, owners, ages and
// counts. A secret that sits in a container's environment is reported by the
// NAME of the variable. The compose job that runs this mounts those paths
// read-only; ops/db/HOST-CHECKLIST.md lists each fact and the value that is good.
//
// EXIT 0 no FAIL (UNKNOWN is allowed and printed), 1 at least one FAIL, 2 bad usage.
// Output ends with HOST_AUDIT_DONE fail=N unknown=M so a job log can be grepped.

import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d }
const list = (f, d) => String(arg(f, d) ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export const OPTS = {
  root: arg('--root', '/h'),
  proc: arg('--proc', '/proc'),
  json: flag('--json'),
  probe: flag('--probe'),
  probeTargets: list('--probe-targets', ''),
  probePort: Number(arg('--probe-port', '3306')),
  probeTimeout: Number(arg('--probe-timeout', '3000')),
  dbImage: new RegExp(arg('--db-image', '(mariadb|mysql|percona)'), 'i'),
  dbName: new RegExp(arg('--db-name', '^/?sporta'), 'i'),
  webAllow: new RegExp(arg('--web-allow', '^/?apache-sporta-\\d+$')),
  sporta: arg('--sporta-dir', 'docker/sporta'),
  dumpMaxHours: Number(arg('--dump-max-hours', '36')),
  ttsMaxDays: Number(arg('--tts-max-days', '100')),
  now: arg('--now') ? new Date(arg('--now')) : new Date(),
}
if (argv.some((a) => a.startsWith('--') && !['--root', '--proc', '--json', '--probe', '--probe-targets', '--probe-port', '--probe-timeout', '--db-image', '--db-name', '--web-allow', '--sporta-dir', '--dump-max-hours', '--tts-max-days', '--now', '--help'].includes(a))) {
  console.error('host-audit: unknown flag'); process.exit(2)
}

// ---------------------------------------------------------------------------
const rd = (p) => { try { return readFileSync(p, 'utf8') } catch { return null } }
const rj = (p) => { const t = rd(p); if (t === null) return null; try { return JSON.parse(t) } catch { return null } }
const st = (p) => { try { return statSync(p) } catch { return null } }
const ls = (p) => { try { return readdirSync(p) } catch { return null } }
const oct = (m) => (m & 0o7777).toString(8).padStart(4, '0')
const own = (s) => `${s.uid}:${s.gid}`
const ageH = (s) => (OPTS.now - s.mtime) / 36e5
const R = (p) => join(OPTS.root, p)

// ---------------------------------------------------------------------------
// The containers
// ---------------------------------------------------------------------------
function containers() {
  const dir = R('containers')
  const ids = ls(dir)
  if (ids === null) return null
  const out = []
  for (const id of ids) {
    const c = rj(join(dir, id, 'config.v2.json'))
    if (!c) continue
    const h = rj(join(dir, id, 'hostconfig.json')) ?? {}
    out.push({
      id, name: String(c.Name ?? '').replace(/^\//, ''), image: String(c.Config?.Image ?? c.Image ?? ''), user: String(c.Config?.User ?? ''),
      running: !!c.State?.Running, project: c.Config?.Labels?.['com.docker.compose.project'] ?? '',
      envNames: (c.Config?.Env ?? []).map((e) => String(e)),
      networks: Object.fromEntries(Object.entries(c.NetworkSettings?.Networks ?? {}).map(([n, v]) => [n, { ip: v?.IPAddress ?? '' }])),
      runtimePorts: c.NetworkSettings?.Ports ?? {},
      mounts: Object.values(c.MountPoints ?? {}).map((m) => ({ src: m.Source ?? '', dst: m.Destination ?? '', rw: m.RW !== false, type: m.Type ?? '', name: m.Name ?? '' })),
      noNewPrivilegesRuntime: c.NoNewPrivileges === true,
      host: { netMode: h.NetworkMode ?? '', ports: h.PortBindings ?? {}, privileged: !!h.Privileged, capAdd: h.CapAdd ?? [], capDrop: h.CapDrop ?? [],
        secOpt: h.SecurityOpt ?? [], ro: !!h.ReadonlyRootfs, pid: h.PidMode ?? '', ipc: h.IpcMode ?? '', binds: h.Binds ?? [] },
    })
  }
  return out
}
// The shop's own database only: another site's MariaDB on the same host is a neighbour, not the subject.
const isDb = (c) => OPTS.dbImage.test(c.image) && OPTS.dbName.test(c.name)

// A host path as seen through the read-only mounts.
function hostPath(p) {
  if (p.startsWith('/var/lib/docker/volumes/')) return R('volumes/' + p.slice('/var/lib/docker/volumes/'.length))
  if (p.startsWith('/docker/')) return R(p.slice(1))
  return null
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const results = []
const add = (id, status, title, detail, items = [], expected = '') => results.push({ id, status, title, detail, items, expected })
const PASS = 'PASS', FAIL = 'FAIL', UNK = 'UNKNOWN'

// /proc/net/tcp: listening sockets
function listeners() {
  const out = []
  for (const f of ['tcp', 'tcp6']) {
    const t = rd(join(OPTS.proc, 'net', f))
    if (t === null) continue
    for (const line of t.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/)
      if (p.length < 4 || p[3] !== '0A') continue
      const [addr, port] = p[1].split(':')
      const a = addr.length === 8 ? addr.match(/../g).reverse().map((h) => parseInt(h, 16)).join('.') : (/^0+$/.test(addr) ? '::' : /^0{31}1$/.test(addr) ? '::1' : 'ipv6')
      out.push({ addr: a, port: parseInt(port, 16) })
    }
  }
  return out
}
const isLoop = (a) => a === '::1' || /^127\./.test(a)
const DB_PORTS = new Set([3306, 3307, 33060, 33061, 5432, 27017, 6379, 11211])

// Every address the host itself holds (public, docker bridges, loopback), from
// /proc/net/fib_trie: a published port answers on all of them, and reading them
// here keeps the server's public address out of the repo.
function localAddresses() {
  const t = rd(join(OPTS.proc, 'net', 'fib_trie'))
  if (t === null) return null
  const out = new Set(); let last = ''
  for (const line of t.split('\n')) {
    const m = /\|--\s+(\d+\.\d+\.\d+\.\d+)\s*$/.exec(line)
    if (m) { last = m[1]; continue }
    if (/\/32\s+host\s+LOCAL/.test(line) && last) out.add(last)
  }
  return [...out]
}

function mysqldUid() {
  const pids = ls(OPTS.proc)
  if (!pids) return null
  for (const p of pids) {
    if (!/^\d+$/.test(p)) continue
    const comm = (rd(join(OPTS.proc, p, 'comm')) ?? '').trim()
    if (!/^(mariadbd|mysqld)$/.test(comm)) continue
    const m = /^Uid:\s+(\d+)/m.exec(rd(join(OPTS.proc, p, 'status')) ?? '')
    if (m) return Number(m[1])
  }
  return null
}

function walk(dir, depth, fn) {
  const names = ls(dir)
  if (!names) return
  for (const n of names) {
    const p = join(dir, n)
    let s
    try { s = lstatSync(p) } catch { continue }
    fn(p, n, s)
    if (s.isDirectory() && depth > 0) walk(p, depth - 1, fn)
  }
}

// ---------------------------------------------------------------------------
// The facts
// ---------------------------------------------------------------------------
async function run() {
  const all = containers()
  if (all === null) {
    add('host.containers', UNK, 'Container runtime files are readable', `${R('containers')} is not mounted or not readable: mount /var/lib/docker/containers read-only at ${R('containers')}`, [], 'readable')
    return
  }
  const dbs = all.filter(isDb)
  add('host.db_container', dbs.length ? PASS : FAIL, 'The database container is found', dbs.length ? `${dbs.length} database container(s): ${dbs.map((c) => `${c.name} (${c.image}, ${c.running ? 'running' : 'stopped'})`).join('; ')}` : 'no container named like the shop database (default ^sporta) whose image is mariadb/mysql: pass --db-name if it is called something else', dbs.map((c) => c.name), 'one running mariadb container')
  if (!dbs.length) return

  // H1 — port publishing, declared and runtime
  {
    const bad = []
    for (const c of dbs) {
      const open = (b) => (Array.isArray(b) ? b.filter((x) => !/^127\./.test(x.HostIp ?? '') && x.HostIp !== '::1') : [])
      for (const [cp, b] of Object.entries(c.host.ports)) if (open(b).length) bad.push(`${c.name}: ${cp} published on host port(s) ${open(b).map((x) => `${x.HostIp || '0.0.0.0'}:${x.HostPort}`).join(', ')}`)
      for (const [cp, b] of Object.entries(c.runtimePorts)) if (open(b).length && !open(c.host.ports[cp]).length) bad.push(`${c.name}: ${cp} published at run time on host port(s) ${open(b).map((x) => x.HostPort).join(', ')}`)
    }
    add('host.port_published', bad.length ? FAIL : PASS, 'No database port is published to the host', bad.length ? `${bad.length} published port mapping(s)` : 'PortBindings is empty for every database container', bad, 'PortBindings: {}  (no "ports:" on the database service)')
  }
  // H1b — listeners on the host
  {
    const ls_ = listeners()
    if (!existsSync(join(OPTS.proc, 'net', 'tcp'))) add('host.port_listening', UNK, 'Nothing listens on a database port beyond loopback', `${OPTS.proc}/net/tcp is not readable`, [], 'no listener on 3306/3307/33060 except 127.0.0.1')
    else {
      const open = ls_.filter((l) => DB_PORTS.has(l.port) && !isLoop(l.addr))
      const loop = ls_.filter((l) => DB_PORTS.has(l.port) && isLoop(l.addr))
      add('host.port_listening', open.length ? FAIL : PASS, 'Nothing listens on a database port beyond loopback', open.length ? `${open.length} listener(s) on database ports reachable beyond loopback` : `${ls_.length} listening sockets seen; none on a database port beyond loopback${loop.length ? ` (${loop.length} on loopback only)` : ''}`, open.map((l) => `${l.addr}:${l.port}`), 'no 0.0.0.0:3306 / :::3306 in /proc/net/tcp')
    }
  }
  // H1c — actual connection attempts
  {
    if (!OPTS.probe) add('host.port_reachable', UNK, '3306 does not answer from the host or its public address', 'not probed (run with --probe; the compose job does)', [], 'connection refused or timeout on every target')
    else {
      const local = localAddresses()
      const targets = OPTS.probeTargets.length ? OPTS.probeTargets : (local ?? ['127.0.0.1']).map((a) => `${a}:${OPTS.probePort}`)
      const res = await Promise.all(targets.map((t) => new Promise((resolve) => {
        const [h, p] = [t.slice(0, t.lastIndexOf(':')), Number(t.slice(t.lastIndexOf(':') + 1))]
        const s = connect({ host: h, port: p, timeout: OPTS.probeTimeout })
        s.on('connect', () => { s.destroy(); resolve([t, 'OPEN']) })
        s.on('timeout', () => { s.destroy(); resolve([t, 'timeout']) })
        s.on('error', (e) => resolve([t, e.code === 'ECONNREFUSED' ? 'refused' : String(e.code)]))
      })))
      const open = res.filter(([, r]) => r === 'OPEN')
      add('host.port_reachable', open.length ? FAIL : PASS, '3306 does not answer from the host or its public address', open.length ? `${open.length} of ${res.length} targets ANSWER on the database port` : `${res.length} targets tried, none answers`, res.map(([t, r]) => `${t}: ${r}`), 'refused or timeout on every target')
    }
  }
  // H2 — network mode and neighbours
  {
    const bad = dbs.filter((c) => /^(host|container:)/.test(c.host.netMode)).map((c) => `${c.name}: NetworkMode ${c.host.netMode}`)
    add('host.network_mode', bad.length ? FAIL : PASS, 'The database is not on the host network', bad.length ? 'a database shares the host or another container network namespace' : 'every database container has its own network namespace', bad, 'NetworkMode is a named network, not "host"')
  }
  {
    const dbNets = new Set(dbs.flatMap((c) => Object.keys(c.networks)))
    const neigh = all.filter((c) => c.running && !isDb(c) && Object.keys(c.networks).some((n) => dbNets.has(n)))
    const bad = neigh.filter((c) => !OPTS.webAllow.test(c.name))
    const onBridge = [...dbNets].filter((n) => n === 'bridge')
    add('host.network_neighbours', bad.length || onBridge.length ? FAIL : PASS, 'Only the shop shares the database network', bad.length ? `${bad.length} other container(s) can reach the database port` : `${neigh.length} container(s) besides the database on its network(s) ${[...dbNets].join(', ')}, all allowed`, [...bad.map((c) => `${c.name} (project ${c.project || '-'}, network ${Object.keys(c.networks).filter((n) => dbNets.has(n)).join('/')})`), ...onBridge.map((n) => `the database is on the default bridge network "${n}": every container on it is a neighbour`)], 'only the sporta web container on the database network; no other site, no default bridge')
  }
  // H3 — privileges and hardening flags
  {
    const bad = []
    for (const c of dbs) {
      if (c.host.privileged) bad.push(`${c.name}: privileged`)
      if (c.host.pid === 'host' || c.host.ipc === 'host') bad.push(`${c.name}: shares the host ${c.host.pid === 'host' ? 'PID' : 'IPC'} namespace`)
      for (const cap of c.host.capAdd) if (/^(SYS_ADMIN|NET_ADMIN|SYS_PTRACE|SYS_MODULE|DAC_READ_SEARCH|ALL)$/i.test(String(cap).replace(/^CAP_/, ''))) bad.push(`${c.name}: cap_add ${cap}`)
    }
    add('host.privileged', bad.length ? FAIL : PASS, 'The database container is not privileged', bad.length ? `${bad.length} privilege problem(s)` : 'not privileged, no host namespaces, no dangerous capability added', bad, 'Privileged false; no SYS_ADMIN / NET_ADMIN / SYS_PTRACE')
    const capdrop = dbs.filter((c) => !c.host.capDrop.some((x) => /^(ALL|CAP_ALL)$/i.test(x)))
    add('host.cap_drop', capdrop.length ? FAIL : PASS, 'The database drops all capabilities', capdrop.length ? 'CapDrop does not contain ALL' : 'CapDrop = ALL', capdrop.map((c) => `${c.name}: CapDrop ${JSON.stringify(c.host.capDrop)}, CapAdd ${JSON.stringify(c.host.capAdd)}`), 'cap_drop: [ALL] with at most CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID added back')
    const nnp = dbs.filter((c) => !(c.noNewPrivilegesRuntime || c.host.secOpt.some((o) => /^no-new-privileges(:true)?$/.test(o))))
    add('host.no_new_privileges', nnp.length ? FAIL : PASS, 'no-new-privileges is set', nnp.length ? 'SecurityOpt lacks no-new-privileges' : 'no-new-privileges is on', nnp.map((c) => c.name), 'security_opt: ["no-new-privileges:true"]')
    const rofs = dbs.filter((c) => !c.host.ro)
    add('host.readonly_rootfs', rofs.length ? FAIL : PASS, 'The root filesystem is read-only', rofs.length ? 'ReadonlyRootfs is false (needs tmpfs for /tmp and /run/mysqld when turned on)' : 'ReadonlyRootfs is true', rofs.map((c) => c.name), 'read_only: true with tmpfs: [/tmp, /run/mysqld]')
    const uid = mysqldUid()
    const configured = dbs.filter((c) => c.user && !/^(root|0)(:|$)/.test(c.user))
    if (uid !== null) add('host.runs_as_non_root', uid === 0 ? FAIL : PASS, 'mysqld does not run as root', uid === 0 ? 'the database server process runs as uid 0' : `the database server process runs as uid ${uid}`, [], 'uid 999 (mysql)')
    else if (configured.length === dbs.length) add('host.runs_as_non_root', PASS, 'mysqld does not run as root', `Config.User is set to a non-root user for every database container`, [], 'uid 999 (mysql)')
    else add('host.runs_as_non_root', UNK, 'mysqld does not run as root', 'no mysqld process found in /proc (needs pid: host) and Config.User is empty (the official image starts as root and drops to mysql); the data directory owner below is the practical proof', [], 'uid 999 (mysql)')
  }
  // H3b — image, environment
  {
    const pinned = (img) => /@sha256:/.test(img) || (/:[^:/]+$/.test(img) && !/:latest$/.test(img))
    const bad = dbs.filter((c) => !pinned(c.image)).map((c) => `${c.name}: ${c.image || '(no image)'}`)
    add('host.image_pinned', bad.length ? FAIL : PASS, 'The database image is pinned to a version', bad.length ? 'image is untagged or :latest' : `image ${dbs.map((c) => c.image).join(', ')}`, bad, 'mariadb:11.8 (or a digest), never :latest')
    const SECRET_ENV = /^(MARIADB|MYSQL|MYSQL_RANDOM)?_?(ROOT_)?(PASSWORD|PASS|SECRET|TOKEN)(_HASH)?$/i
    const lit = []
    for (const c of dbs) for (const e of c.envNames) {
      const i = e.indexOf('=')
      const name = i < 0 ? e : e.slice(0, i), val = i < 0 ? '' : e.slice(i + 1)
      if (/_FILE$/.test(name)) continue
      if (/ALLOW_EMPTY/i.test(name) && /^(1|yes|true)$/i.test(val)) { lit.push(`${c.name}: ${name} allows an empty root password`); continue }
      if (/RANDOM_ROOT_PASSWORD/i.test(name)) continue
      if ((SECRET_ENV.test(name) || /(PASSWORD|SECRET|TOKEN)/i.test(name)) && val !== '') lit.push(`${c.name}: ${name} holds a literal value`)
    }
    add('host.env_secrets', lit.length ? FAIL : PASS, 'No password sits in the database container environment', lit.length ? `${lit.length} secret variable(s) with a literal value (visible to docker inspect and to the socket)` : 'every secret variable is a *_FILE reference', lit, 'MARIADB_ROOT_PASSWORD_FILE=/run/secrets/..., never MARIADB_ROOT_PASSWORD=...')
  }
  // H4 — Docker socket exposure
  {
    const dbNets = new Set(dbs.flatMap((c) => Object.keys(c.networks)))
    const sock = (c) => [...c.mounts.map((m) => m.src), ...c.host.binds].some((x) => /docker\.sock/.test(String(x)))
    const exposed = all.filter((c) => sock(c) && (isDb(c) || Object.keys(c.networks).some((n) => dbNets.has(n))))
    const others = all.filter((c) => sock(c) && !exposed.includes(c))
    add('host.docker_socket', exposed.length ? FAIL : PASS, 'The Docker socket is not mounted into the database or the shop', exposed.length ? `${exposed.length} container(s) on the database network mount the Docker socket (root on the host)` : `no container on the database network mounts the Docker socket${others.length ? `; ${others.length} other container(s) do (a reverse proxy needs it)` : ''}`, [...exposed.map((c) => `${c.name} mounts docker.sock`), ...others.map((c) => `info: ${c.name} mounts docker.sock (not on the database network)`)], 'no docker.sock on the web or database container; only the reverse proxy, read-only')
  }
  // H5 — data directory
  {
    const uid = mysqldUid()
    const items = [], bad = []
    let any = false
    for (const c of dbs) {
      const m = c.mounts.find((x) => x.dst === '/var/lib/mysql')
      if (!m) { items.push(`${c.name}: no mount at /var/lib/mysql (data lives in the container layer)`); bad.push(`${c.name}: data directory is not on a volume`); continue }
      const p = hostPath(m.src)
      const s = p && st(p)
      if (!s) { items.push(`${c.name}: ${m.type || 'mount'} ${m.name || m.src} is not readable through the mounts`); continue }
      any = true
      items.push(`${c.name}: data dir mode ${oct(s.mode)} owner ${own(s)}`)
      if (s.mode & 0o007) bad.push(`${c.name}: data directory mode ${oct(s.mode)} lets other users list it`)
      if (s.uid === 0 && uid !== 0) bad.push(`${c.name}: data directory is owned by root, not by the database user`)
      if (uid !== null && s.uid !== uid && s.uid !== 0) bad.push(`${c.name}: data directory owner uid ${s.uid} is not the mysqld uid ${uid}`)
      const top = ls(p) ?? []
      const world = [], dumps = [], logs = []
      for (const n of top) {
        const fs_ = lstatSync(join(p, n))
        if (fs_.isFile() && (fs_.mode & 0o004)) world.push(n)
        if (/\.(sql|dump|bak|old|zip|7z|tgz)(\.|$)|\.tar(\.|$)|\.sql\.(gz|zst|bz2|xz)$|backup/i.test(n)) dumps.push(`${n} (${oct(fs_.mode)}, ${Math.round(fs_.size / 1024)} KiB)`)
        if (/^(general|slow|query|mysql-slow)[-_.a-z]*\.(log|csv)$|general_log/i.test(n)) logs.push(`${n} (${oct(fs_.mode)})`)
      }
      if (world.length) bad.push(`${c.name}: ${world.length} file(s) in the data directory are world-readable`)
      if (dumps.length) bad.push(`${c.name}: backup/dump-looking file(s) inside the data directory: ${dumps.join(', ')}`)
      if (logs.length) bad.push(`${c.name}: query log file(s) inside the data directory: ${logs.join(', ')}`)
    }
    add('host.data_dir', !any && !bad.length ? UNK : bad.length ? FAIL : PASS, 'The data directory is private and holds only data', bad.length ? `${bad.length} problem(s)` : any ? 'mode, owner and contents are as expected' : 'the data directory could not be read (mount /var/lib/docker/volumes read-only)', [...items, ...bad.map((b) => `PROBLEM ${b}`)], 'mode 0700 (or 0750), owner = the mysqld uid (999), no world-readable file, no dump, no query log inside')
  }
  // H6 — backups
  {
    const dir = R(`${OPTS.sporta}/backups`)
    const s = st(dir)
    if (!s) add('host.backups_dir', UNK, 'The backup folder is private', `${dir} is not readable (mount /docker read-only)`, [], 'mode 0700, owner root; no file readable by others')
    else {
      const bad = []; let files = 0
      if (s.mode & 0o077) bad.push(`the folder itself is mode ${oct(s.mode)} (others can list it)`)
      const worldFiles = [], looseConf = []
      walk(dir, 3, (p, n, e) => {
        if (e.isDirectory()) return
        files++
        if (e.mode & 0o004) worldFiles.push(p.slice(dir.length + 1))
        if (/(api|knet|pay)-?config.*\.php$|\.env$|config\.php/i.test(n) && (e.mode & 0o077)) looseConf.push(`${p.slice(dir.length + 1)} (${oct(e.mode)})`)
      })
      if (worldFiles.length) bad.push(`${worldFiles.length} file(s) are readable by every local user, e.g. ${worldFiles.slice(0, 3).join(', ')}`)
      if (looseConf.length) bad.push(`${looseConf.length} configuration copy(ies) with a secret are not mode 0600: ${looseConf.slice(0, 4).join(', ')}`)
      add('host.backups_dir', bad.length ? FAIL : PASS, 'The backup folder is private', bad.length ? `${bad.length} problem(s) among ${files} file(s)` : `folder mode ${oct(s.mode)}, ${files} file(s), none readable by others`, bad, 'folder 0700 root; every file 0600; no config copy that holds a key')
      // newest dump
      const dumps = []
      walk(dir, 3, (p, n, e) => { if (e.isFile() && /\.(sql|dump)(\.(gz|zst|bz2|xz))?$/i.test(n)) dumps.push({ n, mode: e.mode, h: ageH(e), size: e.size, rel: p.slice(dir.length + 1) }) })
      dumps.sort((a, b) => a.h - b.h)
      if (!dumps.length) add('host.backup_recent', FAIL, 'A database dump exists and is recent', 'no database dump (*.sql, *.sql.gz) found under the backup folder', [], `newest dump younger than ${OPTS.dumpMaxHours} hours`)
      else {
        const loose = dumps.filter((d) => d.mode & 0o077)
        const probs = []
        if (dumps[0].h > OPTS.dumpMaxHours) probs.push(`newest dump is ${Math.round(dumps[0].h)} hours old (limit ${OPTS.dumpMaxHours})`)
        if (loose.length) probs.push(`${loose.length} dump(s) not mode 0600`)
        add('host.backup_recent', probs.length ? FAIL : PASS, 'A database dump exists and is recent', probs.length ? probs.join('; ') : `newest dump is ${Math.round(dumps[0].h)} hours old; ${dumps.length} dump(s), all mode 0600`, dumps.slice(0, 5).map((d) => `${d.rel} age ${Math.round(d.h)} h mode ${oct(d.mode)} ${Math.round(d.size / 1024)} KiB`), `newest dump younger than ${OPTS.dumpMaxHours} hours, every dump 0600`)
      }
    }
  }
  // H7 — private configuration and secret files
  {
    const dir = R(`${OPTS.sporta}/private`)
    if (!st(dir)) add('host.private_config', UNK, 'Configuration and secret files are not readable by others', `${dir} is not readable (mount /docker read-only)`, [], 'secret files 0400/0440/0600; private folders 0700/0750')
    else {
      const items = [], bad = []
      const names = ['api-config.php', 'db_name', 'db_user', 'db_pass', 'config', 'mail', 'voice']
      for (const n of names) {
        const s = st(join(dir, n))
        if (!s) { items.push(`${n}: absent`); continue }
        items.push(`${n}: ${s.isDirectory() ? 'dir' : 'file'} ${oct(s.mode)} ${own(s)}`)
        if (s.mode & 0o002) bad.push(`${n} is world-writable (${oct(s.mode)})`)
        else if (s.mode & 0o004) bad.push(`${n} is world-readable (${oct(s.mode)})`)
      }
      for (const n of ['config']) {
        const sub = ls(join(dir, n)) ?? []
        for (const f of sub) { const s = st(join(dir, n, f)); if (s && (s.mode & 0o044) && !s.isDirectory()) bad.push(`${n}/${f} is readable by group/other (${oct(s.mode)})`) }
      }
      add('host.private_config', bad.length ? FAIL : PASS, 'Configuration and secret files are not readable by others', bad.length ? `${bad.length} file(s) too open` : 'database secrets and gateway configs are closed to other users', [...items, ...bad.map((b) => `PROBLEM ${b}`)], 'api-config.php 0440, db_* 0600, config/ 0700, mail/ 0550 (modes only; nothing is read)')
    }
  }
  // H8 — assistant voice cache (spoken replies)
  {
    const dir = R(`${OPTS.sporta}/private/voice/tts-cache`)
    const s = st(dir)
    if (!s) add('host.tts_cache', UNK, 'The assistant voice cache is pruned and private', `${dir} is not present or not readable`, [], 'oldest file under 100 days, folder not world-readable')
    else {
      let n = 0, oldest = 0, world = 0
      walk(dir, 2, (p, name, e) => { if (e.isFile()) { n++; oldest = Math.max(oldest, ageH(e) / 24); if (e.mode & 0o004) world++ } })
      const bad = []
      if (oldest > OPTS.ttsMaxDays) bad.push(`oldest cached reply is ${Math.round(oldest)} days old (the monthly prune keeps 90)`)
      if (s.mode & 0o004 || world) bad.push(`world-readable: folder ${oct(s.mode)}, ${world} file(s)`)
      add('host.tts_cache', bad.length ? FAIL : PASS, 'The assistant voice cache is pruned and private', bad.length ? bad.join('; ') : `${n} cached file(s), oldest ${Math.round(oldest)} days, folder ${oct(s.mode)}`, bad, 'oldest under 100 days (cron-voice.php prune monthly), folder 0700/0750')
    }
  }
  // H9 — compose files, as declared
  {
    const dir = R('docker')
    if (!st(dir)) add('host.compose_declared', UNK, 'Compose files declare no published database port or socket mount', `${dir} is not readable`, [], 'no "3306:3306", no docker.sock for web or db, no literal root password')
    else {
      const bad = []; let files = 0
      walk(dir, 3, (p, n, e) => {
        if (!e.isFile() || !/^(docker-compose|compose)(\.[\w-]+)*\.ya?ml$/i.test(n) || e.size > 400000) return
        files++
        const t = rd(p) ?? ''
        t.split('\n').forEach((line, i) => {
          const rel = `${p.slice(dir.length + 1)}:${i + 1}`
          if (/^\s*-\s*["']?(\d{1,3}(\.\d{1,3}){3}:)?\d{2,5}:(3306|33060)(\/tcp)?["']?\s*$/.test(line) && !/["']?127\./.test(line.replace(/^\s*-\s*/, ''))) bad.push(`${rel} publishes a database port`)
          if (/docker\.sock/.test(line)) bad.push(`${rel} mounts docker.sock`)
          if (/^\s*privileged:\s*true/.test(line)) bad.push(`${rel} privileged: true`)
          if (/^\s*(MARIADB|MYSQL)_(ROOT_)?PASSWORD\s*[:=]\s*["']?[^\s"'$][^\s"']*/.test(line.replace(/^\s*-\s*/, ''))) bad.push(`${rel} sets a database password literally (value not shown)`)
        })
      })
      add('host.compose_declared', bad.length ? FAIL : PASS, 'Compose files declare no published database port or socket mount', bad.length ? `${bad.length} line(s) in ${files} compose file(s)` : `${files} compose file(s) read, nothing wrong declared`, bad, 'no "3306:3306", no docker.sock on the shop or database service, no literal password')
    }
  }
  // H10 — the firewall is not visible from a container
  add('host.firewall', UNK, 'The firewall closes 3306 to the internet', "the project's firewall is Hostinger's (group \"KVM4 Restricted Web Firewall\"), outside the machine: read its rules with the Hostinger API (vps firewall tools) and confirm no rule allows 3306; host.port_reachable above is the practical test", [], 'only 80, 443 and SSH from one owner address are allowed in')
}

await run()
const fails = results.filter((r) => r.status === FAIL).length, unknowns = results.filter((r) => r.status === UNK).length
if (OPTS.json) console.log(JSON.stringify({ tool: 'host-audit', results, summary: { pass: results.length - fails - unknowns, fail: fails, unknown: unknowns } }, null, 2))
else {
  console.log('host-audit — READ ONLY (bind mounts :ro; no docker socket; names, modes, owners, ports and counts only)')
  for (const r of results) {
    console.log(`  ${r.status === PASS ? 'PASS  ' : r.status === FAIL ? 'FAIL  ' : 'UNKNWN'} ${r.id}  ${r.detail}`)
    for (const i of r.items.slice(0, 14)) console.log(`           - ${i}`)
    if (r.status !== PASS && r.expected) console.log(`           expected: ${r.expected}`)
  }
  console.log(`\nHOST_AUDIT_DONE fail=${fails} unknown=${unknowns} pass=${results.length - fails - unknowns}`)
}
process.exit(fails ? 1 : 0)
