#!/usr/bin/env node
// EXPECTED-FILES MANIFEST + THE ONE-SHOT LIVE SCAN JOB.
//
// What the live server SHOULD hold, generated from the repo at a commit, and the compose job that
// carries it (with scripts/live-files-scan.mjs) to the VPS. Nothing here touches the server: these
// are files; a person starts the job through the Hostinger API (ops/FILES-SCAN.md) and deletes it.
//
//   node scripts/make-expected-manifest.mjs                  write ops/live-files-scan.compose.json from HEAD
//   node scripts/make-expected-manifest.mjs --sha <rev>      …from that commit (must be an ancestor of what is live)
//   node scripts/make-expected-manifest.mjs --manifest-out F also write the bare manifest JSON to F (add --no-job to write nothing else)
//   node scripts/make-expected-manifest.mjs --check          exit 1 if the committed job no longer matches its script
//                                                            and its recorded commit (the manifest is a pure function of it)
//   node scripts/make-expected-manifest.mjs --fetch <sha>    print the variant whose SCRIPT is downloaded from the public
//                                                            repo at a PUSHED commit (use it only if the API refuses the
//                                                            embedded ~45 kB file); the manifest stays embedded
//
// THE MAPPING (the same three facts the deploy already uses; unknown-files-test.mjs compares them with
// their sources so this file cannot drift from them):
//   sporta-web/public/<p>              -> <p>            vite copies public/ into the web root
//   sporta-web/dropin/php-store/<f>    -> api/<f>        bundle-php.mjs BUNDLES
//   sporta-web/dropin/php-knet/<f>     -> knet/<f>
//   sporta-web/dropin/php-cbk/<f>      -> pay/<f>
//   never shipped: config.php, README.md, .cbk_token.json (bundle-php.mjs SKIP, at any depth)
//   held back by vps-deploy.mjs: cats/ hero/ images/products/ (served from private/media), the setup
//   tools go-live.html knet/selftest.php knet/setup-config.php api/setup-admin.php api/preflight.php
//   (flag 's': found on the server they are a finding, not a known file)
//
// WHAT "EXPECTED" IS. For every shipped path, the git blob id (16 hex) of EVERY version of it ever
// committed in the history reachable from the commit, newest first. A live file whose bytes are any
// of them is "ours" (a deploy of an older or newer commit); bytes that are none of them are a hand
// edit or someone else's file. The root .htaccess also carries the hashes of its versions with the
// build-filled CSP script hashes folded back to the placeholder (the build rewrites it).
//
// Generated, not generable from nothing: assets/ chunks, index.html, sw.js and the sitemaps come from
// a build (or from the foreign build that is live today). The scanner explains those by reference
// from the live index.html and by the documented live-only rules below, not by hash.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import { normHt } from './live-files-scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(HERE, '..')
const REPO = path.join(WEB, '..')
export const JOB_FILE = path.join(WEB, 'ops', 'live-files-scan.compose.json')
export const SCANNER = path.join(HERE, 'live-files-scan.mjs')
const HASH_LEN = 16

// ---- the deploy's own facts, restated (and compared with their sources by the test)
export const BUNDLES = [['php-knet', 'knet'], ['php-cbk', 'pay'], ['php-store', 'api']]
export const SKIP = ['.cbk_token.json', 'README.md', 'config.php']
export const MEDIA = ['cats/', 'hero/', 'images/products/']
export const SETUP_TOOLS = ['api/preflight.php', 'api/setup-admin.php', 'go-live.html', 'knet/selftest.php', 'knet/setup-config.php']

