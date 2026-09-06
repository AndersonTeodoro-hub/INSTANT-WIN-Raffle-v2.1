#!/usr/bin/env node
/**
 * Operator seed for Bridge V2. Findings 8.3 and 8.12.
 *
 * Two lists exist that no HTTP route may ever write: the gas funder pool, and
 * the disposable-domain blocklist (C2). A route that could add a funder could
 * add one whose key it chose; a route that could edit the blocklist could
 * unblock a disposable provider. So both are seeded from a terminal, by a
 * person, deliberately outside the request path.
 *
 * That separation is now operational rather than enforced by the database. The
 * seeder role is gone with the other per-route roles, because it depended on
 * minting HS256 tokens from a signing key the project is retiring: the current
 * JWT key is ECC P-256 with a non-exportable private half. This script and the
 * routes therefore hold the same credential, and what keeps the funder pool out
 * of the request path is that no route contains an INSERT against it — a weaker
 * guarantee than a role that could not perform the write, and stated plainly
 * rather than implied.
 *
 * Rule 0.1: this file contains no key, no token and no list. Everything comes
 * from the environment at the moment it runs, and nothing is written back to
 * disk. The only values it prints are funder indexes, public addresses and
 * counts.
 *
 * Usage:
 *   BRIDGE_V2_FUNDER_KEYS=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=...  *     node scripts/bridge-v2-seed.mjs funders
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=...  *     node scripts/bridge-v2-seed.mjs disposable-domains <file>
 *   ... | node scripts/bridge-v2-seed.mjs disposable-domains -
 *
 * The domain list is never embedded here (8.12). It is whatever the operator
 * supplies: one domain per line, blank lines and lines beginning with # ignored.
 */

import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    // F3: the name, never the value and never its length.
    throw new Error(`missing environment variable: ${name}`);
  }
  return value;
}

/**
 * One PostgREST call. Throws with the status, never with a row.
 *
 * The sb_secret_ key goes in `apikey` and nowhere else. It is not a JWT, and
 * Supabase rejects it outright if it also arrives as a Bearer token — the same
 * trap the V1 fell into and fixed in lib/bridge/supabase.ts:30. Sending no
 * Authorization header at all is the simplest way to stay out of it.
 */
async function rest(path, init = {}) {
  const response = await fetch(`${requireEnv('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: requireEnv('SUPABASE_SERVICE_KEY'),
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`PostgREST ${response.status} on ${init.method ?? 'GET'} ${path}`);
  }
  return response.status === 204 ? null : response.json();
}

/**
 * Seeds the funder pool from BRIDGE_V2_FUNDER_KEYS.
 *
 * The key list is the same one funders.ts reads at signing time, so the pool in
 * the database is by construction the pool the bridge can sign for. Each key is
 * turned into an address and dropped; nothing derived from a key is printed
 * except the address, which is public by definition.
 *
 * Idempotent. An index already present is left exactly as it is — its lease and
 * its nonce are live state and overwriting either would hand a running operation
 * a nonce somebody else is using. An index whose stored address no longer
 * matches the configured key is reported and NOT changed: that is a key
 * rotation, which also needs the nonce reset, and it is an operator decision.
 */
async function seedFunders() {
  const keys = requireEnv('BRIDGE_V2_FUNDER_KEYS')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (keys.length === 0) throw new Error('BRIDGE_V2_FUNDER_KEYS is set but holds no key');

  const configured = keys.map((key, index) => ({
    funder_index: index,
    address: privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`)).address.toLowerCase(),
  }));

  const existing = await rest('bridge_v2_funders?select=funder_index,address');
  const byIndex = new Map(existing.map((row) => [row.funder_index, row.address.toLowerCase()]));

  const missing = configured.filter((row) => !byIndex.has(row.funder_index));
  const mismatched = configured.filter(
    (row) => byIndex.has(row.funder_index) && byIndex.get(row.funder_index) !== row.address,
  );

  if (missing.length > 0) {
    await rest('bridge_v2_funders', { method: 'POST', body: JSON.stringify(missing) });
    for (const row of missing) console.log(`inserted funder ${row.funder_index} ${row.address}`);
  }

  for (const row of mismatched) {
    console.error(
      `funder ${row.funder_index}: configured key derives ${row.address}, database holds ` +
        `${byIndex.get(row.funder_index)}. Not changed — rotate deliberately, nonce included.`,
    );
  }

  const stale = existing.filter((row) => row.funder_index >= configured.length);
  for (const row of stale) {
    console.error(
      `funder ${row.funder_index} exists in the database but not in BRIDGE_V2_FUNDER_KEYS. ` +
        'Disable it deliberately rather than leaving it acquirable.',
    );
  }

  console.log(
    `funders: ${configured.length} configured, ${missing.length} inserted, ` +
      `${configured.length - missing.length} already present`,
  );
  return mismatched.length + stale.length === 0;
}

/**
 * Seeds the C2 blocklist from a file the operator supplies, or from stdin.
 *
 * No list lives in this repository (8.12). The blocklist is a moving target that
 * has to be updatable without a deploy, which is why it is a table, and a copy
 * frozen into a source file would be out of date the day after it was written.
 *
 * Idempotent through ON CONFLICT: re-running with a superset adds only the new
 * domains. Nothing is ever removed here — taking a domain off the blocklist
 * admits a provider, and that is a decision, not a side effect of a seed.
 */
async function seedDisposableDomains(source) {
  if (source === undefined) {
    throw new Error('usage: bridge-v2-seed.mjs disposable-domains <file|->');
  }

  const raw = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
  const domains = [
    ...new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().toLowerCase())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .filter((line) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(line)),
    ),
  ];

  if (domains.length === 0) throw new Error('the supplied list holds no usable domain');

  // Chunked so one run does not build a request larger than PostgREST accepts.
  const CHUNK = 500;
  for (let i = 0; i < domains.length; i += CHUNK) {
    await rest('bridge_v2_disposable_domains?on_conflict=domain', {
      method: 'POST',
      headers: { prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(domains.slice(i, i + CHUNK).map((domain) => ({ domain }))),
    });
  }

  console.log(`disposable domains: ${domains.length} submitted from ${source === '-' ? 'stdin' : source}`);
  return true;
}

const [command, argument] = process.argv.slice(2);

try {
  let clean;
  if (command === 'funders') clean = await seedFunders();
  else if (command === 'disposable-domains') clean = await seedDisposableDomains(argument);
  else {
    console.error('usage: bridge-v2-seed.mjs funders | disposable-domains <file|->');
    process.exit(2);
  }
  process.exit(clean ? 0 : 1);
} catch (error) {
  // The message is ours: a name, a status, or a count. Never a row and never a key.
  console.error(`seed failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
}
