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
export const PRIVACY_TEXT = `KEPTRA — PRIVACY NOTICE

Who we are
Keptra is operated by Anderson Luiz Lages Teodoro, Portugal. Contact for privacy requests: instantwin.official@gmail.com

What we collect and why
- Delivery address: collected when you pay for an order or redeem a prize voucher, so the store or brand can ship your item. It is shared only with the store or brand fulfilling that order. (Legal basis: performance of a contract)
- Email address: used only to send you notices about your orders (for example, when your action window opens). (Legal basis: performance of a contract and our legitimate interest in providing a reliable service)
- Tracking number: provided by the store when it ships your order, and sent to our tracking provider to confirm delivery.
- Recipient phone number: we keep only a one-way hash of it, never the number itself. The hash is kept with no deadline, because each store's count of distinct recipients is permanent.
- Account: your account is secured by a passkey on your device. We do not hold your passkey.

Service providers & international transfers
- Ship24, as a processor, to track deliveries. Ship24 receives only the tracking number, the postal code and the country, never your name, email or full address. Data sent to Ship24 is kept according to Ship24's own retention policy.
- Resend, to send email notices.
- Vercel and Supabase, to host the service and its database.
Some of these providers may process your data outside the European Economic Area (EEA). When this happens, we ensure your data is protected by legal safeguards such as the Standard Contractual Clauses approved by the European Commission.

What is public
Payments, orders and prizes are recorded on the Arbitrum One blockchain. Records on a public blockchain are visible to anyone and cannot be changed or deleted by us or by anyone else. Your delivery address and email are never written to the blockchain.

How long we keep your data
The data Keptra keeps about an order, including any dispute evidence, is erased within 30 days after the order reaches its final state.

Your rights
- Export: you can download your data from your Account page.
- Erase: you can delete your data from your Account page. Erasure is refused while you still have USDC or vouchers in either of your Keptra accounts, or an open order as a buyer or as a store.
- Rectify, and any other request: contact us at the address above.
- You also have the right to complain to a data protection authority. In Portugal, this is the Comissão Nacional de Proteção de Dados (CNPD).

Changes
If this notice changes, the new version will be published on this page. Last updated: 24 September 2026.`;

/** T14: whether the address forms may open. */
export const privacyPublished = (text: string = PRIVACY_TEXT): boolean => text.trim().length > 0;