// ---- the documented live-only files. Every rule names the document that says it; add one only when
// the owner decides something, never to make a scan green. Regex sources; evaluated against the path
// relative to the area (site/, private/, backups/, releases/, /sporta top level).
export const LIVE_RULES = [
  // ---------------------------------------------------------------- site/ (the web root)
  { id: 'live-entry', area: 'site', re: '^index\\.html$', verdict: 'KNOWN', doc: 'CLAUDE.md item 4', why: 'the live storefront entry page; the reference walk starts here (a foreign build today)' },
  { id: 'live-config-js', area: 'site', re: '^config\\.js$', maxSize: 8192, verdict: 'KNOWN', doc: 'CLAUDE.md Configuration; vps-deploy.mjs neverTouch', why: 'runtime endpoints, edited in place on the server, never overwritten by a deploy' },
  { id: 'service-worker', area: 'site', re: '^sw\\.js$', maxSize: 400000, verdict: 'KNOWN', doc: 'scripts/sw-precache.mjs', why: 'generated at release time with the precache list (public/sw.js is the template)' },
  { id: 'static-root-text', area: 'site', re: '^(?:robots\\.txt|llms\\.txt|sitemap(?:-pages|-products)?\\.xml|site\\.webmanifest|backends\\.webmanifest)$', maxSize: 400000, verdict: 'KNOWN', doc: 'SERVER-LAYOUT.md; public/', why: 'crawler and manifest files regenerated by npm run seo or served by the live build' },
  { id: 'acme-challenge', area: 'site', re: '^\\.well-known/(?:acme-challenge|pki-validation)/[A-Za-z0-9_.-]{8,200}$', maxSize: 4096, noPhp: true, verdict: 'KNOWN', doc: 'public/.htaccess (.well-known stays reachable)', why: 'certificate-renewal token' },
  { id: 'owner-photo', area: 'site', re: '^(?:cats|hero)/(?:[^/]+/)*[^/]+\\.(?:jpe?g|png|webp|avif|gif)$', flags: 'i', magic: 'image', noPhp: true, verdict: 'KNOWN', doc: 'CLAUDE.md (category photos are files the owner puts on the server by hand)', why: 'a real image in a photo folder' },
  { id: 'font-file', area: 'site', re: '^fonts/[^/]+\\.(?:woff2?|ttf|otf)$', flags: 'i', magic: 'font', verdict: 'KNOWN', doc: 'SERVER-LAYOUT.md', why: 'a real font file in the self-hosted fonts folder' },
  // ---------------------------------------------------------------- private/ (names, modes, owners)
  { id: 'priv-api-config', area: 'private', re: '^api-config\\.php$', maxMode: '0440', uids: [0], verdict: 'KNOWN', doc: 'CLAUDE.md item 5; LIVE-SECURITY-SCAN config', why: 'the store config, mounted at /run/sporta-api-config.php (root:33, 0440)' },
  { id: 'priv-gateway-config', area: 'private', re: '^config/(?:knet|pay)-config\\.php$', maxMode: '0600', uids: [33], verdict: 'KNOWN', doc: 'CLAUDE.md "Where every config lives"', why: 'gateway credentials read through /run/sporta-config (0600, 33:33)' },
  { id: 'priv-db-secret', area: 'private', re: '^(?:db_name|db_user|db_pass)$', maxMode: '0600', uids: [33], verdict: 'KNOWN', doc: 'LIVE-SECURITY-SCAN config', why: 'database secret files mounted read-only' },
  { id: 'priv-mail', area: 'private', re: '^mail/(?:password)?$', maxMode: '0550', verdict: 'KNOWN', doc: 'VPS-SCAN 2026-10-31 (mail password)', why: 'the sending mailbox password file' },
  { id: 'priv-bin', area: 'private', re: '^bin/(?:db-backup|db-restore-test)\\.sh$', maxMode: '0750', verdict: 'KNOWN', doc: 'ops/db/BACKUP.md', why: 'the database backup and restore-test scripts the host cron runs' },
  { id: 'priv-backup-secret', area: 'private', re: '^backup-secrets/db-backup\\.key(?:\\.escrow)?$', maxMode: '0600', verdict: 'KNOWN', doc: 'ops/db/BACKUP.md', why: 'the backup encryption passphrase (and its escrow copy)' },
  { id: 'priv-db-backup', area: 'private', re: '^backups/(?:sporta-db-\\d{8}T\\d{6}Z\\.sql\\.gz\\.enc(?:\\.sha256)?|backup\\.log|last-status|last-success|\\.lock)$', maxMode: '0600', verdict: 'KNOWN', doc: 'ops/db/BACKUP.md', why: 'encrypted database backups and their bookkeeping' },
  { id: 'priv-payment-log', area: 'private', re: '^voice/[\\w.-]+\\.log$', maxMode: '0600', uids: [33], verdict: 'KNOWN', doc: 'CLAUDE.md item 5 (/var/lib/sporta)', why: 'payment logs (knet/pay audit trail) under the voice mount' },
  { id: 'priv-tts-cache', area: 'private', re: '^voice/tts-cache/', uids: [33], verdict: 'KNOWN', doc: 'SPORTA-AI-VOICE.md', why: 'cached text-to-speech audio' },
  { id: 'priv-admin-sessions', area: 'private', re: '^voice/admin-sessions/(?:sess_[A-Za-z0-9,-]{20,128})?$', maxMode: '0600', uids: [33], verdict: 'KNOWN', doc: 'CLAUDE.md "The admin is at /backends"', why: 'admin PHP session files (30-day sign-in)' },
  { id: 'priv-stale-config-copy', area: 'private', re: '^api-config[.-][\\w.-]+\\.php$', verdict: 'UNKNOWN', kind: 'stale-copy', sev: 'medium', doc: 'VPS-SCAN 2026-10-31 (api-config.prev/next/failed deleted)', why: 'an old copy of the store config: old credentials kept around' },
  // ---------------------------------------------------------------- private/media (public by design)
  { id: 'media-image', area: 'media', re: '^media/(?:products|cats|hero)(?:/responsive)?/[^/]+\\.(?:jpe?g|png|webp|avif|gif)$', flags: 'i', magic: 'image', noPhp: true, verdict: 'KNOWN', doc: 'CLAUDE.md "Image upload: ONE route exists"', why: 'a real image in the photo mount' },
  // ---------------------------------------------------------------- backups/
  { id: 'bk-deploy', area: 'backups', re: '^deploy-\\d{8}T\\d{6}Z-[0-9a-f]{7}\\.(?:tar\\.gz|json)$', verdict: 'KNOWN', doc: 'scripts/vps-deploy.mjs', why: 'pre-image of the files one deploy overwrote, and its record' },
  { id: 'bk-session', area: 'backups', re: '^(?:claude|manual|codex)-\\d{8}T\\d{4,6}Z[\\w.-]*/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31; DATA-SCAN-2026-11-02.md', why: 'a hand backup made before a change' },
  { id: 'bk-site-pre', area: 'backups', re: '^site-pre-repo-deploy-\\d{8}T\\d{4,6}Z/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31', why: 'full copy of the site before the first repo deploy' },
  { id: 'bk-old-assets', area: 'backups', re: '^old-assets-[\\w-]+/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'scripts/old-files-inventory.mjs (CLEAN-UP)', why: 'orphan chunks moved out of the web root' },
  { id: 'bk-db-dump', area: 'backups', re: '^sporta-db-\\d{8}T\\d{6}Z\\.sql(?:\\.gz)?$', verdict: 'KNOWN', doc: 'VPS-SCAN 2026-10-31', why: 'an ad-hoc database dump (readable by every host user: chmod 700 the folder)' },
  // ---------------------------------------------------------------- releases/
  { id: 'rel-deploy', area: 'releases', re: '^deploy-\\d{8}T\\d{6}Z-[0-9a-f]{7}\\.json$', verdict: 'KNOWN', doc: 'scripts/vps-deploy.mjs', why: 'the record a successful deploy writes' },
  // ---------------------------------------------------------------- /sporta top level
  { id: 'top-dockerfile', area: 'top', re: '^Dockerfile(?:\\.[\\w.-]+)?$', verdict: 'KNOWN', kind: 'generated-or-scratch', doc: 'VPS-SCAN 2026-10-31', why: 'the apache-sporta image build file (and the xss-stage experiments)' },
  { id: 'top-compose-override', area: 'top', re: '^apache-service\\.override\\.yml(?:\\.[\\w.-]+)?$', verdict: 'KNOWN', doc: 'VPS-SCAN 2026-10-31; LIVE-SECURITY-SCAN config-7', why: 'the compose override the panel never shows (and its hand backups)' },
  { id: 'top-cutover-script', area: 'top', re: '^cutover-[\\w.-]+\\.sh$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31', why: 'a one-time cutover script from the move to the VPS' },
  { id: 'top-htaccess-backup', area: 'top', re: '^(?:api-)?htaccess\\.bak-claude-\\d{8}T\\d{4,6}Z$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31', why: 'a hand backup of an .htaccess before a change' },
  { id: 'top-build-log', area: 'top', re: '^\\.build\\.log$', verdict: 'KNOWN', kind: 'generated-or-scratch', doc: 'VPS-SCAN 2026-10-31', why: 'the image build log' },
  { id: 'copy-site-old', area: 'copy', re: '^site-(?:prev|next|failed)-[\\w.-]+/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31', why: 'an old copy of the web root kept for rollback' },
  { id: 'copy-rollback', area: 'copy', re: '^rollback/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31', why: 'rollback copies from the cutover' },
  { id: 'copy-staging', area: 'copy', re: '^staging/$', verdict: 'KNOWN', kind: 'stale-copy', doc: 'VPS-SCAN 2026-10-31; sporta-live/hero/README.md', why: 'files staged for a hand copy' },
  { id: 'copy-php-ini', area: 'copy', re: '^php/$', verdict: 'KNOWN', doc: 'VPS-SCAN 2026-10-31 (COPY php/92-sporta-errors.ini)', why: 'the PHP settings the image build copies in' },
]

// ---------------------------------------------------------------- git helpers
const git = (args, opts = {}) => execFileSync('git', ['-C', REPO, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })
const SRC_PREFIXES = ['sporta-web/public/', ...BUNDLES.map(([from]) => `sporta-web/dropin/${from}/`)]
export function toLive(src) {
  let live = null
  if (src.startsWith('sporta-web/public/')) live = src.slice('sporta-web/public/'.length)
  else for (const [from, to] of BUNDLES) if (src.startsWith(`sporta-web/dropin/${from}/`)) live = `${to}/${src.slice(`sporta-web/dropin/${from}/`.length)}`
  if (live === null || SKIP.includes(live.split('/').pop())) return null
  return live
}

export function buildManifest(rev = 'HEAD') {
  const sha = git(['rev-parse', '--verify', `${rev}^{commit}`]).trim()
  // the tree at the commit
  const head = new Map()
  const ls = git(['ls-tree', '-r', '-z', sha, '--', 'sporta-web/public', 'sporta-web/dropin'])
  for (const ent of ls.split('\0').filter(Boolean)) {
    const tab = ent.indexOf('\t')
    const [mode, type, blob] = ent.slice(0, tab).split(' ')
    const src = ent.slice(tab + 1)
    const live = toLive(src)
    if (live && type === 'blob' && mode !== '120000') head.set(live, blob)
  }
  // every version ever committed (newest first), from the history reachable from the commit
  const versions = new Map()
  const seenPath = new Set()
  const log = git(['log', sha, '--no-abbrev', '--raw', '--no-renames', '--format=', '--', 'sporta-web/public', 'sporta-web/dropin'])
  for (const line of log.split('\n')) {
    if (!line.startsWith(':')) continue
    const tab = line.indexOf('\t')
    const [, , , newBlob, status] = line.slice(1, tab).split(' ')
    const src = line.slice(tab + 1)
    if (src.startsWith('"')) throw new Error(`a quoted path in the history cannot be mapped: ${src}`)
    const live = toLive(src)
    if (!live) continue
    seenPath.add(live)
    if (status !== 'D' && !/^0+$/.test(newBlob)) {
      const list = versions.get(live) ?? []
      if (!list.includes(newBlob)) list.push(newBlob)
      versions.set(live, list)
    }
  }
  const all = new Set([...head.keys(), ...seenPath])
  const paths = []
  const norm = {}
  for (const live of [...all].sort()) {
    const list = [...(versions.get(live) ?? [])]
    const h = head.get(live)
    if (h) { const i = list.indexOf(h); if (i > 0) list.splice(i, 1); if (i !== 0) list.unshift(h) }
    if (list.length === 0) continue
    let flags = ''
    if (!h) flags += 'g'
    if (SETUP_TOOLS.includes(live)) flags += 's'
    if (MEDIA.some((m) => live.startsWith(m))) flags += 'm'
    if (live === '.htaccess') {
      flags += 'n'
      norm[live] = list.map((id) => createHash('sha256').update(normHt(git(['cat-file', 'blob', id]))).digest('hex').slice(0, HASH_LEN))
    }
    paths.push([live, flags, ...list.map((id) => id.slice(0, HASH_LEN))])
  }
  return { version: 1, repo: 'hkspower/wain', sha, hashLen: HASH_LEN, setup: [...SETUP_TOOLS], media: [...MEDIA], paths, norm, rules: LIVE_RULES }
}
export const manifestJson = (m) => JSON.stringify(m)

// ---------------------------------------------------------------- the job
// The API refuses a compose file containing curl, wget or require( and compose interpolates a dollar
// sign; base64 has neither, but a long random string can spell a word by chance, so the encoder tries
// other compression settings until none appears.
export const FORBIDDEN = ['curl', 'wget', 'require(', '$']
export function encode(text) {
  for (const level of [9, 8, 7, 6, 5]) for (const memLevel of [8, 9, 7]) {
    const b64 = gzipSync(Buffer.from(text, 'utf8'), { level, memLevel }).toString('base64')
    if (!FORBIDDEN.some((w) => b64.toLowerCase().includes(w))) return b64
  }
  throw new Error('no gzip setting avoided a forbidden word in the base64 text')
}
export const decode = (b64) => gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')

export function jobFor({ script, manifest, fetchSha }) {
  const run = 'node /tmp/s.mjs --root /sporta --manifest /tmp/m.json --details /out/details.ndjson'
  const decodeManifest = 'printenv MAN | base64 -d | gunzip > /tmp/m.json'
  let command, environment
  if (fetchSha) {
    if (!/^[0-9a-f]{7,40}$/.test(fetchSha)) throw new Error('--fetch needs a pushed commit id (7 to 40 hex characters)')
    const url = `https://raw.githubusercontent.com/hkspower/wain/${fetchSha}/sporta-web/scripts/live-files-scan.mjs`
    command = `${decodeManifest} && node --input-type=module -e "import { writeFileSync } from 'node:fs'; const r = await fetch('${url}'); if (!r.ok) { console.log('FILES_SCAN_FAIL download ' + r.status); process.exit(1) } writeFileSync('/tmp/s.mjs', await r.text())" && ${run}`
    environment = { MAN: encode(manifest) }
  } else {
    command = `printenv SRC | base64 -d | gunzip > /tmp/s.mjs && ${decodeManifest} && ${run}`
    environment = { SRC: encode(script), MAN: encode(manifest) }
  }
  return {
    services: {
      filesscan: {
        image: 'node:24-alpine',
        restart: 'no',
        // No network at all: the scan opens no connection, so the job is given none. (Delete this line
        // only if the API refuses it; nothing else changes.) --fetch needs the network: it drops this line.
        ...(fetchSha ? {} : { network_mode: 'none' }),
        read_only: true,
        environment,
        // The whole of /docker/sporta, READ-ONLY. Nothing else of the host is mounted: no Docker socket,
        // no /etc, no /var/lib/docker.
        volumes: ['/docker/sporta:/sporta:ro'],
        // The job's own scratch: the details file lives here and dies with the container.
        tmpfs: ['/tmp:size=32m', '/out:size=64m,mode=0700'],
        entrypoint: ['/bin/sh', '-c'],
        command: [command],
      },
    },
  }
}
export const render = (job) => JSON.stringify(job, null, 2) + '\n'

// ---------------------------------------------------------------- CLI
function main() {
  const argv = process.argv.slice(2)
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
  const script = fs.readFileSync(SCANNER, 'utf8')
  if (argv.includes('--check')) {
    let have
    try { have = JSON.parse(fs.readFileSync(JOB_FILE, 'utf8')) } catch { console.log('STALE ops/live-files-scan.compose.json (missing or not JSON)'); process.exit(1) }
    const env = have?.services?.filesscan?.environment ?? {}
    let ok = false, why = ''
    try {
      const m = JSON.parse(decode(env.MAN))
      const want = manifestJson(buildManifest(m.sha))
      const sameManifest = decode(env.MAN) === want
      const sameScript = decode(env.SRC) === script
      const wantJob = jobFor({ script, manifest: want })
      const strip = (j) => JSON.stringify({ ...j.services.filesscan, environment: {} })
      const sameShape = strip(have) === strip(wantJob)
      ok = sameManifest && sameScript && sameShape
      why = `${sameScript ? '' : ' script differs;'}${sameManifest ? '' : ' manifest differs from the recorded commit;'}${sameShape ? '' : ' job shape differs;'}`
    } catch (e) { why = ` unreadable (${e.message})` }
    console.log(`${ok ? 'ok   ' : 'STALE'} ops/live-files-scan.compose.json${why}`)
    process.exit(ok ? 0 : 1)
  }
  const m = buildManifest(arg('--sha') ?? 'HEAD')
  const json = manifestJson(m)
  if (arg('--manifest-out')) fs.writeFileSync(arg('--manifest-out'), json + '\n')
  if (arg('--fetch')) { process.stdout.write(render(jobFor({ script, manifest: json, fetchSha: arg('--fetch') }))); return }
  if (argv.includes('--no-job')) { console.log(`manifest only · commit ${m.sha.slice(0, 8)} · ${m.paths.length} paths · ${m.paths.reduce((n, p) => n + p.length - 2, 0)} versions`); return }
  const out = render(jobFor({ script, manifest: json }))
  fs.mkdirSync(path.dirname(JOB_FILE), { recursive: true })
  fs.writeFileSync(JOB_FILE, out)
  console.log(`wrote ops/live-files-scan.compose.json (${out.length} bytes) · commit ${m.sha.slice(0, 8)} · ${m.paths.length} paths · ${m.paths.reduce((n, p) => n + p.length - 2, 0)} versions · ${m.rules.length} documented live-only rules`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
