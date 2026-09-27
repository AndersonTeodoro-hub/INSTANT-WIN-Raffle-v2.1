import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { RequireAccount } from '../../components/keptra/SignIn';
import { QrCode } from '../../components/keptra/QrCode';
import { ProofSeal } from '../../components/Proof';
import { MoneyPath } from '../../components/proof/MoneyPath';
import { useFirstSight } from '../../components/proof/DrawReveal';
import { useBridgeRead, useDescription, useOrderOnChain, useTerms, type OrderRead } from '../../components/keptra/hooks';
import { AddressLink, Button, Card, DoneOnChain, Empty, Eyebrow, Facts, Loading, NotAvailable, Notice, ReadError } from '../../components/keptra/ui';
import { myOrders, orderEvidence, type Evidence } from '../../lib/keptra/api';
import { CHAIN_FAILED } from '../../lib/keptra/reads';
import { KEPTRA_ESCROW, keptraConfigured, OrderState } from '../../lib/keptra/contracts';
import { codeFor, groupCode } from '../../lib/keptra/deliveryCode';
import { formatUsdc, formatUtc, timeLeft } from '../../lib/keptra/format';
import { orderStatusText, recipientActions, type RecipientAction } from '../../lib/keptra/orders';
import { fill, useKeptraCopy } from '../keptra.i18n';

/** The 5 days the page and the offer state for confirming or contesting; only draws how much of the window has run. */
const WINDOW_SECONDS = 5 * 86_400;

/*
 * /orders/:id — one order, for the person who paid or redeemed it (8.1, 8.3, 9.2, P17).
 *
 * The state and the deadlines are the bridge's index and the chain's order; the
 * actions are the ones the contract accepts now (T2 cancel, T6 confirm, T9
 * contest), each signed with the passkey after its summary. An own-means order
 * shows its delivery code — from this device, checked against the order's
 * commitment — as text and as a QR carrying only the code (T6). The notices'
 * links land here (mail.ts: /orders/:id).
 */

export function OrderPage() {
  const { id } = useParams();
  const orderId = id && /^\d{1,30}$/.test(id) ? id : null;
  const { t } = useKeptraCopy();
  useEffect(() => {
    document.title = orderId ? fill(t.order.metaTitle, { id: orderId }) : t.order.metaTitleBare;
  }, [orderId, t]);
  return (
    <KeptraShell>
      {!keptraConfigured() ? (
        <NotAvailable />
      ) : orderId === null ? (
        <Empty title={t.order.badLink} />
      ) : (
        <RequireAccount intro={t.order.intro}>{() => <OrderBody orderId={orderId} />}</RequireAccount>
      )}
    </KeptraShell>
  );
}

