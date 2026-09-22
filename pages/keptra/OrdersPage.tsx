import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Ticket } from 'lucide-react';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { RequireAccount } from '../../components/keptra/SignIn';
import { Badge, Card, Empty, Loading, NotAvailable, Notice, PageTitle, SectionTitle } from '../../components/keptra/ui';
import { accountVouchers, myOrders, type PublicOrder, type VoucherHeld } from '../../lib/keptra/api';
import { keptraConfigured, OrderState } from '../../lib/keptra/contracts';
import { formatUtc, timeLeft } from '../../lib/keptra/format';
import { orderStatusText } from '../../lib/keptra/orders';

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
  const [orders, setOrders] = useState<readonly (PublicOrder & { hasAddress: boolean })[] | null>(null);
  const [vouchers, setVouchers] = useState<readonly VoucherHeld[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);

  useEffect(() => {
    void myOrders().then((result) => (result.ok ? setOrders(result.orders) : setError(result.error)));
    void accountVouchers().then((result) => setVouchers(result.ok ? result.vouchers.filter((v) => v.role === 'PARTICIPANT') : []));
  }, []);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (orders === null) return <Loading label="Loading your orders…" />;

  const open = orders.filter((order) => order.state !== OrderState.CLOSED);
  const closed = orders.filter((order) => order.state === OrderState.CLOSED);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-8">
        <section>
          <SectionTitle aside={<span className="font-mono text-sm text-gray-500">{open.length}</span>}>In progress</SectionTitle>
          {open.length === 0 ? <Empty title="No order in progress." /> : <OrderTable orders={open} now={now} />}
        </section>
        {closed.length > 0 && (
          <section>
            <SectionTitle aside={<span className="font-mono text-sm text-gray-500">{closed.length}</span>}>Finished</SectionTitle>
            <OrderTable orders={closed} now={now} />
          </section>
        )}
      </div>
      <aside>
        <Card>
          <SectionTitle>Vouchers to redeem</SectionTitle>
          {vouchers === null ? (
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
                    <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden="true" />
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
        const deadline = order.state === OrderState.WINDOW ? order.windowEndsAt : order.state === OrderState.PAID ? order.shipBy : order.deliverBy;
        return (
          <li key={order.orderId}>
            <Link to={`/orders/${order.orderId}`} className="grid min-h-[64px] grid-cols-[1fr_auto] items-center gap-3 p-4 hover:bg-white/[0.03] sm:grid-cols-[8rem_1fr_12rem_auto]">
              <span className="font-mono text-sm text-white">#{order.orderId}</span>
              <span className="order-3 col-span-2 text-sm text-gray-300 sm:order-none sm:col-span-1">{orderStatusText(order)}</span>
              <span className="hidden text-xs text-gray-400 sm:block">
                {order.state !== OrderState.CLOSED && deadline ? `Next deadline ${timeLeft(deadline, now)}` : ''}
              </span>
              <span className="flex items-center gap-2">
                {order.prize && <Badge tone="warning">Prize</Badge>}
                <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
