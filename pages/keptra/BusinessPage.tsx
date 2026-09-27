import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useReadContracts } from 'wagmi';
import { Copy, ExternalLink, PackagePlus, Truck } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { useBridgeRead, useTerms, useTier } from '../../components/keptra/hooks';
import { EvidencePanel } from './OrderPage';
import {
  AddressLink,
  Badge,
  Button,
  Card,
  DoneOnChain,
  Empty,
  Field,
  Loading,
  NotAvailable,
  Notice,
  PageTitle,
  ReadError,
  SectionTitle,
  Stat,
  inputClass,
} from '../../components/keptra/ui';
import {
  accountVouchers,
  myOffers,
  offerDescription,
  registerTracking,
  storeOrders,
  writeDescription,
  type AccountStatus,
  type OfferListed,
  type StoreOrder,
  type VoucherHeld,
} from '../../lib/keptra/api';
import { CHAIN_FAILED, chainFailed, type Read } from '../../lib/keptra/reads';
import { ESCROW_READ_ABI, GUARANTEE_READ_ABI, KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_GUARANTEE_ABI, OrderState, keptraConfigured } from '../../lib/keptra/contracts';
import { countryName, formatNumber, formatUsdc, formatUtc, parseUsdc } from '../../lib/keptra/format';
import { orderStatusText, storeActions, type StoreAction } from '../../lib/keptra/orders';
import { codeToBytes32, normalizeDeliveryCode } from '../../lib/keptra/deliveryCode';
import { DESCRIPTION_TEXT_MAX, DESCRIPTION_TITLE_MAX, checkDescription } from '../../lib/keptra-description';
import { around, fill, useKeptraCopy, type KeptraCopy } from '../keptra.i18n';
import type { Lang } from '../landing.i18n';

/*
 * The business area (T0: apart from the customer's), for a store (COMPRA) and a
 * brand (PRÉMIO) — the same creator account, one reputation (H32, P1, P2).
 *
 *   /business              the orders to ship, with their addresses (10.2), and every store action
 *   /business/offers       publish an offer with its description (7, T4), share its link (T5)
 *   /business/obligations  prize obligations and their vouchers, and voucher campaigns (11, 12.4)
 *   /store/orders/:id      one order, where the store's notice links (mail.ts)
 *
 * T21: built for the computer first — the console shows the orders as a table
 * with their deadlines and addresses side by side — and complete on a phone.
 */

type Section = 'orders' | 'offers' | 'obligations';

export function BusinessPage({ section = 'orders' }: { section?: Section }) {
  const { id } = useParams();
  const { t } = useKeptraCopy();
  useEffect(() => {
    document.title = t.business.metaTitle;
  }, [t]);
  const title = { orders: t.business.ordersTitle, offers: t.business.offersTitle, obligations: t.business.obligationsTitle }[section];
  return (
    <KeptraShell area="business">
      <PageTitle eyebrow={t.business.eyebrow} title={id ? fill(t.business.orderTitle, { id }) : title} />
      {!keptraConfigured() ? (
        <NotAvailable />
      ) : (
        <RequireAccount intro={t.business.intro}>
          {(status) => <BusinessBody section={section} status={status} focus={id ?? null} />}
        </RequireAccount>
      )}
    </KeptraShell>
  );
}

function BusinessBody({ section, status, focus }: { section: Section; status: AccountStatus; focus: string | null }) {
  const account = status.accounts.find((item) => item.role === 'CREATOR');
  if (account === undefined) return <Loading />;
  if (!account.configured || account.address === null) return <AccountSetup role="CREATOR" status={status} />;
  return (
    <div className="space-y-8">
      <BusinessHeader address={account.address} />
      {section === 'orders' && <OrdersSection focus={focus} />}
      {section === 'offers' && <OffersSection payout={account.address} />}
      {section === 'obligations' && <ObligationsSection status={status} />}
    </div>
  );
}

