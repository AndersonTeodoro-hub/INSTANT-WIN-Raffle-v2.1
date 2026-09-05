/**
 * The request envelope every Bridge V2 route runs inside.
 *
 * K6: no code path sits outside error handling. In the V1, verify.ts called
 * getSupabase() before the try block, so a configuration failure escaped as an
 * unhandled 500 with whatever the driver said in it. Here the route body is a
 * callback and the wrapper owns the try, so there is no "before the try" to get
 * wrong.
 *
 * D5: an operational failure returns one fixed sentence. Nothing about pool
 * saturation, funder exhaustion or database state reaches the client, because
 * each of those is a capacity signal an attacker can use.
 *
 * D3: paths that could reveal whether an email exists are padded to a floor, so
 * what the body refuses to distinguish the latency does not give away either.
 */

import { MAX_BODY_BYTES, REQUIRED_CONTENT_TYPE, UNIFORM_RESPONSE_MS } from './config.js';
import { correlationId } from './crypto.js';
import { createLogger, type Logger } from './log.js';
import { MissingEnvError } from './env.js';

/** The single generic failure sentence (D5). */
const GENERIC_ERROR = 'Something went wrong. Please try again.';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export function ok(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ ok: true, ...body }, 200, headers);
}

/** A refusal the client is allowed to understand: bad input, or a limit. */
export function refuse(status: number, message: string, headers: Record<string, string> = {}): Response {
  return json({ ok: false, error: message }, status, headers);
}

/**
 * D2: the deliberately indistinguishable answer.
 *
 * Every route that could otherwise confirm an address exists returns this, with
 * the same shape and the same status, whether or not anything happened. The V1
 * returned 409 "This email has already entered", which is finding #10: a
 * membership oracle for anyone who cared to ask.
 */
export function accepted(): Response {
  return json({ ok: true, status: 'accepted' }, 200);
}

/**
 * I3: size and content type are checked before parsing, not after.
 *
 * Content-Length can be absent or wrong, so the decoded body is measured as
 * well. A body that lies about its length is refused on the real number.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes(REQUIRED_CONTENT_TYPE)) return null;

  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) return null;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > MAX_BODY_BYTES) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** D3: pads a response so an existence check cannot be timed. */
export async function padTo(startedAt: number, floorMs: number = UNIFORM_RESPONSE_MS): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < floorMs) await new Promise((resolve) => setTimeout(resolve, floorMs - elapsed));
}

export interface RouteContext {
  readonly request: Request;
  readonly log: Logger;
  readonly startedAt: number;
}

/**
 * Wraps a route so that every exit is accounted for.
 *
 * A thrown MissingEnvError is configuration, not a client problem, and its
 * message carries variable names only (F3) — but even names are internal, so the
 * client still gets the generic sentence and the names go to the log.
 */
export function handle(
  route: string,
  body: (context: RouteContext) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now();
    const log = createLogger(route, correlationId());
    try {
      return await body({ request, log, startedAt });
    } catch (error) {
      if (error instanceof MissingEnvError) {
        await log.failure('route.error', error, { missing: error.names.join(',') });
      } else {
        await log.failure('route.error', error);
      }
      return refuse(500, GENERIC_ERROR);
    }
  };
}

/** Rejects any method other than the one the route implements. */
export function methodGuard(request: Request, method: 'POST' | 'GET'): Response | null {
  return request.method === method ? null : refuse(405, 'Method not allowed.');
}
