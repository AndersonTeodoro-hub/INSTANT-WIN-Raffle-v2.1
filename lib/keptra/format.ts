/**
 * How the Keptra pages write numbers, dates and a transaction's summary.
 *
 * T0: every number shown comes from the chain or the bridge; these functions only
 * write them down — an amount in base units becomes "12.50 USDC", never a guess.
 * C12 and T2: a relay summary becomes three plain sentences — what happens, what
 * moves, where it goes — from the fields the bridge computed.
 *
 * In the page's language (the owner's decision of 27/09/2026: the Keptra screens
 * follow the language switch). Every function takes it last and defaults to
 * English; the numbers follow the language as on the home page (pt-PT, es-ES),
 * never rounded — addresses, hashes and "USDC" never change.
 */

import type { Lang } from '../../pages/landing.i18n';
import type { ActionSummary, SummaryAmount } from './relay.js';
import { KEPTRA_ESCROW, KEPTRA_GUARANTEE, KEPTRA_VOUCHER, USDC, USDC_DECIMALS } from './contracts.js';

const LOCALE: Record<Lang, string> = { en: 'en-US', pt: 'pt-PT', es: 'es-ES' };

/** Base units as a decimal string with the token's decimals, trailing zeros past two dropped. */
export function formatUnits(value: string | bigint, decimals: number, lang: Lang = 'en'): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let fraction = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  if (fraction.length < 2 && decimals >= 2) fraction = fraction.padEnd(2, '0');
  if (lang !== 'en') {
    // The whole part through the locale's own grouping (a bigint, so exact at any size); the decimals as read.
    const format = new Intl.NumberFormat(LOCALE[lang]);
    const point = format.formatToParts(1.5).find((part) => part.type === 'decimal')?.value ?? ',';
    return `${negative ? '-' : ''}${format.format(whole)}${fraction === '' ? '' : `${point}${fraction}`}`;
  }
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === '' ? '' : `.${fraction}`}`;
}

export const formatUsdc = (value: string | bigint, lang: Lang = 'en'): string => `${formatUnits(value, USDC_DECIMALS, lang)} USDC`;

/** A plain figure (a limit, a count) with the language's decimal sign: "12.5", "12,5". */
export const formatNumber = (value: number, lang: Lang = 'en'): string => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(value);

/** Basis points as a percentage with two decimals: "12.50%", "12,50 %". */
export const formatPercent = (bps: bigint | number, lang: Lang = 'en'): string =>
  new Intl.NumberFormat(LOCALE[lang], { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(bps) / 10_000);

/**
 * An amount a person typed, with its decimal sign written as a point, or null when
 * it holds the other sign (the owner's decision of 27/09/2026): in Portuguese and
 * Spanish a comma is the decimal sign and a point is refused ("1500", "12,50"); in
 * English a point is, and a comma is refused ("1500", "12.50"). A thousands separator
 * is never read — "1.500" in Portuguese and "1,000" in English are refused, never
 * guessed. The caller's pattern then allows one decimal sign at most, and no space.
 */
export function decimalText(text: string, lang: Lang = 'en'): string | null {
  const clean = text.trim();
  if (lang === 'en') return clean.includes(',') ? null : clean;
  return clean.includes('.') ? null : clean.replace(',', '.');
}

/**
 * "12.50" (EN) or "12,50" (PT, ES) from what a person typed, in USDC base units;
 * null when it is not an amount with at most six decimals written with the
 * language's decimal sign (decimalText).
 */
export function parseUsdc(text: string, lang: Lang = 'en'): bigint | null {
  const clean = decimalText(text, lang);
  if (clean === null || !/^\d{1,12}(\.\d{1,6})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  return BigInt(whole) * 10n ** 6n + BigInt(fraction.padEnd(6, '0'));
}

export const shortAddress = (address: string): string => `${address.slice(0, 6)}…${address.slice(-4)}`;

/** A chain timestamp (seconds) as "22 Sep 2026, 14:05 UTC" ("22/09/2026, 14:05 UTC" in Portuguese). */
export function formatUtc(seconds: string | number | bigint, lang: Lang = 'en'): string {
  const date = new Date(Number(seconds) * 1000);
  const locale = lang === 'en' ? 'en-GB' : LOCALE[lang];
  const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${day}, ${time} UTC`;
}

