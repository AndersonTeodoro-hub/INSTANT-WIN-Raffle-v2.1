import { useLang } from './landing.i18n';
import type { Lang } from './landing.i18n';

// i18n da página /giveaways. Mesmo padrão do roadmap.i18n.ts: objecto de lookup
// por idioma, sem biblioteca, `Lang`/`useLang`/persistência vindos do landing.i18n.
//
// Fonte do texto: ROADMAP.md (secção 02 — Onchain Event Center) e as constantes
// reais do GiveawayManager V1 em constants.ts. Nada aqui promete o que o
// contrato não faz, e nenhuma frase tem data.
//
// Números: NÃO se escrevem à mão neste ficheiro. Os limites (5%, 1.000, 100.000,
// 1h–30d) vivem em GIVEAWAY_LIMITS e a página compõe os valores a partir de lá —
// aqui ficam só os rótulos. É a única forma de a copy não divergir do contrato.

interface Bullet {
  lead: string;
  rest: string;
}

export interface GiveawaysCopy {
  meta: { title: string; description: string };
  waitlist: { short: string; cta: string; headline: string; body: string };
  hero: { eyebrow: string; title: string; intro: string; bullets: Bullet[] };
  proof: {
    eyebrow: string;
    title: string;
    verifyLabel: string;
    matchLabel: string;
    /** Rótulos das constantes; a ordem casa com SPECS em Giveaways.tsx. */
    specs: string[];
    /**
     * Palavras que envolvem os números das constantes. Os números continuam a
     * vir de GIVEAWAY_LIMITS e são idênticos nas três línguas — o que se traduz
     * é só o texto à volta, para o painel de prova não ficar meio em inglês.
     */
    specWords: { upTo: string; anyErc20: string; hour: string; days: string };
    discipline: string;
  };
  wizard: {
    eyebrow: string;
    title: string;
    intro: string;
    banner: string;
    /**
     * Locale BCP 47 para a data de fecho das entradas no passo da revisão.
     * Vive aqui e não no componente porque é dado de idioma como qualquer outro
     * — sem isto a página em português mostrava "5 Sept 2026".
     */
    dateLocale: string;
    stepOf: string;
    stepNames: string[];
    back: string;
    next: string;
    restart: string;
    prize: {
      title: string;
      hint: string;
      tokenLabel: string;
      tokenUsdc: string;
      tokenCustom: string;
      addressLabel: string;
      decimalsLabel: string;
      amountLabel: string;
      amountHint: string;
    };
    timing: {
      title: string;
      hint: string;
      durationLabel: string;
      unitHours: string;
      unitDays: string;
      endsLabel: string;
      winnersLabel: string;
      winnersHint: string;
    };
    eligibility: {
      title: string;
      hint: string;
      openTitle: string;
      openBody: string;
      allowTitle: string;
      allowBody: string;
      allowLabel: string;
      allowPlaceholder: string;
      allowCount: string;
      merkleNote: string;
    };
    review: {
      title: string;
      hint: string;
      rowToken: string;
      rowPrize: string;
      rowFee: string;
      rowTotal: string;
      rowDuration: string;
      rowEnds: string;
      rowWinners: string;
      rowShare: string;
      rowEligibility: string;
      openValue: string;
      allowValue: string;
      dustNote: string;
      clampNote: string;
    };
    submit: {
      title: string;
      body: string;
      cta: string;
      note: string;
    };
    errors: {
      amountInvalid: string;
      amountDust: string;
      addressInvalid: string;
      decimalsInvalid: string;
      durationRange: string;
      winnersRange: string;
      allowEmpty: string;
      allowTooMany: string;
      allowInvalid: string;
    };
  };
  participants: { eyebrow: string; title: string; body: string };
  outro: { back: string };
}

