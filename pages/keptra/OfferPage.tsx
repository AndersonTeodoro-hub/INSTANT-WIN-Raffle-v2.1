import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PackageCheck, ShieldCheck } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { AddressForm } from '../../components/keptra/AddressForm';
import { useDescription, useTerms, useTier, useUsdcBalance } from '../../components/keptra/hooks';
import { AddressLink, Badge, Button, Card, Empty, Eyebrow, Facts, Loading, NotAvailable, Notice } from '../../components/keptra/ui';
import { TIER_NAMES, keptraConfigured } from '../../lib/keptra/contracts';
import { countryName, formatUsdc } from '../../lib/keptra/format';
import { generateDeliveryCode, keepCode } from '../../lib/keptra/deliveryCode';
import type { AccountStatus } from '../../lib/keptra/api';

/*
 * /offers/:termsId — the link a store shares (T5: there is no catalogue).
 *
 * Before anything is paid (section 7, T4, T15): the product description, every
 * condition the store declared, the countries it delivers to, the store's tier —
 * all read from the chain or the bridge. Then the address (P15, T14), and the
 * payment, signed with the passkey after the summary (C12). For an own-means
 * offer the delivery code is made here, on this device, and only its commitment
 * leaves it (9.2, H18, T6).
 */

export function OfferPage() {
  const { termsId: raw } = useParams();
  const termsId = useMemo(() => (raw && /^\d{1,30}$/.test(raw) ? BigInt(raw) : null), [raw]);
  const { terms, regions, feeBps, paused, loading, error } = useTerms(termsId);
  const { description, missing, loading: describing } = useDescription(termsId === null ? null : termsId.toString());
  const tier = useTier(terms?.store ?? null);

  useEffect(() => {
    document.title = description ? `${description.title} · Keptra` : 'Offer · Keptra';
  }, [description]);

  if (!keptraConfigured()) {
    return (
      <KeptraShell>
        <NotAvailable />
      </KeptraShell>
    );
  }
  if (termsId === null) {
    return (
      <KeptraShell>
        <Empty title="This link does not name an offer." />
      </KeptraShell>
    );
  }

  return (
    <KeptraShell>
      {(loading || describing) && <Loading label="Reading the offer from the chain…" />}
      {!loading && (error || terms === null || terms.prize) && (
        <Empty title="There is no offer at this link.">
          <p>Check the link the store sent you. An offer that was taken down is not shown here.</p>
        </Empty>
      )}
      {!loading && terms !== null && !terms.prize && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 space-y-8">
            <div>
              <Eyebrow>Offer #{termsId.toString()} · protected by Keptra</Eyebrow>
              <h1 className="mt-3 break-words font-display text-4xl font-bold tracking-tight sm:text-5xl">{description?.title ?? 'Untitled offer'}</h1>
              <p className="mt-4 font-mono text-3xl font-bold text-brand tabular-nums">{formatUsdc(terms.price)}</p>
              {!terms.active && (
                <div className="mt-4">
                  <Notice tone="warning">The store took this offer down. It accepts no new orders.</Notice>
                </div>
              )}
            </div>

            <Card>
              <h2 className="font-display text-2xl font-bold tracking-tight">About the product</h2>
              {description ? (
                <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-gray-200">{description.text}</p>
              ) : (
                <p className="mt-3 text-sm text-gray-400">
                  {missing ? 'The store has not published a description for this offer yet, so it cannot be bought.' : 'The description could not be read. Try again shortly.'}
                </p>
              )}
            </Card>

            <Card>
              <h2 className="font-display text-2xl font-bold tracking-tight">The conditions</h2>
              <p className="mt-2 text-sm text-gray-400">Declared by the store on-chain before any payment. They never change for your order.</p>
              <div className="mt-4">
                <Facts
                  rows={[
                    ['Price per unit', <span className="font-mono">{formatUsdc(terms.price)}</span>],
                    ['Shipping, per order', <span className="font-mono">{formatUsdc(terms.shipping)}</span>],
                    ['Return cost, if refused', <span className="font-mono">{formatUsdc(terms.returnCost)}</span>],
                    ['Refusal fee', <span className="font-mono">{(terms.refusalFeeBps / 100).toFixed(2)}% of the price</span>],
                    ['Delivered by', terms.mode === 0 ? 'Carrier, with tracking checked by the Keptra oracle' : 'The store itself, with a delivery code you show on arrival'],
                    ['Ships within', `${terms.shipDays} day${terms.shipDays === 1 ? '' : 's'} of payment`],
                    ['Arrives within', `${terms.deliveryDays} day${terms.deliveryDays === 1 ? '' : 's'} of shipping`],
                    ['Delivers to', regions.map(countryName).join(', ') || '—'],
                    ['Store payout address', <AddressLink address={terms.payout} />],
                  ]}
                />
              </div>
            </Card>

            <Card>
              <h2 className="font-display text-2xl font-bold tracking-tight">How your money is protected</h2>
              <ol className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  ['Held on-chain', 'Your payment goes to the Keptra escrow contract, not to the store.'],
                  ['Released on proof', 'The store is paid when delivery is proven and 5 days pass without a contest — or when you confirm.'],
                  ['Returned by rule', 'If it never ships or never arrives, the contract returns your money. Anyone can trigger it.'],
                ].map(([title, body], index) => (
                  <li key={title} className="rounded-xl border border-dark-border p-4">
                    <p className="font-mono text-xs text-gray-500">0{index + 1}</p>
                    <p className="mt-1 font-semibold text-white">{title}</p>
                    <p className="mt-1 text-sm text-gray-400">{body}</p>
                  </li>
                ))}
              </ol>
            </Card>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Card>
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl font-bold tracking-tight">Buy</h2>
                {tier.tier !== null && (
                  <Badge tone={tier.tier >= 3 ? 'danger' : tier.tier >= 1 ? 'success' : 'neutral'}>{TIER_NAMES[tier.tier] ?? 'Unknown'} store</Badge>
                )}
              </div>
              {tier.tier !== null && (
                <p className="mt-2 text-xs text-gray-400">
                  Store tier from its on-chain record: {tier.delivered ?? 0} verified deliveries, {tier.materialFailures ?? 0} material failures.
                </p>
              )}
              <div className="mt-5">
                {paused ? (
                  <Notice tone="warning">New payments are paused on Keptra right now. Orders already paid are not affected.</Notice>
                ) : !terms.active || !description ? (
                  <Notice>This offer cannot be bought right now.</Notice>
                ) : (
                  <RequireAccount intro="Sign in to buy. Your payment is held by the Keptra escrow until delivery is proven.">
                    {(status) => <Checkout termsId={termsId} terms={terms} regions={regions} feeBps={feeBps} status={status} />}
                  </RequireAccount>
                )}
              </div>
            </Card>
          </aside>
        </div>
      )}
    </KeptraShell>
  );
}

