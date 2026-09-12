/**
 * The requirements that are properties of the whole surface rather than of one
 * function: no identity by parameter anywhere, no secret in any file, no
 * unbounded external call, no dependency on the key path, no SMS provider.
 *
 * A test that reads source is weaker than a test that runs it, and it is the
 * only shape some of these requirements have: A6 says NO route may take an
 * identity from the client, and running one route says nothing about the other
 * nine. The report marks which requirements got which kind of test.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assert, suite, test } from '../harness.mjs';

suite('source');

const root = fileURLToPath(new URL('../../../', import.meta.url)).replaceAll('\\', '/');

function filesUnder(relative, extension = '.ts') {
  const out = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = `${directory}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(extension)) out.push(path);
    }
  };
  walk(`${root}${relative}`);
  return out;
}

const read = (path) => readFileSync(path, 'utf8');
const shortName = (path) => path.replaceAll('\\', '/').slice(root.length);

const LIB_FILES = filesUnder('lib/bridge-v2');
const ROUTE_FILES = filesUnder('api/bridge/v2');
const ALL_FILES = [...LIB_FILES, ...ROUTE_FILES];

/** Source with block and line comments removed, for checks about code. */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');

/** Every file a person edits in this repository. */
function repositoryFiles() {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.vercel', 'coverage']);
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      if (skip.has(name)) continue;
      const path = `${directory}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|mjs|cjs|json|sql|md|yml|yaml|env|txt)$/.test(name)) out.push(path);
    }
  };
  walk(root.replace(/\/$/, ''));
  return out;
}

// ---------------------------------------------------------------------------
// A1, A6, D1, D4 — no route takes an identity from the client
// ---------------------------------------------------------------------------

/**
 * The only two routes allowed to read an email out of a request body: one sends
 * a code to it and reveals nothing, the other exchanges it plus a code for a
 * session. Everything else learns who is calling from the cookie.
 */
const EMAIL_ROUTES = ['api/bridge/v2/session/request-code.ts', 'api/bridge/v2/session/verify.ts'];

await test(['A6', 'D1'], 'no route outside the two session routes reads an email from a body', () => {
  for (const path of ROUTE_FILES) {
    if (EMAIL_ROUTES.includes(shortName(path))) continue;
    const code = codeOnly(read(path));
    assert.ok(!/body\.email/.test(code), `${shortName(path)} reads body.email`);
    assert.ok(!/parseEmail\(/.test(code), `${shortName(path)} parses an email from input`);
    assert.ok(!/canonicalizeEmail\(/.test(code), `${shortName(path)} canonicalises client input`);
  }
});

await test(['A6'], 'no route takes a participant id or a wallet address from a body', () => {
  for (const path of ROUTE_FILES) {
    const code = codeOnly(read(path));
    assert.ok(!/body\.participantId/.test(code), `${shortName(path)} takes a participant id`);
    assert.ok(!/body\.walletAddress/.test(code), `${shortName(path)} takes a wallet address`);
    assert.ok(!/body\.wallet\b/.test(code), `${shortName(path)} takes a wallet`);
    // prize/destination takes an address, and it is a DESTINATION the winner
    // confirms for their own prize, never the identity of the caller.
    // entry/address takes one too (07/09/2026 decision): the eligibility
    // TARGET a session-verified participant declares for their own entry,
    // never a caller identity read from the body.
    if (/body\.address/.test(code)) {
      assert.ok(
        ['api/bridge/v2/prize/destination.ts', 'api/bridge/v2/entry/address.ts'].includes(shortName(path)),
        `${shortName(path)} takes an address`,
      );
      assert.match(code, /session\.participantId/);
    }
  }
});

await test(['A1', 'D1'], 'every route that returns participant state resolves a session first', () => {
  const stateful = [
    'api/bridge/v2/entry/status.ts',
    'api/bridge/v2/entry/start.ts',
    'api/bridge/v2/prize/destination.ts',
    'api/bridge/v2/privacy/export.ts',
    'api/bridge/v2/privacy/erase.ts',
    'api/bridge/v2/session/revoke.ts',
  ];
  for (const name of stateful) {
    const code = codeOnly(read(`${root}${name}`));
    assert.match(code, /await resolveSession\(request\)/, `${name} does not resolve a session`);
    assert.match(code, /session\.participantId/, `${name} does not scope to the session`);
  }
});

await test(['D1'], 'every read of a participant row is filtered by the session participant', () => {
  // A query naming anything else is the V1's status endpoint returning the
  // wallet address of whatever email was typed (finding #2).
  for (const name of ['api/bridge/v2/entry/status.ts', 'api/bridge/v2/privacy/export.ts']) {
    const code = codeOnly(read(`${root}${name}`));
    for (const [, argument] of code.matchAll(/\.eq\('(?:participant_id|id)',\s*([^)]+)\)/g)) {
      assert.match(argument, /session\.participantId/, `${name} scopes a read by ${argument}`);
    }
  }
});

await test(['D4'], 'no route reads anything personal out of a URL', () => {
  for (const path of ROUTE_FILES) {
    const code = codeOnly(read(path));
    // Query strings reach access logs, browser history and the Referer header.
    assert.ok(!/searchParams/.test(code), `${shortName(path)} reads a query string`);
    assert.ok(!/new URL\(request\.url\)/.test(code), `${shortName(path)} parses its own URL`);
  }
});

await test(['D4'], 'every route that carries data is a POST', () => {
  for (const path of ROUTE_FILES) {
    const code = codeOnly(read(path));
    assert.ok(
      /methodGuard\(request, 'POST'\)/.test(code) || /export async function GET/.test(code),
      `${shortName(path)} implements neither guard`,
    );
    // The two crons answer GET because the scheduler uses it, and they carry no
    // participant data at all: their authorisation is a header.
    if (/export async function GET/.test(code)) {
      assert.ok(shortName(path).includes('/cron/'), `${shortName(path)} answers GET`);
      assert.match(code, /authorization/);
    }
  }
});

// ---------------------------------------------------------------------------
// B1, B2 — every route is rate limited, read routes included
// ---------------------------------------------------------------------------

await test(['B1'], 'every participant-facing route enforces a rate limit', () => {
  for (const path of ROUTE_FILES) {
    const name = shortName(path);
    const code = codeOnly(read(path));
    if (name.includes('/cron/')) {
      // A cron is not participant-facing; its ceiling is the shared secret and
      // the run lock, both asserted in the routes suite.
      assert.match(code, /acquireRunLock|timingSafeEqualHex/, `${name} has no guard at all`);
      continue;
    }
    assert.match(code, /await enforce\(\[/, `${name} enforces no rate limit`);
  }
});

await test(['B1'], 'the read-only routes are limited as well as the writing ones', () => {
  // An unlimited read endpoint is an unlimited enumeration budget.
  for (const name of ['api/bridge/v2/entry/status.ts', 'api/bridge/v2/privacy/export.ts']) {
    assert.match(codeOnly(read(`${root}${name}`)), /await enforce\(\[/, `${name} is unlimited`);
  }
});

await test(['B2'], 'every route carries the global axis as well as its own', () => {
  for (const path of ROUTE_FILES) {
    if (shortName(path).includes('/cron/')) continue;
    assert.match(
      codeOnly(read(path)),
      /axis: 'ROUTE_GLOBAL'/,
      `${shortName(path)} has no global ceiling`,
    );
  }
});

// ---------------------------------------------------------------------------
// F1, F2, F4, F6, F7 — secrets
// ---------------------------------------------------------------------------

await test(['F2'], 'no file in the repository carries anything shaped like a live secret', () => {
  // Rule 0.1 over the whole tree. The shapes are the ones this project's own
  // providers issue, plus the two generic ones.
  // A key VALUE, not a prefix. The suffix of a real Supabase key mixes case and
  // digits; an all-capitals marker with the right prefix is a placeholder, and
  // flagging one is a false positive that teaches the reader to ignore this.
  const patterns = [
    [/\bsb_secret_(?=[A-Za-z0-9_-]{8,})(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)/, 'a Supabase secret key'],
    [/\bsb_publishable_(?=[A-Za-z0-9_-]{8,})(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)/, 'a Supabase publishable key'],
    [/\bre_[A-Za-z0-9]{20,}/, 'a Resend API key'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./, 'a JWT'],
    [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, 'a Telegram bot token'],
    [/(?:^|[^A-Za-z0-9])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/, 'a 32-byte private key'],
  ];
  const offenders = [];
  for (const path of repositoryFiles()) {
    const text = read(path);
    for (const [pattern, what] of patterns) {
      if (pattern.test(text)) offenders.push(`${shortName(path)}: ${what}`);
    }
  }
  assert.deepEqual(offenders, [], `secret-shaped values found:\n  ${offenders.join('\n  ')}`);
});

await test(['F2'], 'no .env file is tracked in the repository', () => {
  assert.deepEqual(
    repositoryFiles().map(shortName).filter((name) => /(^|\/)\.env(\.|$)/.test(name)),
    [],
  );
});

await test(['F4'], 'no module holds key material in module scope', () => {
  for (const path of ALL_FILES) {
    const code = codeOnly(read(path));
    // A top-level const holding requireEnv() is a copy that outlives the request.
    for (const [line] of code.matchAll(/^(?:const|let|var)\s+\w+\s*=[^\n]*requireEnv\([^\n]*/gm)) {
      assert.fail(`${shortName(path)} caches a secret in module scope: ${line.trim()}`);
    }
    for (const [line] of code.matchAll(/^(?:const|let|var)\s+\w+\s*=[^\n]*process\.env[^\n]*/gm)) {
      assert.fail(`${shortName(path)} caches an environment value: ${line.trim()}`);
    }
  }
});

await test(['F6'], 'no module returns an object that holds a private key', () => {
  for (const path of ALL_FILES) {
    const code = codeOnly(read(path));
    // The V1 handed callers a viem HDAccount, and an HDAccount exposes
    // getHdKey().privateKey to anything running in the same process (A4).
    assert.ok(!/getHdKey/.test(code), `${shortName(path)} reaches for the HD key`);
    // An account may be built and used in place; what may not cross the
    // boundary is the object itself. A return of one is only allowed to be a
    // return of its address.
    for (const [statement] of code.matchAll(
      /return\s+(?:mnemonicToAccount|privateKeyToAccount)\([\s\S]*?;/g,
    )) {
      assert.match(
        statement,
        /\.(address|signTransaction\()/,
        `${shortName(path)} returns an account object: ${statement.replace(/\s+/g, ' ')}`,
      );
    }
    assert.ok(!/\.privateKey/.test(code), `${shortName(path)} reads a private key`);
  }
});

await test(['F7'], 'the funder keys and the participant seed are never read together', () => {
  const funders = codeOnly(read(`${root}lib/bridge-v2/funders.ts`));
  const wallet = codeOnly(read(`${root}lib/bridge-v2/wallet.ts`));
  assert.match(funders, /requireEnv\('BRIDGE_V2_FUNDER_KEYS'\)/);
  assert.ok(!/BRIDGE_V2_WALLET_SEED/.test(funders), 'the funder pool reads the participant seed');
  assert.match(wallet, /requireEnv\('BRIDGE_V2_WALLET_SEED'\)/);
  assert.ok(!/BRIDGE_V2_FUNDER_KEYS/.test(wallet), 'the participant wallet reads a funder key');
});

await test(['F1'], 'each root is read by the module whose job it is, and by no other', () => {
  const readers = new Map();
  for (const path of ALL_FILES) {
    if (shortName(path) === 'lib/bridge-v2/env.ts') continue;
    for (const [, name] of codeOnly(read(path)).matchAll(/'(BRIDGE_V2_[A-Z_]+)'/g)) {
      if (!/HMAC_KEY|SEED|FUNDER_KEYS|ROLE_KEY/.test(name)) continue;
      readers.set(name, [...(readers.get(name) ?? []), shortName(path)]);
    }
  }
  const expected = {
    BRIDGE_V2_WALLET_SEED: ['lib/bridge-v2/wallet.ts'],
    BRIDGE_V2_FUNDER_KEYS: ['lib/bridge-v2/funders.ts'],
    BRIDGE_V2_ROLE_KEY: ['lib/bridge-v2/chain.ts'],
    BRIDGE_V2_CODE_HMAC_KEY: ['lib/bridge-v2/codes.ts', 'lib/bridge-v2/linkcodes.ts'],
    BRIDGE_V2_PHONE_HMAC_KEY: ['lib/bridge-v2/phone.ts'],
    BRIDGE_V2_SESSION_HMAC_KEY: ['lib/bridge-v2/session.ts'],
    BRIDGE_V2_SIGNAL_HMAC_KEY: ['lib/bridge-v2/ratelimit.ts', 'lib/bridge-v2/signals.ts'],
  };
  for (const [name, expectedReaders] of Object.entries(expected)) {
    assert.deepEqual(
      [...new Set(readers.get(name) ?? [])].sort(),
      [...expectedReaders].sort(),
      `${name} is read by the wrong modules`,
    );
  }
});

// ---------------------------------------------------------------------------
// G2, G4, K6 — errors are checked, waits are bounded, nothing sits outside
// ---------------------------------------------------------------------------

await test(['G2'], 'no database result is used without going through the checked helpers', () => {
  for (const path of ALL_FILES) {
    // Destructuring { data } straight off a query is the shape that ignores the
    // error beside it, which is finding #5.
    assert.ok(
      !/const\s*\{\s*data\s*\}\s*=\s*await\s+db\./.test(codeOnly(read(path))),
      `${shortName(path)} reads data without its error`,
    );
  }
});

await test(['G4'], 'every database call in the codebase carries an abort signal', () => {
  const offenders = [];
  for (const path of ALL_FILES) {
    const code = codeOnly(read(path));
    const queries = (code.match(/await db\s*\n?\s*\./g) ?? []).length;
    const bounded = (code.match(/\.abortSignal\(AbortSignal\.timeout\(/g) ?? []).length;
    if (queries > bounded) {
      offenders.push(`${shortName(path)}: ${queries} queries, ${bounded} bounded`);
    }
  }
  assert.deepEqual(offenders, [], `unbounded database calls:\n  ${offenders.join('\n  ')}`);
});

await test(['G4'], 'every outbound fetch in the codebase carries an abort signal', () => {
  for (const path of ALL_FILES) {
    const name = shortName(path);
    const code = codeOnly(read(path));
    if ((code.match(/\bfetch\(/g) ?? []).length === 0) continue;
    // db.ts wraps fetch to strip a header and passes the caller's init through,
    // and the caller is the Supabase client, which is bounded by abortSignal.
    if (name === 'lib/bridge-v2/db.ts') continue;
    assert.match(code, /signal: controller\.signal/, `${name} fetches unbounded`);
    assert.match(code, /setTimeout\(\(\) => controller\.abort\(\)/, `${name} never aborts`);
    assert.match(code, /clearTimeout\(timer\)/, `${name} leaks its timer`);
  }
});

await test(['G4'], 'the receipt wait is bounded and there is only one of it', () => {
  const chain = codeOnly(read(`${root}lib/bridge-v2/chain.ts`));
  assert.match(chain, /waitForTransactionReceipt\(\{[\s\S]*timeout: RECEIPT_TIMEOUT_MS/);
  // Findings #9, K3 and K4 share one root: a wait that cannot end.
  const waits = (chain.match(/waitForTransactionReceipt\(/g) ?? []).length;
  assert.equal(waits, 1, `${waits} receipt waits, only one of which carries the timeout`);
  assert.match(chain, /transport: http\([\s\S]*timeout: RPC_TIMEOUT_MS/);
});

await test(['K6'], 'every route body runs inside the envelope', () => {
  for (const path of ROUTE_FILES) {
    const code = codeOnly(read(path));
    // Finding I4: the V1 called getSupabase() before the try, so a
    // configuration failure escaped as an unhandled 500.
    assert.match(code, /const route = handle\(/, `${shortName(path)} does not use the envelope`);
    // A top-level await, at column zero, is work outside the envelope. An await
    // inside a helper the envelope calls is not.
    const before = code.slice(0, code.indexOf('const route = handle('));
    assert.ok(!/^await /m.test(before), `${shortName(path)} awaits before the envelope`);
    assert.match(
      code,
      /export async function (POST|GET)\(request: Request\): Promise<Response> \{\s*return route\(request\);\s*\}/,
      `${shortName(path)} does work outside the envelope in its export`,
    );
  }
});

// ---------------------------------------------------------------------------
// H1, H2, E4 — the signing surface
// ---------------------------------------------------------------------------

await test(['H1'], 'no contract address in the bridge comes from input', () => {
  for (const path of ALL_FILES) {
    for (const [, target] of codeOnly(read(path)).matchAll(/address:\s*([A-Za-z_][\w.]*)/g)) {
      assert.ok(
        !/body|input|params/.test(target),
        `${shortName(path)} takes a contract address from input`,
      );
    }
  }
  const chain = codeOnly(read(`${root}lib/bridge-v2/chain.ts`));
  const fromEnv = (chain.match(/requireEnv\('[^']+'\)/g) ?? []).join('');
  assert.ok(!/MANAGER|CONTRACT/.test(fromEnv), 'the manager address is read from configuration');
});

await test(['H1'], 'every functionName the bridge signs is a literal', () => {
  const signed = new Set();
  for (const path of ALL_FILES) {
    const code = codeOnly(read(path));
    for (const [, name] of code.matchAll(/functionName:\s*'([^']+)'/g)) signed.add(name);
    // A computed function name would be a configurable thing to sign.
    assert.ok(
      !/functionName:\s*(?!')[A-Za-z_]/.test(code),
      `${shortName(path)} computes a function name`,
    );
  }
  const mutating = [...signed].filter((name) =>
    ['enter', 'addEligibilityRoot', 'claimPrize', 'transfer', 'safeTransferFrom'].includes(name),
  );
  assert.deepEqual(
    mutating.sort(),
    ['addEligibilityRoot', 'claimPrize', 'enter', 'safeTransferFrom', 'transfer'],
  );
});

await test(['H2'], 'the destination of a funding is always a server-derived address', () => {
  const processor = codeOnly(read(`${root}lib/bridge-v2/processor.ts`));
  assert.match(processor, /fundDerivedWallet\(/);
  for (const [, destination] of processor.matchAll(
    /fundDerivedWallet\(\s*\n?\s*lease,\s*\n?\s*([\w.]+),/g,
  )) {
    assert.ok(/entry\.walletAddress|^wallet$/.test(destination), `a funding goes to ${destination}`);
  }
});

await test(['H2', 'E4'], 'a prize delivery goes only to an address the participant confirmed', () => {
  const processor = codeOnly(read(`${root}lib/bridge-v2/processor.ts`));
  assert.match(
    processor,
    /const destination = custody\.destinationConfirmedAt === null \? null : custody\.destinationAddress;/,
  );
  // And the row is written by two separate calls, so there is something to show.
  const route = codeOnly(read(`${root}api/bridge/v2/prize/destination.ts`));
  assert.match(route, /proposeDestination\(/);
  assert.match(route, /confirmDestination\(entry\.id, address\)/);
});

// ---------------------------------------------------------------------------
// K1, K2, K3, K4 — the supply chain and the logs
// ---------------------------------------------------------------------------

await test(['K1'], 'a lockfile is committed and carries integrity hashes', () => {
  const manifest = JSON.parse(read(`${root}package.json`));
  const lock = JSON.parse(read(`${root}package-lock.json`));
  assert.equal(lock.name, manifest.name);
  assert.ok(lock.lockfileVersion >= 2, 'the lockfile predates integrity hashes');
});

await test(['K2'], 'the modules that touch key material import no package but viem', () => {
  // Every package in the process is code with access to the same memory as the
  // seed. crypto.ts uses Web Crypto, which the runtime already has.
  for (const name of ['crypto.ts', 'wallet.ts', 'funders.ts']) {
    const code = codeOnly(read(`${root}lib/bridge-v2/${name}`));
    for (const [, specifier] of code.matchAll(/from '([^']+)'/g)) {
      assert.ok(
        specifier.startsWith('.') || specifier.startsWith('viem'),
        `lib/bridge-v2/${name} imports ${specifier}`,
      );
    }
    assert.ok(!/node:crypto/.test(code), `lib/bridge-v2/${name} pulls in node:crypto`);
  }
});

await test(['K2'], 'the email and Telegram clients are one fetch each, not an SDK', () => {
  for (const name of ['mail.ts', 'telegram.ts', 'alert.ts']) {
    const code = codeOnly(read(`${root}lib/bridge-v2/${name}`));
    assert.ok(!/from 'resend'/.test(code), `lib/bridge-v2/${name} imports the Resend package`);
    assert.match(code, /fetch\(/);
  }
});

await test(['K3'], 'no public high-volume route imports a module that signs', () => {
  // K3 asks for separation by privilege in so far as the platform allows. On
  // Vercel each route file is its own function, so what is testable is that the
  // routes anyone can call do not pull the signing modules into their process.
  for (const name of [
    'api/bridge/v2/session/request-code.ts',
    'api/bridge/v2/session/verify.ts',
    'api/bridge/v2/entry/status.ts',
    'api/bridge/v2/telegram/webhook.ts',
  ]) {
    const code = codeOnly(read(`${root}${name}`));
    for (const module of ['wallet.js', 'funders.js', 'processor.js']) {
      assert.ok(!code.includes(module), `${name} imports ${module}`);
    }
  }
});

await test(['K4'], 'the log detail type cannot carry an arbitrary object', () => {
  // An arbitrary object is how an email ends up in a log: somebody passes the
  // row they already had.
  assert.match(
    read(`${root}lib/bridge-v2/log.ts`),
    /export type Detail = Record<string, string \| number \| boolean \| null>/,
  );
});

await test(['K4'], 'no log call passes a value that could be an email, a number or a code', () => {
  const forbidden = /\b(email|canonical|phone|code|token|secret|seed|privateKey|walletIndex)\b/;
  for (const path of ALL_FILES) {
    const code = codeOnly(read(path));
    for (const [call] of code.matchAll(/log\.(?:event|failure)\([^;]*?\);/gs)) {
      // A detail KEY may be named for what it counts; a VALUE may not be one of
      // these identifiers.
      for (const [, value] of call.matchAll(/:\s*([A-Za-z_][\w.]*)/g)) {
        // error.code is the stable ChainError code — a constant of this
        // codebase, not a verification code somebody was sent.
        if (value.startsWith('error.')) continue;
        assert.ok(
          !forbidden.test(value),
          `${shortName(path)} logs ${value} in: ${call.replace(/\s+/g, ' ').slice(0, 90)}`,
        );
      }
    }
  }
});

await test(['K4'], 'no console call in the bridge prints a value', () => {
  for (const path of ALL_FILES) {
    for (const [call] of codeOnly(read(path)).matchAll(/console\.\w+\([^;]*\);/g)) {
      assert.ok(
        !/\$\{(?!kind|route|correlationId)/.test(call),
        `${shortName(path)} interpolates into a console call: ${call.slice(0, 90)}`,
      );
    }
  }
});

await test(['K4'], 'the rate limiter hashes its key before anything is stored', () => {
  const rateLimit = codeOnly(read(`${root}lib/bridge-v2/ratelimit.ts`));
  assert.match(rateLimit, /const keyHash = await keyedHash\(/);
  assert.match(rateLimit, /p_key_hash: keyHash/);
  assert.ok(!/p_key_hash: check\.value/.test(rateLimit), 'the raw value reaches the database');
});

// ---------------------------------------------------------------------------
// R1, R3, R5 — the Telegram terms
// ---------------------------------------------------------------------------

await test(['R1'], 'nothing in the bridge builds a Mini App, a Web App, or a link to one', () => {
  for (const path of ALL_FILES) {
    const code = read(path);
    for (const forbidden of ['web_app', 'WebApp', 'webApp', 'MiniApp', 'mini_app', 'menu_button']) {
      assert.ok(!code.includes(forbidden), `${shortName(path)} mentions ${forbidden}`);
    }
  }
});

await test(['R1'], 'the only keyboard the bot builds carries request_contact', () => {
  const telegram = codeOnly(read(`${root}lib/bridge-v2/telegram.ts`));
  const markups = [...telegram.matchAll(/reply_markup:\s*\{([\s\S]*?)\n\s*\},/g)].map((m) => m[1]);
  assert.ok(markups.length >= 1, 'no markup is built at all');
  for (const markup of markups) {
    assert.ok(!/inline_keyboard/.test(markup), 'an inline keyboard is built');
    assert.ok(
      /request_contact: true/.test(markup) || /remove_keyboard: true/.test(markup),
      `an unexpected markup is built: ${markup.replace(/\s+/g, ' ').slice(0, 80)}`,
    );
  }
});

await test(['R1'], 'the deep link the page opens is a plain t.me start link', () => {
  assert.match(
    codeOnly(read(`${root}api/bridge/v2/entry/start.ts`)),
    /https:\/\/t\.me\/\$\{requireEnv\('TELEGRAM_BOT_USERNAME'\)\}\?start=\$\{code\}/,
  );
});

await test(['R3'], 'the bot name is configuration, not a name written into the code', () => {
  // R3 constrains the bot's name, username and description, which live in
  // BotFather. The code must therefore not hard-code one.
  const start = codeOnly(read(`${root}api/bridge/v2/entry/start.ts`));
  assert.match(start, /requireEnv\('TELEGRAM_BOT_USERNAME'\)/);
  assert.ok(!/t\.me\/[a-z_]+bot/i.test(start), 'a bot username is written into the code');
});

await test(['R5'], 'the bot token is read from the environment at the moment of the call', () => {
  const telegram = codeOnly(read(`${root}lib/bridge-v2/telegram.ts`));
  assert.match(telegram, /api\.telegram\.org\/bot\$\{requireEnv\('TELEGRAM_BOT_TOKEN'\)\}/);
  for (const path of ALL_FILES) {
    const name = shortName(path);
    if (name === 'lib/bridge-v2/telegram.ts' || name === 'lib/bridge-v2/env.ts') continue;
    assert.ok(!/TELEGRAM_BOT_TOKEN/.test(read(path)), `${name} also reads the bot token`);
  }
});

// ---------------------------------------------------------------------------
// B6, C3, C4 — the requirements the 05/09/2026 decision replaced
// ---------------------------------------------------------------------------

await test(['B6', 'C3', 'C4'], 'no SMS provider, and no line-type lookup, exists anywhere', () => {
  // B6, C3 and C4 are marked SUBSTITUÍDO: the number arrives from Telegram's
  // request_contact and costs nothing, so there is no SMS to limit, none to
  // require, and no carrier lookup to make. The absence is what is testable,
  // and the absence is what the decision asks for.
  const providers = /twilio|vonage|nexmo|messagebird|plivo|sinch|sendSms|line_?type|carrier_?lookup/i;
  const offenders = repositoryFiles()
    .map(shortName)
    .filter((name) => !name.startsWith('test/'))
    .filter((name) => providers.test(read(`${root}${name}`)));
  assert.deepEqual(offenders, [], `an SMS provider is referenced in ${offenders.join(', ')}`);
  const manifest = JSON.parse(read(`${root}package.json`));
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    assert.ok(!providers.test(name), `${name} is an SMS dependency`);
  }
});

// ---------------------------------------------------------------------------
// J2, J6, J7 — the code and the mail that carries it
// ---------------------------------------------------------------------------

await test(['J2'], 'the code hash is bound to the address it was issued for', () => {
  assert.match(
    codeOnly(read(`${root}lib/bridge-v2/codes.ts`)),
    /keyedHash\('BRIDGE_V2_CODE_HMAC_KEY', 'email-code-v1', `\$\{canonicalEmail\}:\$\{code\}`\)/,
  );
});

await test(['J2'], 'the code hash is bound to the campaign as well as the address', () => {
  // J2: "ligado ao email E À CAMPANHA para impedir reutilização cruzada".
  const codes = codeOnly(read(`${root}lib/bridge-v2/codes.ts`));
  const hashFunction = codes.match(/function hashCode\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(
    hashFunction,
    /giveaway|campaign/i,
    'the code hash carries no campaign, so a code issued in one campaign verifies in another',
  );
});

await test(['J6'], 'the code is in the body of the mail and never in its subject', () => {
  const mail = codeOnly(read(`${root}lib/bridge-v2/mail.ts`));
  // Finding I6: the V1 put the code in the subject, so it was readable in a
  // lock-screen notification without opening the mailbox.
  const subject = mail.match(/const CODE_SUBJECT = '([^']*)'/)?.[1];
  assert.ok(subject, 'there is no fixed subject');
  assert.ok(!/\$\{/.test(subject), 'the subject interpolates something');
  // The two arguments in the order post() declares them: subject second, body
  // third. Written against the call rather than an object literal since the
  // settlement notices gave that call a second caller, and the property is the
  // same one either way — the code is an argument to the body, never the subject.
  assert.match(mail, /post\(to, CODE_SUBJECT, codeBody\(code, ttlMinutes\)\)/);
  assert.match(mail, /subject,\s*\n\s*text,/, 'post does not pass a subject and a text');
});

await test(['J6', 'R3'], 'a settlement subject names the campaign and nothing else', () => {
  // The notice may say what a verification code may not, because a settled
  // campaign's winners are a public list on a public chain. What it may still
  // not do is carry anything that is not already public, so the subject is
  // allowed exactly one interpolation and it is the giveaway id.
  const mail = codeOnly(read(`${root}lib/bridge-v2/mail.ts`));
  const subjectFunction = mail.match(/function noticeSubject\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.ok(subjectFunction, 'there is no settlement subject');
  const interpolations = [...subjectFunction.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(
    [...new Set(interpolations)],
    ['notice.giveawayId'],
    'the settlement subject carries something other than the campaign id',
  );
});

await test(['J7'], 'the sender is configured, and is not the shared provider address', () => {
  const mail = codeOnly(read(`${root}lib/bridge-v2/mail.ts`));
  assert.match(mail, /from: requireEnv\('BRIDGE_V2_MAIL_FROM'\)/);
  assert.ok(!/resend\.dev/.test(mail), 'the shared sender is back');
});

// ---------------------------------------------------------------------------
// C9, E5, F5 — the requirements whose content is a declaration
// ---------------------------------------------------------------------------

await test(['C9'], 'the limits of the anti-sybil layers are written down, not implied', () => {
  assert.match(read(`${root}lib/bridge-v2/signals.ts`), /burst detector, not an identifier/);
  assert.match(read(`${root}lib/bridge-v2/identity.ts`), /worse failure/);
});

await test(['E5'], 'no off-ramp guidance and no provider name is built into the bridge', () => {
  // E5 puts the off-ramp guide outside this specification and explicitly
  // outside code. What is testable is that no provider is named or linked.
  const exchanges = /binance|coinbase|kraken|bitstamp|okx|bybit|kucoin|off-?ramp/i;
  for (const path of ALL_FILES) {
    assert.ok(!exchanges.test(read(path)), `${shortName(path)} names an off-ramp`);
  }
});

await test(['F5'], 'each root is one variable, read at use, so rotation is a deployment', () => {
  // F5 asks for a documented, executable rotation procedure, which is a
  // document. What the code can carry is the property rotation needs, and the
  // one root that needs more than a redeploy says so.
  assert.match(read(`${root}lib/bridge-v2/wallet.ts`), /read at the moment of use/);
  const env = read(`${root}lib/bridge-v2/env.ts`);
  for (const name of [
    'BRIDGE_V2_CODE_HMAC_KEY',
    'BRIDGE_V2_PHONE_HMAC_KEY',
    'BRIDGE_V2_SESSION_HMAC_KEY',
    'BRIDGE_V2_SIGNAL_HMAC_KEY',
    'BRIDGE_V2_FUNDER_KEYS',
    'BRIDGE_V2_ROLE_KEY',
  ]) {
    assert.ok(env.includes(`'${name}'`), `${name} is not a variable of its own`);
  }
});