const en: GiveawaysCopy = {
  meta: {
    title: 'Instant Win — Giveaways',
    description:
      'Provably fair giveaways on Arbitrum One. Free entry for participants, any ERC-20 as the prize, winners drawn by Chainlink VRF. Deployed and verified contract, campaign creation in preview.',
  },
  waitlist: {
    short: 'Waitlist',
    cta: 'Join the waitlist',
    headline: 'Want to enter giveaways, not run them?',
    body: 'One waitlist covers the whole Event Center. Join it and you hear first when campaigns open to entrants.',
  },
  hero: {
    eyebrow: 'Event Center · Module 02',
    title: 'Giveaways, provably fair.',
    intro:
      'Most giveaway platforms are web2 products with crypto branding: you are asked to trust that the draw happened. Here the draw is the proof. A creator funds a prize, entrants join for free, and Chainlink VRF picks the winners on-chain where anyone can check the result.',
    bullets: [
      {
        lead: 'Free entry for participants',
        rest: ' — the creator funds the prize up front. Entrants never pay, and no participant funds are ever collected.',
      },
      {
        lead: 'Any ERC-20 as the prize',
        rest: ' — stablecoins, project tokens, tokenized assets. One wallet, one entry.',
      },
      {
        lead: 'Winners drawn by Chainlink VRF',
        rest: ' — no admin can pick, change or block a winner, not even us.',
      },
      {
        lead: 'Prizes claimed from the contract',
        rest: ' — pull-payment, exactly like the lottery. Claims are never pausable and nothing can be trapped.',
      },
      {
        lead: 'For brands, communities and creators',
        rest: ' — open campaigns, or an eligibility list when entries need to be restricted.',
      },
    ],
  },
  proof: {
    eyebrow: 'Proof',
    title: 'This is not a mockup.',
    verifyLabel: 'GiveawayManager · Arbitrum One',
    matchLabel: 'Verified · Exact Match',
    specs: [
      'Platform fee',
      'Winners per campaign',
      'Participants per campaign',
      'Prize asset',
      'Campaign duration',
    ],
    specWords: { upTo: 'Up to', anyErc20: 'Any ERC-20', hour: 'hour', days: 'days' },
    discipline:
      'Deployed and verified on Arbitrum One. Campaign creation opens after our lottery’s public launch — we ship in order.',
  },
  wizard: {
    eyebrow: 'Campaign creation',
    title: 'Walk the flow.',
    intro:
      'The exact steps a creator will take, with the real limits the contract enforces. Nothing here connects a wallet or sends a transaction — it is a preview you can click through end to end.',
    banner: 'PREVIEW MODE · no wallet, no transaction, nothing leaves this page',
    dateLocale: 'en-GB',
    stepOf: 'of',
    stepNames: ['Prize', 'Timing', 'Eligibility', 'Review', 'Early access'],
    back: 'Back',
    next: 'Continue',
    restart: 'Start over',
    prize: {
      title: 'What is the prize?',
      hint: 'The creator deposits the full prize plus the platform fee when the campaign is created. The contract records the amount actually received, so fee-on-transfer tokens are handled correctly.',
      tokenLabel: 'Prize token',
      tokenUsdc: 'USDC',
      tokenCustom: 'Other ERC-20',
      addressLabel: 'Token address',
      decimalsLabel: 'Decimals',
      amountLabel: 'Prize amount',
      amountHint: 'Split equally between the winners you choose in the next step.',
    },
    timing: {
      title: 'How long, and how many winners?',
      hint: 'Entries close at the end time. Closing is permissionless: automation calls it, but anyone can — a campaign can never be held open.',
      durationLabel: 'Entry window',
      unitHours: 'hours',
      unitDays: 'days',
      endsLabel: 'Entries would close',
      winnersLabel: 'Number of winners',
      winnersHint: 'If fewer people enter than the number of winners, the contract clamps it to the actual participants.',
    },
    eligibility: {
      title: 'Who can enter?',
      hint: 'One wallet, one entry, in both modes.',
      openTitle: 'Open to any wallet',
      openBody:
        'Anyone on Arbitrum One can enter. Open campaigns accept sybil entries by design — that is the creator’s informed choice.',
      allowTitle: 'Eligibility list',
      allowBody:
        'Only the wallets you list can enter. This is the sybil defence for brands, and the compliance tool for transfer-restricted tokens.',
      allowLabel: 'Eligible wallets',
      allowPlaceholder: '0x… one address per line',
      allowCount: 'eligible wallets',
      merkleNote:
        'The list becomes a Merkle root off-chain. Only 32 bytes go on-chain — the contract never publishes the addresses themselves.',
    },
    review: {
      title: 'Review the campaign.',
      hint: 'Every figure below is computed with the same integer maths the contract uses.',
      rowToken: 'Prize token',
      rowPrize: 'Prize pool',
      rowFee: 'Platform fee (5%)',
      rowTotal: 'You would deposit',
      rowDuration: 'Entry window',
      rowEnds: 'Entries close',
      rowWinners: 'Winners',
      rowShare: 'Share per winner',
      rowEligibility: 'Eligibility',
      openValue: 'Open to any wallet',
      allowValue: 'Eligibility list',
      dustNote:
        'An indivisible remainder goes to the first winner drawn — deterministic, and the full prize is always distributed.',
      clampNote: 'Winners are clamped to the number of actual participants at close.',
    },
    submit: {
      title: 'Campaign creation opens after public launch.',
      body: 'The contract is deployed and verified, but creation stays closed until the lottery is publicly launched — we ship in order, and we do not open a revenue product on top of an unlaunched one. Request early access to be in the first group when it opens.',
      cta: 'Request early access',
      note: 'Nothing you typed was stored or sent. This preview keeps everything inside the page.',
    },
    errors: {
      amountInvalid: 'Enter a prize amount greater than zero, with no more decimals than the token has.',
      amountDust: 'Prize too small: the 5% fee would round to zero, and the contract rejects it.',
      addressInvalid: 'Enter a valid contract address (0x followed by 40 hex characters).',
      decimalsInvalid: 'Decimals must be between 0 and 36.',
      durationRange: 'The contract accepts 1 hour to 30 days.',
      winnersRange: 'The contract accepts 1 to 1,000 winners.',
      allowEmpty: 'Add at least one eligible wallet, or switch to an open campaign.',
      allowTooMany: 'The contract caps a campaign at 100,000 participants.',
      allowInvalid: 'Some lines are not valid addresses.',
    },
  },
  participants: {
    eyebrow: 'For entrants',
    title: 'Not running a campaign?',
    body: 'Entering a giveaway will always be free. There is one waitlist for the whole Event Center — the lottery, giveaways and everything after.',
  },
  outro: { back: 'Back to instantwin' },
};

