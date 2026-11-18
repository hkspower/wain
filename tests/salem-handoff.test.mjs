#!/usr/bin/env node
/**
 * The handover marker that keeps a free call's question on the device:
 *   node tests/salem-handoff.test.mjs
 *
 * His free call answers a question it heard by pushing `/salem/?q=…&own=1`
 * (WainAiCall, finishWith), and the chat reads `own=1` as «answer this here,
 * do not send it down his agent's socket» (SalemChat, the handover effect). The
 * marker is the only thing that keeps the spoken words off the voice service,
 * and no suite used to notice it being dropped: the browser suites set the
 * parameter by hand. So this checks the builder, and the two places that write
 * and read it.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeCheck } from './harness/check.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ok, fails, counts } = makeCheck();

const tmp = mkdtempSync(join(tmpdir(), 'wain-handoff-'));
const entry = join(tmp, 'entry.ts');
writeFileSync(entry, `export * from ${JSON.stringify(join(ROOT, 'src/lib/wain-ai.ts'))};\n`);
const bundle = join(tmp, 'entry.mjs');
execSync(
  `npx -y esbuild ${JSON.stringify(entry)} --bundle --format=esm --alias:@=${JSON.stringify(join(ROOT, 'src'))} --outfile=${JSON.stringify(bundle)} --log-level=error`,
  { cwd: ROOT, stdio: 'pipe' }
);
const { salemHandoff } = await import(pathToFileURL(bundle).href);
rmSync(tmp, { recursive: true, force: true });

console.log('\n── the builder ──');
{
  const own = salemHandoff('قهوة', undefined, true);
  ok('a question the free call heard is marked own=1', own.includes('own=1') && own.includes('q=%D9%82'), own);
  ok('an unmarked question carries no own mark', !salemHandoff('قهوة').includes('own'), salemHandoff('قهوة'));
  ok('the source tag still goes with it', salemHandoff('قهوة', 'call', true).includes('from=call'));
}

console.log('\n── the writer and the reader ──');
{
  const call = readFileSync(join(ROOT, 'src/components/WainAiCall.tsx'), 'utf8');
  ok('his free call pushes its question marked own (WainAiCall, finishWith)',
    /salemHandoff\(q,\s*undefined,\s*true\)/.test(call),
    'remove the `true` and his spoken question is submitted down his agent\'s socket');
  const chat = readFileSync(join(ROOT, 'src/app/salem/SalemChat.tsx'), 'utf8');
  ok('the chat reads own=1 from the address (SalemChat, the mount read)',
    /params\.get\("own"\)\s*===\s*"1"/.test(chat));
  ok('and removes it from the address with the others', /params\.delete\("own"\)/.test(chat));
}

console.log(`\n${counts.pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
