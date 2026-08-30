/**
 * Testes dos módulos puros da ponte + smoke das rotas sem env vars.
 *
 * Sem framework e sem dependências: `node:assert` e o type-stripping nativo do
 * Node 22. Correr com:
 *   node --experimental-strip-types --import ./test/register-loader.mjs test/bridge.test.mjs
 *
 * NÃO cobre: a assinatura das rotas perante o runtime do Vercel (só o curl
 * pós-deploy prova), nem nada que toque na chain ou no Supabase.
 */
import assert from 'node:assert/strict';

/**
 * Mnemónica de TESTE pública do Hardhat/Anvil. Não é um segredo: está na
 * documentação do Hardhat, as suas contas são conhecidas por toda a gente e não
 * têm fundos em nenhuma rede real. A seed verdadeira vive só em BRIDGE_SEED, no
 * Vercel, e NUNCA aparece num ficheiro.
 */
const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

/** Endereços canónicos de m/44'/60'/0'/0/{0,1,2} para essa mnemónica. */
const EXPECTED = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
];

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); console.log(`PASS  ${name}`); pass++; }
  catch (e) { console.log(`FALHA ${name}\n      ${e.message}`); fail++; }
};

// ============================================================ wallet
process.env.BRIDGE_SEED = TEST_MNEMONIC;
const wallet = await import('../lib/bridge/wallet.ts');

await t('wallet: derivação bate com os endereços canónicos BIP-44', () => {
  EXPECTED.forEach((addr, i) => assert.equal(wallet.deriveAddress(i), addr));
});
await t('wallet: derivação é determinística', () => {
  assert.equal(wallet.deriveAddress(7), wallet.deriveAddress(7));
});
await t('wallet: índices diferentes dão wallets diferentes', () => {
  assert.notEqual(wallet.deriveAddress(0), wallet.deriveAddress(1));
});
await t('wallet: índice inválido rejeitado', () => {
  assert.throws(() => wallet.deriveAddress(-1));
  assert.throws(() => wallet.deriveAddress(1.5));
});
await t('wallet: não expõe a chave privada no objecto devolvido', () => {
  const acc = wallet.deriveAccount(0);
  assert.equal(acc.privateKey, undefined);
  assert.ok(!JSON.stringify(Object.keys(acc)).includes('privateKey'));
});

// ============================================================ codes
const codes = await import('../lib/bridge/codes.ts');

await t('codes: gera sempre 6 dígitos no intervalo certo', () => {
  for (let i = 0; i < 500; i++) {
    const c = codes.generateCode();
    assert.match(c, /^\d{6}$/);
    assert.ok(Number(c) >= 100000 && Number(c) <= 999999);
  }
});
await t('codes: não é constante (500 amostras, >100 distintas)', () => {
  const set = new Set(Array.from({ length: 500 }, () => codes.generateCode()));
  assert.ok(set.size > 100, `só ${set.size} distintos`);
});
await t('codes: hash é determinístico', async () => {
  assert.equal(await codes.hashCode('123456', 'a@b.pt', '1'), await codes.hashCode('123456', 'a@b.pt', '1'));
});
await t('codes: hash não revela o código (não o contém)', async () => {
  const h = await codes.hashCode('123456', 'a@b.pt', '1');
  assert.ok(!h.includes('123456'));
  assert.equal(h.length, 64);
});
await t('codes: hash está ligado ao email e à campanha', async () => {
  const base = await codes.hashCode('123456', 'a@b.pt', '1');
  assert.notEqual(base, await codes.hashCode('123456', 'outro@b.pt', '1'));
  assert.notEqual(base, await codes.hashCode('123456', 'a@b.pt', '2'));
  assert.notEqual(base, await codes.hashCode('654321', 'a@b.pt', '1'));
});
await t('codes: email é case-insensitive no hash', async () => {
  assert.equal(await codes.hashCode('123456', 'A@B.PT', '1'), await codes.hashCode('123456', 'a@b.pt', '1'));
});
await t('codes: comparação em tempo constante', () => {
  assert.equal(codes.timingSafeEqualHex('abcd', 'abcd'), true);
  assert.equal(codes.timingSafeEqualHex('abcd', 'abce'), false);
  assert.equal(codes.timingSafeEqualHex('abcd', 'abc'), false);
});
await t('codes: expiração a 10 minutos', () => {
  const now = Date.now();
  assert.equal(codes.CODE_TTL_MS, 600000);
  assert.equal(codes.isExpired(codes.codeExpiry(now), now), false);
  assert.equal(codes.isExpired(codes.codeExpiry(now), now + 600001), true);
  assert.equal(codes.isExpired(new Date(now - 1), now), true);
});
await t('codes: limites do SPEC', () => {
  assert.equal(codes.MAX_ATTEMPTS, 5);
  assert.equal(codes.MAX_CODES_PER_HOUR, 3);
});

// ============================================================ http (validação)
const http = await import('../lib/bridge/http.ts');