/** 2.2.6, 13, T15: authorised or not, the tier, and any debt to the pool (H24). */
function BusinessHeader({ address }: { address: `0x${string}` }) {
  const reads = useReadContracts({
    contracts: [
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'isStore', args: [address] },
      { address: KEPTRA_GUARANTEE, abi: GUARANTEE_READ_ABI, functionName: 'totalDebtOf', args: [address] },
    ],
  });
  const tier = useTier(address);
  const { t, lang } = useKeptraCopy();
  const [isStore, debt] = reads.data ?? [];
  const authorised = isStore?.status === 'success' ? (isStore.result as boolean) : null;
  // V3: what the chain did not give is "Not read", with the way to read it again.
  const failed = chainFailed(reads) || tier.failed;
  const pending = failed ? t.ui.notRead : '…';
  const [authoriseBefore, authoriseAfter] = around(t.business.notAuthorisedBody, 'address');
  return (
    <Card>
      <dl className="grid grid-cols-2 gap-6 md:grid-cols-4">
        <Stat label={t.business.account} value={<AddressLink address={address} />} />
        <Stat
          label={t.business.tier}
          value={tier.tier === null ? pending : t.tiers[tier.tier]}
          hint={tier.delivered === null ? undefined : fill(t.business.verifiedDeliveries, { n: tier.delivered })}
        />
        <Stat label={t.business.failures} value={tier.materialFailures ?? pending} />
        <Stat label={t.business.debt} value={debt?.status === 'success' ? formatUsdc(debt.result as bigint, lang) : pending} />
      </dl>
      {failed && (
        <div className="mt-5">
          <ReadError
            what={t.what.businessRecord}
            error={CHAIN_FAILED}
            onRetry={() => {
              void reads.refetch();
              if (tier.failed) tier.retry();
            }}
          />
        </div>
      )}
      {authorised === false && (
        <div className="mt-5">
          <Notice tone="warning" title={t.business.notAuthorisedTitle}>
            {authoriseBefore}
            <span className="break-all font-mono">{address}</span>
            {authoriseAfter}
          </Notice>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// orders — T4, 9.1.1, 9.2, 9.3, 9.4, T12
// ---------------------------------------------------------------------------

function OrdersSection({ focus }: { focus: string | null }) {
  const listed = useBridgeRead(storeOrders, []);
  const { t, lang } = useKeptraCopy();
  if (listed.read.status === 'failed') return <ReadError what={t.what.yourOrders} error={listed.read.error} onRetry={listed.retry} />;
  if (listed.read.status === 'loading') return <Loading label={t.business.loadingOrders} />;
  const load = listed.reload;
  const orders = listed.read.value.orders;
  const shown = focus === null ? orders : orders.filter((order) => order.orderId === focus);
  if (shown.length === 0) return <Empty title={focus === null ? t.business.noOrders : t.business.notYours}>{focus === null && <p>{t.business.appearsLater}</p>}</Empty>;
  const open = shown.filter((order) => order.state !== OrderState.CLOSED);
  const closed = shown.filter((order) => order.state === OrderState.CLOSED);
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle aside={<span className="font-mono text-sm text-gray-400">{open.length}</span>}>{t.business.open}</SectionTitle>
        {open.length === 0 ? <Empty title={t.business.nothingToFulfil} /> : <div className="space-y-4">{open.map((order) => <StoreOrderCard key={order.orderId} order={order} onChange={load} />)}</div>}
      </section>
      {closed.length > 0 && (
        <section>
          <SectionTitle>{t.business.finished}</SectionTitle>
          <ul className="divide-y divide-dark-border rounded-2xl border border-dark-border bg-dark-card">
            {closed.map((order) => (
              <li key={order.orderId} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span className="font-mono text-white">#{order.orderId}</span>
                <span className="text-gray-300">{orderStatusText(order, lang)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The store's own steps, named in the dictionary (business.storeActions). */
type StoreStep = Exclude<StoreAction, 'evidence' | 'tracking' | 'submitCode' | 'refund'>;

function StoreOrderCard({ order, onChange }: { order: StoreOrder; onChange: () => void }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // P6-17: `at` is the order as it was when the answer came, so an error the order has since outgrown is not shown.
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string; at?: string; txHash?: string } | null>(null);
  const now = Math.floor(Date.now() / 1000);
  const at = `${order.state}:${order.trackingRegistered}`;
  // P6-17: an answer lost on the way, and the order read again shows the step done —
  // the page says it is done, never "done" and the error side by side.
  // A signed step the chain confirmed is shown as done on-chain, with its transaction; then no second notice.
  const done = message?.tone === 'success' && message.txHash ? { text: message.text, txHash: message.txHash } : null;
  const shown = message?.tone === 'error' && message.at !== undefined && message.at !== at ? { tone: 'success' as const, text: t.business.lostAnswer } : done ? null : message;
  // V1 (A1): whether the number is registered is the bridge's answer (store/orders), not this page's memory —
  // so the store declares the shipment in another session, after a reload, from the notice's link, or after a lost answer.
  const actions = storeActions(order, now, order.trackingRegistered);

  const run = async (label: string, work: () => Promise<{ ok: boolean; text?: string; txHash?: string }>) => {
    setBusy(label);
    setMessage(null);
    const result = await work();
    setBusy(null);
    setMessage(result.ok ? { tone: 'success', text: result.text ?? t.business.done, txHash: result.txHash } : { tone: 'error', text: result.text ?? t.business.failed, at });
    // P6-17: read the order again either way — a step whose answer was lost shows up as done.
    onChange();
  };
  const relayed = (body: Record<string, unknown> & { kind: string }) => async () => {
    const outcome = await relay(body);
    if (outcome.status === 'done')
      return outcome.result.status === 'CONFIRMED'
        ? { ok: true, text: t.business.doneOnChain, txHash: outcome.result.txHash }
        : { ok: true, text: t.business.sentConfirming };
    if (outcome.status === 'cancelled') return { ok: false, text: t.business.nothingSigned };
    return { ok: false, text: say(outcome.error) };
  };

  return (
    <Card as="article">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <div>
          <p className="font-mono text-sm text-gray-400">{fill(order.prize ? t.business.orderPrizeLabel : t.business.orderLabel, { id: order.orderId })}</p>
          <p className="mt-1 text-base text-white">{orderStatusText(order, lang)}</p>
          <p className="mt-3 text-xs text-gray-400">
            {order.state === OrderState.PAID
              ? fill(t.business.shipBy, { date: formatUtc(order.shipBy, lang) })
              : order.deliverBy
                ? fill(t.business.deliverBy, { date: formatUtc(order.deliverBy, lang) })
                : ''}
          </p>
          <p className="mt-1 text-xs text-gray-400">{order.mode === 'CARRIER' ? t.business.carrier : t.business.own}</p>
          {order.state === OrderState.PAID && order.trackingRegistered && <p className="mt-1 text-xs text-gray-300">{t.business.trackingRegistered}</p>}
        </div>
        <div className="text-sm">
          <p className="text-xs uppercase tracking-wider text-gray-400">{t.business.shipTo}</p>
          {order.address ? (
            <address className="mt-2 not-italic leading-relaxed text-gray-200">
              {order.address.name}
              <br />
              {order.address.street}
              <br />
              {order.address.postCode} {order.address.city}
              <br />
              {countryName(order.address.country, lang)}
              {order.address.phone && (
                <>
                  <br />
                  <span className="font-mono text-gray-400">{order.address.phone}</span>
                </>
              )}
            </address>
          ) : (
            <p className="mt-2 text-gray-400">{t.business.notRegistered}</p>
          )}
        </div>
        <div className="space-y-3">
          {actions.includes('tracking') && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run('tracking', async () => {
                  const result = await registerTracking(order.orderId, input);
                  // V1: the order is read again either way (run) — a registration whose answer was lost shows up as registered.
                  if (result.ok) setInput('');
                  return result.ok ? { ok: true, text: t.business.trackingDone } : { ok: false, text: say(result.error) };
                });
              }}
            >
              <Field id={`track-${order.orderId}`} label={t.business.trackingNumber}>
                <input id={`track-${order.orderId}`} className={`${inputClass} font-mono`} value={input} onChange={(event) => setInput(event.target.value)} />
              </Field>
              <Button type="submit" tone="secondary" busy={busy === 'tracking'}>
                <Truck className="h-4 w-4" aria-hidden="true" /> {t.business.registerTracking}
              </Button>
            </form>
          )}
          {actions.includes('submitCode') && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const code = normalizeDeliveryCode(input);
                if (code === null) return setMessage({ tone: 'error', text: t.business.codeFormat });
                void run('submitCode', relayed({ kind: 'submitCode', orderId: order.orderId, code: codeToBytes32(code) }));
              }}
            >
              <Field id={`code-${order.orderId}`} label={t.business.buyerCode} hint={t.business.buyerCodeHint}>
                <input id={`code-${order.orderId}`} autoCapitalize="characters" className={`${inputClass} font-mono uppercase tracking-wider`} value={input} onChange={(event) => setInput(event.target.value)} />
              </Field>
              <Button type="submit" busy={busy === 'submitCode'}>
                {t.business.submitCode}
              </Button>
            </form>
          )}
          <div className="flex flex-wrap gap-2">
            {(['ship', 'declareDelivered', 'declareRefusal'] as const satisfies readonly StoreStep[])
              .filter((kind) => actions.includes(kind))
              .map((kind) => (
                <Button key={kind} tone={kind === 'ship' ? 'primary' : 'secondary'} busy={busy === kind} onClick={() => void run(kind, relayed({ kind, orderId: order.orderId }))}>
                  {t.business.storeActions[kind]}
                </Button>
              ))}
          </div>
          {actions.includes('refund') && <RefundForm orderId={order.orderId} run={(amount) => run('refund', relayed({ kind: 'refund', orderId: order.orderId, amount }))} busy={busy === 'refund'} />}
          {done && <DoneOnChain text={done.text} txHash={done.txHash} />}
          {shown && <Notice tone={shown.tone}>{shown.text}</Notice>}
        </div>
      </div>
      {actions.includes('evidence') && (
        <div className="mt-6">
          <EvidencePanel orderId={order.orderId} party="STORE" />
        </div>
      )}
    </Card>
  );
}

/** T12: a voluntary refund, up to the whole amount — the relay checks the ceiling. */
function RefundForm({ orderId, run, busy }: { orderId: string; run: (amount: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { t, lang } = useKeptraCopy();
  if (!open) return <Button tone="quiet" onClick={() => setOpen(true)}>{t.business.refundOpen}</Button>;
  return (
    <form
      className="space-y-2 rounded-xl border border-dark-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const value = parseUsdc(amount, lang);
        if (value === null || value === 0n) return setError(t.business.refundAmountNeeded);
        setError(null);
        run(value.toString());
      }}
    >
      <Field id={`refund-${orderId}`} label={t.business.refundLabel} error={error}>
        <input id={`refund-${orderId}`} inputMode="decimal" className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} />
      </Field>
      <Button type="submit" tone="danger" busy={busy}>
        {t.business.refundReview}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// offers — section 7, T4, T5
// ---------------------------------------------------------------------------

/** Section 7's ceilings, read from the escrow — the form's limits are the contract's. */
function useCeilings() {
  const reads = useReadContracts({
    contracts: [
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'MAX_REFUSAL_BPS' },
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'MAX_SHIP_DAYS' },
      { address: KEPTRA_ESCROW, abi: ESCROW_READ_ABI, functionName: 'MAX_DELIVERY_DAYS' },
    ],
  });
  const [refusal, ship, delivery] = reads.data ?? [];
  return {
    failed: chainFailed(reads),
    retry: () => void reads.refetch(),
    maxRefusalBps: refusal?.status === 'success' ? Number(refusal.result) : null,
    maxShipDays: ship?.status === 'success' ? Number(ship.result) : null,
    maxDeliveryDays: delivery?.status === 'success' ? Number(delivery.result) : null,
  };
}

interface ConditionsDraft {
  title: string;
  text: string;
  price: string;
  shipping: string;
  returnCost: string;
  refusalPercent: string;
  shipDays: string;
  deliveryDays: string;
  mode: 'CARRIER' | 'OWN_MEANS';
  regions: string;
  units: string;
}

const EMPTY_DRAFT: ConditionsDraft = { title: '', text: '', price: '', shipping: '', returnCost: '0', refusalPercent: '0', shipDays: '3', deliveryDays: '7', mode: 'CARRIER', regions: '', units: '1' };

/**
 * The draft as the relay's body, or the first thing wrong with it, in the page's
 * language. The relay checks every ceiling again. In Portuguese and Spanish a
 * decimal is written with a comma (parseUsdc, and the refusal percentage).
 */
function conditionsBody(
  draft: ConditionsDraft,
  kind: 'offer' | 'obligation',
  ceilings: ReturnType<typeof useCeilings>,
  t: KeptraCopy,
  lang: Lang,
): { body: Record<string, unknown> } | { error: string } {
  const description = checkDescription({ title: draft.title, text: draft.text });
  if (!description.ok) return { error: description.field === 'title' ? t.business.titleMissing : t.business.describe };
  const price = parseUsdc(draft.price, lang);
  const shipping = parseUsdc(draft.shipping, lang);
  const returnCost = parseUsdc(draft.returnCost || '0', lang);
  if (price === null || price === 0n) return { error: kind === 'offer' ? t.business.priceMissing : t.business.valueMissing };
  if (shipping === null) return { error: t.business.shippingMissing };
  if (returnCost === null || returnCost > shipping) return { error: t.business.returnTooHigh };
  const percent = lang === 'en' ? draft.refusalPercent || '0' : (draft.refusalPercent || '0').replace(',', '.');
  const refusalBps = Math.round(Number(percent) * 100);
  if (kind === 'offer' && (!Number.isFinite(refusalBps) || refusalBps < 0 || (ceilings.maxRefusalBps !== null && refusalBps > ceilings.maxRefusalBps))) {
    return { error: fill(t.business.refusalRange, { max: formatNumber((ceilings.maxRefusalBps ?? 0) / 100, lang) }) };
  }
  const shipDays = Number(draft.shipDays);
  const deliveryDays = Number(draft.deliveryDays);
  if (!Number.isInteger(shipDays) || shipDays < 1 || (ceilings.maxShipDays !== null && shipDays > ceilings.maxShipDays)) return { error: fill(t.business.shipsRange, { max: ceilings.maxShipDays ?? '…' }) };
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || (ceilings.maxDeliveryDays !== null && deliveryDays > ceilings.maxDeliveryDays)) {
    return { error: fill(t.business.arrivesRange, { max: ceilings.maxDeliveryDays ?? '…' }) };
  }
  const regions = draft.regions.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (regions.length === 0 || !regions.every((code) => /^[A-Z]{2}$/.test(code)) || new Set(regions).size !== regions.length) return { error: t.business.regionsFormat };
  const body: Record<string, unknown> = {
    price: price.toString(),
    shipping: shipping.toString(),
    returnCost: returnCost.toString(),
    shipDays,
    deliveryDays,
    mode: draft.mode,
    regions,
  };
  if (kind === 'offer') body.refusalFeeBps = refusalBps;
  else {
    const units = Number(draft.units);
    if (!Number.isInteger(units) || units < 1 || units > 1000) return { error: t.business.unitsRange };
    body.units = units;
  }
  return { body };
}

function ConditionsForm({ kind, draft, setDraft }: { kind: 'offer' | 'obligation'; draft: ConditionsDraft; setDraft: (draft: ConditionsDraft) => void }) {
  const ceilings = useCeilings();
  const { t, lang } = useKeptraCopy();
  const set = (key: keyof ConditionsDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setDraft({ ...draft, [key]: event.target.value });
  const id = (name: string) => `${kind}-${name}`;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="md:col-span-2 xl:col-span-4">
        <Field id={id('title')} label={t.business.productTitle} hint={fill(t.business.productTitleHint, { max: DESCRIPTION_TITLE_MAX })}>
          <input id={id('title')} maxLength={DESCRIPTION_TITLE_MAX} className={inputClass} value={draft.title} onChange={set('title')} />
        </Field>
      </div>
      <div className="md:col-span-2 xl:col-span-4">
        <Field id={id('text')} label={t.business.productText} hint={fill(t.business.productTextHint, { max: DESCRIPTION_TEXT_MAX })}>
          <textarea id={id('text')} maxLength={DESCRIPTION_TEXT_MAX} rows={5} className="w-full rounded-xl border border-dark-border bg-dark-input p-3 text-white" value={draft.text} onChange={set('text')} />
        </Field>
      </div>
      <Field id={id('price')} label={kind === 'offer' ? t.business.priceLabel : t.business.declaredLabel}>
        <input id={id('price')} inputMode="decimal" className={`${inputClass} font-mono`} value={draft.price} onChange={set('price')} />
      </Field>
      <Field id={id('shipping')} label={t.business.shippingLabel}>
        <input id={id('shipping')} inputMode="decimal" className={`${inputClass} font-mono`} value={draft.shipping} onChange={set('shipping')} />
      </Field>
      <Field id={id('return')} label={t.business.returnLabel} hint={t.business.returnHint}>
        <input id={id('return')} inputMode="decimal" className={`${inputClass} font-mono`} value={draft.returnCost} onChange={set('returnCost')} />
      </Field>
      {kind === 'offer' ? (
        <Field id={id('refusal')} label={t.business.refusalLabel} hint={ceilings.maxRefusalBps === null ? undefined : fill(t.business.refusalHint, { max: formatNumber(ceilings.maxRefusalBps / 100, lang) })}>
          <input id={id('refusal')} inputMode="decimal" className={`${inputClass} font-mono`} value={draft.refusalPercent} onChange={set('refusalPercent')} />
        </Field>
      ) : (
        <Field id={id('units')} label={t.business.unitsLabel} hint={t.business.unitsHint}>
          <input id={id('units')} inputMode="numeric" className={`${inputClass} font-mono`} value={draft.units} onChange={set('units')} />
        </Field>
      )}
      <Field id={id('ship')} label={t.business.shipLabel} hint={ceilings.maxShipDays === null ? undefined : fill(t.business.shipHint, { max: ceilings.maxShipDays })}>
        <input id={id('ship')} inputMode="numeric" className={`${inputClass} font-mono`} value={draft.shipDays} onChange={set('shipDays')} />
      </Field>
      <Field id={id('delivery')} label={t.business.deliveryLabel} hint={ceilings.maxDeliveryDays === null ? undefined : fill(t.business.deliveryHint, { max: ceilings.maxDeliveryDays })}>
        <input id={id('delivery')} inputMode="numeric" className={`${inputClass} font-mono`} value={draft.deliveryDays} onChange={set('deliveryDays')} />
      </Field>
      <Field id={id('mode')} label={t.business.modeLabel}>
        <select id={id('mode')} className={inputClass} value={draft.mode} onChange={set('mode')}>
          <option value="CARRIER">{t.business.modeCarrier}</option>
          <option value="OWN_MEANS">{t.business.modeOwn}</option>
        </select>
      </Field>
      <Field id={id('regions')} label={t.business.regionsLabel} hint={t.business.regionsHint}>
        <input id={id('regions')} className={`${inputClass} font-mono uppercase`} value={draft.regions} onChange={set('regions')} />
      </Field>
    </div>
  );
}

function OffersSection({ payout }: { payout: `0x${string}` }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const ceilings = useCeilings();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: React.ReactNode } | null>(null);
  // V5 (B9): an offer that exists without its description — the page offers only to write that one.
  const [unwritten, setUnwritten] = useState<Unwritten | null>(null);
  const listed = useBridgeRead(myOffers, []);
  const load = listed.reload;
  // P6-14: after a reload the list still names an offer without its description.
  const pending = unwritten ?? undescribedOf(listed.read, 'offer', draft, t.business.writeAgain);

  const published = (termsId: string) => {
    setUnwritten(null);
    setDraft(EMPTY_DRAFT);
    const [before, after] = around(fill(t.business.published, { id: termsId }), 'link');
    setMessage({
      tone: 'success',
      text: (
        <>
          {before}
          <ShareLink path={`/offers/${termsId}`} />
          {after}
        </>
      ),
    });
    load();
  };

  const publish = async () => {
    const built = conditionsBody(draft, 'offer', ceilings, t, lang);
    if ('error' in built) return setMessage({ tone: 'error', text: built.error });
    setBusy(true);
    setMessage(null);
    const outcome = await relay({ kind: 'createOffer', payout, ...built.body });
    if (outcome.status !== 'done') {
      setBusy(false);
      return setMessage(outcome.status === 'refused' ? { tone: 'error', text: say(outcome.error) } : null);
    }
    const termsId = outcome.result.termsId;
    setBusy(false);
    if (termsId === null) {
      // Sent, but its receipt did not come back yet: the offer's number is not known, so it cannot be described here.
      setUnwritten({ termsId: null, title: draft.title, text: draft.text, error: t.business.offerConfirming });
      return;
    }
    // T4: the description, written once, right after the offer exists (T5 gave its id).
    const written = await writeDescription({ termsId, title: draft.title, text: draft.text });
    if (written.ok) return published(termsId);
    setUnwritten({ termsId, title: draft.title, text: draft.text, error: say(written.error) });
  };

  return (
    <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <SectionTitle>
          <span className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-gray-300" aria-hidden="true" /> {t.business.newOffer}
          </span>
        </SectionTitle>
        <p className="mb-5 text-sm text-gray-400">{fill(t.business.offerIntro, { address: payout.slice(0, 6) })}</p>
        {ceilings.failed && (
          <div className="mb-5">
            <ReadError what={t.what.escrowLimits} error={CHAIN_FAILED} onRetry={ceilings.retry} />
          </div>
        )}
        <ConditionsForm kind="offer" draft={draft} setDraft={setDraft} />
        {message && <div className="mt-5"><Notice tone={message.tone}>{message.text}</Notice></div>}
        {pending ? (
          <div className="mt-5">
            <DescriptionRetry what="Offer" unwritten={pending} onWritten={published} />
          </div>
        ) : listed.read.status === 'ready' ? (
          <Button className="mt-5" busy={busy} onClick={() => void publish()}>
            {t.business.publish}
          </Button>
        ) : (
          // AB4: until the list is read, the page cannot know no offer is waiting for its description.
          <p className="mt-5 text-sm text-gray-400">{listed.read.status === 'failed' ? t.business.publishAfterRead : t.business.readingOffers}</p>
        )}
      </Card>
      <section>
        <SectionTitle>{t.business.yourOffers}</SectionTitle>
        {listed.read.status === 'failed' ? (
          <ReadError what={t.what.yourOffers} error={listed.read.error} onRetry={listed.retry} />
        ) : listed.read.status === 'loading' ? (
          <Loading />
        ) : (
          <OfferList offers={listed.read.value.offers.filter((o) => o.obligationId === null)} onChange={load} />
        )}
      </section>
    </div>
  );
}

