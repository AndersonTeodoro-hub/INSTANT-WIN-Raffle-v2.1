/**
 * An order's state in words, and which actions each side can take now.
 *
 * The contract decides (KeptraEscrow.sol) and the relay checks again before
 * anything is signed; this only decides which buttons a page shows, so a person
 * is never offered what the contract would refuse. Sections 8 and 9, H6, H15.
 */

import type { Lang } from '../../pages/landing.i18n';
import { OrderFlag, OrderState } from './contracts.js';
import { timeLeft } from './format.js';

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

/** An order's state in words, in the page's language (the Keptra screens follow the language switch). */
export const STATUS_WORDS: Record<Lang, Record<string, string>> = {
  en: {
    paid: 'Paid — waiting for the store to ship',
    redeemed: 'Redeemed — waiting for the brand to ship',
    shipped: 'Shipped — on its way',
    refusalWindow: 'The store declared a refusal — window to contest open',
    window: 'Delivered — window to confirm or contest open',
    contested: 'Contested — the arbiter decides',
    notFound: 'Not found',
    completedPrize: 'Completed — delivered',
    completed: 'Completed — the store was paid',
    compensated: 'Closed — compensation paid to the winner',
    refunded: 'Closed — refunded to the buyer in full',
    refusalTerms: 'Closed — refusal terms applied',
    refundedByStore: 'Closed — refunded by the store',
    cancelled: 'Cancelled',
    closed: 'Closed',
    nextDeadline: 'Next deadline {when}',
  },
  pt: {
    paid: 'Paga — à espera de que a loja a envie',
    redeemed: 'Resgatada — à espera de que a marca a envie',
    shipped: 'Enviada — a caminho',
    refusalWindow: 'A loja declarou uma recusa — janela para contestar aberta',
    window: 'Entregue — janela para confirmar ou contestar aberta',
    contested: 'Contestada — o árbitro decide',
    notFound: 'Não encontrada',
    completedPrize: 'Concluída — entregue',
    completed: 'Concluída — a loja recebeu',
    compensated: 'Fechada — compensação paga ao vencedor',
    refunded: 'Fechada — reembolsada ao comprador na totalidade',
    refusalTerms: 'Fechada — aplicadas as condições de recusa',
    refundedByStore: 'Fechada — reembolsada pela loja',
    cancelled: 'Cancelada',
    closed: 'Fechada',
    nextDeadline: 'Próximo prazo {when}',
  },
  es: {
    paid: 'Pagado — esperando a que la tienda lo envíe',
    redeemed: 'Canjeado — esperando a que la marca lo envíe',
    shipped: 'Enviado — en camino',
    refusalWindow: 'La tienda declaró un rechazo — plazo para impugnar abierto',
    window: 'Entregado — plazo para confirmar o impugnar abierto',
    contested: 'Impugnado — decide el árbitro',
    notFound: 'No encontrado',
    completedPrize: 'Completado — entregado',
    completed: 'Completado — la tienda cobró',
    compensated: 'Cerrado — compensación pagada al ganador',
    refunded: 'Cerrado — reembolsado al comprador en su totalidad',
    refusalTerms: 'Cerrado — aplicadas las condiciones de rechazo',
    refundedByStore: 'Cerrado — reembolsado por la tienda',
    cancelled: 'Cancelado',
    closed: 'Cerrado',
    nextDeadline: 'Próximo plazo {when}',
  },
};

/** One line on where the order stands, for the recipient and the store alike. */
export function orderStatusText(order: OrderFacts, lang: Lang = 'en'): string {
  const words = STATUS_WORDS[lang];
  switch (order.state) {
    case OrderState.PAID:
      return order.prize ? words.redeemed : words.paid;
    case OrderState.SHIPPED:
      return words.shipped;
    case OrderState.WINDOW:
      return refusalWindow(order) ? words.refusalWindow : words.window;
    case OrderState.CONTESTED:
      return words.contested;
    case OrderState.CLOSED:
      return closedText(order.outcome, order.prize, words);
    default:
      return words.notFound;
  }
}

function closedText(outcome: number | null, prize: boolean, words: Record<string, string>): string {
  switch (outcome) {
    case 0:
      return prize ? words.completedPrize : words.completed;
    case 1:
      return prize ? words.compensated : words.refunded;
    case 2:
      return words.refusalTerms;
    case 3:
      return words.refundedByStore;
    case 4:
      return words.cancelled;
    default:
      return words.closed;
  }
}

/**
 * V5 (B7): an open order's next deadline in words, the same on every width — the
 * ship-by while paid, the window's end while it runs, the arrive-by after that.
 * null for a closed order, or one whose deadline is not set yet.
 */
export function nextDeadlineText(order: Pick<OrderFacts, 'state' | 'shipBy' | 'deliverBy' | 'windowEndsAt'>, nowSeconds: number, lang: Lang = 'en'): string | null {
  if (order.state === OrderState.CLOSED || order.state === OrderState.NONE) return null;
  const at = order.state === OrderState.WINDOW ? order.windowEndsAt : order.state === OrderState.PAID ? order.shipBy : order.deliverBy;
  return at === null ? null : STATUS_WORDS[lang].nextDeadline.replace('{when}', timeLeft(at, nowSeconds, lang));
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