await t('http: emails válidos aceites e normalizados', () => {
  assert.equal(http.parseEmail('  A@Exemplo.PT '), 'a@exemplo.pt');
  assert.equal(http.parseEmail('a.b+c@sub.dominio.com'), 'a.b+c@sub.dominio.com');
});
await t('http: emails inválidos rejeitados', () => {
  for (const bad of ['', 'sem-arroba', 'a@sem-ponto', '@b.pt', 'a b@c.pt', 'a@b.pt extra', null, 42, {}, `${'x'.repeat(250)}@b.pt`]) {
    assert.equal(http.parseEmail(bad), null, `devia rejeitar: ${String(bad)}`);
  }
});
await t('http: giveawayId aceita decimal e number, rejeita o resto', () => {
  assert.equal(http.parseGiveawayId('1'), 1n);
  assert.equal(http.parseGiveawayId(42), 42n);
  assert.equal(http.parseGiveawayId(' 7 '), 7n);
  for (const bad of ['0', 0, -1, '-1', '1.5', 'abc', '', null, {}, '0x1']) {
    assert.equal(http.parseGiveawayId(bad), null, `devia rejeitar: ${String(bad)}`);
  }
});
await t('http: código tem de ter 6 dígitos', () => {
  assert.equal(http.parseCode('123456'), '123456');
  for (const bad of ['12345', '1234567', 'abcdef', '', null, 123456]) {
    assert.equal(http.parseCode(bad), null, `devia rejeitar: ${String(bad)}`);
  }
});
await t('http: maskEmail nunca devolve o email completo', () => {
  assert.equal(http.maskEmail('anderson@instntwin.com'), 'a***@instntwin.com');
  assert.ok(!http.maskEmail('anderson@instntwin.com').includes('anderson'));
});
await t('http: readJson devolve null em corpo malformado', async () => {
  assert.equal(await http.readJson(new Request('https://x', { method: 'POST', body: '{nope' })), null);
  assert.equal(await http.readJson(new Request('https://x', { method: 'POST', body: '[1,2]' })), null);
});

// ============================================================ rotas sem env vars
// Não devem CRASHAR: input inválido dá 400, e o fail-fast do env.ts tem de sair
// como 500 JSON limpo, sem stack trace nem valores internos na resposta.
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY', 'BRIDGE_FUNDER_PK']) delete process.env[k];

const routes = {
  status: await import('../api/bridge/status.ts'),
  verify: await import('../api/bridge/verify.ts'),
  requestCode: await import('../api/bridge/request-code.ts'),
};

await t('rotas: exportam o método certo e nenhum default', () => {
  assert.equal(typeof routes.status.GET, 'function');
  assert.equal(typeof routes.verify.POST, 'function');
  assert.equal(typeof routes.requestCode.POST, 'function');
  for (const [n, m] of Object.entries(routes)) assert.equal(m.default, undefined, `${n} tem default export`);
});
await t('rotas: corpo malformado -> 400, não 500', async () => {
  for (const m of [routes.verify.POST, routes.requestCode.POST]) {
    const res = await m(new Request('https://x', { method: 'POST', body: '{nope' }));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).ok, false);
  }
});
await t('rotas: email inválido -> 400', async () => {
  const res = await routes.requestCode.POST(new Request('https://x', {
    method: 'POST', body: JSON.stringify({ email: 'nope', giveawayId: 1 }),
  }));
  assert.equal(res.status, 400);
});
await t('rotas: giveawayId inválido -> 400', async () => {
  const res = await routes.verify.POST(new Request('https://x', {
    method: 'POST', body: JSON.stringify({ email: 'a@b.pt', giveawayId: 0, code: '123456' }),
  }));
  assert.equal(res.status, 400);
});
await t('status: sem env vars falha limpo em 500 JSON, sem stack', async () => {
  const res = await routes.status.GET(new Request('https://x/api/bridge/status?email=a@b.pt&giveawayId=1'));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
  // nada de nomes de env vars, caminhos, stack ou "Error:" na resposta
  const s = JSON.stringify(body);
  for (const leak of ['SUPABASE', 'BRIDGE_SEED', 'at ', '.ts:', 'Error:']) {
    assert.ok(!s.includes(leak), `resposta vaza "${leak}": ${s}`);
  }
});

// ============================================================ funding pool
const funders = await import('../lib/bridge/funders.ts');

/** Chaves de TESTE: as 3 primeiras contas do Anvil. Públicas, documentadas, sem
 *  fundos em nenhuma rede real. As verdadeiras vivem só em BRIDGE_FUNDER_PKS. */
const TEST_PKS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
];

/** LockStore em memória com a mesma semântica de exclusão mútua da tabela. */
function fakeStore() {
  const held = new Map();
  return {
    ensured: 0, releases: [],
    async ensureRows(n) { this.ensured = n; },
    async tryAcquire(index, token) {
      if (held.has(index)) return false;
      held.set(index, token);
      return true;
    },
    async release(index, token) {
      if (held.get(index) === token) held.delete(index);
      this.releases.push(index);
    },
    heldCount: () => held.size,
    forceHold: (i) => held.set(i, 'outro'),
  };
}

const RICH = async () => 10n ** 18n;
const BROKE = async () => 0n;
const noSleep = async () => {};

