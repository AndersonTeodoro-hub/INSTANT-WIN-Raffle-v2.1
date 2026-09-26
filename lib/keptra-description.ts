/**
 * SPEC-BLOCO-03 T4: the product description of an offer or an obligation — a
 * title and a text, no images — written by the store or the brand when it creates
 * it, never changed after, shown before paying or redeeming and handed to the
 * arbiter with the evidence.
 *
 * Shared by the page (the form's limits) and the bridge (the check before the
 * write), so both sides normalise a description the one way, as
 * lib/campaign-identity.ts does for a campaign's identity.
 */

import { multiLine, singleLine } from './campaign-identity.js';

export const DESCRIPTION_TITLE_MAX = 120;
export const DESCRIPTION_TEXT_MAX = 2_000;
export const DESCRIPTION_TEXT_MAX_LINES = 40;

export interface ProductDescription {
  readonly title: string;
  readonly text: string;
}

export type DescriptionCheck =
  | { readonly ok: true; readonly value: ProductDescription }
  | { readonly ok: false; readonly field: 'title' | 'text' };

/** The title on one line, the text on at most DESCRIPTION_TEXT_MAX_LINES; no invisible characters, no link in the title. */
export function checkDescription(input: { title: unknown; text: unknown }): DescriptionCheck {
  const title = singleLine(input.title, DESCRIPTION_TITLE_MAX);
  if (title === null) return { ok: false, field: 'title' };
  const text = multiLine(input.text, DESCRIPTION_TEXT_MAX, DESCRIPTION_TEXT_MAX_LINES);
  if (text === null) return { ok: false, field: 'text' };
  return { ok: true, value: { title, text } };
}
