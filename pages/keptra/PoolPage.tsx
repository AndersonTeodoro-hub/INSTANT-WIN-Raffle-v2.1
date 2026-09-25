import { useCallback, useEffect, useRef, useState } from 'react';
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { AddressLink, Card, Empty, Loading, NOT_READ, NotAvailable, Notice, PageTitle, ReadError, SectionTitle, Stat } from '../../components/keptra/ui';
import { GUARANTEE_READ_ABI, KEPTRA_GUARANTEE, POOL_READ_ABI, keptraConfigured } from '../../lib/keptra/contracts';
import { formatUsdc } from '../../lib/keptra/format';
import { CHAIN_FAILED, LOADING, chainFailed, type Read } from '../../lib/keptra/reads';

/*
 * /pool — the guarantee pool in public (12.7, 16.6): capital, active coverage,
 * free capacity, utilisation, fees received and how they are split, the
 * provider's share (H2, T11) and the brands' debts. Every figure is a read of the
 * pool or the guarantee contract; the lists are the pool's own events. Nothing
 * here needs an account.
 *
 * Language (section 0): a guarantee for brands — no insurance, no yield.
 *
 * V3: a figure or a list the chain did not give is an error with "Try again" —
 * never "no provider" or "no debt" on a read that failed. P6-15: one "Try again"
 * for the panel, which reads again everything that failed; P6-16: a figure not
 * read says so, and keeps saying so while it is read again. P6-3: no figure is
 * written by hand; P6-4: the fees are shown as amounts as well as the split.
 */

const pct = (bps: bigint | number | null | undefined) => (bps === null || bps === undefined ? '…' : `${(Number(bps) / 100).toFixed(2)}%`);

export function PoolPage() {
  useEffect(() => {
    document.title = 'Guarantee pool · Keptra';
  }, []);
  return (
    <KeptraShell>
      <PageTitle eyebrow="Public, on-chain" title="Guarantee pool" />
      {keptraConfigured() ? <PoolBody /> : <NotAvailable />}
    </KeptraShell>
  );
}

/** P6-16: what a figure shows — its value, "Not read" once its read failed (kept while it is read again), or "…" only on the first read. */
export function figureText(read: { status: 'success'; result: unknown } | { status: 'failure' } | undefined, show: (value: bigint | number) => string, failedBefore: boolean): string {
  if (read?.status === 'success') return show(read.result as bigint | number);
  if (read?.status === 'failure' || failedBefore) return NOT_READ;
  return '…';
}


