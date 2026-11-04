#!/usr/bin/env node
// Writes the two one-shot job definitions for the Hostinger API (project
// compose JSON, the same shape the project's other read-only scan jobs use):
//
//   ops/db/db-audit.compose.json     runs scripts/db-security-audit.mjs against the live
//                                    database from the database network
//   ops/db/host-audit.compose.json   runs ops/db/host-audit.mjs on the host (read-only mounts)
//
//   node ops/db/make-audit-jobs.mjs           write both files
//   node ops/db/make-audit-jobs.mjs --check   exit 1 if a committed file no longer matches its script
//   node ops/db/make-audit-jobs.mjs --fetch <sha>   print a SMALL db-audit job that downloads the script from
//                                    the public repo at a pushed commit (use it only if the API refuses the
//                                    ~47 KB embedded file; the commit must be pushed first)
//
// WHY THE SCRIPT TRAVELS AS DATA. The Hostinger API refuses a compose file that
// contains `curl`, `wget` or `require('fs')`, and compose interpolates a dollar
// sign. So the script is gzipped, base64-encoded (an alphabet with neither) and
// carried in an environment variable that the job decodes with printenv,
// base64 and gunzip. Nothing is downloaded and nothing is typed by hand: the
// generator is the only way these files are made, and test:db-audit decodes them
// and compares them with the scripts byte for byte.
//
// NOTHING HERE RUNS ANYTHING. These are files. A person starts a job through the
// Hostinger API (docs: ops/db/HOST-CHECKLIST.md), reads its log, and deletes it.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')
const CHECK = process.argv.includes('--check')
const FETCH = process.argv.includes('--fetch') ? process.argv[process.argv.indexOf('--fetch') + 1] : null

export const JOBS = [
  {
    file: 'db-audit.compose.json',
    script: join(WEB, 'scripts', 'db-security-audit.mjs'),
    build: (src) => ({
      services: {
        dbaudit: {
          image: 'node:24-alpine',
          restart: 'no',
          environment: { SRC: src },
          // The store's own config and the three secret files it reads: the web account's credentials,
          // exactly as the project's earlier read-only database jobs mount them. For the FULL verdict
          // (account tables, other connections, triggers) run it again with an auditor account instead
          // (HOST-CHECKLIST.md, "Full-visibility audit account").
          volumes: [
            '/docker/sporta/private/api-config.php:/run/sporta-api-config.php:ro',
            '/docker/sporta/private/db_name:/run/secrets/sporta_db_name:ro',
            '/docker/sporta/private/db_user:/run/secrets/sporta_db_user:ro',
            '/docker/sporta/private/db_pass:/run/secrets/sporta_db_pass:ro',
          ],
          networks: ['sporta-db_default'],
          entrypoint: ['/bin/sh', '-c'],
          command: ['printenv SRC | base64 -d | gunzip > /tmp/a.mjs && node /tmp/a.mjs --config /run/sporta-api-config.php --order-retention-days 1825'],
        },
      },
      networks: { 'sporta-db_default': { external: true } },
    }),
  },
  {
    file: 'host-audit.compose.json',
    script: join(HERE, 'host-audit.mjs'),
    build: (src) => ({
      services: {
        hostaudit: {
          image: 'node:24-alpine',
          restart: 'no',
          // The host's network namespace, so /proc/net/tcp and a connect to the host's own addresses show what
          // the world would see. pid: host lets the job read the database server's user id from /proc; delete
          // that line if the API refuses it (the fact becomes UNKNOWN, nothing else changes).
          network_mode: 'host',
          pid: 'host',
          environment: { SRC: src },
          // Read-only, three trees only: no root of the host, no Docker socket, no /etc.
          volumes: [
            '/docker:/h/docker:ro',
            '/var/lib/docker/containers:/h/containers:ro',
            '/var/lib/docker/volumes:/h/volumes:ro',
          ],
          entrypoint: ['/bin/sh', '-c'],
          command: ['printenv SRC | base64 -d | gunzip > /tmp/h.mjs && node /tmp/h.mjs --root /h --probe'],
        },
      },
    }),
  },
]

export const encode = (text) => gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64')
export function render(job) {
  return JSON.stringify(job.build(encode(readFileSync(job.script, 'utf8'))), null, 2) + '\n'
}

// The same job with the script fetched instead of embedded. No curl or wget: Node's own fetch.
export function fetchJob(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(String(sha))) throw new Error('--fetch needs a pushed commit id (7 to 40 hex characters)')
  const job = JOBS[0].build('')
  const svc = job.services.dbaudit
  delete svc.environment
  const url = `https://raw.githubusercontent.com/hkspower/wain/${sha}/sporta-web/scripts/db-security-audit.mjs`
  svc.command = [`node --input-type=module -e "const t = await (await fetch('${url}')).text(); (await import('node:fs')).writeFileSync('/tmp/a.mjs', t)" && node /tmp/a.mjs --config /run/sporta-api-config.php --order-retention-days 1825`]
  return JSON.stringify(job, null, 2) + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (FETCH !== null) { process.stdout.write(fetchJob(FETCH)); process.exit(0) }
  let bad = 0
  for (const j of JOBS) {
    const out = join(HERE, j.file)
    if (CHECK) {
      let have = null
      try { have = JSON.parse(readFileSync(out, 'utf8')) } catch { /* missing or broken */ }
      const want = JSON.parse(render(j))
      const svc = Object.values(have?.services ?? {})[0]
      const wsvc = Object.values(want.services)[0]
      // Compare the decoded script, not the compressed bytes, so a different zlib build does not matter.
      const decoded = svc?.environment?.SRC ? Buffer.from(svc.environment.SRC, 'base64') : null
      let text = null
      try { text = decoded ? gunzipSync(decoded).toString('utf8') : null } catch { /* not gzip */ }
      const same = text === readFileSync(j.script, 'utf8') && JSON.stringify({ ...svc, environment: {} }) === JSON.stringify({ ...wsvc, environment: {} })
      console.log(`${same ? 'ok  ' : 'STALE'} ${j.file}`)
      if (!same) bad++
    } else {
      writeFileSync(out, render(j))
      console.log(`wrote ${j.file} (${render(j).length} bytes)`)
    }
  }
  process.exit(bad ? 1 : 0)
}
