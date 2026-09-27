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
import type { Lang } from '../../pages/landing.i18n';

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

/**
 * The same notice in Portuguese and Spanish, for the page in those languages (the
 * owner's decision of 27/09/2026: the Keptra screens follow the language switch).
 * Translations of the owner's English text above, which stays the reference: a
 * change to it is a change to these two as well. Same structure — blocks, headings,
 * "- " items, a short label before a colon — so the page lays them out the same way.
 */
export const PRIVACY_TEXTS: Record<Lang, string> = {
  en: PRIVACY_TEXT,
  pt: `KEPTRA — AVISO DE PRIVACIDADE

Quem somos
A Keptra é operada por Anderson Luiz Lages Teodoro, Portugal. Contacto para pedidos de privacidade: instantwin.official@gmail.com

O que recolhemos e porquê
- Morada de entrega: recolhida quando paga uma encomenda ou resgata um voucher de prémio, para que a loja ou a marca possa enviar o seu artigo. É partilhada apenas com a loja ou a marca que cumpre essa encomenda. (Fundamento jurídico: execução de um contrato)
- Endereço de email: usado apenas para lhe enviar avisos sobre as suas encomendas (por exemplo, quando abre a sua janela de acção). (Fundamento jurídico: execução de um contrato e o nosso interesse legítimo em prestar um serviço fiável)
- Número de seguimento: fornecido pela loja quando envia a sua encomenda, e enviado ao nosso fornecedor de seguimento para confirmar a entrega.
- Telefone do destinatário: guardamos apenas um hash unidireccional, nunca o próprio número. O hash é guardado sem prazo, porque a contagem de destinatários distintos de cada loja é permanente.
- Conta: a sua conta é protegida por uma passkey no seu dispositivo. Não guardamos a sua passkey.

Prestadores de serviços e transferências internacionais
- Ship24, como subcontratante, para seguir as entregas. A Ship24 recebe apenas o número de seguimento, o código postal e o país, nunca o seu nome, email ou morada completa. Os dados enviados à Ship24 são guardados de acordo com a política de conservação da própria Ship24.
- Resend, para enviar os avisos por email.
- Vercel e Supabase, para alojar o serviço e a sua base de dados.
Alguns destes prestadores podem tratar os seus dados fora do Espaço Económico Europeu (EEE). Quando isso acontece, garantimos que os seus dados ficam protegidos por garantias legais, como as Cláusulas Contratuais-Tipo aprovadas pela Comissão Europeia.

O que é público
Pagamentos, encomendas e prémios são registados na blockchain Arbitrum One. Os registos numa blockchain pública são visíveis para qualquer pessoa e não podem ser alterados nem apagados por nós nem por mais ninguém. A sua morada de entrega e o seu email nunca são escritos na blockchain.

Durante quanto tempo guardamos os seus dados
Os dados que a Keptra guarda sobre uma encomenda, incluindo qualquer prova de uma contestação, são apagados no prazo de 30 dias depois de a encomenda chegar ao seu estado final.

Os seus direitos
- Exportar: pode descarregar os seus dados na página Conta.
- Apagar: pode apagar os seus dados na página Conta. O apagamento é recusado enquanto ainda tiver USDC ou vouchers em qualquer uma das suas contas Keptra, ou uma encomenda em aberto como comprador ou como loja.
- Rectificar e outros pedidos: contacte-nos pelo endereço acima.
- Tem também o direito de apresentar reclamação a uma autoridade de protecção de dados. Em Portugal, é a Comissão Nacional de Proteção de Dados (CNPD).

Alterações
Se este aviso mudar, a nova versão será publicada nesta página. Última actualização: 24 de Setembro de 2026.`,
  es: `KEPTRA — AVISO DE PRIVACIDAD

Quiénes somos
Keptra es un servicio operado por Anderson Luiz Lages Teodoro, Portugal. Contacto para solicitudes de privacidad: instantwin.official@gmail.com

Qué recogemos y por qué
- Dirección de entrega: se recoge cuando pagas un pedido o canjeas un vale de premio, para que la tienda o la marca pueda enviarte el artículo. Solo se comparte con la tienda o la marca que cumple ese pedido. (Base jurídica: ejecución de un contrato)
- Dirección de email: se usa solo para enviarte avisos sobre tus pedidos (por ejemplo, cuando se abre tu plazo para actuar). (Base jurídica: ejecución de un contrato y nuestro interés legítimo en prestar un servicio fiable)
- Número de seguimiento: lo facilita la tienda cuando envía tu pedido, y se envía a nuestro proveedor de seguimiento para confirmar la entrega.
- Teléfono del destinatario: guardamos solo un hash unidireccional, nunca el número en sí. El hash se guarda sin plazo, porque el recuento de destinatarios distintos de cada tienda es permanente.
- Cuenta: tu cuenta está protegida por una passkey en tu dispositivo. No guardamos tu passkey.

Proveedores de servicios y transferencias internacionales
- Ship24, como encargado del tratamiento, para seguir las entregas. Ship24 recibe solo el número de seguimiento, el código postal y el país, nunca tu nombre, email o dirección completa. Los datos enviados a Ship24 se conservan según la política de conservación de la propia Ship24.
- Resend, para enviar los avisos por email.
- Vercel y Supabase, para alojar el servicio y su base de datos.
Algunos de estos proveedores pueden tratar tus datos fuera del Espacio Económico Europeo (EEE). Cuando esto ocurre, nos aseguramos de que tus datos estén protegidos por garantías legales como las Cláusulas Contractuales Tipo aprobadas por la Comisión Europea.

Qué es público
Los pagos, pedidos y premios se registran en la blockchain Arbitrum One. Los registros en una blockchain pública son visibles para cualquiera y no pueden ser modificados ni borrados por nosotros ni por nadie. Tu dirección de entrega y tu email nunca se escriben en la blockchain.

Cuánto tiempo guardamos tus datos
Los datos que Keptra guarda sobre un pedido, incluida cualquier prueba de una impugnación, se borran en un plazo de 30 días después de que el pedido llegue a su estado final.

Tus derechos
- Exportar: puedes descargar tus datos desde la página Cuenta.
- Borrar: puedes borrar tus datos desde la página Cuenta. El borrado se rechaza mientras aún tengas USDC o vales en cualquiera de tus cuentas Keptra, o un pedido abierto como comprador o como tienda.
- Rectificar y otras solicitudes: contáctanos en la dirección indicada arriba.
- También tienes derecho a presentar una reclamación ante una autoridad de protección de datos. En Portugal, es la Comissão Nacional de Proteção de Dados (CNPD).

Cambios
Si este aviso cambia, la nueva versión se publicará en esta página. Última actualización: 24 de septiembre de 2026.`,
};

/** T14: whether the address forms may open. */
export const privacyPublished = (text: string = PRIVACY_TEXT): boolean => text.trim().length > 0;
