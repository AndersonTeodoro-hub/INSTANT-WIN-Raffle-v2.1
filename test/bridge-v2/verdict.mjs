/**
 * The exit code of the Bridge V2 suite. SPEC-BLOCO-03 Adenda F12.
 *
 * The suite fails — exits with a code other than zero — when any test fails that
 * is not one of the declared baseline failures. Those are the three that fail on
 * main as well (A16), named by suite and title exactly, so a new failure that
 * happens to carry one of their tags, or their title in another suite, still
 * fails the run. A baseline test that starts passing does not fail it.
 *
 * The general rehearsal (section 17, point 7) depends on this to fail on its own.
 */

export const BASELINE_FAILURES = [
  { suite: 'sql', name: '0010 runs as its caller and resolves citext through both schemas' },
  { suite: 'source', name: 'the code hash is bound to the campaign as well as the address' },
  { suite: 'processor', name: 'the prize queue is served before the notices, never after' },
];

const isBaseline = (entry) => BASELINE_FAILURES.some((known) => known.suite === entry.suite && known.name === entry.name);

/** The failures that are not the baseline's, and the exit code they make. */
export function verdict(results) {
  const unexpected = results.filter((entry) => !entry.ok && !isBaseline(entry));
  const baseline = results.filter((entry) => !entry.ok && isBaseline(entry));
  return { unexpected, baseline, exitCode: unexpected.length > 0 ? 1 : 0 };
}

/**
 * Ends the process with `code`, explicitly. process.exitCode is not enough here:
 * embedded-postgres registers async-exit-hook, which answers 'beforeExit' with
 * process.exit(0) and so replaced whatever the suite had set — every run ended
 * with 0, failures or not.
 */
export function exitWith(code) {
  process.exit(code);
}