await t('pool: singular BRIDGE_FUNDER_PK vira pool de 1', () => {
  delete process.env.BRIDGE_FUNDER_PKS;
  process.env.BRIDGE_FUNDER_PK = TEST_PKS[0];
  assert.equal(funders.loadFunderPool().length, 1);
});
await t('pool: plural le N chaves e ganha ao singular', () => {
  process.env.BRIDGE_FUNDER_PKS = TEST_PKS.join(',');
  process.env.BRIDGE_FUNDER_PK = TEST_PKS[0];
  const pool = funders.loadFunderPool();
  assert.equal(pool.length, 3);
  assert.equal(new Set(pool.map((a) => a.address)).size, 3);
});
await t('pool: tolera espacos e virgulas a mais', () => {
  process.env.BRIDGE_FUNDER_PKS = ` ${TEST_PKS[0]} , ${TEST_PKS[1]} ,`;
  assert.equal(funders.loadFunderPool().length, 2);
});
await t('pool: sem env var lanca nomeando as duas', () => {
  delete process.env.BRIDGE_FUNDER_PKS; delete process.env.BRIDGE_FUNDER_PK;
  assert.throws(() => funders.loadFunderPool(), /BRIDGE_FUNDER_PKS.*BRIDGE_FUNDER_PK/s);
});
await t('pool: maskAddress nunca devolve o endereco inteiro', () => {
  const a = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  assert.equal(funders.maskAddress(a), '0xf3..66');
  assert.ok(!funders.maskAddress(a).includes('aad88'));
});

process.env.BRIDGE_FUNDER_PKS = TEST_PKS.join(',');
const POOL = funders.loadFunderPool();

await t('pool: adquire funder livre e devolve lease valido', async () => {
  const store = fakeStore();
  const lease = await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH });
  assert.ok(lease.index >= 0 && lease.index < 3);
  assert.equal(typeof lease.token, 'string');
  assert.equal(lease.account.address, POOL[lease.index].address);
  assert.equal(store.ensured, 3);
});
await t('pool: ordem aleatoria (nao comeca sempre no 0)', async () => {
  const primeiros = new Set();
  for (let i = 0; i < 60; i++) {
    const store = fakeStore();
    primeiros.add((await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH })).index);
  }
  assert.ok(primeiros.size > 1, 'escolheu sempre o mesmo indice');
});
await t('pool: exclusao mutua — dois leases nunca no mesmo indice', async () => {
  const store = fakeStore();
  const a = await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH });
  const b = await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH });
  assert.notEqual(a.index, b.index);
  assert.equal(store.heldCount(), 2);
});
await t('pool: todos ocupados -> AllFundersBusyError (503)', async () => {
  const store = fakeStore();
  [0, 1, 2].forEach((i) => store.forceHold(i));
  let now = 0;
  await assert.rejects(
    funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH, now: () => (now += 300), sleep: noSleep }),
    (e) => e instanceof funders.AllFundersBusyError,
  );
});
await t('pool: nenhum com saldo -> FundersDepletedError, todos libertados', async () => {
  const store = fakeStore();
  await assert.rejects(
    funders.acquireFunder({ store, pool: POOL, needed: 10n ** 18n, getBalance: BROKE, sleep: noSleep }),
    (e) => e instanceof funders.FundersDepletedError,
  );
  assert.equal(store.heldCount(), 0, 'ficou lease preso');
  assert.deepEqual([...new Set(store.releases)].sort(), [0, 1, 2]);
});
await t('pool: sem saldo num, salta para o proximo com saldo', async () => {
  const store = fakeStore();
  const pobre = POOL[0].address;
  const lease = await funders.acquireFunder({
    store, pool: POOL, needed: 5n, sleep: noSleep,
    order: (xs) => [...xs],
    getBalance: async (addr) => (addr === pobre ? 0n : 10n),
  });
  assert.notEqual(lease.index, 0);
  assert.ok(store.releases.includes(0), 'o funder sem saldo nao foi libertado');
});
await t('pool: erro a ler saldo liberta e nao marca esgotado', async () => {
  const store = fakeStore();
  let n = 0;
  const lease = await funders.acquireFunder({
    store, pool: POOL, needed: 5n, sleep: noSleep, order: (xs) => [...xs],
    getBalance: async () => { if (++n === 1) throw new Error('rpc down'); return 10n; },
  });
  assert.ok(lease.index >= 0);
  assert.ok(store.releases.includes(0));
});
await t('pool: release usa token — lease alheio nao e libertado', async () => {
  const store = fakeStore();
  const lease = await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH });
  await store.release(lease.index, 'token-errado');
  assert.equal(store.heldCount(), 1, 'libertou com token errado');
  await store.release(lease.index, lease.token);
  assert.equal(store.heldCount(), 0);
});
await t('pool: try/finally liberta mesmo quando o funding rebenta', async () => {
  const store = fakeStore();
  const lease = await funders.acquireFunder({ store, pool: POOL, needed: 1n, getBalance: RICH });
  try {
    try { throw new Error('funding falhou'); } finally { await store.release(lease.index, lease.token); }
  } catch { /* esperado */ }
  assert.equal(store.heldCount(), 0, 'lease ficou preso apos erro');
});

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
