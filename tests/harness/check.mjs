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
