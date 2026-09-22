/**
 * An order's state in words, and which actions each side can take now.
 *
 * The contract decides (KeptraEscrow.sol) and the relay checks again before
 * anything is signed; this only decides which buttons a page shows, so a person
 * is never offered what the contract would refuse. Sections 8 and 9, H6, H15.
 */

import { OrderFlag, OrderState } from './contracts.js';

export interface OrderFacts {
  readonly state: number;
  readonly flags: number;
  readonly mode: 'CARRIER' | 'OWN_MEANS';
  readonly prize: boolean;
  /** Seconds, as strings from the bridge; null where the order has not got that far. */
  readonly shipBy: string;
  readonly deliverBy: string | null;
  readonly windowEndsAt: string | null;
  readonly outcome: number | null;
}

const refusalWindow = (order: OrderFacts) => order.state === OrderState.WINDOW && (order.flags & OrderFlag.REFUSAL) !== 0;

/** One line on where the order stands, for the recipient and the store alike. */
export function orderStatusText(order: OrderFacts): string {
  switch (order.state) {
    case OrderState.PAID:
      return order.prize ? 'Redeemed — waiting for the brand to ship' : 'Paid — waiting for the store to ship';
    case OrderState.SHIPPED:
      return 'Shipped — on its way';
    case OrderState.WINDOW:
      return refusalWindow(order) ? 'The store declared a refusal — window to contest open' : 'Delivered — window to confirm or contest open';
    case OrderState.CONTESTED:
      return 'Contested — the arbiter decides';
    case OrderState.CLOSED:
      return closedText(order.outcome, order.prize);
    default:
      return 'Not found';
  }
}

function closedText(outcome: number | null, prize: boolean): string {
  switch (outcome) {
    case 0:
      return prize ? 'Completed — delivered' : 'Completed — the store was paid';
    case 1:
      return prize ? 'Closed — compensation paid to the winner' : 'Closed — refunded to the buyer in full';
    case 2:
      return 'Closed — refusal terms applied';
    case 3:
      return 'Closed — refunded by the store';
    case 4:
      return 'Cancelled';
    default:
      return 'Closed';
  }
}

export type RecipientAction = 'cancelOrder' | 'confirm' | 'contest' | 'evidence';
export type StoreAction = 'tracking' | 'ship' | 'submitCode' | 'declareDelivered' | 'declareRefusal' | 'refund' | 'evidence';

/** T2, T6, T9 and P17: what the recipient can do now (KeptraEscrow cancel, confirm, contest). */
export function recipientActions(order: OrderFacts, nowSeconds: number): RecipientAction[] {
  const out: RecipientAction[] = [];
  if (order.state === OrderState.PAID) out.push('cancelOrder');
  if (order.state === OrderState.SHIPPED || (order.state === OrderState.WINDOW && !refusalWindow(order))) out.push('confirm');
  if (order.state === OrderState.WINDOW && order.windowEndsAt !== null && nowSeconds <= Number(order.windowEndsAt)) out.push('contest');
  if (order.state === OrderState.CONTESTED) out.push('evidence');
  return out;
}

/**
 * T4, 9.1.1, 9.2, 9.3, 9.4, T12: what the store can do now. `tracked`: a carrier
 * order's number is registered (ship needs its hash, relay.ts).
 */
export function storeActions(order: OrderFacts, nowSeconds: number, tracked: boolean): StoreAction[] {
  const out: StoreAction[] = [];
  if (order.state === OrderState.PAID) {
    if (order.mode === 'CARRIER' && !tracked) out.push('tracking');
    else out.push('ship');
  }
  const provable = order.state === OrderState.SHIPPED || (order.state === OrderState.WINDOW && !refusalWindow(order));
  if (order.mode === 'OWN_MEANS' && provable) out.push('submitCode');
  if (order.state === OrderState.SHIPPED && order.deliverBy !== null && nowSeconds <= Number(order.deliverBy)) out.push('declareDelivered');
  if (order.mode === 'OWN_MEANS' && order.state === OrderState.SHIPPED) out.push('declareRefusal');
  if (order.state !== OrderState.CLOSED && order.state !== OrderState.NONE) out.push('refund');
  if (order.state === OrderState.CONTESTED) out.push('evidence');
  return out;
}
