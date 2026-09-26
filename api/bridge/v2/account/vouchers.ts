import { handle, methodGuard, ok, refuse } from '../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../lib/bridge-v2/signals.js';
import { resolveSession } from '../../../../lib/bridge-v2/session.js';
import { accountsOf } from '../../../../lib/bridge-v2/accounts.js';
import { readVouchers, voucherLastId } from '../../../../lib/bridge-v2/escrowChain.js';
import { finishedVouchers, keptraContractsConfigured } from '../../../../lib/bridge-v2/orders.js';
import { ORDER_SCAN_PAGE, VOUCHER_LIST_MAX_PAGES, VOUCHER_REDEEM_WINDOW_SECONDS } from '../../../../lib/bridge-v2/config.js';

/**
 * POST /api/bridge/v2/account/vouchers -> the vouchers the session's two accounts hold
 *
 * SPEC-BLOCO-03 T3, for the page: a winner finds the voucher to redeem (11.4, 11.5,
 * U23), and a brand the loose vouchers of its obligations to put in a campaign
 * (11.3, P1). KeptraVoucher has no enumeration, so the live vouchers are read by
 * id — the same scan the orders pass makes, skipping the ones it has finished
 * with — up to VOUCHER_LIST_MAX_PAGES pages; `complete` says whether it got to
 * the end.
 *
 * A6 and D1: the accounts are the session's own; nobody else's vouchers are named.
 */
const route = handle('account/vouchers', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  const session = await resolveSession(request);
  if (session === null) return refuse(401, 'Sign in to continue.');
  // P24: no voucher exists while the contracts are not configured.
  if (!keptraContractsConfigured()) return refuse(503, 'Vouchers are not available yet.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'SESSION', value: session.id },
    { axis: 'IP', value: signals.ipHash },
    { axis: 'ROUTE_GLOBAL', value: 'account/vouchers' },
  ]);
  if (!verdict.allowed) return refuse(429, 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));

  const accounts = await accountsOf(session.participantId);
  const roleOf = new Map(accounts.map((account) => [account.safe.toLowerCase(), account.role]));
  if (roleOf.size === 0) return ok({ vouchers: [], complete: true });

  const finished = await finishedVouchers();
  const last = await voucherLastId();
  const ids: bigint[] = [];
  for (let id = 1n; id <= last; id += 1n) if (!finished.has(id.toString())) ids.push(id);

  const vouchers = [];
  const pages = Math.ceil(ids.length / ORDER_SCAN_PAGE);
  for (let page = 0; page < Math.min(pages, VOUCHER_LIST_MAX_PAGES); page += 1) {
    for (const voucher of await readVouchers(ids.slice(page * ORDER_SCAN_PAGE, (page + 1) * ORDER_SCAN_PAGE))) {
      const role = voucher.owner === null ? undefined : roleOf.get(voucher.owner.toLowerCase());
      if (role === undefined || voucher.voided) continue;
      vouchers.push({
        voucherId: voucher.voucherId.toString(),
        role,
        obligationId: voucher.obligationId.toString(),
        giveawayId: voucher.giveawayId === 0n ? null : voucher.giveawayId.toString(),
        claimedAt: voucher.claimedAt === 0n ? null : voucher.claimedAt.toString(),
        // 11.10: thirty days from the claim, the contract's constant.
        redeemBy: voucher.claimedAt === 0n ? null : (voucher.claimedAt + BigInt(VOUCHER_REDEEM_WINDOW_SECONDS)).toString(),
      });
    }
  }

  await log.event('route.ok', { vouchers: vouchers.length });
  return ok({ vouchers, complete: pages <= VOUCHER_LIST_MAX_PAGES });
});

/**
 * 8.10: exported as a named async function declaration.
 */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
