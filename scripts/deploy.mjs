#!/usr/bin/env node
// Deploy the static web export (dist/) to Hostinger over FTP(S).
//
// Usage:
//   HOSTINGER_FTP_HOST=... HOSTINGER_FTP_USER=... HOSTINGER_FTP_PASSWORD=... \
//   HOSTINGER_FTP_REMOTE_DIR='/domains/sporta.com.kw/public_html' \
//   npm run deploy -- [--force] [--verify=hash] [--dry-run]
//
// Flags:
//   --force         Upload every file, ignoring the remote manifest / hashes.
//   --verify=hash   After uploading a file, download it back and compare the
//                   sha256 to guarantee the transfer was byte-for-byte.
//   --dry-run       Show what would change without touching the server.
//
// Env:
//   HOSTINGER_FTP_HOST        (required) e.g. ftp.sporta.com.kw
//   HOSTINGER_FTP_USER        (required)
//   HOSTINGER_FTP_PASSWORD    (required)
//   HOSTINGER_FTP_REMOTE_DIR  (required) target dir on the server
//   HOSTINGER_FTP_PORT        (optional) default 21
//   HOSTINGER_FTP_SECURE      (optional) 'true' (default, explicit FTPS) | 'false'

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ftp from 'basic-ftp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const MANIFEST_NAME = '.deploy-manifest.json';

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(`--${name}`);
const flagValue = (name) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
};

const FORCE = hasFlag('force');
const DRY_RUN = hasFlag('dry-run');
const VERIFY_HASH = flagValue('verify') === 'hash' || hasFlag('verify-hash');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`✖ Missing required env var: ${name}`);
    return null;
  }
  return value;
}

async function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Recursively collect files under `dir`, returning POSIX-style relative paths. */
async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(abs, base)));
    } else if (entry.isFile()) {
      const rel = path.relative(base, abs).split(path.sep).join('/');
      files.push({ rel, abs });
    }
  }
  return files;
}

async function buildLocalManifest() {
  const files = await walk(DIST_DIR);
  const manifest = {};
  for (const f of files) {
    if (f.rel === MANIFEST_NAME) continue;
    manifest[f.rel] = await sha256(f.abs);
  }
  return manifest;
}

async function downloadRemoteManifest(client, tmp) {
  try {
    const local = path.join(tmp, 'remote-manifest.json');
    await client.downloadTo(local, MANIFEST_NAME);
    return JSON.parse(await readFile(local, 'utf8'));
  } catch {
    return {}; // No manifest yet (first deploy) or unreadable.
  }
}

async function ensureRemoteDirFor(client, remoteDir, relPath) {
  const dir = path.posix.dirname(relPath);
  if (dir === '.' || dir === '') {
    await client.cd(remoteDir);
    return;
  }
  await client.ensureDir(path.posix.join(remoteDir, dir));
  // ensureDir leaves the CWD inside the created dir; reset to root each time.
  await client.cd(remoteDir);
}

async function main() {
  const host = requireEnv('HOSTINGER_FTP_HOST');
  const user = requireEnv('HOSTINGER_FTP_USER');
  const password = requireEnv('HOSTINGER_FTP_PASSWORD');
  const remoteDir = requireEnv('HOSTINGER_FTP_REMOTE_DIR');
  if (!host || !user || !password || !remoteDir) {
    console.error(
      '\nSet the FTP credentials before deploying. Required:\n' +
        '  HOSTINGER_FTP_HOST, HOSTINGER_FTP_USER, HOSTINGER_FTP_PASSWORD, HOSTINGER_FTP_REMOTE_DIR',
    );
    process.exit(1);
  }

  const port = Number(process.env.HOSTINGER_FTP_PORT || 21);
  const secure = (process.env.HOSTINGER_FTP_SECURE || 'true').toLowerCase() !== 'false';

  // Fail early if the build output is missing.
  try {
    const s = await stat(DIST_DIR);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`✖ Build output not found at ${DIST_DIR}. Run "expo export --platform web" first.`);
    process.exit(1);
  }

  console.log(`• Hashing local build…`);
  const localManifest = await buildLocalManifest();
  const localFiles = Object.keys(localManifest);
  console.log(`  ${localFiles.length} files in dist/`);
  console.log(
    `• Target: ${secure ? 'ftps' : 'ftp'}://${host}:${port}${remoteDir}` +
      `${FORCE ? '  [--force]' : ''}${VERIFY_HASH ? '  [--verify=hash]' : ''}${DRY_RUN ? '  [--dry-run]' : ''}`,
  );

  const tmp = await mkdtemp(path.join(tmpdir(), 'wain-deploy-'));
  const client = new ftp.Client(30_000);
  client.ftp.verbose = false;

  let uploaded = 0;
  let skipped = 0;
  let deleted = 0;
  let verified = 0;

  try {
    await client.access({ host, port, user, password, secure });
    await client.ensureDir(remoteDir);
    await client.cd(remoteDir);

    const remoteManifest = FORCE ? {} : await downloadRemoteManifest(client, tmp);

    // Upload new/changed files.
    for (const rel of localFiles) {
      const changed = FORCE || remoteManifest[rel] !== localManifest[rel];
      if (!changed) {
        skipped++;
        continue;
      }
      const absLocal = path.join(DIST_DIR, rel);
      if (DRY_RUN) {
        console.log(`  would upload  ${rel}`);
        uploaded++;
        continue;
      }
      await ensureRemoteDirFor(client, remoteDir, rel);
      await client.uploadFrom(absLocal, path.posix.join(remoteDir, rel));
      uploaded++;

      if (VERIFY_HASH) {
        const check = path.join(tmp, 'verify.bin');
        await client.downloadTo(check, path.posix.join(remoteDir, rel));
        const remoteHash = await sha256(check);
        await rm(check, { force: true });
        if (remoteHash !== localManifest[rel]) {
          throw new Error(`Hash mismatch after upload for ${rel} (expected ${localManifest[rel]}, got ${remoteHash})`);
        }
        verified++;
      }
      console.log(`  uploaded${VERIFY_HASH ? ' ✓' : '  '} ${rel}`);
    }

    // Prune remote files that no longer exist locally (tracked via manifest).
    for (const rel of Object.keys(remoteManifest)) {
      if (localManifest[rel]) continue;
      if (DRY_RUN) {
        console.log(`  would delete  ${rel}`);
        deleted++;
        continue;
      }
      try {
        await client.remove(path.posix.join(remoteDir, rel));
        deleted++;
        console.log(`  deleted   ${rel}`);
      } catch {
        console.warn(`  ! could not delete ${rel}`);
      }
    }

    // Write the updated manifest last, so a failed run never marks files as synced.
    if (!DRY_RUN) {
      const manifestLocal = path.join(tmp, MANIFEST_NAME);
      await writeFile(manifestLocal, JSON.stringify(localManifest, null, 2));
      await client.cd(remoteDir);
      await client.uploadFrom(manifestLocal, path.posix.join(remoteDir, MANIFEST_NAME));
    }

    console.log(
      `\n✓ Deploy ${DRY_RUN ? '(dry run) ' : ''}complete — ` +
        `${uploaded} uploaded, ${skipped} unchanged, ${deleted} removed` +
        `${VERIFY_HASH ? `, ${verified} verified` : ''}.`,
    );
  } finally {
    client.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\n✖ Deploy failed: ${err?.message || err}`);
  process.exit(1);
});
