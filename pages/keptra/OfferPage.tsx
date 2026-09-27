import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PackageCheck, ShieldCheck, Undo2 } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { AddressForm } from '../../components/keptra/AddressForm';
import { useDescription, useTerms, useTier, useUsdcBalance } from '../../components/keptra/hooks';
import { AddressLink, Badge, Button, Card, Empty, Eyebrow, Facts, Loading, NotAvailable, Notice, ReadError } from '../../components/keptra/ui';
import { keptraConfigured } from '../../lib/keptra/contracts';
import { countryName, formatPercent, formatUsdc } from '../../lib/keptra/format';
import { generateDeliveryCode, keepCode } from '../../lib/keptra/deliveryCode';
import type { AccountStatus } from '../../lib/keptra/api';
import { CHAIN_FAILED } from '../../lib/keptra/reads';
import { fill, useKeptraCopy } from '../keptra.i18n';

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
  const { terms, regions, paused, loading, failed, retry } = useTerms(termsId);
  const describing = useDescription(termsId === null ? null : termsId.toString());
  const { description, missing } = describing;
  const tier = useTier(terms?.store ?? null);
  const { t, lang } = useKeptraCopy();

  useEffect(() => {
    document.title = description ? `${description.title} · Keptra` : t.offer.metaTitleBare;
  }, [description, t]);

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
        <Empty title={t.offer.badLink} />
      </KeptraShell>
    );
  }

  return (
    <KeptraShell>
      {(loading || describing.loading) && <Loading label={t.offer.reading} />}
      {/* V3: a read that failed says so; "no offer at this link" only when the chain said there is none. */}
      {!loading && failed && <ReadError what={t.what.thisOffer} error={CHAIN_FAILED} onRetry={retry} />}
      {!loading && !failed && (terms === null || terms.prize) && (
        <Empty title={t.offer.noOffer}>
          <p>{t.offer.noOfferBody}</p>
        </Empty>
      )}
      {!loading && !failed && terms !== null && !terms.prize && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 space-y-8">
            <div>
              <Eyebrow>{fill(t.offer.eyebrow, { id: termsId.toString() })}</Eyebrow>
              <h1 className="mt-3 break-words font-display text-4xl font-bold tracking-tight sm:text-5xl">{description?.title ?? t.offer.untitled}</h1>
              <p className="mt-5 font-mono text-4xl font-bold text-white tabular-nums sm:text-5xl">{formatUsdc(terms.price, lang)}</p>
              {!terms.active && (
                <div className="mt-4">
                  <Notice tone="warning">{t.offer.takenDown}</Notice>
                </div>
              )}
            </div>

            {/*
              How the money is protected, right under the price it protects: the
              three steps it follows, on one rail that fills once when the offer
              opens (the value arriving at each step in turn).
            */}
            <section aria-labelledby="protection" className="iw-surface-raised p-5 sm:p-7">
              <h2 id="protection" className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                <ShieldCheck className="h-6 w-6 text-success" aria-hidden="true" />
                {t.offer.protection}
              </h2>
              <ol className="relative mt-6 grid gap-5 sm:grid-cols-3 sm:gap-4">
                <span aria-hidden="true" className="absolute left-[1.15rem] top-3 bottom-3 w-px overflow-hidden bg-dark-line sm:left-4 sm:right-4 sm:top-[1.15rem] sm:bottom-auto sm:h-px sm:w-auto">
                  <span className="iw-rail-fill block h-full w-full bg-success/70" />
                </span>
                {[ShieldCheck, PackageCheck, Undo2].map((StepIcon, index) => {
                  const { title, body } = t.offer.steps[index];
                  return (
                    <li key={title} className="iw-path-node relative flex gap-4 sm:flex-col sm:gap-3" style={{ animationDelay: `${150 + index * 420}ms` }}>
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-success/40 bg-dark-raised shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                        <StepIcon className="h-4 w-4 text-white" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-gray-400">0{index + 1}</p>
                        <p className="mt-1 font-semibold text-white">{title}</p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-300">{body}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>

            <Card>
              <h2 className="font-display text-2xl font-bold tracking-tight">{t.offer.about}</h2>
              {description ? (
                <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-gray-200">{description.text}</p>
              ) : missing ? (
                <p className="mt-3 text-sm text-gray-400">{t.offer.noDescription}</p>
              ) : describing.failed !== null ? (
                <div className="mt-3">
                  <ReadError what={t.what.description} error={describing.failed} onRetry={describing.retry} />
                </div>
              ) : null}
            </Card>

            <Card>
              <h2 className="font-display text-2xl font-bold tracking-tight">{t.offer.conditions}</h2>
              <p className="mt-2 text-sm text-gray-400">{t.offer.conditionsNote}</p>
              <div className="mt-4">
                <Facts
                  rows={[
                    [t.offer.pricePerUnit, <span className="font-mono">{formatUsdc(terms.price, lang)}</span>],
                    [t.offer.shipping, <span className="font-mono">{formatUsdc(terms.shipping, lang)}</span>],
                    [t.offer.returnCost, <span className="font-mono">{formatUsdc(terms.returnCost, lang)}</span>],
                    [t.offer.refusalFee, <span className="font-mono">{fill(t.offer.refusalFeeValue, { pct: formatPercent(terms.refusalFeeBps, lang) })}</span>],
                    [t.offer.deliveredBy, terms.mode === 0 ? t.offer.carrier : t.offer.ownMeans],
                    [t.offer.shipsWithin, fill(terms.shipDays === 1 ? t.offer.shipDaysOne : t.offer.shipDaysMany, { n: terms.shipDays })],
                    [t.offer.arrivesWithin, fill(terms.deliveryDays === 1 ? t.offer.deliveryDaysOne : t.offer.deliveryDaysMany, { n: terms.deliveryDays })],
                    [t.offer.deliversTo, regions.map((code) => countryName(code, lang)).join(', ') || '—'],
                    [t.offer.payoutAddress, <AddressLink address={terms.payout} />],
                  ]}
                />
              </div>
            </Card>

          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <Card className="!border-dark-line !bg-dark-raised !rounded-panel shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_48px_-28px_rgba(0,0,0,0.95)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display text-2xl font-bold tracking-tight">{t.offer.buy}</h2>
                {tier.tier !== null && (
                  <Badge tone={tier.tier >= 3 ? 'danger' : tier.tier >= 1 ? 'success' : 'neutral'}>{fill(t.offer.tierBadge, { tier: t.tiers[tier.tier] ?? t.offer.unknownTier })}</Badge>
                )}
              </div>
              {tier.tier !== null && (
                <p className="mt-2 text-xs text-gray-400">
                  {/* P6-21: counters that were not read are not shown — never a 0 standing in for them. */}
                  {tier.delivered !== null && tier.materialFailures !== null ? fill(t.offer.tierLine, { delivered: tier.delivered, failures: tier.materialFailures }) : tier.failed ? t.offer.tierLineUnread : t.offer.tierLineReading}
                </p>
              )}
              {tier.failed && (
                <div className="mt-3">
                  <ReadError what={t.what.storeTier} error={CHAIN_FAILED} onRetry={tier.retry} />
                </div>
              )}
              <div className="mt-5">
                {paused ? (
                  <Notice tone="warning">{t.offer.paused}</Notice>
                ) : !terms.active || !description ? (
                  <Notice>{t.offer.cannotBuy}</Notice>
                ) : (
                  <RequireAccount intro={t.offer.intro}>
                    {(status) => <Checkout termsId={termsId} terms={terms} regions={regions} status={status} />}
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
  status,
}: {
  termsId: bigint;
  terms: NonNullable<ReturnType<typeof useTerms>['terms']>;
  regions: readonly string[];
  status: AccountStatus;
}) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const navigate = useNavigate();
  const account = status.accounts.find((item) => item.role === 'PARTICIPANT');
  const usdc = useUsdcBalance(account?.address ?? null);
  const [quantity, setQuantity] = useState(1);
  const [addressSaved, setAddressSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (account === undefined) return <Loading />;
  if (!account.configured) return <AccountSetup role="PARTICIPANT" status={status} />;

  const pay = async () => {
    setError(null);
    setBusy(true);
    // 9.2, H18, T6: an own-means order's code is made here and kept on this device; only the commitment is sent.
    const codeCommit = terms.mode === 1 ? keepCode(window.localStorage, generateDeliveryCode()) : undefined;
    const outcome = await relay({ kind: 'pay', termsId: termsId.toString(), quantity, ...(codeCommit ? { codeCommit } : {}) });
    setBusy(false);
    if (outcome.status === 'refused') return setError(say(outcome.error));
    if (outcome.status === 'done' && outcome.result.orderId) navigate(`/orders/${outcome.result.orderId}`);
    else if (outcome.status === 'done') navigate('/orders');
  };

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="quantity" className="mb-2 block text-sm text-gray-300">
          {t.offer.quantity}
        </label>
        <div className="flex items-center gap-2">
          <Button tone="secondary" aria-label={t.offer.oneLess} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
            −
          </Button>
          <input
            id="quantity"
            inputMode="numeric"
            className="min-h-[48px] w-20 rounded-control border border-dark-border bg-dark-input text-center font-mono text-white"
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Math.min(999, Number(event.target.value.replace(/\D/g, '')) || 1)))}
          />
          <Button tone="secondary" aria-label={t.offer.oneMore} onClick={() => setQuantity((q) => Math.min(999, q + 1))}>
            +
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-dark-border bg-black/30 p-4 text-sm">
        <p className="flex justify-between gap-3">
          <span className="text-gray-400">{t.offer.yourUsdc}</span>
          <span className="font-mono text-white">{usdc.balance !== null ? formatUsdc(usdc.balance, lang) : usdc.failed ? t.ui.notRead : '…'}</span>
        </p>
        {usdc.failed && (
          <div className="mt-3">
            <ReadError what={t.what.usdcBalance} error={CHAIN_FAILED} onRetry={() => void usdc.refetch()} />
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">{t.offer.totalNote}</p>
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <PackageCheck className="h-4 w-4 text-gray-300" aria-hidden="true" /> {t.offer.deliveryAddress}
        </h3>
        {addressSaved ? (
          <Notice tone="success">{t.offer.addressSaved}</Notice>
        ) : (
          <AddressForm purpose={{ termsId: termsId.toString() }} regions={regions} onRegistered={() => setAddressSaved(true)} />
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      <Button className="w-full" busy={busy} disabled={!addressSaved} onClick={() => void pay()}>
        <ShieldCheck className="h-4 w-4" aria-hidden="true" /> {t.offer.pay}
      </Button>
      {terms.mode === 1 && <p className="text-xs text-gray-400">{t.offer.ownDelivery}</p>}
      <p className="text-xs text-gray-400">
        {t.offer.acceptTerms}{' '}
        <Link to="/privacy" className="underline underline-offset-4">
          {t.shell.privacy}
        </Link>
      </p>
    </div>
  );
}
