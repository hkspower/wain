// Source-level guard for comments that were wrong, found in the round-three
// and round-four reviews. Each check names the sentence that was false, or the
// claim a comment makes about the code, and the corrected one. A comment is not
// run, so these read the text on purpose: they fail if the false claim comes
// back, and they fail if the claim the code depends on is removed. They prove
// nothing about behaviour; the browser suites do that. Run by `npm run scan`.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCheck } from './harness/check.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const { ok, fails, counts } = makeCheck();

// The launcher's preload: what starts the fetch, and what arms the call.
const button = read('src/components/ShouqCallButton.tsx');
ok(
  'the preload comment does not say touchstart starts the fetch',
  !/`touchstart` lands/.test(button) && !/Both start a fetch/.test(button),
  'the preload is pointerenter and focus (warmCall); pointerdown and touchstart arm the call (armCall)'
);
ok(
  'the comment says pointerdown and touchstart arm the call, by name',
  /`pointerdown` and `touchstart` arm\s*\n\s*\*\s*the call \(armCall\)/.test(button),
  'the sentence the code depends on: the arm handlers are pointerdown and touchstart'
);
ok(
  'the comment says pointerenter and focus start the fetch, and the code wires exactly those',
  /`pointerenter` and `focus` start the chunk's fetch/.test(button) &&
    /onPointerEnter=\{preload\}/.test(button) &&
    /onFocus=\{preload\}/.test(button),
  'a comment that names handlers the element does not have is the same defect as a wrong number'
);
ok(
  'the arm handlers are wired to arm, not to the preload',
  /onPointerDown=\{arm\}/.test(button) && /onTouchStart=\{arm\}/.test(button)
);
ok(
  'the warm-up comment does not say the session is on a third origin',
  !/the session is on a third origin/.test(button)
);

// The React.lazy history: a date the history does not support was written here.
const wainAi = read('src/components/WainAi.tsx');
ok(
  'the boundary comment does not date the React.lazy removal to 10 November',
  !/removed\s*\n?\s*\*\s*on 10 November/.test(wainAi),
  'the removal is commit e7b43310 (11 November); the 10 November date was the repair that added it'
);
ok(
  'the boundary comment names the commit that removed React.lazy',
  /removed\s*\n?\s*\*\s*in e7b43310\)/.test(wainAi)
);

// The widget host move is cited by its commit, not a date.
const htaccessAudit = read('scripts/audit-htaccess.mjs');
ok(
  'the audit cites the commit that moved the widget host, not a date',
  !/11 November/.test(htaccessAudit) && /b3795c82/.test(htaccessAudit),
  'the US host move is commit b3795c82; the date was wrong for the record'
);

console.log(`\n${counts.pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
