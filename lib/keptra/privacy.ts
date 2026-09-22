/**
 * The privacy page's text. SPEC-BLOCO-03 10.4, P6, P7, R6 and T14.
 *
 * The text is the owner's (T14), and it is empty until the owner writes it here:
 * paragraphs separated by a blank line, plain text. While it is empty the privacy
 * page says it has not been published, and every delivery-address form stays
 * locked — the first address is never asked for before the page exists (10.4).
 *
 * What the owner's text must cover, from the spec (not written here, because it is
 * the owner's): the Ship24 processor and its retention (P7), the phone hash kept
 * without a deadline for the distinct-recipient count (R6), erasure within 30 days
 * of an order's final state (10.3).
 */
export const PRIVACY_TEXT = '';

/** T14: whether the address forms may open. */
export const privacyPublished = (text: string = PRIVACY_TEXT): boolean => text.trim().length > 0;
