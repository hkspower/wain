// Source-level guard for three comments that were wrong, found in the round-three
// review (12 November). Each check names the sentence that was false and the
// one that replaced it. A comment is not run, so these read the text on purpose:
// they fail if the false claim comes back, and they fail if the corrected claim
// is removed. They prove nothing about behaviour; the browser suites do that.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCheck } from './harness/check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const { ok, fails, counts } = makeCheck();

const button = read('src/components/ShouqCallButton.tsx');
ok(
  'the preload comment does not say touchstart starts the fetch',
  !/`touchstart` lands/.test(button) && !/Both start a fetch/.test(button),
  'the preload is pointerenter and focus (warmCall); pointerdown and touchstart arm the call (armCall)'
);
ok(
  'the preload comment names pointerenter, focus and armCall',
  /pointerenter/.test(button) && /armCall/.test(button)
);
ok(
  'the warm-up comment does not say the session is on a third origin',
  !/the session is on a third origin/.test(button)
);

const htaccessAudit = read('scripts/audit-htaccess.mjs');
ok(
  'the audit cites the commit that moved the widget host, not a date',
  !/11 November/.test(htaccessAudit) &&
    /b3795c82/.test(htaccessAudit),
  'the US host move is commit b3795c82; the date was wrong for the record'
);

const wainAi = read('src/components/WainAi.tsx');
ok(
  'the lazy-load comment marks the boundary path as the removed React.lazy one',
  !/Caught by the boundary below while\s*\n?\s*\*\s*that navigation was still in flight/.test(wainAi) &&
    /removed\s*\n?\s*\*\s*on 10 November/.test(wainAi),
  'the boundary catches a lazy throw only in the React.lazy version, removed on 10 November'
);

console.log(`\n${counts.pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
