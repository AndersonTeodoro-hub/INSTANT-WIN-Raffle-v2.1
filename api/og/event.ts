import { handle } from '../../lib/bridge-v2/http.js';
import { enforce } from '../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../lib/bridge-v2/validate.js';
import { readIdentity } from '../../lib/bridge-v2/campaignIdentity.js';
import type { PublicIdentity } from '../../lib/campaign-identity.js';

/**
 * GET /api/og/event?id=<giveawayId>
 *
 * L10: WHAT A LINK PREVIEW SEES. The app is a single-page bundle, so every path
 * answers with the same index.html and a crawler — which runs no JavaScript —
 * reads the same title and image for /events/2 as for the home page. vercel.json
 * rewrites /events/<digits> to this function only when the user agent is a link
 * preview fetcher, and only when the URL does not carry ?app, so:
 *
 *   - a person opening /events/2 never reaches this file; the rewrite does not
 *     match them and the SPA is served exactly as before;
 *   - a preview fetcher gets a small document whose tags are the campaign's;
 *   - a person whose browser happens to look like a fetcher follows the one link
 *     on that document to /events/2?app=1, which the rewrite does not match.
 *
 * Search engine crawlers are deliberately NOT in the rewrite. They render the
 * SPA themselves, and serving them a different document from the one people get
 * is the definition of cloaking.
 *
 * L9: WITHOUT AN IDENTITY THE TAGS ARE index.html's OWN, so a campaign that has
 * published nothing previews exactly as it did before this route existed. The
 * identity suite reads index.html and asserts the two agree.
 *
 * Outside api/bridge/v2 because it reads its id from the URL, which D4 forbids
 * there for a reason that does not apply to a public campaign id — and because
 * the envelope's JSON error would be the worst thing to hand a crawler.
 */

const SITE = 'https://instntwin.com';

/** Everything that is printed is escaped. The name and the message are the creator's. */
const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const oneLine = (value: string, max: number) => {
  const text = value.replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
};

/** index.html's head, tag for tag. */
const FALLBACK_TAGS = [
  '<title>Instant Win — Provably Fair Raffle on Arbitrum</title>',
  '<meta name="description" content="A provably fair on-chain raffle on Arbitrum One. 3 winners per 30-minute round, tickets from 1 USDC, drawn by Chainlink VRF. Winners claim their prize on-chain.">',
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="Instant Win — Provably Fair Raffle on Arbitrum">',
  '<meta property="og:description" content="3 winners per 30-minute round, tickets from 1 USDC, drawn by Chainlink VRF. Winners claim on-chain. Live on Arbitrum One.">',
  '<meta property="og:image" content="https://instntwin.com/og-image.png">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:image" content="https://instntwin.com/og-image.png">',
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#0A0A0B">',
];

function identityTags(identity: PublicIdentity, page: string): string[] {
  const name = escape(identity.name);
  const description = escape(oneLine(`${identity.brand} — ${identity.message}`, 200));
  const image = escape(identity.banner.url);
  return [
    `<title>${name} — ${escape(identity.brand)}</title>`,
    `<meta name="description" content="${description}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Instant Win">',
    `<meta property="og:url" content="${escape(page)}">`,
    `<meta property="og:title" content="${name}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:type" content="${escape(identity.banner.type)}">`,
    `<meta property="og:image:width" content="${identity.banner.width}">`,
    `<meta property="og:image:height" content="${identity.banner.height}">`,
    `<meta property="og:image:alt" content="${name}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${image}">`,
    `<link rel="canonical" href="${escape(page)}">`,
  ];
}

function previewDocument(identity: PublicIdentity | null, giveawayId: string | null): string {
  const page = giveawayId === null ? `${SITE}/events` : `${SITE}/events/${giveawayId}`;
  const title = identity === null ? 'Instant Win — Event Center' : identity.name;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    ...(identity === null ? FALLBACK_TAGS : identityTags(identity, page)),
    '</head>',
    '<body>',
    `<p><a href="${escape(`${page}?app=1`)}">${escape(title)}</a></p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const route = handle('og/event', async ({ request, log }) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed.', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  const giveawayId = parseGiveawayId(new URL(request.url).searchParams.get('id'));

  let identity: PublicIdentity | null = null;
  // Whether this answer is the real one and may be cached at the edge. A preview
  // that fell back because the limiter or the database said no is served, never
  // cached: otherwise one bad second is the preview every crawler sees for the
  // next five minutes.
  let settled = giveawayId === null;
  if (giveawayId !== null) {
    try {
      const signals = await extractSignals(request);
      const verdict = await enforce([
        { axis: 'IP', value: signals.ipHash },
        { axis: 'ROUTE_GLOBAL', value: 'og/event' },
      ]);
      if (verdict.allowed) {
        identity = await readIdentity(giveawayId);
        settled = true;
      }
    } catch (error) {
      await log.failure('route.error', error);
    }
  }

  const body = previewDocument(identity, giveawayId === null ? null : giveawayId.toString());
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': settled ? 'public, max-age=0, s-maxage=300' : 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
});

export async function GET(request: Request): Promise<Response> {
  return route(request);
}

export async function HEAD(request: Request): Promise<Response> {
  return route(request);
}