function OfferList({ offers, onChange }: { offers: readonly OfferListed[]; onChange: () => void }) {
  const { t } = useKeptraCopy();
  if (offers.length === 0) return <Empty title={t.business.noOffer} />;
  return <ul className="space-y-3">{offers.map((offer) => <OfferRow key={offer.termsId} offer={offer} onChange={onChange} />)}</ul>;
}

/**
 * P6-14: the newest offer (or obligation) the bridge lists without a description.
 * Its title and text are the ones in the form above, which the store writes again;
 * `writeAgain` says so, in the page's language.
 */
function undescribedOf(
  read: Read<{ readonly offers: readonly OfferListed[] }>,
  kind: 'offer' | 'obligation',
  draft: { title: string; text: string },
  writeAgain: string,
): Unwritten | null {
  if (read.status !== 'ready') return null;
  const found = read.value.offers.find((o) => o.title === null && (o.obligationId === null) === (kind === 'offer'));
  if (!found) return null;
  return {
    termsId: found.termsId,
    ...(found.obligationId !== null ? { obligationId: found.obligationId } : {}),
    title: draft.title,
    text: draft.text,
    error: writeAgain,
  };
}

/** V5 (B9): what was created and still lacks its description; `termsId` null while its receipt has not come back. */
interface Unwritten {
  readonly termsId: string | null;
  readonly obligationId?: string;
  readonly title: string;
  readonly text: string;
  readonly error: string;
}

