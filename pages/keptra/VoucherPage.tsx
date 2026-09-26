import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useReadContract } from 'wagmi';
import { Ticket } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { AddressForm } from '../../components/keptra/AddressForm';
import { useBridgeRead, useDescription, useTerms } from '../../components/keptra/hooks';
import { Button, Card, Empty, Eyebrow, Facts, Loading, NotAvailable, Notice, ReadError, VOUCHERS_INCOMPLETE } from '../../components/keptra/ui';
import { accountVouchers, type AccountStatus } from '../../lib/keptra/api';
import { CHAIN_FAILED } from '../../lib/keptra/reads';
import { KEPTRA_GUARANTEE, KEPTRA_GUARANTEE_ABI, keptraConfigured } from '../../lib/keptra/contracts';
import { countryName, formatUsdc, formatUtc, timeLeft } from '../../lib/keptra/format';
import { generateDeliveryCode, keepCode } from '../../lib/keptra/deliveryCode';

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
  useEffect(() => {
    document.title = voucherId ? `Voucher #${voucherId} · Keptra` : 'Voucher · Keptra';
  }, [voucherId]);
  return (
    <KeptraShell>
      {!keptraConfigured() ? (
        <NotAvailable />
      ) : voucherId === null ? (
        <Empty title="This link does not name a voucher." />
      ) : (
        <RequireAccount intro="Sign in to redeem your voucher.">{(status) => <VoucherBody voucherId={voucherId} status={status} />}</RequireAccount>
      )}
    </KeptraShell>
  );
}

function VoucherBody({ voucherId, status }: { voucherId: string; status: AccountStatus }) {
  const { relay } = useKeptra();
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
  if (held.read.status === 'failed') return <ReadError what="Your vouchers" error={held.read.error} onRetry={held.retry} />;
  if (voucher === undefined) return <Loading label="Looking for your voucher…" />;
  if (voucher === null) {
    // P6-11: with the list cut short, a voucher not found may be one of those not listed.
    if (held.read.status === 'ready' && !held.read.value.complete) return <Notice tone="warning">{VOUCHERS_INCOMPLETE}</Notice>;
    return (
      <Empty title="This voucher is not in your account.">
        <p>A voucher appears here once you have claimed it in the Event Center.</p>
      </Empty>
    );
  }
  if (voucher.claimedAt === null) return <Notice>Claim the prize in its campaign first; the voucher can be redeemed once it is in your account.</Notice>;

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
    if (outcome.status === 'refused') return setError(outcome.error);
    if (outcome.status === 'done') navigate(outcome.result.orderId ? `/orders/${outcome.result.orderId}` : '/orders');
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-6">
        <div>
          <Eyebrow>Voucher #{voucherId} · physical prize</Eyebrow>
          <h1 className="mt-3 break-words font-display text-4xl font-bold tracking-tight sm:text-5xl">{description?.title ?? 'Your prize'}</h1>
          {voucher.redeemBy && (
            <p className={`mt-3 text-sm ${expired ? 'text-red-300' : 'text-gray-300'}`}>
              {expired ? 'The 30 days to redeem it have passed.' : `Redeem ${timeLeft(voucher.redeemBy, now)} — by ${formatUtc(voucher.redeemBy)}.`}
            </p>
          )}
        </div>
        <Card>
          <h2 className="font-display text-2xl font-bold tracking-tight">About the prize</h2>
          {description ? (
            <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-gray-200">{description.text}</p>
          ) : describing.missing ? (
            <p className="mt-3 text-base leading-relaxed text-gray-200">The brand has not published a description for this prize.</p>
          ) : describing.failed !== null ? (
            <div className="mt-3">
              <ReadError what="The description" error={describing.failed} onRetry={describing.retry} />
            </div>
          ) : conditionsFailed ? null : (
            <Loading />
          )}
        </Card>
        {conditionsFailed && <ReadError what="The prize's conditions" error={CHAIN_FAILED} onRetry={retryConditions} />}
        {terms && (
          <Card>
            <h2 className="font-display text-2xl font-bold tracking-tight">The conditions</h2>
            <div className="mt-4">
              <Facts
                rows={[
                  ['Declared value', <span className="font-mono">{formatUsdc(terms.price)}</span>],
                  ['Shipping, covered', <span className="font-mono">{formatUsdc(terms.shipping)}</span>],
                  ['Delivered by', terms.mode === 0 ? 'Carrier, tracked by the Keptra oracle' : 'The brand itself, with a delivery code'],
                  ['Ships within', `${terms.shipDays} days of redeeming`],
                  ['Arrives within', `${terms.deliveryDays} days of shipping`],
                  ['Delivers to', regions.map(countryName).join(', ')],
                ]}
              />
            </div>
            <p className="mt-4 text-xs text-gray-400">
              If the brand fails to deliver, you are paid the declared value plus shipping — from the brand's bond first, then from the Keptra guarantee pool.
            </p>
          </Card>
        )}
      </div>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <Ticket className="h-5 w-5 text-gray-300" aria-hidden="true" /> Redeem
          </h2>
          <div className="mt-5 space-y-5">
            {expired ? (
              <Notice tone="warning">This voucher can no longer be redeemed.</Notice>
            ) : !described ? (
              // P6-5 (T4): a prize is redeemed only once the brand has said what it is.
              <Notice tone="warning">
                {describing.failed ? 'The prize’s description could not be read, so it cannot be redeemed until it is.' : 'The brand has not described this prize yet, so it cannot be redeemed here until it does.'}
              </Notice>
            ) : account && !account.configured ? (
              <AccountSetup role="PARTICIPANT" status={status} />
            ) : addressSaved ? (
              <Notice tone="success">Address saved for this voucher.</Notice>
            ) : terms === null ? (
              // The countries come with the conditions: no form until they are read (V3 — never a form with no country to choose).
              conditionsFailed ? <Notice>The address can be given once the prize's conditions are read.</Notice> : <Loading />
            ) : (
              <AddressForm purpose={{ voucherId }} regions={regions} onRegistered={() => setAddressSaved(true)} />
            )}
            {error && <Notice tone="error">{error}</Notice>}
            {!expired && described && (
              <Button className="w-full" busy={busy} disabled={!addressSaved} onClick={() => void redeem()}>
                Review and redeem
              </Button>
            )}
          </div>
        </Card>
      </aside>
    </div>
  );
}