/*
 * Português europeu, mesma norma da /roadmap: "lotaria", "levantar", "prémio",
 * "utilizador", "ficheiro". Termos do sector ficam em inglês nos três idiomas —
 * pull-payment, allowlist, on-chain, wallet, VRF, ERC-20, Exact Match, early
 * access, preview, permissionless, sybil, compliance, Merkle root,
 * fee-on-transfer — porque é assim que quem cria campanhas os lê.
 */
const pt: GiveawaysCopy = {
  meta: {
    title: 'Instant Win — Giveaways',
    description:
      'Giveaways comprovadamente justos na Arbitrum One. Entrada gratuita para os participantes, qualquer ERC-20 como prémio, vencedores sorteados por Chainlink VRF. Contrato deployado e verificado, criação de campanhas em preview.',
  },
  waitlist: {
    short: 'Lista de espera',
    cta: 'Entrar na lista de espera',
    headline: 'Quer entrar em giveaways, não organizá-los?',
    body: 'Uma única lista de espera cobre todo o Event Center. Entre nela e fica a saber primeiro quando as campanhas abrirem a participantes.',
  },
  hero: {
    eyebrow: 'Event Center · Módulo 02',
    title: 'Giveaways, comprovadamente justos.',
    intro:
      'A maioria das plataformas de giveaways são produtos web2 com marca cripto: pedem-lhe que confie que o sorteio aconteceu. Aqui o sorteio é a prova. Um criador financia um prémio, quem entra participa de graça, e o Chainlink VRF escolhe os vencedores on-chain, onde qualquer pessoa pode verificar o resultado.',
    bullets: [
      {
        lead: 'Entrada gratuita para os participantes',
        rest: ' — o criador financia o prémio à cabeça. Quem entra nunca paga, e nunca são recolhidos fundos de participantes.',
      },
      {
        lead: 'Qualquer ERC-20 como prémio',
        rest: ' — stablecoins, tokens de projeto, ativos tokenizados. Uma wallet, uma entrada.',
      },
      {
        lead: 'Vencedores sorteados por Chainlink VRF',
        rest: ' — nenhum admin pode escolher, alterar ou bloquear um vencedor, nem nós.',
      },
      {
        lead: 'Prémios levantados do contrato',
        rest: ' — pull-payment, exatamente como na lotaria. Os levantamentos nunca podem ser pausados e nada pode ficar preso.',
      },
      {
        lead: 'Para marcas, comunidades e criadores',
        rest: ' — campanhas abertas, ou uma lista de elegibilidade quando as entradas têm de ser restringidas.',
      },
    ],
  },
  proof: {
    eyebrow: 'Prova',
    title: 'Isto não é um mockup.',
    verifyLabel: 'GiveawayManager · Arbitrum One',
    matchLabel: 'Verificado · Exact Match',
    specs: [
      'Taxa da plataforma',
      'Vencedores por campanha',
      'Participantes por campanha',
      'Ativo do prémio',
      'Duração da campanha',
    ],
    specWords: { upTo: 'Até', anyErc20: 'Qualquer ERC-20', hour: 'hora', days: 'dias' },
    discipline:
      'Deployado e verificado na Arbitrum One. A criação de campanhas abre depois do lançamento público da nossa lotaria — lançamos por ordem.',
  },
  wizard: {
    eyebrow: 'Criação de campanhas',
    title: 'Percorra o fluxo.',
    intro:
      'Os passos exatos que um criador vai dar, com os limites reais que o contrato impõe. Nada aqui liga uma wallet nem envia uma transação — é um preview que pode percorrer de ponta a ponta.',
    banner: 'MODO PREVIEW · sem wallet, sem transação, nada sai desta página',
    dateLocale: 'pt-PT',
    stepOf: 'de',
    stepNames: ['Prémio', 'Prazos', 'Elegibilidade', 'Revisão', 'Early access'],
    back: 'Voltar',
    next: 'Continuar',
    restart: 'Recomeçar',
    prize: {
      title: 'Qual é o prémio?',
      hint: 'O criador deposita o prémio completo mais a taxa da plataforma quando a campanha é criada. O contrato regista o montante efetivamente recebido, por isso os tokens fee-on-transfer são tratados corretamente.',
      tokenLabel: 'Token do prémio',
      tokenUsdc: 'USDC',
      tokenCustom: 'Outro ERC-20',
      addressLabel: 'Endereço do token',
      decimalsLabel: 'Decimais',
      amountLabel: 'Montante do prémio',
      amountHint: 'Dividido em partes iguais pelos vencedores que escolher no passo seguinte.',
    },
    timing: {
      title: 'Durante quanto tempo, e quantos vencedores?',
      hint: 'As entradas fecham na hora de fim. O fecho é permissionless: a automação chama-o, mas qualquer pessoa pode — uma campanha nunca pode ser mantida aberta.',
      durationLabel: 'Janela de entrada',
      unitHours: 'horas',
      unitDays: 'dias',
      endsLabel: 'As entradas fechariam',
      winnersLabel: 'Número de vencedores',
      winnersHint: 'Se entrarem menos pessoas do que o número de vencedores, o contrato limita-o aos participantes efetivos.',
    },
    eligibility: {
      title: 'Quem pode entrar?',
      hint: 'Uma wallet, uma entrada, nos dois modos.',
      openTitle: 'Aberto a qualquer wallet',
      openBody:
        'Qualquer pessoa na Arbitrum One pode entrar. As campanhas abertas aceitam entradas sybil por desenho — é a escolha informada do criador.',
      allowTitle: 'Lista de elegibilidade',
      allowBody:
        'Só as wallets que listar podem entrar. É esta a defesa contra sybil para as marcas, e a ferramenta de compliance para tokens com transferência restrita.',
      allowLabel: 'Wallets elegíveis',
      allowPlaceholder: '0x… um endereço por linha',
      allowCount: 'wallets elegíveis',
      merkleNote:
        'A lista torna-se uma Merkle root off-chain. Só 32 bytes vão para on-chain — o contrato nunca publica os próprios endereços.',
    },
    review: {
      title: 'Reveja a campanha.',
      hint: 'Todos os valores abaixo são calculados com a mesma aritmética de inteiros que o contrato usa.',
      rowToken: 'Token do prémio',
      rowPrize: 'Pool do prémio',
      rowFee: 'Taxa da plataforma (5%)',
      rowTotal: 'Depositaria',
      rowDuration: 'Janela de entrada',
      rowEnds: 'As entradas fecham',
      rowWinners: 'Vencedores',
      rowShare: 'Quota por vencedor',
      rowEligibility: 'Elegibilidade',
      openValue: 'Aberto a qualquer wallet',
      allowValue: 'Lista de elegibilidade',
      dustNote:
        'Um resto indivisível vai para o primeiro vencedor sorteado — determinístico, e o prémio completo é sempre distribuído.',
      clampNote: 'Os vencedores são limitados ao número de participantes efetivos no fecho.',
    },
    submit: {
      title: 'A criação de campanhas abre depois do lançamento público.',
      body: 'O contrato está deployado e verificado, mas a criação continua fechada até a lotaria ser lançada publicamente — lançamos por ordem, e não abrimos um produto de receita em cima de um que ainda não foi lançado. Peça early access para estar no primeiro grupo quando abrir.',
      cta: 'Pedir early access',
      note: 'Nada do que escreveu foi guardado ou enviado. Este preview mantém tudo dentro da página.',
    },
    errors: {
      amountInvalid: 'Introduza um montante de prémio maior do que zero, com não mais decimais do que o token tem.',
      amountDust: 'Prémio demasiado pequeno: a taxa de 5% arredondaria para zero, e o contrato rejeita-o.',
      addressInvalid: 'Introduza um endereço de contrato válido (0x seguido de 40 caracteres hexadecimais).',
      decimalsInvalid: 'Os decimais têm de estar entre 0 e 36.',
      durationRange: 'O contrato aceita de 1 hora a 30 dias.',
      winnersRange: 'O contrato aceita de 1 a 1,000 vencedores.',
      allowEmpty: 'Adicione pelo menos uma wallet elegível, ou mude para uma campanha aberta.',
      allowTooMany: 'O contrato limita uma campanha a 100,000 participantes.',
      allowInvalid: 'Algumas linhas não são endereços válidos.',
    },
  },
  participants: {
    eyebrow: 'Para participantes',
    title: 'Não vai organizar uma campanha?',
    body: 'Entrar num giveaway será sempre gratuito. Há uma única lista de espera para todo o Event Center — a lotaria, os giveaways e tudo o que vier a seguir.',
  },
  outro: { back: 'Voltar a instantwin' },
};