/**
 * V5 (B9): the offer or the obligation exists, its description does not. The page
 * shows why, and offers one thing: write the description of that one — never create
 * another (a second obligation would take a second bond). A write refused because
 * one is already there (an answer lost on the way) counts once the bridge shows it.
 */
function DescriptionRetry({ what, unwritten, onWritten }: { what: 'Offer' | 'Obligation'; unwritten: Unwritten; onWritten: (termsId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(unwritten.error);
  const { t, say } = useKeptraCopy();
  const offer = what === 'Offer';
  const id = offer ? unwritten.termsId : (unwritten.obligationId ?? null);
  if (unwritten.termsId === null) {
    return (
      <Notice tone="warning" title={offer ? t.business.offerUnknown : t.business.obligationUnknown}>
        <p>{fill(t.business.unknownBody, { error })}</p>
      </Notice>
    );
  }
  const termsId = unwritten.termsId;
  const save = async () => {
    setBusy(true);
    const written = await writeDescription({ termsId, ...(unwritten.obligationId ? { obligationId: unwritten.obligationId } : {}), title: unwritten.title, text: unwritten.text });
    const there = written.ok || (written.status === 409 && (await offerDescription(termsId)).ok);
    setBusy(false);
    if (there) onWritten(termsId);
    else if (!written.ok) setError(say(written.error));
  };
  return (
    <Notice tone="error" title={fill(offer ? t.business.offerCreated : t.business.obligationCreated, { id: id ?? '' })}>
      <p>{error}</p>
      <p className="mt-1">
        {offer ? t.business.offerNeedsIt : t.business.obligationNeedsIt} {t.business.nothingNew}
      </p>
      <Button className="mt-3" busy={busy} onClick={() => void save()}>
        {fill(offer ? t.business.saveOffer : t.business.saveObligation, { id: id ?? '' })}
      </Button>
    </Notice>
  );
}

function ShareLink({ path }: { path: string }) {
  const url = `https://keptra.io${path}`;
  const { t } = useKeptraCopy();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link to={path} className="break-all font-mono underline underline-offset-4">
        {url}
      </Link>
      <button type="button" className="inline-flex min-h-[32px] items-center gap-1 text-xs text-gray-300 hover:text-white" onClick={() => void navigator.clipboard?.writeText(url)}>
        <Copy className="h-3.5 w-3.5" aria-hidden="true" /> {t.business.copy}
      </button>
    </span>
  );
}

function OfferRow({ offer, onChange }: { offer: OfferListed; onChange: () => void }) {
  const { relay } = useKeptra();
  const { terms, failed, retry } = useTerms(BigInt(offer.termsId));
  const [busy, setBusy] = useState(false);
  const { t, lang } = useKeptraCopy();
  return (
    <li className="rounded-2xl border border-dark-border bg-dark-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-gray-400">#{offer.termsId}</p>
          <p className="break-words font-semibold text-white">{offer.title ?? t.business.noDescriptionYet}</p>
          <p className="mt-1 font-mono text-sm text-white">{terms ? formatUsdc(terms.price, lang) : failed ? t.ui.notRead : '…'}</p>
        </div>
        {terms && <Badge tone={terms.active ? 'success' : 'neutral'}>{terms.active ? t.business.live : t.business.takenDown}</Badge>}
      </div>
      {failed && (
        <div className="mt-3">
          <ReadError what={t.what.itsConditions} error={CHAIN_FAILED} onRetry={retry} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <ShareLink path={`/offers/${offer.termsId}`} />
        {terms?.active && (
          <Button
            tone="quiet"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              await relay({ kind: 'deactivateOffer', termsId: offer.termsId });
              setBusy(false);
              onChange();
            }}
          >
            {t.business.takeDown}
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// obligations — 11, 12.4, 13.2, H11, AQ5, P1
// ---------------------------------------------------------------------------

function ObligationsSection({ status }: { status: AccountStatus }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const ceilings = useCeilings();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [unwritten, setUnwritten] = useState<Unwritten | null>(null);
  const listed = useBridgeRead(myOffers, []);
  const held = useBridgeRead(accountVouchers, []);
  const load = () => {
    listed.reload();
    held.reload();
  };
  const vouchers = held.read.status === 'ready' ? held.read.value.vouchers.filter((v) => v.role === 'CREATOR') : null;
  // P6-14: after a reload the list still names an obligation without its description.
  const pending = unwritten ?? undescribedOf(listed.read, 'obligation', draft, t.business.writeAgain);

  const create = async () => {
    const built = conditionsBody(draft, 'obligation', ceilings, t, lang);
    if ('error' in built) return setMessage({ tone: 'error', text: built.error });
    setBusy(true);
    setMessage(null);
    // T2: the bond and the protection fee are the bridge's figures, shown in the summary before the passkey.
    const outcome = await relay({ kind: 'createObligation', ...built.body });
    if (outcome.status !== 'done') {
      setBusy(false);
      return setMessage(outcome.status === 'refused' ? { tone: 'error', text: say(outcome.error) } : null);
    }
    const { termsId, obligationId, voucherIds } = outcome.result;
    const done = () => {
      setUnwritten(null);
      setDraft(EMPTY_DRAFT);
      setMessage({ tone: 'success', text: fill(voucherIds.length === 1 ? t.business.coveredOne : t.business.coveredMany, { id: obligationId ?? '', n: voucherIds.length }) });
    };
    if (termsId === null || obligationId === null) {
      setBusy(false);
      setUnwritten({ termsId: null, title: draft.title, text: draft.text, error: t.business.obligationConfirming });
      load();
      return;
    }
    const written = await writeDescription({ termsId, obligationId, title: draft.title, text: draft.text });
    setBusy(false);
    // V5 (B9): without its description the page offers to write that one, never to create another (a second bond).
    if (written.ok) done();
    else setUnwritten({ termsId, obligationId, title: draft.title, text: draft.text, error: say(written.error) });
    load();
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-8 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionTitle>{t.business.newObligation}</SectionTitle>
          <p className="mb-5 text-sm text-gray-400">{t.business.obligationIntro}</p>
          {ceilings.failed && (
            <div className="mb-5">
              <ReadError what={t.what.escrowLimits} error={CHAIN_FAILED} onRetry={ceilings.retry} />
            </div>
          )}
          <ConditionsForm kind="obligation" draft={draft} setDraft={setDraft} />
          {message && <div className="mt-5"><Notice tone={message.tone}>{message.text}</Notice></div>}
          {pending ? (
            <div className="mt-5">
              <DescriptionRetry
                what="Obligation"
                unwritten={pending}
                onWritten={() => {
                  setUnwritten(null);
                  setDraft(EMPTY_DRAFT);
                  setMessage({ tone: 'success', text: fill(t.business.coveredDescribed, { id: pending.obligationId ?? '' }) });
                  load();
                }}
              />
            </div>
          ) : listed.read.status === 'ready' ? (
            <Button className="mt-5" busy={busy} onClick={() => void create()}>
              {t.business.create}
            </Button>
          ) : (
            // AB4: until the list is read, the page cannot know no obligation is waiting for its description.
            <p className="mt-5 text-sm text-gray-400">{listed.read.status === 'failed' ? t.business.createAfterRead : t.business.readingObligations}</p>
          )}
        </Card>
        <section>
          <SectionTitle>{t.business.yourObligations}</SectionTitle>
          {listed.read.status === 'failed' ? (
            <ReadError what={t.what.yourObligations} error={listed.read.error} onRetry={listed.retry} />
          ) : listed.read.status === 'loading' ? (
            <Loading />
          ) : (
            <ObligationList offers={listed.read.value.offers.filter((o) => o.obligationId !== null)} vouchers={vouchers} />
          )}
        </section>
      </div>
      {held.read.status === 'failed' ? (
        <ReadError what={t.what.yourVouchers} error={held.read.error} onRetry={held.retry} />
      ) : vouchers === null ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          {held.read.status === 'ready' && !held.read.value.complete && <Notice tone="warning">{t.ui.vouchersIncomplete}</Notice>}
          <VoucherCampaign vouchers={vouchers} phoneVerified={status.phoneVerified} onCreated={load} />
        </div>
      )}
    </div>
  );
}

/**
 * P6-12: each obligation with its bond, its coverage and its state, read from the
 * guarantee (getObligation) — per unit, and how many of its units are still open.
 * A read that failed says "Not read", never a figure.
 */
function ObligationList({ offers, vouchers }: { offers: readonly OfferListed[]; vouchers: readonly VoucherHeld[] | null }) {
  const read = useReadContracts({
    contracts: offers.map((offer) => ({ address: KEPTRA_GUARANTEE, abi: KEPTRA_GUARANTEE_ABI, functionName: 'getObligation', args: [BigInt(offer.obligationId ?? '0')] })),
    query: { enabled: offers.length > 0 },
  });
  const { t, lang } = useKeptraCopy();
  if (offers.length === 0) return <Empty title={t.business.noObligation} />;
  return (
    <ul className="space-y-3">
      {offers.map((offer, index) => {
        const item = read.data?.[index];
        const o = item?.status === 'success' ? (item.result as unknown as { units: number; openUnits: number; bond: bigint; coverage: bigint }) : null;
        const shown = (value: (o: { units: number; openUnits: number; bond: bigint; coverage: bigint }) => string) =>
          o !== null ? value(o) : item?.status === 'failure' || read.isError ? t.ui.notRead : '…';
        return (
          <li key={offer.termsId} className="rounded-2xl border border-dark-border bg-dark-card p-4">
            <p className="font-mono text-xs text-gray-400">{fill(t.business.obligationNumber, { id: offer.obligationId ?? '' })}</p>
            <p className="break-words font-semibold text-white">{offer.title ?? t.business.noDescriptionYet}</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Stat label={t.business.bondPerUnit} value={shown((x) => formatUsdc(x.bond, lang))} />
              <Stat label={t.business.coveragePerUnit} value={shown((x) => formatUsdc(x.coverage, lang))} />
              <Stat
                label={t.business.state}
                value={shown((x) =>
                  x.openUnits === 0
                    ? fill(x.units === 1 ? t.business.settledOne : t.business.settledMany, { n: x.units })
                    : fill(x.units === 1 ? t.business.openOne : t.business.openMany, { open: x.openUnits, n: x.units }),
                )}
              />
            </dl>
            {vouchers !== null && (
              <p className="mt-2 text-xs text-gray-400">{fill(t.business.vouchersInAccount, { n: vouchers.filter((v) => v.obligationId === offer.obligationId).length })}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** P1, AQ5, H9: up to 20 loose vouchers of one obligation into an Event Center campaign; needs a verified phone. */
function VoucherCampaign({ vouchers, phoneVerified, onCreated }: { vouchers: readonly VoucherHeld[]; phoneVerified: boolean; onCreated: () => void }) {
  const { relay } = useKeptra();
  const { t, say } = useKeptraCopy();
  const loose = useMemo(() => vouchers.filter((v) => v.giveawayId === null && v.claimedAt === null), [vouchers]);
  const [selected, setSelected] = useState<string[]>([]);
  const [days, setDays] = useState('7');
  const [slots, setSlots] = useState('100');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: React.ReactNode } | null>(null);

  const obligationOf = selected.length > 0 ? loose.find((v) => v.voucherId === selected[0])?.obligationId : null;
  const toggle = (voucher: VoucherHeld) =>
    setSelected((current) =>
      current.includes(voucher.voucherId)
        ? current.filter((id) => id !== voucher.voucherId)
        : obligationOf && voucher.obligationId !== obligationOf
          ? current
          : current.length >= 20
            ? current
            : [...current, voucher.voucherId],
    );

  const create = async () => {
    const duration = Number(days) * 86_400;
    const slotCap = Number(slots);
    if (selected.length === 0) return setMessage({ tone: 'error', text: t.business.chooseVouchers });
    if (!Number.isInteger(Number(days)) || Number(days) < 1) return setMessage({ tone: 'error', text: t.business.minDay });
    if (!Number.isInteger(slotCap) || slotCap < 1) return setMessage({ tone: 'error', text: t.business.slotsNeeded });
    setBusy(true);
    setMessage(null);
    const outcome = await relay({ kind: 'createVoucherCampaign', obligationId: obligationOf, voucherIds: selected, durationSeconds: duration, slotCap });
    setBusy(false);
    if (outcome.status === 'refused') return setMessage({ tone: 'error', text: say(outcome.error) });
    if (outcome.status === 'done') {
      setSelected([]);
      setMessage({
        tone: 'success',
        text: outcome.result.giveawayId ? (
          <>
            {t.business.created}{' '}
            <Link className="underline underline-offset-4" to={`/events/${outcome.result.giveawayId}`}>
              {fill(t.business.openCampaign, { id: outcome.result.giveawayId })} <ExternalLink className="inline h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        ) : (
          t.business.campaignConfirming
        ),
      });
      onCreated();
    }
  };

  return (
    <Card>
      <SectionTitle>{t.business.campaignTitle}</SectionTitle>
      {!phoneVerified && (
        <div className="mb-4">
          <Notice tone="warning">{t.business.phoneNeeded}</Notice>
        </div>
      )}
      {loose.length === 0 ? (
        <Empty title={t.business.noneToPlace}>
          <p>{t.business.noneBody}</p>
        </Empty>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-400">{t.business.campaignRules}</p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {loose.map((voucher) => {
              const on = selected.includes(voucher.voucherId);
              return (
                <li key={voucher.voucherId}>
                  <label className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-control border p-3 text-sm ${on ? 'border-gray-300 bg-white/[0.05]' : 'border-dark-border'}`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(voucher)} className="h-4 w-4 accent-amber-500" />
                    <span className="font-mono">#{voucher.voucherId}</span>
                    <span className="text-xs text-gray-400">{fill(t.business.obligationTag, { id: voucher.obligationId })}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="camp-days" label={t.business.runsFor}>
              <input id="camp-days" inputMode="numeric" className={`${inputClass} font-mono`} value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
            <Field id="camp-slots" label={t.business.entries}>
              <input id="camp-slots" inputMode="numeric" className={`${inputClass} font-mono`} value={slots} onChange={(event) => setSlots(event.target.value)} />
            </Field>
          </div>
          {message && <div className="mt-5"><Notice tone={message.tone}>{message.text}</Notice></div>}
          {/* One amber button per screen: on this one it is the new obligation's. */}
          <Button tone="secondary" className="mt-5" busy={busy} disabled={!phoneVerified} onClick={() => void create()}>
            {t.business.createCampaign}
          </Button>
        </>
      )}
    </Card>
  );
}