function OrderBody({ orderId }: { orderId: string }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const listed = useBridgeRead(myOrders, []);
  const row = listed.read.status === 'ready' ? (listed.read.value.orders.find((order) => order.orderId === orderId) ?? null) : undefined;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string; txHash?: string } | null>(null);
  const chain = useOrderOnChain(BigInt(orderId));
  const terms = useTerms(row ? BigInt(row.termsId) : null);
  const describing = useDescription(row?.termsId ?? null);
  const { description } = describing;

  const code = useMemo(() => (chain.order ? codeFor(window.localStorage, chain.order.codeCommit) : null), [chain.order]);

  // V3: an order list that failed is an error, not "no order of yours".
  if (listed.read.status === 'failed') return <ReadError what={t.what.yourOrders} error={listed.read.error} onRetry={listed.retry} />;
  if (row === undefined) return <Loading label={t.order.loading} />;
  if (row === null) {
    return (
      <Empty title={t.order.notYours}>
        <p>
          {t.order.appearsLater}{' '}
          <Link to="/orders" className="underline underline-offset-4">
            {t.order.seeAll}
          </Link>
          .
        </p>
      </Empty>
    );
  }

  const now = Math.floor(Date.now() / 1000);
  // The chain's state is fresher than the index; the actions follow it.
  const facts = { ...row, state: chain.order?.state ?? row.state, flags: chain.order?.flags ?? row.flags };
  const actions = recipientActions(facts, now);

  const act = async (kind: Exclude<RecipientAction, 'evidence'>) => {
    setBusy(kind);
    setMessage(null);
    const outcome = await relay({ kind, orderId });
    setBusy(null);
    if (outcome.status === 'refused') setMessage({ tone: 'error', text: say(outcome.error) });
    if (outcome.status === 'done') {
      setMessage(
        outcome.result.status === 'CONFIRMED'
          ? { tone: 'success', text: t.order.done, txHash: outcome.result.txHash }
          : { tone: 'success', text: t.order.sent },
      );
      void chain.refetch();
      listed.reload();
    }
  };
  // What only the chain holds (the amount held, the quantity): read, still reading, or not read (V3).
  const onChain = (value: (order: OrderRead) => ReactNode) => (chain.order ? value(chain.order) : chain.failed ? t.ui.notRead : '…');

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <Eyebrow>{fill(row.prize ? t.order.eyebrowPrize : t.order.eyebrow, { id: orderId })}</Eyebrow>
          <h1 className="mt-3 break-words font-display text-4xl font-bold tracking-tight sm:text-5xl">{description?.title ?? t.order.untitled}</h1>
          <p className="mt-3 inline-flex items-center gap-2.5 text-lg text-gray-200">
            <OrderStateMark state={facts.state} />
            {orderStatusText(facts, lang)}
          </p>
        </div>

        {/* Delivered and closed, the proof done: where the money went. */}
        {facts.state === OrderState.CLOSED && !row.prize && <PaidPath orderId={orderId} outcome={row.outcome} payout={terms.terms?.payout ?? null} />}

        {/* The window is the normal course of an order, not an alarm: it only asks for attention in its last day. */}
        {facts.state === OrderState.WINDOW && row.windowEndsAt && (
          <Notice
            tone={Number(row.windowEndsAt) - now < 86_400 ? 'warning' : 'info'}
            title={fill(t.order.windowTitle, { when: timeLeft(row.windowEndsAt, now, lang), date: formatUtc(row.windowEndsAt, lang) })}
          >
            {(facts.flags & 2) !== 0 ? t.order.windowBodyRefusal : t.order.windowBody}
            {/* The window opening: how much of it has run, filled in when the page opens. */}
            <span aria-hidden="true" className="mt-4 block h-1 w-full overflow-hidden rounded-full bg-white/10">
              <span
                className="iw-meter block h-full rounded-full bg-white/80"
                style={{ transform: `scaleX(${Math.min(1, Math.max(0.02, 1 - (Number(row.windowEndsAt) - now) / WINDOW_SECONDS))})` }}
              />
            </span>
          </Notice>
        )}

        <Card>
          <h2 className="font-display text-2xl font-bold tracking-tight">{t.order.theOrder}</h2>
          <div className="mt-4">
            <Facts
              rows={[
                [t.order.heldInEscrow, onChain((order) => (row.prize ? t.order.prizeHeld : <span className="font-mono">{formatUsdc(order.paid, lang)}</span>))],
                [t.order.quantity, onChain((order) => String(order.quantity))],
                [t.order.delivery, row.mode === 'CARRIER' ? t.order.byCarrier : t.order.byStore],
                [t.order.shipsBy, formatUtc(row.shipBy, lang)],
                [t.order.arrivesBy, row.deliverBy ? formatUtc(row.deliverBy, lang) : t.order.fromShipping],
                [t.order.payoutAddress, terms.terms ? terms.terms.payout : terms.failed ? t.ui.notRead : '…'],
              ]}
            />
          </div>
          {(chain.failed || terms.failed) && (
            <div className="mt-4">
              <ReadError
                what={t.what.partOfOrder}
                error={CHAIN_FAILED}
                onRetry={() => {
                  if (chain.failed) void chain.refetch();
                  if (terms.failed) terms.retry();
                }}
              />
            </div>
          )}
          <p className="mt-4 text-xs text-gray-400">{t.order.keeperNote}</p>
        </Card>

        {(description || describing.failed) && (
          <Card>
            <h2 className="font-display text-2xl font-bold tracking-tight">{t.order.whatYouOrdered}</h2>
            {description ? (
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-gray-300">{description.text}</p>
            ) : (
              <div className="mt-3">
                <ReadError what={t.what.productDescription} error={describing.failed ?? ''} onRetry={describing.retry} />
              </div>
            )}
          </Card>
        )}

        {facts.state === OrderState.CONTESTED && <EvidencePanel orderId={orderId} />}
      </div>

      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        {row.mode === 'OWN_MEANS' && facts.state !== OrderState.CLOSED && (
          <Card>
            <h2 className="font-display text-2xl font-bold tracking-tight">{t.order.deliveryCode}</h2>
            {code ? (
              <div className="iw-reveal mt-4 flex flex-col items-center gap-4 text-center">
                <div className="rounded-lg shadow-[0_16px_40px_-20px_rgba(255,255,255,0.3)]">
                  <QrCode text={code} label={fill(t.order.qrLabel, { code: groupCode(code) })} />
                </div>
                <p className="w-full break-all rounded-control border border-dark-line bg-black/40 px-3 py-3 font-mono text-xl font-bold tracking-wider text-white">{groupCode(code)}</p>
                <p className="text-xs text-gray-400">{t.order.showIt}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-gray-400">{t.order.notOnDevice}</p>
            )}
          </Card>
        )}
        <Card>
          <h2 className="font-display text-2xl font-bold tracking-tight">{t.order.yourActions}</h2>
          {actions.filter((a) => a !== 'evidence').length === 0 ? (
            <p className="mt-3 text-sm text-gray-400">{t.order.nothingToDo}</p>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              {actions
                .filter((a): a is Exclude<RecipientAction, 'evidence'> => a !== 'evidence')
                .map((kind) => (
                  <Button key={kind} tone={kind === 'confirm' ? 'primary' : kind === 'contest' ? 'danger' : 'secondary'} busy={busy === kind} onClick={() => void act(kind)}>
                    {t.order.actions[kind]}
                  </Button>
                ))}
            </div>
          )}
          {message && (
            <div className="mt-4">
              {message.txHash ? <DoneOnChain text={message.text} txHash={message.txHash} /> : <Notice tone={message.tone}>{message.text}</Notice>}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

/**
 * A closed order's money, drawn as it moved, the first time this device sees it:
 * paid into the Keptra escrow and released to the store on a proven delivery, or
 * returned to the buyer by the contract's rule. Both ends link to the chain.
 */
function PaidPath({ orderId, outcome, payout }: { orderId: string; outcome: number | null; payout: `0x${string}` | null }) {
  const first = useFirstSight(`order-closed-${orderId}`);
  const { t } = useKeptraCopy();
  const toStore = outcome === 0;
  const toYou = outcome === 1 || outcome === 3 || outcome === 4;
  if (!toStore && !toYou) return null;
  const escrow = { label: t.order.escrow, detail: <AddressLink address={KEPTRA_ESCROW} /> };
  const nodes = toStore ? [{ label: t.order.you }, escrow, { label: t.order.store, detail: payout ? <AddressLink address={payout} /> : undefined }] : [escrow, { label: t.order.you }];
  return (
    <Card>
      <h2 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight">
        <ProofSeal className="h-5 w-5 text-success" />
        {toStore ? t.order.released : t.order.returned}
      </h2>
      <MoneyPath tone="proof" animate={first} nodes={nodes} className="mt-6" />
    </Card>
  );
}

/**
 * The order's state, marked as the rest of the platform marks it: a state the
 * chain is still running is live (green, pulsing); a closed order is a settled
 * fact (the seal); a contest waits on a person, so it stays neutral.
 */
function OrderStateMark({ state }: { state: number }) {
  if (state === OrderState.CLOSED) return <ProofSeal className="h-5 w-5 text-success" />;
  if (state === OrderState.CONTESTED) return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gray-300" />;
  return <span aria-hidden="true" className="iw-live" />;
}

/** P17 and AQ3: one text from each party, up to 2 000 characters, written once while the order is contested. */
export function EvidencePanel({ orderId, party = 'RECIPIENT' }: { orderId: string; party?: 'RECIPIENT' | 'STORE' }) {
  const read = useBridgeRead(() => orderEvidence(orderId), [orderId]);
  const { t, say } = useKeptraCopy();
  const [written, setWritten] = useState<Evidence | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evidence = written ?? (read.read.status === 'ready' ? read.read.value : null);
  const mine = party === 'RECIPIENT' ? evidence?.recipient : evidence?.store;
  const theirs = party === 'RECIPIENT' ? evidence?.store : evidence?.recipient;
  return (
    <Card>
      <h2 className="font-display text-2xl font-bold tracking-tight">{t.order.evidenceTitle}</h2>
      <p className="mt-2 text-sm text-gray-400">{t.order.evidenceBody}</p>
      {evidence === null && read.read.status === 'loading' && <Loading />}
      {evidence === null && read.read.status === 'failed' && <ReadError what={t.what.statements} error={read.read.error} onRetry={read.retry} />}
      {error && <Notice tone="error">{error}</Notice>}
      {evidence && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">{t.order.yourStatement}</p>
            {mine ? (
              <p className="mt-2 whitespace-pre-line rounded-xl border border-dark-border p-3 text-sm text-gray-200">{mine}</p>
            ) : (
              <form
                className="mt-2 space-y-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setBusy(true);
                  const result = await orderEvidence(orderId, text);
                  setBusy(false);
                  if (result.ok) setWritten(result);
                  else setError(say(result.error));
                }}
              >
                <label htmlFor="evidence" className="sr-only">
                  {t.order.yourStatement}
                </label>
                <textarea
                  id="evidence"
                  maxLength={2000}
                  rows={6}
                  className="w-full rounded-xl border border-dark-border bg-dark-input p-3 text-sm text-white"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-gray-400">{text.length} / 2000</span>
                  <Button type="submit" busy={busy} disabled={text.trim().length === 0}>
                    {t.order.sendStatement}
                  </Button>
                </div>
                <p className="text-xs text-gray-400">{t.order.final}</p>
              </form>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400">{party === 'RECIPIENT' ? t.order.storeStatement : t.order.buyerStatement}</p>
            <p className="mt-2 whitespace-pre-line rounded-xl border border-dark-border p-3 text-sm text-gray-300">{theirs ?? t.order.notWritten}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
