import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Ticket } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { RequireAccount } from '../../components/keptra/SignIn';
import { useBridgeRead } from '../../components/keptra/hooks';
import { Badge, Card, Empty, Loading, NotAvailable, Notice, PageTitle, ReadError, SectionTitle, VOUCHERS_INCOMPLETE } from '../../components/keptra/ui';
import { accountVouchers, myOrders, type PublicOrder } from '../../lib/keptra/api';
import { keptraConfigured, OrderState } from '../../lib/keptra/contracts';
import { formatUtc } from '../../lib/keptra/format';
import { nextDeadlineText, orderStatusText } from '../../lib/keptra/orders';

/*
 * /orders — the customer's orders and the vouchers they can redeem (8, 11.4).
 * The list is the bridge's (order/list, account/vouchers); each row opens the
 * order, where every action is.
 */

export function OrdersPage() {
  useEffect(() => {
    document.title = 'My orders · Keptra';
  }, []);
  return (
    <KeptraShell>
      <PageTitle eyebrow="Customer" title="My orders" />
      {!keptraConfigured() ? (
        <NotAvailable />
      ) : (
        <RequireAccount intro="Sign in to see your orders and vouchers.">{() => <OrdersBody />}</RequireAccount>
      )}
    </KeptraShell>
  );
}

function OrdersBody() {
  // V3: a list that could not be read is an error with "Try again", never an empty list.
  const listed = useBridgeRead(myOrders, []);
  const held = useBridgeRead(accountVouchers, []);
  const now = Math.floor(Date.now() / 1000);

  if (listed.read.status === 'failed') return <ReadError what="Your orders" error={listed.read.error} onRetry={listed.retry} />;
  if (listed.read.status === 'loading') return <Loading label="Loading your orders…" />;
  const orders = listed.read.value.orders;
  const vouchers = held.read.status === 'ready' ? held.read.value.vouchers.filter((v) => v.role === 'PARTICIPANT') : null;

  const open = orders.filter((order) => order.state !== OrderState.CLOSED);
  const closed = orders.filter((order) => order.state === OrderState.CLOSED);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-8">
        <section>
          <SectionTitle aside={<span className="font-mono text-sm text-gray-400">{open.length}</span>}>In progress</SectionTitle>
          {open.length === 0 ? <Empty title="No order in progress." /> : <OrderTable orders={open} now={now} />}
        </section>
        {closed.length > 0 && (
          <section>
            <SectionTitle aside={<span className="font-mono text-sm text-gray-400">{closed.length}</span>}>Finished</SectionTitle>
            <OrderTable orders={closed} now={now} />
          </section>
        )}
      </div>
      <aside>
        <Card>
          <SectionTitle>Vouchers to redeem</SectionTitle>
          {held.read.status === 'ready' && !held.read.value.complete && <Notice tone="warning">{VOUCHERS_INCOMPLETE}</Notice>}
          {held.read.status === 'failed' ? (
            <ReadError what="Your vouchers" error={held.read.error} onRetry={held.retry} />
          ) : vouchers === null ? (
            <Loading />
          ) : vouchers.length === 0 ? (
            <p className="text-sm text-gray-400">No voucher in your account. Vouchers are prizes for physical products, won in the Event Center.</p>
          ) : (
            <ul className="space-y-3">
              {vouchers.map((voucher) => (
                <li key={voucher.voucherId}>
                  <Link
                    to={`/vouchers/${voucher.voucherId}`}
                    className="flex min-h-[56px] items-center justify-between gap-3 rounded-xl border border-dark-border p-3 hover:border-gray-500"
                  >
                    <span className="flex items-center gap-3">
                      <Ticket className="h-5 w-5 text-brand" aria-hidden="true" />
                      <span>
                        <span className="block font-mono text-sm text-white">Voucher #{voucher.voucherId}</span>
                        {voucher.redeemBy && <span className="block text-xs text-gray-400">Redeem by {formatUtc(voucher.redeemBy)}</span>}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>
    </div>
  );
}

function OrderTable({ orders, now }: { orders: readonly PublicOrder[]; now: number }) {
  return (
    <ul className="divide-y divide-dark-border overflow-hidden rounded-2xl border border-dark-border bg-dark-card">
      {orders.map((order) => {
        // B7: the next deadline shows on a phone too — below the state there, in its own column on a wider screen.
        const deadline = nextDeadlineText(order, now);
        return (
          <li key={order.orderId}>
            <Link to={`/orders/${order.orderId}`} className="grid min-h-[64px] grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 p-4 hover:bg-white/[0.03] sm:grid-cols-[8rem_1fr_12rem_auto] sm:gap-y-3">
              <span className="font-mono text-sm text-white">#{order.orderId}</span>
              <span className="order-3 col-span-2 text-sm text-gray-300 sm:order-none sm:col-span-1">{orderStatusText(order)}</span>
              <span className="order-4 col-span-2 text-xs text-gray-400 sm:order-none sm:col-span-1">{deadline ?? ''}</span>
              <span className="flex items-center gap-2">
                {order.prize && <Badge tone="warning">Prize</Badge>}
                <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
