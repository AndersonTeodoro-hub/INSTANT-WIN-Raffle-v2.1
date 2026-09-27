import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { Ticket } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { AddressForm } from '../../components/keptra/AddressForm';
import { useBridgeRead, useDescription, useTerms } from '../../components/keptra/hooks';
import { Button, Card, Empty, Eyebrow, Facts, Loading, NotAvailable, Notice, ReadError } from '../../components/keptra/ui';
import { accountVouchers, type AccountStatus } from '../../lib/keptra/api';
import { CHAIN_FAILED } from '../../lib/keptra/reads';
import { KEPTRA_GUARANTEE, KEPTRA_GUARANTEE_ABI, keptraConfigured } from '../../lib/keptra/contracts';
import { countryName, formatUsdc, formatUtc, timeLeft } from '../../lib/keptra/format';
import { generateDeliveryCode, keepCode } from '../../lib/keptra/deliveryCode';
import { fill, useKeptraCopy } from '../keptra.i18n';

/*
 * /vouchers/:id — redeem a physical prize (11.4 to 11.10, H7, T4).
 *
 * The voucher is the winner's (account/vouchers); its conditions are the
 * obligation's terms, read from the chain, with the brand's description (T4).
 * Redeeming needs an address in a country the brand accepts (H7, T14), and, for
 * own-means delivery, a delivery code made on this device (T6). Thirty days from
 * the claim (11.10); the deadline shown is the bridge's.
 */

export function VoucherPage() {
  const { id } = useParams();
  const voucherId = id && /^\d{1,30}$/.test(id) ? id : null;
  const { t } = useKeptraCopy();
  useEffect(() => {
    document.title = voucherId ? fill(t.voucher.metaTitle, { id: voucherId }) : t.voucher.metaTitleBare;
  }, [voucherId, t]);
  return (
    <KeptraShell>
      {!keptraConfigured() ? (
        <NotAvailable />
      ) : voucherId === null ? (
        <Empty title={t.voucher.badLink} />
      ) : (
        <RequireAccount intro={t.voucher.intro}>{(status) => <VoucherBody voucherId={voucherId} status={status} />}</RequireAccount>
      )}
    </KeptraShell>
  );
}