function PoolBody() {
  // P6-15: one "Try again" for the whole panel — it reads again everything that failed.
  const [attempt, setAttempt] = useState(0);
  const [childFailures, setChildFailures] = useState<Record<string, boolean>>({});
  const reportFailure = useCallback((name: string, failed: boolean) => setChildFailures((now) => (now[name] === failed ? now : { ...now, [name]: failed })), []);
  const source = useReadContract({ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'defaultSource' });
  const pool = source.data as `0x${string}` | undefined;
  const split = useReadContracts({
    contracts: [
      { address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'poolShareBps' },
      { address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'reserveShareBps' },
      { address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'platformShareBps' },
    ],
  });
  const names = ['totalAssets', 'reservedTotal', 'freeCapacity', 'utilisationBps', 'maxUtilisationBps', 'riskReserve', 'feesReceived', 'lossesPaid', 'pendingRequests', 'totalSupply'] as const;
  const figures = useReadContracts({
    contracts: names.map((functionName) => ({ address: pool ?? KEPTRA_GUARANTEE, abi: POOL_READ_ABI, functionName })),
    query: { enabled: pool !== undefined, refetchInterval: 30_000 },
  });
  // P6-16: a figure whose read failed stays "Not read" while the next read runs, never "…" and back.
  const failedOnce = useRef(new Set<string>());
  const itemOf = (name: (typeof names)[number]) => figures.data?.[names.indexOf(name)] as Parameters<typeof figureText>[0];
  const text = (name: (typeof names)[number], show: (value: bigint | number) => string) => {
    const read = itemOf(name);
    if (read?.status === 'failure' || (figures.isError && read === undefined)) failedOnce.current.add(name);
    if (read?.status === 'success') failedOnce.current.delete(name);
    return figureText(read, show, failedOnce.current.has(name));
  };
  const value = (name: (typeof names)[number]) => {
    const read = itemOf(name);
    return read?.status === 'success' ? (read.result as bigint | number) : null;
  };
  const splitText = (index: number) => figureText(split.data?.[index] as Parameters<typeof figureText>[0], pct, split.isError);

  useEffect(() => {
    if (attempt === 0) return;
    void source.refetch();
    void figures.refetch();
    void split.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  if (source.isError) return <ReadError what="The pool" error={CHAIN_FAILED} onRetry={() => setAttempt((n) => n + 1)} />;
  if (source.isLoading || pool === undefined || figures.isLoading) return <Loading label="Reading the pool from the chain…" />;
  if (pool === '0x0000000000000000000000000000000000000000') return <Notice>The guarantee names no pool yet.</Notice>;
  const anyFailed = chainFailed(figures) || chainFailed(split) || Object.values(childFailures).some(Boolean);
  const usdcOf = (v: bigint | number) => formatUsdc(BigInt(v));
  const count = (v: bigint | number) => String(v);

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-base leading-relaxed text-gray-300">
        The pool backs brands' prize obligations up to a limit, after the brand's own bond. When a brand fails, the winner is paid from the bond first, then from the pool, and
        the brand owes the pool what it paid. Its capital comes from the providers Keptra authorises, listed below.
      </p>
      {anyFailed && <ReadError what="Some of the pool's figures" error={CHAIN_FAILED} onRetry={() => setAttempt((n) => n + 1)} />}
      <Card>
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Capital" value={text('totalAssets', usdcOf)} />
          <Stat label="Active guarantees" value={text('reservedTotal', usdcOf)} hint="Coverage reserved for live obligations" />
          <Stat label="Free capacity" value={text('freeCapacity', usdcOf)} hint={`Up to ${text('maxUtilisationBps', pct)} of capital`} />
          <Stat label="Utilisation" value={text('utilisationBps', pct)} />
          <Stat label="Risk reserve" value={text('riskReserve', usdcOf)} hint="Absorbs losses before providers" />
          <Stat label="Losses paid" value={text('lossesPaid', usdcOf)} />
        </dl>
        <PoolMeter capital={value('totalAssets')} reserved={value('reservedTotal')} maxBps={value('maxUtilisationBps')} />
      </Card>
      <AbsorptionOrder reserve={text('riskReserve', usdcOf)} capital={text('totalAssets', usdcOf)} />
      {/* Each card as tall as what it holds: no card stretched into an empty box. */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <SectionTitle>Protection fees</SectionTitle>
          <dl className="grid grid-cols-2 gap-6">
            <Stat label="Received by the pool, ever" value={text('feesReceived', usdcOf)} />
            <Stat label="Withdrawals waiting" value={text('pendingRequests', count)} />
          </dl>
          <p className="mt-5 text-sm text-gray-400">Each fee a brand pays is split on-chain:</p>
          <dl className="mt-3 grid grid-cols-3 gap-4">
            <Stat label="Pool" value={splitText(0)} />
            <Stat label="Risk reserve" value={splitText(1)} />
            <Stat label="Platform" value={splitText(2)} />
          </dl>
          <FeesDistributed pool={pool} attempt={attempt} report={reportFailure} />
        </Card>
        <Providers pool={pool} supply={value('totalSupply')} capital={value('totalAssets')} attempt={attempt} report={reportFailure} />
      </div>
      <Debts pool={pool} attempt={attempt} report={reportFailure} />
      <p className="text-xs text-gray-400">
        Pool contract <AddressLink address={pool} /> · Guarantee contract <AddressLink address={KEPTRA_GUARANTEE} />
      </p>
    </div>
  );
}

/**
 * The capital as one bar: the part reserved for live obligations, and the line
 * utilisation may not cross. Drawn only from figures read above; nothing is
 * drawn for a figure not read. It fills in when the page opens.
 */
function PoolMeter({ capital, reserved, maxBps }: { capital: bigint | number | null; reserved: bigint | number | null; maxBps: bigint | number | null }) {
  if (capital === null || reserved === null || Number(capital) === 0) return null;
  const used = Math.min(1, Number(reserved) / Number(capital));
  const cap = maxBps === null ? null : Math.min(1, Number(maxBps) / 10_000);
  return (
    <div aria-hidden="true" className="mt-6 border-t border-dark-border pt-5">
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
        <div className="iw-meter h-full rounded-full bg-white/80" style={{ transform: `scaleX(${used})` }} />
        {cap !== null && <span className="absolute inset-y-0 w-px bg-gray-300" style={{ left: `${cap * 100}%` }} />}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-gray-400">
        <span>Active guarantees</span>
        <span>Free capacity</span>
      </div>
    </div>
  );
}

/**
 * When a brand fails, who pays first — the order the paragraph above states,
 * given its own place: the brand's bond, then the risk reserve, then the pool's
 * capital, each with what it holds where the chain says. The rail fills once
 * when the page opens, each layer arriving after the one before, so the order
 * reads as an order.
 */
function AbsorptionOrder({ reserve, capital }: { reserve: string; capital: string }) {
  const layers = [
    { name: 'Bond', body: "The brand's own deposit, paid first.", figure: null },
    { name: 'Risk reserve', body: 'Absorbs losses before providers', figure: reserve },
    { name: 'Capital', body: "The providers' capital, paid last.", figure: capital },
  ];
  return (
    <section aria-labelledby="absorption" className="iw-surface-raised p-5 sm:p-7">
      <h2 id="absorption" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        Who pays when a brand fails
      </h2>
      <ol className="relative mt-6 grid gap-4 sm:grid-cols-3">
        <span aria-hidden="true" className="absolute left-[1.15rem] top-4 bottom-4 w-px overflow-hidden bg-dark-line sm:left-8 sm:right-8 sm:top-[1.15rem] sm:bottom-auto sm:h-px sm:w-auto">
          <span className="iw-rail-fill block h-full w-full bg-white/60" />
        </span>
        {layers.map((layer, index) => (
          <li key={layer.name} className="iw-path-node relative flex gap-4 sm:flex-col sm:gap-3" style={{ animationDelay: `${150 + index * 420}ms` }}>
            <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dark-line bg-dark-raised font-mono text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-white">{layer.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-gray-300">{layer.body}</p>
              {layer.figure && <p className="mt-2 font-mono text-lg font-semibold tabular-nums text-white">{layer.figure}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

type Reporter = (name: string, failed: boolean) => void;

/**
 * P6-4: what the fees came to, in USDC, and where each part went — every
 * protection fee the guarantee charged on an obligation this pool covers
 * (ObligationCreated), and what the pool took of them into its capital and its
 * risk reserve (FeeReceived). The platform's part is the rest of each fee.
 */
function FeesDistributed({ pool, attempt, report }: { pool: `0x${string}`; attempt: number; report: Reporter }) {
  const client = usePublicClient();
  const [found, setFound] = useState<Read<{ charged: bigint; capital: bigint; reserve: bigint }>>(LOADING);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void Promise.all([
      client.getContractEvents({ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, eventName: 'ObligationCreated', fromBlock: 'earliest' }),
      client.getContractEvents({ address: pool, abi: POOL_READ_ABI, eventName: 'FeeReceived', fromBlock: 'earliest' }),
    ])
      .then(([created, received]) => {
        if (!live) return;
        const mine = created.filter((log) => (log.args as { source: string }).source.toLowerCase() === pool.toLowerCase());
        const charged = mine.reduce((sum, log) => sum + (log.args as { protectionFee: bigint }).protectionFee, 0n);
        const capital = received.reduce((sum, log) => sum + (log.args as { capitalAmount: bigint }).capitalAmount, 0n);
        const reserve = received.reduce((sum, log) => sum + (log.args as { reserveAmount: bigint }).reserveAmount, 0n);
        setFound({ status: 'ready', value: { charged, capital, reserve } });
      })
      .catch(() => live && setFound((now) => (now.status === 'ready' ? now : { status: 'failed', error: CHAIN_FAILED })));
    return () => {
      live = false;
    };
  }, [client, pool, attempt]);
  useEffect(() => report('fees', found.status === 'failed'), [found.status, report]);
  const show = (pick: (v: { charged: bigint; capital: bigint; reserve: bigint }) => bigint) =>
    found.status === 'ready' ? formatUsdc(pick(found.value)) : found.status === 'failed' ? NOT_READ : '…';
  return (
    <>
      <p className="mt-5 text-sm text-gray-400">Distributed so far, in USDC:</p>
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Fees charged" value={show((v) => v.charged)} />
        <Stat label="To the pool" value={show((v) => v.capital)} />
        <Stat label="To the risk reserve" value={show((v) => v.reserve)} />
        <Stat label="To the platform" value={show((v) => (v.charged > v.capital + v.reserve ? v.charged - v.capital - v.reserve : 0n))} />
      </dl>
    </>
  );
}

/** H2 and T11: the providers' shares, from the pool's ProviderSet events and their balances. */
function Providers({
  pool,
  supply,
  capital,
  attempt,
  report,
}: {
  pool: `0x${string}`;
  supply: bigint | number | null;
  capital: bigint | number | null;
  attempt: number;
  report: Reporter;
}) {
  const client = usePublicClient();
  const [found, setFound] = useState<Read<`0x${string}`[]>>(LOADING);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
      .getContractEvents({ address: pool, abi: POOL_READ_ABI, eventName: 'ProviderSet', fromBlock: 'earliest' })
      .then((logs) => {
        if (!live) return;
        const allowed = new Map<string, boolean>();
        for (const log of logs) allowed.set((log.args as { provider: string }).provider, (log.args as { allowed: boolean }).allowed);
        setFound({ status: 'ready', value: [...allowed].filter(([, on]) => on).map(([address]) => address as `0x${string}`) });
      })
      .catch(() => live && setFound((now) => (now.status === 'ready' ? now : { status: 'failed', error: CHAIN_FAILED })));
    return () => {
      live = false;
    };
  }, [client, pool, attempt]);
  const providers = found.status === 'ready' ? found.value : null;
  const balances = useReadContracts({
    contracts: (providers ?? []).map((provider) => ({ address: pool, abi: POOL_READ_ABI, functionName: 'balanceOf', args: [provider] })),
    query: { enabled: (providers ?? []).length > 0 },
  });
  useEffect(() => {
    if (attempt > 0) void balances.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => report('providers', found.status === 'failed' || chainFailed(balances)), [found.status, balances.isError, balances.data, report]);
  return (
    <Card>
      <SectionTitle>Providers</SectionTitle>
      {found.status === 'failed' ? (
        <p className="text-sm text-gray-400">{NOT_READ}</p>
      ) : providers === null ? (
        <Loading />
      ) : providers.length === 0 ? (
        <p className="text-sm text-gray-400">No provider authorised yet.</p>
      ) : (
        <>
          {/* The shares as one bar: each provider's part of the pool, drawn from the balances read below. */}
          <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
            {providers.map((provider, index) => {
              const read = balances.data?.[index];
              const shares = read?.status === 'success' ? (read.result as bigint) : null;
              const part = shares !== null && supply ? Number((shares * 10_000n) / BigInt(supply)) / 10_000 : 0;
              return <span key={provider} className="iw-meter h-full border-r border-black bg-white/70 last:border-r-0" style={{ width: `${part * 100}%` }} />;
            })}
          </div>
          <ul className="mt-4 divide-y divide-dark-border">
            {providers.map((provider, index) => {
              const read = balances.data?.[index];
              const shares = read?.status === 'success' ? (read.result as bigint) : null;
              const share = shares !== null && supply ? Number((shares * 10_000n) / BigInt(supply)) : null;
              // Their part of the capital, from the two figures already read (shares of the supply × capital).
              const held = shares !== null && supply && capital !== null ? (shares * BigInt(capital)) / BigInt(supply) : null;
              return (
                <li key={provider} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <AddressLink address={provider} />
                  <span className="text-right">
                    <span className="block font-mono text-white">{share !== null ? `${(share / 100).toFixed(2)}% of the shares` : read?.status === 'failure' || balances.isError ? NOT_READ : '…'}</span>
                    {held !== null && <span className="block font-mono text-xs text-gray-400">{formatUsdc(held)} of capital</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-gray-400">Its capital comes from the providers Keptra authorises. Their capital pays after the brand's bond and the risk reserve.</p>
        </>
      )}
    </Card>
  );
}

/** 12.2.3 and H24: what brands owe the pool, from the guarantee's DebtRecorded and the pool's own debtOf. */
function Debts({ pool, attempt, report }: { pool: `0x${string}`; attempt: number; report: Reporter }) {
  const client = usePublicClient();
  const [found, setFound] = useState<Read<`0x${string}`[]>>(LOADING);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void client
      .getContractEvents({ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, eventName: 'DebtRecorded', args: { source: pool }, fromBlock: 'earliest' })
      .then((logs) => live && setFound({ status: 'ready', value: [...new Set(logs.map((log) => (log.args as { brand: `0x${string}` }).brand))] }))
      .catch(() => live && setFound((now) => (now.status === 'ready' ? now : { status: 'failed', error: CHAIN_FAILED })));
    return () => {
      live = false;
    };
  }, [client, pool, attempt]);
  const brands = found.status === 'ready' ? found.value : null;
  const debts = useReadContracts({
    contracts: (brands ?? []).map((brand) => ({ address: pool, abi: POOL_READ_ABI, functionName: 'debtOf', args: [brand] })),
    query: { enabled: (brands ?? []).length > 0 },
  });
  useEffect(() => {
    if (attempt > 0) void debts.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => report('debts', found.status === 'failed' || chainFailed(debts)), [found.status, debts.isError, debts.data, report]);
  const owing = (brands ?? [])
    .map((brand, index) => ({ brand, debt: debts.data?.[index]?.status === 'success' ? (debts.data[index].result as bigint) : null }))
    .filter((row) => row.debt === null || row.debt > 0n);
  return (
    <Card>
      <SectionTitle>Brands' debts</SectionTitle>
      {found.status === 'failed' || chainFailed(debts) ? (
        <p className="text-sm text-gray-400">{NOT_READ}</p>
      ) : brands === null ? (
        <Loading />
      ) : owing.length === 0 ? (
        <Empty title="No brand owes the pool anything." />
      ) : (
        <ul className="divide-y divide-dark-border">
          {owing.map((row) => (
            <li key={row.brand} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <AddressLink address={row.brand} />
              <span className="font-mono text-white">{row.debt === null ? '…' : formatUsdc(row.debt)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-gray-400">A brand with a debt creates no new obligation until it is repaid.</p>
    </Card>
  );
}
