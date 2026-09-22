import { useEffect, useState } from 'react';
import { usePublicClient, useReadContract, useReadContracts } from 'wagmi';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { AddressLink, Card, Empty, Loading, NotAvailable, Notice, PageTitle, SectionTitle, Stat } from '../../components/keptra/ui';
import { GUARANTEE_READ_ABI, KEPTRA_GUARANTEE, POOL_READ_ABI, keptraConfigured } from '../../lib/keptra/contracts';
import { formatUsdc } from '../../lib/keptra/format';

/*
 * /pool — the guarantee pool in public (12.7, 16.6): capital, active coverage,
 * free capacity, utilisation, fees received and how they are split, the
 * provider's share (H2, T11) and the brands' debts. Every figure is a read of the
 * pool or the guarantee contract; the lists are the pool's own events. Nothing
 * here needs an account.
 *
 * Language (section 0): a guarantee for brands — no insurance, no yield.
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

function PoolBody() {
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
  const value = (name: (typeof names)[number]) => {
    const item = figures.data?.[names.indexOf(name)];
    return item?.status === 'success' ? (item.result as bigint | number) : null;
  };
  const [poolShare, reserveShare, platformShare] = (split.data ?? []).map((item) => (item.status === 'success' ? (item.result as number) : null));

  if (source.isLoading || (pool !== undefined && figures.isLoading)) return <Loading label="Reading the pool from the chain…" />;
  if (pool === undefined || pool === '0x0000000000000000000000000000000000000000') return <Notice tone="error">The pool could not be read. Try again shortly.</Notice>;

  const usdc = (name: (typeof names)[number]) => (value(name) === null ? '…' : formatUsdc(BigInt(value(name) as bigint)));

  return (
    <div className="space-y-8">
      <p className="max-w-3xl text-base leading-relaxed text-gray-300">
        The pool backs brands' prize obligations up to a limit, after the brand's own bond. When a brand fails, the winner is paid from the bond first, then from the pool, and
        the brand owes the pool what it paid. Its capital comes from providers Keptra authorises; today, one.
      </p>
      <Card>
        <dl className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Capital" value={usdc('totalAssets')} />
          <Stat label="Active guarantees" value={usdc('reservedTotal')} hint="Coverage reserved for live obligations" />
          <Stat label="Free capacity" value={usdc('freeCapacity')} hint={`Up to ${pct(value('maxUtilisationBps'))} of capital`} />
          <Stat label="Utilisation" value={pct(value('utilisationBps'))} />
          <Stat label="Risk reserve" value={usdc('riskReserve')} hint="Absorbs losses before providers" />
          <Stat label="Losses paid" value={usdc('lossesPaid')} />
        </dl>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Protection fees</SectionTitle>
          <dl className="grid grid-cols-2 gap-6">
            <Stat label="Received by the pool, ever" value={usdc('feesReceived')} />
            <Stat label="Withdrawals waiting" value={value('pendingRequests') === null ? '…' : String(value('pendingRequests'))} />
          </dl>
          <p className="mt-5 text-sm text-gray-400">Each fee a brand pays is split on-chain:</p>
          <dl className="mt-3 grid grid-cols-3 gap-4">
            <Stat label="Pool" value={pct(poolShare)} />
            <Stat label="Risk reserve" value={pct(reserveShare)} />
            <Stat label="Platform" value={pct(platformShare)} />
          </dl>
        </Card>
        <Providers pool={pool} supply={value('totalSupply')} />
      </div>
      <Debts pool={pool} />
      <p className="text-xs text-gray-500">
        Pool contract <AddressLink address={pool} /> · Guarantee contract <AddressLink address={KEPTRA_GUARANTEE} />
      </p>
    </div>
  );
}

/** H2 and T11: the providers' shares, from the pool's ProviderSet events and their balances. */
function Providers({ pool, supply }: { pool: `0x${string}`; supply: bigint | number | null }) {
  const client = usePublicClient();
  const [providers, setProviders] = useState<`0x${string}`[] | null>(null);
  useEffect(() => {
    if (!client) return;
    void client
      .getContractEvents({ address: pool, abi: POOL_READ_ABI, eventName: 'ProviderSet', fromBlock: 'earliest' })
      .then((logs) => {
        const allowed = new Map<string, boolean>();
        for (const log of logs) allowed.set((log.args as { provider: string }).provider, (log.args as { allowed: boolean }).allowed);
        setProviders([...allowed].filter(([, on]) => on).map(([address]) => address as `0x${string}`));
      })
      .catch(() => setProviders([]));
  }, [client, pool]);
  const balances = useReadContracts({
    contracts: (providers ?? []).map((provider) => ({ address: pool, abi: POOL_READ_ABI, functionName: 'balanceOf', args: [provider] })),
    query: { enabled: (providers ?? []).length > 0 },
  });
  return (
    <Card>
      <SectionTitle>Providers</SectionTitle>
      {providers === null ? (
        <Loading />
      ) : providers.length === 0 ? (
        <p className="text-sm text-gray-400">No provider authorised yet.</p>
      ) : (
        <ul className="divide-y divide-dark-border">
          {providers.map((provider, index) => {
            const shares = balances.data?.[index]?.status === 'success' ? (balances.data[index].result as bigint) : null;
            const share = shares !== null && supply ? Number((shares * 10_000n) / BigInt(supply)) : null;
            return (
              <li key={provider} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <AddressLink address={provider} />
                <span className="font-mono text-white">{share === null ? '…' : `${(share / 100).toFixed(2)}% of the shares`}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** 12.2.3 and H24: what brands owe the pool, from the guarantee's DebtRecorded and the pool's own debtOf. */
function Debts({ pool }: { pool: `0x${string}` }) {
  const client = usePublicClient();
  const [brands, setBrands] = useState<`0x${string}`[] | null>(null);
  useEffect(() => {
    if (!client) return;
    void client
      .getContractEvents({ address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, eventName: 'DebtRecorded', args: { source: pool }, fromBlock: 'earliest' })
      .then((logs) => setBrands([...new Set(logs.map((log) => (log.args as { brand: `0x${string}` }).brand))]))
      .catch(() => setBrands([]));
  }, [client, pool]);
  const debts = useReadContracts({
    contracts: (brands ?? []).map((brand) => ({ address: pool, abi: POOL_READ_ABI, functionName: 'debtOf', args: [brand] })),
    query: { enabled: (brands ?? []).length > 0 },
  });
  const owing = (brands ?? [])
    .map((brand, index) => ({ brand, debt: debts.data?.[index]?.status === 'success' ? (debts.data[index].result as bigint) : null }))
    .filter((row) => row.debt === null || row.debt > 0n);
  return (
    <Card>
      <SectionTitle>Brands' debts</SectionTitle>
      {brands === null ? (
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
      <p className="mt-4 text-xs text-gray-500">A brand with a debt creates no new obligation until it is repaid.</p>
    </Card>
  );
}