const es: GiveawaysCopy = {
  meta: {
    title: 'Instant Win — Giveaways',
    description:
      'Giveaways demostrablemente justos en Arbitrum One. Entrada gratuita para los participantes, cualquier ERC-20 como premio, ganadores sorteados por Chainlink VRF. Contrato desplegado y verificado, creación de campañas en preview.',
  },
  waitlist: {
    short: 'Lista de espera',
    cta: 'Unirse a la lista de espera',
    headline: '¿Quieres entrar en giveaways, no organizarlos?',
    body: 'Una sola lista de espera cubre todo el Event Center. Únete y te enteras primero cuando las campañas abran a participantes.',
  },
  hero: {
    eyebrow: 'Event Center · Módulo 02',
    title: 'Giveaways, demostrablemente justos.',
    intro:
      'La mayoría de las plataformas de giveaways son productos web2 con marca cripto: se te pide confiar en que el sorteo ocurrió. Aquí el sorteo es la prueba. Un creador financia un premio, quien entra participa gratis, y Chainlink VRF elige a los ganadores on-chain, donde cualquiera puede verificar el resultado.',
    bullets: [
      {
        lead: 'Entrada gratuita para los participantes',
        rest: ' — el creador financia el premio por adelantado. Quien entra nunca paga, y nunca se recaudan fondos de participantes.',
      },
      {
        lead: 'Cualquier ERC-20 como premio',
        rest: ' — stablecoins, tokens de proyecto, activos tokenizados. Una wallet, una entrada.',
      },
      {
        lead: 'Ganadores sorteados por Chainlink VRF',
        rest: ' — ningún admin puede elegir, cambiar o bloquear a un ganador, ni siquiera nosotros.',
      },
      {
        lead: 'Premios reclamados del contrato',
        rest: ' — pull-payment, exactamente como en la lotería. Los retiros nunca pueden pausarse y nada puede quedar atrapado.',
      },
      {
        lead: 'Para marcas, comunidades y creadores',
        rest: ' — campañas abiertas, o una lista de elegibilidad cuando las entradas deben restringirse.',
      },
    ],
  },
  proof: {
    eyebrow: 'Prueba',
    title: 'Esto no es un mockup.',
    verifyLabel: 'GiveawayManager · Arbitrum One',
    matchLabel: 'Verificado · Exact Match',
    specs: [
      'Comisión de la plataforma',
      'Ganadores por campaña',
      'Participantes por campaña',
      'Activo del premio',
      'Duración de la campaña',
    ],
    specWords: { upTo: 'Hasta', anyErc20: 'Cualquier ERC-20', hour: 'hora', days: 'días' },
    discipline:
      'Desplegado y verificado en Arbitrum One. La creación de campañas abre después del lanzamiento público de nuestra lotería — lanzamos en orden.',
  },
  wizard: {
    eyebrow: 'Creación de campañas',
    title: 'Recorre el flujo.',
    intro:
      'Los pasos exactos que dará un creador, con los límites reales que el contrato impone. Nada aquí conecta una wallet ni envía una transacción — es un preview que puedes recorrer de principio a fin.',
    banner: 'MODO PREVIEW · sin wallet, sin transacción, nada sale de esta página',
    dateLocale: 'es-ES',
    stepOf: 'de',
    stepNames: ['Premio', 'Plazos', 'Elegibilidad', 'Revisión', 'Early access'],
    back: 'Atrás',
    next: 'Continuar',
    restart: 'Empezar de nuevo',
    prize: {
      title: '¿Cuál es el premio?',
      hint: 'El creador deposita el premio completo más la comisión de la plataforma cuando se crea la campaña. El contrato registra el importe realmente recibido, por lo que los tokens fee-on-transfer se tratan correctamente.',
      tokenLabel: 'Token del premio',
      tokenUsdc: 'USDC',
      tokenCustom: 'Otro ERC-20',
      addressLabel: 'Dirección del token',
      decimalsLabel: 'Decimales',
      amountLabel: 'Importe del premio',
      amountHint: 'Se divide a partes iguales entre los ganadores que elijas en el paso siguiente.',
    },
    timing: {
      title: '¿Cuánto tiempo, y cuántos ganadores?',
      hint: 'Las entradas cierran a la hora de fin. El cierre es permissionless: la automatización lo llama, pero cualquiera puede — una campaña nunca puede mantenerse abierta.',
      durationLabel: 'Ventana de entrada',
      unitHours: 'horas',
      unitDays: 'días',
      endsLabel: 'Las entradas cerrarían',
      winnersLabel: 'Número de ganadores',
      winnersHint: 'Si entran menos personas que el número de ganadores, el contrato lo limita a los participantes reales.',
    },
    eligibility: {
      title: '¿Quién puede entrar?',
      hint: 'Una wallet, una entrada, en ambos modos.',
      openTitle: 'Abierto a cualquier wallet',
      openBody:
        'Cualquier persona en Arbitrum One puede entrar. Las campañas abiertas aceptan entradas sybil por diseño — es la elección informada del creador.',
      allowTitle: 'Lista de elegibilidad',
      allowBody:
        'Solo las wallets que enumeres pueden entrar. Esta es la defensa contra sybil para las marcas, y la herramienta de compliance para tokens con transferencia restringida.',
      allowLabel: 'Wallets elegibles',
      allowPlaceholder: '0x… una dirección por línea',
      allowCount: 'wallets elegibles',
      merkleNote:
        'La lista se convierte en una Merkle root off-chain. Solo 32 bytes van on-chain — el contrato nunca publica las direcciones en sí.',
    },
    review: {
      title: 'Revisa la campaña.',
      hint: 'Todas las cifras de abajo se calculan con la misma aritmética de enteros que usa el contrato.',
      rowToken: 'Token del premio',
      rowPrize: 'Pool del premio',
      rowFee: 'Comisión de la plataforma (5%)',
      rowTotal: 'Depositarías',
      rowDuration: 'Ventana de entrada',
      rowEnds: 'Las entradas cierran',
      rowWinners: 'Ganadores',
      rowShare: 'Parte por ganador',
      rowEligibility: 'Elegibilidad',
      openValue: 'Abierto a cualquier wallet',
      allowValue: 'Lista de elegibilidad',
      dustNote:
        'Un resto indivisible va al primer ganador sorteado — determinista, y el premio completo siempre se distribuye.',
      clampNote: 'Los ganadores se limitan al número de participantes reales en el cierre.',
    },
    submit: {
      title: 'La creación de campañas abre después del lanzamiento público.',
      body: 'El contrato está desplegado y verificado, pero la creación sigue cerrada hasta que la lotería se lance públicamente — lanzamos en orden, y no abrimos un producto de ingresos encima de uno que aún no se ha lanzado. Solicita early access para estar en el primer grupo cuando abra.',
      cta: 'Solicitar early access',
      note: 'Nada de lo que escribiste se guardó ni se envió. Este preview mantiene todo dentro de la página.',
    },
    errors: {
      amountInvalid: 'Introduce un importe de premio mayor que cero, con no más decimales de los que tiene el token.',
      amountDust: 'Premio demasiado pequeño: la comisión del 5% redondearía a cero, y el contrato lo rechaza.',
      addressInvalid: 'Introduce una dirección de contrato válida (0x seguido de 40 caracteres hexadecimales).',
      decimalsInvalid: 'Los decimales deben estar entre 0 y 36.',
      durationRange: 'El contrato acepta de 1 hora a 30 días.',
      winnersRange: 'El contrato acepta de 1 a 1,000 ganadores.',
      allowEmpty: 'Añade al menos una wallet elegible, o cambia a una campaña abierta.',
      allowTooMany: 'El contrato limita una campaña a 100,000 participantes.',
      allowInvalid: 'Algunas líneas no son direcciones válidas.',
    },
  },
  participants: {
    eyebrow: 'Para participantes',
    title: '¿No vas a organizar una campaña?',
    body: 'Entrar en un giveaway siempre será gratis. Hay una sola lista de espera para todo el Event Center — la lotería, los giveaways y todo lo que venga después.',
  },
  outro: { back: 'Volver a instantwin' },
};

/**
 * Os três dicionários dizem exactamente a mesma coisa.
 *
 * Mesma regra da /roadmap: as frases que são compromisso — "we ship in order",
 * "Claims are never pausable", "Nothing you typed was stored or sent" — passam
 * literais, sem suavizar nem reforçar, e nenhuma língua ganha promessa, data ou
 * adjectivo que o inglês não tenha.
 *
 * Números, endereços e limites do contrato (5%, 1,000, 100,000, 1h–30d) ficam
 * idênticos ao inglês nas três línguas: são o que o contrato faz, não copy.
 */
export const giveawaysTranslations: Record<Lang, GiveawaysCopy> = { en, pt, es };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useGiveawaysCopy(): GiveawaysCopy {
  const [lang] = useLang();
  return giveawaysTranslations[lang];
}