const TIME_WORDS: Record<Lang, { passed: string; days: string; hours: string; minute: string; minutes: string }> = {
  en: { passed: 'passed', days: 'in {n} days', hours: 'in {n} hours', minute: 'in 1 minute', minutes: 'in {n} minutes' },
  pt: { passed: 'já passou', days: 'dentro de {n} dias', hours: 'dentro de {n} horas', minute: 'dentro de 1 minuto', minutes: 'dentro de {n} minutos' },
  es: { passed: 'ya pasó', days: 'en {n} días', hours: 'en {n} horas', minute: 'en 1 minuto', minutes: 'en {n} minutos' },
};

/** "in 3 days" / "in 5 hours" / "in 1 minute" / "passed", against the chain's clock or this device's. */
export function timeLeft(seconds: string | number | bigint, nowSeconds: number, lang: Lang = 'en'): string {
  const words = TIME_WORDS[lang];
  const left = Number(seconds) - nowSeconds;
  if (left <= 0) return words.passed;
  const days = Math.floor(left / 86_400);
  if (days >= 2) return words.days.replace('{n}', String(days));
  const hours = Math.floor(left / 3_600);
  if (hours >= 2) return words.hours.replace('{n}', String(hours));
  const minutes = Math.max(1, Math.floor(left / 60));
  return minutes === 1 ? words.minute : words.minutes.replace('{n}', String(minutes));
}

