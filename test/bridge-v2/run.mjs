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
import { BASELINE_FAILURES, exitWith, verdict } from './verdict.mjs';

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
  // §17: campaign identity — the pure checks, the two routes, the preview route
  // and the emails. Its migration is exercised in sql.test.mjs and engine.test.mjs.
  './suites/identity.test.mjs',
  // §18: the campaign lifecycle the keeper drives, with the chain doubled.
  './suites/lifecycle.test.mjs',
  './suites/contracts.test.mjs',
  // SPEC-BLOCO-03 piece 1: Keptra accounts — the pure half, the routes, the
  // pipeline, the recovery pass and migration 0012, with the chain doubled. The
  // on-chain half runs in ./fork, below.
  './suites/keptra.test.mjs',
  // SPEC-BLOCO-03 piece 5: the orders — addresses, the tracking provider, the
  // oracle's list, the relay's order actions, the orders pass, the notices, the
  // evidence, and migration 0013, with the chain doubled. On-chain: ./fork.
  './suites/orders.test.mjs',
  // SPEC-BLOCO-03 piece 6: the frontend's client modules against the real routes,
  // the bridge's additions of Adenda T, and migration 0014 (T8: no browser).
  './suites/frontend.test.mjs',
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
  'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10',
  'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8',
  'OWNER-D1', 'OWNER-D2',
  // SPEC-BLOCO-03 piece 1: M1-M46 of MATRIZ-PECA1-KEPTRA, as KMn so they do not
  // collide with SPEC-BRIDGE-V2 §18's M1-M8 above.
  ...Array.from({ length: 46 }, (_unused, index) => `KM${index + 1}`),
  // SPEC-BLOCO-03 Adenda C, as ACn (C1-C9 are SPEC-BRIDGE-V2's). C8 is accepted
  // as a limit and C12 belongs to piece 6, so neither is listed.
  'AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7', 'AC9', 'AC10', 'AC11', 'AC13', 'AC14',
  // SPEC-BLOCO-03 Adenda D, as ADn. D2, D5, D7 and D8 ask for no code.
  'AD1', 'AD3', 'AD4', 'AD6',
  // SPEC-BLOCO-03 Adenda E, as AEn. E6 and E12 ask for no code; E8 is a comment.
  'AE1', 'AE2', 'AE3', 'AE4', 'AE5', 'AE7', 'AE9', 'AE10', 'AE11',
  // SPEC-BLOCO-03 Adenda F, as AFn. F9 is comments and F11 asks for no code.
  'AF1', 'AF2', 'AF3', 'AF4', 'AF5', 'AF6', 'AF7', 'AF8', 'AF10', 'AF12',
  // SPEC-BLOCO-03 piece 5: the rows of its matrix, Qn. Q22-Q25 (the ramp) left
  // the build with Adenda P8-P10.
  ...Array.from({ length: 21 }, (_unused, index) => `Q${index + 1}`),
  'Q26', 'Q27', 'Q28', 'Q29', 'Q30', 'Q31', 'Q32',
  // SPEC-BLOCO-03 Adenda P, as APn. P6 is the owner's test, P8-P10 took the ramp
  // out, P23 is the owner's DNS, P25 and P26 go to the lot before the deploy.
  'AP1', 'AP2', 'AP3', 'AP4', 'AP5', 'AP7', 'AP11', 'AP12', 'AP13', 'AP14', 'AP15', 'AP16', 'AP17', 'AP18', 'AP19', 'AP20', 'AP21', 'AP22', 'AP24',
  // SPEC-BLOCO-03 Adenda Q, as AQn (Qn is taken by the matrix rows). Q6 and Q7 are
  // the owner's steps before the deploy.
  'AQ1', 'AQ2', 'AQ3', 'AQ4', 'AQ5',
  // SPEC-BLOCO-03 Adenda R, as ARn. R5 and R6 ask for no code in this correction.
  'AR1', 'AR2', 'AR3', 'AR4',
  // SPEC-BLOCO-03 piece 6: the rows of its matrix, Un. T12 took U10, U11, U13 and
  // U18 out of this build, and P8-P10 took U38 (the ramp).
  ...Array.from({ length: 37 }, (_unused, index) => `U${index + 1}`).filter((tag) => !['U10', 'U11', 'U13', 'U18'].includes(tag)),
  // SPEC-BLOCO-03 Adenda T, as ATn. T1 is the owner's registration, T10 and T11
  // are the terminal (docs/keptra), T12 is what left, T19 and T20 are accepted rules.
  'AT0', 'AT2', 'AT3', 'AT4', 'AT5', 'AT6', 'AT7', 'AT8', 'AT9', 'AT10', 'AT11', 'AT12', 'AT13', 'AT14', 'AT15', 'AT17', 'AT18', 'AT19', 'AT21',
  // SPEC-BLOCO-03 Adenda U, as AUn (Un is taken by the matrix rows). U7 is the owner's steps before the deploy.
  'AU1', 'AU2', 'AU3', 'AU4', 'AU5', 'AU6',
  // SPEC-BLOCO-03 Adenda V, as AVn. V7 lists what goes to the lot before the deploy.
  'AV1', 'AV2', 'AV3', 'AV4', 'AV5', 'AV6',
  // SPEC-BLOCO-03 Adenda AA4: the lot of the bridge and the frontend before the
  // deploy. The pendentes keep their own names; the decisions they come from are
  // AA-prefixed where the bare name is taken (Q7, B8 and T18 already are).
  'AA-T18', 'AA-Q7', 'AA-B8', 'AA-Y5', 'AA-X8', 'P23-15',
  ...Array.from({ length: 11 }, (_unused, index) => `P1-${index + 1}`),
  'D-B5', 'D-FUNDING',
  ...Array.from({ length: 14 }, (_unused, index) => `P5-${index + 1}`),
  ...Array.from({ length: 21 }, (_unused, index) => `P6-${index + 1}`),
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

// SPEC-BLOCO-03: the on-chain suite, in a process of its own because it needs
// the real chain modules and this process has them doubled (loader.mjs). It
// starts anvil from ANVIL_BIN on a local fork of Arbitrum One and prints its
// results as one JSON line, merged here so the requirement map is one map.
{
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './test/bridge-v2/fork/register.mjs', 'test/bridge-v2/fork/run.mjs'],
    { cwd: new URL('../../', import.meta.url), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60 * 1000 },
  );
  const marker = '::keptra-fork-results::';
  const line = (child.stdout ?? '').split('\n').find((text) => text.startsWith(marker));
  if (line === undefined) {
    results.push({
      suite: 'fork',
      requirements: [],
      name: 'the on-chain suite ran and reported',
      ok: false,
      error: `no results from the fork process (exit ${child.status}): ${String(child.stderr ?? '').slice(-2000)}`,
    });
  } else {
    results.push(...JSON.parse(line.slice(marker.length)));
  }
}

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

// SPEC-BLOCO-03 Adenda F12: non-zero when any test fails that is not a declared
// baseline failure, and only then.
const outcome = verdict(results);
console.log(`falhas de base: ${outcome.baseline.length} de ${BASELINE_FAILURES.length} declaradas`);
console.log(`falhas novas:   ${outcome.unexpected.length}`);
console.log(`código de saída: ${outcome.exitCode}`);
exitWith(outcome.exitCode);
