/**
 * The tally a test file prints at its end, once, for every file in tests/.
 * One definition of how a check is counted and how a failure is shown, so a
 * change to the report is one change and not thirty-odd copies of it.
 *
 *   const { ok, fails, counts } = makeCheck();
 *   ok('the thing holds', condition, 'the detail shown under a failure');
 *   console.log(`\n${counts.pass} passed, ${fails.length} failed`);
 *
 * `counts` is an object, not a bare number, because `ok` closes over it: the
 * summary reads the same tally the checks wrote. The runners read the exit
 * code, not this text, so a file still ends the way it always did.
 */
export function makeCheck() {
  const counts = { pass: 0 };
  const fails = [];
  const ok = (n, c, d = '') => {
    if (c) {
      counts.pass++;
      console.log(`  ✓ ${n}`);
    } else {
      fails.push(n);
      console.log(`  ✗ ${n}${d ? '\n      ' + d : ''}`);
    }
  };
  return { ok, fails, counts };
}

/**
 * One named part of a browser suite, so a step that throws is a red in that
 * part and the parts after it still run.
 *
 *   const section = makeSection(ok);
 *   await section('the call connects', async () => { … });
 *
 * A suite is one file of top-level awaits, and a wait or a locator read that
 * times out throws: one throw ended the process, and every section after it
 * never ran. The run was still red, but it said one thing and hid the rest —
 * met while proving a check could fail on 3 October, 23 September and three
 * more times after (CLAUDE.md), each time as «two reds, a crash, and thirty
 * assertions that never ran». A throw here is recorded as a failed check named
 * after its section, so the exit code is red either way and the report is
 * whole.
 *
 * Hard waits inside a section stay hard on purpose. Softening the wait itself
 * lets the `ok` after it pass on a page where the thing never happened.
 */
export function makeSection(ok) {
  return async function section(name, fn) {
    console.log(`\n── ${name} ──`);
    try {
      await fn();
    } catch (e) {
      ok(`${name}: ran to the end`, false, String(e?.message ?? e).split('\n')[0]);
    }
  };
}
