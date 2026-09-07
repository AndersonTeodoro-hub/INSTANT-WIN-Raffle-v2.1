/**
 * The Bridge V2 suite entry point.
 *
 *   npm run test:bridge-v2
 *
 * The environment and the outbound-HTTP double are installed before any suite is
 * imported, because config.ts runs its invariants at import time and several
 * modules read the environment at the moment of use.
 *
 * The last thing printed is the requirement map: every identifier in
 * SPEC-BRIDGE-V2 against the tests that exercise it, and the ones with none.
 * It is produced from the declarations on the tests themselves, so it cannot
 * drift away from what actually ran.
 */

import { installEnv, installFetchDouble, restoreFetch, results } from './harness.mjs';
import { stopEngine } from './pg.mjs';

installEnv();
installFetchDouble();

const SUITES = [
  './suites/pure.test.mjs',
  './suites/sql.test.mjs',
  // The same three migrations, applied to a real PostgreSQL cluster and called.
  // sql.test.mjs decides what the text of a migration can decide; this one
  // decides what only an engine can: concurrency, RLS and the privileges.
  './suites/engine.test.mjs',
  './suites/source.test.mjs',
  './suites/routes.test.mjs',
  './suites/processor.test.mjs',
  './suites/contracts.test.mjs',
];

/**
 * Every requirement identifier the specification defines, plus the two owner
 * decisions of 06/09/2026. A requirement absent from this list cannot be
 * reported as uncovered, so the list is the specification's own index.
 */
const REQUIREMENTS = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7',
  'E1', 'E2', 'E3', 'E4', 'E5',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7',
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8',
  'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10',
  'J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7',
  'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'K8',
  'R1', 'R2', 'R3', 'R4', 'R5',
  'OWNER-D1', 'OWNER-D2',
];

for (const path of SUITES) {
  try {
    await import(path);
  } catch (error) {
    results.push({
      suite: path,
      requirements: [],
      name: `${path} failed to load`,
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
}

restoreFetch();
// The cluster is a child process with open connections; without this the run
// finishes its output and then hangs on an event loop that never empties.
await stopEngine();

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
let lastSuite = null;

for (const entry of results) {
  if (entry.suite !== lastSuite) {
    console.log(`\n=== ${entry.suite} ===`);
    lastSuite = entry.suite;
  }
  const tags = entry.requirements.length > 0 ? `[${entry.requirements.join(' ')}] ` : '';
  if (entry.ok) {
    passed += 1;
    console.log(`PASS  ${tags}${entry.name}`);
  } else {
    failed += 1;
    console.log(`FALHA ${tags}${entry.name}`);
    for (const line of String(entry.error).split('\n').slice(0, 6)) {
      console.log(`      ${line}`);
    }
  }
}

console.log('\n=== requirement map ===');
const uncovered = [];
for (const requirement of REQUIREMENTS) {
  const covering = results.filter((entry) => entry.requirements.includes(requirement));
  if (covering.length === 0) {
    uncovered.push(requirement);
    console.log(`${requirement.padEnd(9)} NENHUM TESTE`);
    continue;
  }
  const failures = covering.filter((entry) => !entry.ok).length;
  const mark = failures === 0 ? 'ok' : `FALHA(${failures})`;
  console.log(`${requirement.padEnd(9)} ${String(covering.length).padStart(3)} testes  ${mark}`);
}

const declared = new Set(results.flatMap((entry) => entry.requirements));
const unknown = [...declared].filter((requirement) => !REQUIREMENTS.includes(requirement));

console.log('\n=== resumo ===');
console.log(`testes:     ${passed + failed}  (passaram ${passed}, falharam ${failed})`);
console.log(`requisitos: ${REQUIREMENTS.length}  (sem teste: ${uncovered.length})`);
if (uncovered.length > 0) console.log(`sem teste:  ${uncovered.join(', ')}`);
if (unknown.length > 0) console.log(`identificadores desconhecidos: ${unknown.join(', ')}`);

process.exitCode = failed > 0 ? 1 : 0;