/** ISO-3166-1 alpha-2 as a country's name in the page's language — Portugal's Portuguese ("Irão", not "Irã") — through the platform's own table. */
export function countryName(code: string, lang: Lang = 'en'): string {
  try {
    return new Intl.DisplayNames([LOCALE[lang]], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The countries an offer accepts, from regionsOf's bytes: ASCII pairs (I14). */
export function decodeRegions(hex: string): string[] {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const text = Array.from({ length: body.length / 2 }, (_, i) => String.fromCharCode(parseInt(body.slice(2 * i, 2 * i + 2), 16))).join('');
  return text.match(/.{2}/g) ?? [];
}

// ---------------------------------------------------------------------------
// C12 and T2 — a relay summary in plain words
// ---------------------------------------------------------------------------

interface SummaryVocabulary {
  readonly actions: Record<string, string>;
  readonly escrow: string;
  readonly guarantee: string;
  /** {token}: the token's short address. */
  readonly decimalsUnread: string;
  readonly decimalsUnstated: string;
  /** {n}: how many. */
  readonly itemOne: string;
  readonly itemMany: string;
  /** {id}; {n} and {ids} for several. */
  readonly voucherOne: string;
  readonly voucherMany: string;
  readonly nftOne: string;
  readonly nftMany: string;
  readonly destinations: Record<string, string>;
}

/** Every word the summary sheet can show, in the three languages (the tests check the three hold the same keys). */
export const SUMMARY_WORDS: Record<Lang, SummaryVocabulary> = {
  en: {
    actions: {
      enter: 'Enter the draw',
      claim: 'Claim your prize',
      transfer: 'Send a prize',
      transferUsdc: 'Send USDC',
      createCampaign: 'Create the campaign',
      addPasskey: 'Add a passkey',
      cancelRecovery: 'Cancel the change of access',
      revokeGuardian: 'Remove the recovery key',
      configure: 'Set up your account',
      pay: 'Pay for this order',
      redeem: 'Redeem your voucher',
      cancelOrder: 'Cancel this order',
      confirm: 'Confirm you received the order',
      contest: 'Contest this order',
      createOffer: 'Publish this offer',
      deactivateOffer: 'Take this offer down',
      ship: 'Declare the order shipped',
      submitCode: 'Submit the delivery code',
      declareDelivered: 'Declare the order delivered',
      declareRefusal: 'Declare the order refused',
      refund: 'Refund the recipient',
      createObligation: 'Create the prize obligation',
      createVoucherCampaign: 'Create the voucher campaign',
    },
    escrow: 'the Keptra escrow contract',
    guarantee: 'the Keptra guarantee contract',
    decimalsUnread: 'an amount of token {token} that cannot be shown: its decimals could not be read — try again',
    decimalsUnstated: 'an amount of token {token} that cannot be shown: the token does not state its decimals',
    itemOne: '{n} prize item',
    itemMany: '{n} prize items',
    voucherOne: 'voucher #{id}',
    voucherMany: '{n} vouchers (#{ids})',
    nftOne: 'item #{id}',
    nftMany: '{n} items (#{ids})',
    destinations: {
      ESCROW: 'held by the Keptra escrow contract until the order ends',
      GUARANTEE: 'held by the Keptra guarantee contract',
      GIVEAWAY: 'to the Event Center giveaway contract',
      THIS_ACCOUNT: 'into your own Keptra account',
      STORE: "to the store's payout address",
      RECIPIENT: "to the buyer's Keptra account",
      ADDRESS: 'to the address you entered',
    },
  },
  pt: {
    actions: {
      enter: 'Participar no sorteio',
      claim: 'Reclamar o prémio',
      transfer: 'Enviar um prémio',
      transferUsdc: 'Enviar USDC',
      createCampaign: 'Criar a campanha',
      addPasskey: 'Adicionar uma passkey',
      cancelRecovery: 'Cancelar a mudança de acesso',
      revokeGuardian: 'Retirar a chave de recuperação',
      configure: 'Configurar a sua conta',
      pay: 'Pagar esta encomenda',
      redeem: 'Resgatar o voucher',
      cancelOrder: 'Cancelar esta encomenda',
      confirm: 'Confirmar que recebeu a encomenda',
      contest: 'Contestar esta encomenda',
      createOffer: 'Publicar esta oferta',
      deactivateOffer: 'Retirar esta oferta',
      ship: 'Declarar a encomenda enviada',
      submitCode: 'Submeter o código de entrega',
      declareDelivered: 'Declarar a encomenda entregue',
      declareRefusal: 'Declarar a encomenda recusada',
      refund: 'Reembolsar o destinatário',
      createObligation: 'Criar a obrigação de prémio',
      createVoucherCampaign: 'Criar a campanha de vouchers',
    },
    escrow: 'o contrato de escrow da Keptra',
    guarantee: 'o contrato de garantia da Keptra',
    decimalsUnread: 'um montante do token {token} que não pode ser mostrado: não foi possível ler as casas decimais — tente de novo',
    decimalsUnstated: 'um montante do token {token} que não pode ser mostrado: o token não declara as casas decimais',
    itemOne: '{n} item de prémio',
    itemMany: '{n} itens de prémio',
    voucherOne: 'voucher #{id}',
    voucherMany: '{n} vouchers (#{ids})',
    nftOne: 'item #{id}',
    nftMany: '{n} itens (#{ids})',
    destinations: {
      ESCROW: 'retido pelo contrato de escrow da Keptra até a encomenda terminar',
      GUARANTEE: 'retido pelo contrato de garantia da Keptra',
      GIVEAWAY: 'para o contrato de giveaways do Event Center',
      THIS_ACCOUNT: 'para a sua própria conta Keptra',
      STORE: 'para o endereço de pagamento da loja',
      RECIPIENT: 'para a conta Keptra do comprador',
      ADDRESS: 'para o endereço que introduziu',
    },
  },
  es: {
    actions: {
      enter: 'Participar en el sorteo',
      claim: 'Reclamar tu premio',
      transfer: 'Enviar un premio',
      transferUsdc: 'Enviar USDC',
      createCampaign: 'Crear la campaña',
      addPasskey: 'Añadir una passkey',
      cancelRecovery: 'Cancelar el cambio de acceso',
      revokeGuardian: 'Quitar la clave de recuperación',
      configure: 'Configurar tu cuenta',
      pay: 'Pagar este pedido',
      redeem: 'Canjear tu vale',
      cancelOrder: 'Cancelar este pedido',
      confirm: 'Confirmar que recibiste el pedido',
      contest: 'Impugnar este pedido',
      createOffer: 'Publicar esta oferta',
      deactivateOffer: 'Retirar esta oferta',
      ship: 'Declarar el pedido enviado',
      submitCode: 'Enviar el código de entrega',
      declareDelivered: 'Declarar el pedido entregado',
      declareRefusal: 'Declarar el pedido rechazado',
      refund: 'Reembolsar al destinatario',
      createObligation: 'Crear la obligación de premio',
      createVoucherCampaign: 'Crear la campaña de vales',
    },
    escrow: 'el contrato de escrow de Keptra',
    guarantee: 'el contrato de garantía de Keptra',
    decimalsUnread: 'un importe del token {token} que no se puede mostrar: no se pudieron leer sus decimales — inténtalo de nuevo',
    decimalsUnstated: 'un importe del token {token} que no se puede mostrar: el token no declara sus decimales',
    itemOne: '{n} artículo de premio',
    itemMany: '{n} artículos de premio',
    voucherOne: 'vale #{id}',
    voucherMany: '{n} vales (#{ids})',
    nftOne: 'artículo #{id}',
    nftMany: '{n} artículos (#{ids})',
    destinations: {
      ESCROW: 'retenido por el contrato de escrow de Keptra hasta que termine el pedido',
      GUARANTEE: 'retenido por el contrato de garantía de Keptra',
      GIVEAWAY: 'al contrato de giveaways del Event Center',
      THIS_ACCOUNT: 'a tu propia cuenta Keptra',
      STORE: 'a la dirección de cobro de la tienda',
      RECIPIENT: 'a la cuenta Keptra del comprador',
      ADDRESS: 'a la dirección que introdujiste',
    },
  },
};

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);

/** What a named contract is, for a person. */
function contractName(address: string, lang: Lang): string | null {
  const lower = address.toLowerCase();
  if (lower === KEPTRA_ESCROW.toLowerCase()) return SUMMARY_WORDS[lang].escrow;
  if (lower === KEPTRA_GUARANTEE.toLowerCase()) return SUMMARY_WORDS[lang].guarantee;
  return null;
}

/**
 * V4 (A4): USDC with its six decimals; any other token with the decimals and the
 * symbol the bridge read from it (relay.ts withTokenMeta). A token that did not say
 * gets no figure at all — a count of base units read as a price would be a number
 * nobody read.
 */
export function amountText(amount: SummaryAmount, lang: Lang = 'en'): string {
  const words = SUMMARY_WORDS[lang];
  if (amount.kind === 'ERC20') {
    if (amount.token.toLowerCase() === USDC.toLowerCase()) return formatUsdc(amount.value, lang);
    if (amount.meta) return `${formatUnits(amount.value, amount.meta.decimals, lang)} ${amount.meta.symbol}`;
    // P6-18: a failed read is a failed read, not a token that says nothing.
    if (amount.metaFailed) return fill(words.decimalsUnread, { token: shortAddress(amount.token) });
    return fill(words.decimalsUnstated, { token: shortAddress(amount.token) });
  }
  if (amount.kind === 'ITEMS') return fill(amount.count === '1' ? words.itemOne : words.itemMany, { n: amount.count });
  const voucher = amount.token.toLowerCase() === KEPTRA_VOUCHER.toLowerCase();
  return amount.tokenIds.length === 1
    ? fill(voucher ? words.voucherOne : words.nftOne, { id: amount.tokenIds[0] })
    : fill(voucher ? words.voucherMany : words.nftMany, { n: String(amount.tokenIds.length), ids: amount.tokenIds.join(', #') });
}

export interface SummaryWords {
  readonly action: string;
  /** Each amount as a sentence fragment; empty when nothing moves. */
  readonly amounts: readonly string[];
  /** Where it goes, in words, and the address itself; null when nothing moves. */
  readonly destination: { readonly words: string; readonly address: string; readonly named: string | null } | null;
}

export function summaryWords(summary: ActionSummary, lang: Lang = 'en'): SummaryWords {
  const words = SUMMARY_WORDS[lang];
  return {
    action: words.actions[summary.action] ?? summary.action,
    amounts: summary.amounts.map((amount) => amountText(amount, lang)),
    destination:
      summary.destination === null
        ? null
        : {
            words: words.destinations[summary.destination.role] ?? summary.destination.role,
            address: summary.destination.address,
            named: contractName(summary.destination.address, lang),
          },
  };
}