function Checkout({
  termsId,
  terms,
  regions,
  feeBps,
  status,
}: {
  termsId: bigint;
  terms: NonNullable<ReturnType<typeof useTerms>['terms']>;
  regions: readonly string[];
  feeBps: number | null;
  status: AccountStatus;
}) {
  const { relay } = useKeptra();
  const navigate = useNavigate();
  const account = status.accounts.find((item) => item.role === 'PARTICIPANT');
  const { balance } = useUsdcBalance(account?.address ?? null);
  const [quantity, setQuantity] = useState(1);
  const [addressSaved, setAddressSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  void feeBps;

  if (account === undefined) return <Loading />;
  if (!account.configured) return <AccountSetup role="PARTICIPANT" status={status} />;

  const pay = async () => {
    setError(null);
    setBusy(true);
    // 9.2, H18, T6: an own-means order's code is made here and kept on this device; only the commitment is sent.
    const codeCommit = terms.mode === 1 ? keepCode(window.localStorage, generateDeliveryCode()) : undefined;
    const outcome = await relay({ kind: 'pay', termsId: termsId.toString(), quantity, ...(codeCommit ? { codeCommit } : {}) });
    setBusy(false);
    if (outcome.status === 'refused') return setError(outcome.error);
    if (outcome.status === 'done' && outcome.result.orderId) navigate(`/orders/${outcome.result.orderId}`);
    else if (outcome.status === 'done') navigate('/orders');
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="quantity" className="mb-2 block text-sm text-gray-300">
          Quantity
        </label>
        <div className="flex items-center gap-2">
          <Button tone="secondary" aria-label="One less" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
            −
          </Button>
          <input
            id="quantity"
            inputMode="numeric"
            className="min-h-[48px] w-20 rounded-xl border border-dark-border bg-dark-input text-center font-mono text-white"
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Math.min(999, Number(event.target.value.replace(/\D/g, '')) || 1)))}
          />
          <Button tone="secondary" aria-label="One more" onClick={() => setQuantity((q) => Math.min(999, q + 1))}>
            +
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-dark-border p-4 text-sm">
        <p className="flex justify-between gap-3">
          <span className="text-gray-400">Your USDC</span>
          <span className="font-mono text-white">{balance === null ? '…' : formatUsdc(balance)}</span>
        </p>
        <p className="mt-2 text-xs text-gray-500">
          The exact total, price × quantity plus shipping, is computed by Keptra and shown before you sign. Send USDC on Arbitrum One to your account address (Account page)
          to pay.
        </p>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <PackageCheck className="h-4 w-4 text-brand" aria-hidden="true" /> Delivery address
        </h3>
        {addressSaved ? (
          <Notice tone="success">Address saved for this order. It is bound to the order when you pay.</Notice>
        ) : (
          <AddressForm purpose={{ termsId: termsId.toString() }} regions={regions} onRegistered={() => setAddressSaved(true)} />
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <Button className="w-full" busy={busy} disabled={!addressSaved} onClick={() => void pay()}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Review and pay
      </Button>
      {terms.mode === 1 && (
        <p className="text-xs text-gray-500">This store delivers itself. A delivery code is created on this device; show it when the order arrives. It is never sent to anyone.</p>
      )}
      <p className="text-xs text-gray-500">
        By paying you accept the store's conditions above. <Link to="/privacy" className="underline underline-offset-4">Privacy</Link>
      </p>
    </div>
  );
}