function VoucherBody({ voucherId, status }: { voucherId: string; status: AccountStatus }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const navigate = useNavigate();
  const held = useBridgeRead(accountVouchers, []);
  const voucher = held.read.status === 'ready' ? (held.read.value.vouchers.find((item) => item.voucherId === voucherId && item.role === 'PARTICIPANT') ?? null) : undefined;
  const [addressSaved, setAddressSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const obligation = useReadContract({
    address: KEPTRA_GUARANTEE,
    abi: KEPTRA_GUARANTEE_ABI,
    functionName: 'getObligation',
    args: [BigInt(voucher?.obligationId ?? '0')],
    query: { enabled: voucher != null },
  });
  const termsId = obligation.data ? (obligation.data as unknown as { termsId: bigint }).termsId : null;
  const conditions = useTerms(termsId);
  const { terms, regions } = conditions;
  const describing = useDescription(termsId === null ? null : termsId.toString());
  const { description } = describing;
  // P6-5: a voucher with no description is not redeemable through the page.
  const described = description !== null && description !== undefined;
  const account = status.accounts.find((item) => item.role === 'PARTICIPANT');

  // V3: a list that failed is an error, not "this voucher is not in your account".
  if (held.read.status === 'failed') return <ReadError what={t.what.yourVouchers} error={held.read.error} onRetry={held.retry} />;
  if (voucher === undefined) return <Loading label={t.voucher.looking} />;
  if (voucher === null) {
    // P6-11: with the list cut short, a voucher not found may be one of those not listed.
    if (held.read.status === 'ready' && !held.read.value.complete) return <Notice tone="warning">{t.ui.vouchersIncomplete}</Notice>;
    return (
      <Empty title={t.voucher.notInAccount}>
        <p>{t.voucher.appearsAfterClaim}</p>
      </Empty>
    );
  }
  if (voucher.claimedAt === null) return <Notice>{t.voucher.claimFirst}</Notice>;

  const now = Math.floor(Date.now() / 1000);
  // The prize's conditions are two chain reads: the obligation, then its terms.
  const conditionsFailed = obligation.isError || conditions.failed;
  const retryConditions = () => {
    if (obligation.isError) void obligation.refetch();
    else conditions.retry();
  };
  const expired = voucher.redeemBy !== null && Number(voucher.redeemBy) < now;

  const redeem = async () => {
    setBusy(true);
    setError(null);
    const codeCommit = terms?.mode === 1 ? keepCode(window.localStorage, generateDeliveryCode()) : undefined;
    const outcome = await relay({ kind: 'redeem', voucherId, ...(codeCommit ? { codeCommit } : {}) });
    setBusy(false);
    if (outcome.status === 'refused') return setError(say(outcome.error));
    if (outcome.status === 'done') navigate(outcome.result.orderId ? `/orders/${outcome.result.orderId}` : '/orders');
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <Eyebrow>{fill(t.voucher.eyebrow, { id: voucherId })}</Eyebrow>
          <h1 className="mt-3 break-words font-display text-4xl font-bold tracking-tight sm:text-5xl">{description?.title ?? t.voucher.untitled}</h1>
          {voucher.redeemBy && (
            <p className={`mt-3 text-sm ${expired ? 'text-red-300' : 'text-gray-300'}`}>
              {expired ? t.voucher.expired : fill(t.voucher.redeemWhen, { when: timeLeft(voucher.redeemBy, now, lang), date: formatUtc(voucher.redeemBy, lang) })}
            </p>
          )}
        </div>
        <Card>
          <h2 className="font-display text-2xl font-bold tracking-tight">{t.voucher.about}</h2>
          {description ? (
            <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-gray-200">{description.text}</p>
          ) : describing.missing ? (
            <p className="mt-3 text-base leading-relaxed text-gray-200">{t.voucher.noDescription}</p>
          ) : describing.failed !== null ? (
            <div className="mt-3">
              <ReadError what={t.what.description} error={describing.failed} onRetry={describing.retry} />
            </div>
          ) : conditionsFailed ? null : (
            <Loading />
          )}
        </Card>
        {conditionsFailed && <ReadError what={t.what.prizeConditions} error={CHAIN_FAILED} onRetry={retryConditions} />}
        {terms && (
          <Card>
            <h2 className="font-display text-2xl font-bold tracking-tight">{t.voucher.conditions}</h2>
            <div className="mt-4">
              <Facts
                rows={[
                  [t.voucher.declaredValue, <span className="font-mono">{formatUsdc(terms.price, lang)}</span>],
                  [t.voucher.shippingCovered, <span className="font-mono">{formatUsdc(terms.shipping, lang)}</span>],
                  [t.voucher.deliveredBy, terms.mode === 0 ? t.voucher.carrier : t.voucher.ownMeans],
                  [t.voucher.shipsWithin, fill(terms.shipDays === 1 ? t.voucher.shipDaysOne : t.voucher.shipDaysMany, { n: terms.shipDays })],
                  [t.voucher.arrivesWithin, fill(terms.deliveryDays === 1 ? t.voucher.deliveryDaysOne : t.voucher.deliveryDaysMany, { n: terms.deliveryDays })],
                  [t.voucher.deliversTo, regions.map((code) => countryName(code, lang)).join(', ')],
                ]}
              />
            </div>
            <p className="mt-4 text-xs text-gray-400">{t.voucher.failNote}</p>
          </Card>
        )}
      </div>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <Ticket className="h-5 w-5 text-gray-300" aria-hidden="true" /> {t.voucher.redeem}
          </h2>
          <div className="mt-5 space-y-5">
            {expired ? (
              <Notice tone="warning">{t.voucher.noLonger}</Notice>
            ) : !described ? (
              // P6-5 (T4): a prize is redeemed only once the brand has said what it is.
              <Notice tone="warning">
                {describing.failed ? t.voucher.descriptionUnread : t.voucher.notDescribed}
              </Notice>
            ) : account && !account.configured ? (
              <AccountSetup role="PARTICIPANT" status={status} />
            ) : addressSaved ? (
              <Notice tone="success">{t.voucher.addressSaved}</Notice>
            ) : terms === null ? (
              // The countries come with the conditions: no form until they are read (V3 — never a form with no country to choose).
              conditionsFailed ? <Notice>{t.voucher.addressAfterConditions}</Notice> : <Loading />
            ) : (
              <AddressForm purpose={{ voucherId }} regions={regions} onRegistered={() => setAddressSaved(true)} />
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {!expired && described && (
              <Button className="w-full" busy={busy} disabled={!addressSaved} onClick={() => void redeem()}>
                {t.voucher.review}
              </Button>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
