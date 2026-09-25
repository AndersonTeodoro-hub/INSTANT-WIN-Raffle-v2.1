import { useLang } from './landing.i18n';

// i18n do Event Center (/events/*). Mesmo padrão de app.i18n.ts e
// giveaways.i18n.ts: objecto de lookup por idioma, useLang partilhado.
//
// Não se traduz: INSTANT WIN, USDC, Arbitrum One, Telegram, Event Center.

export interface EventsCopy {
  nav: { link: string };
  list: {
    metaTitle: string;
    metaDescription: string;
    eyebrow: string;
    title: string;
    intro: string;
    createCta: string;
    myEventsCta: string;
    empty: string;
    loading: string;
    error: string;
    contractLabel: string;
    card: {
      prize: string;
      winners: string;
      slots: string;
      view: string;
      /** Sufixo do contador de vagas do cartão: "1 240 slots left". */
      slotsLeft: string;
      full: string;
      /** Antes do nome da marca no cartão: "de Acme". */
      byBrand: string;
    };
    status: Record<'OPEN' | 'CLOSED' | 'DRAW_REQUESTED' | 'SEED_RECEIVED' | 'SETTLED' | 'CANCELLED', string>;
    /**
     * As três garantias, ditas à entrada em vez de espalhadas pelas páginas.
     * São factos do contrato, não promessas de marketing.
     */
    trust: { draw: string; custody: string; free: string };
  };
  detail: {
    back: string;
    loading: string;
    notFound: string;
    contractLabel: string;
    prizeLabel: string;
    winnersLabel: string;
    slotsLabel: string;
    timeLeftLabel: string;
    endedLabel: string;
    pausedBanner: string;
    /** "Campanha de" + endereço do criador. Quem pagou o prémio tem nome. */
    byCreator: string;
    /** Identidade de campanha (SPEC-BRIDGE-V2 §17), quando o criador a publicou. */
    identity: {
      byBrand: string;
      /** Por cima da mensagem do criador: "Uma mensagem de" + marca. */
      messageFrom: string;
      /** A prova discreta: o endereço que o contrato regista como criador. */
      creatorProof: string;
      /** Para leitores de ecrã, no link da marca. */
      opensNewTab: string;
    };
    freeToEnter: string;
    entriesLabel: string;
    /** Cabeçalho da espinha de participação. */
    yourEntry: string;
    /** Títulos dos três passos. O funil é uma sequência a sério. */
    steps: { identity: string; entry: string; prize: string };
    proofLine: string;
    previousWinners: { title: string; empty: string; you: string };
    /** A forma da prova de uma campanha liquidada: de onde vem (a semente do VRF, on-chain). */
    proof: { markCampaign: string; vrfSeed: string; vrfRequest: string; settled: string };
    outcome: {
      pending: string;
      wonTitle: string;
      wonBody: string;
      /** The bridge holds no key for a self-custody wallet; only they can claim. */
      wonBodySelf: string;
      lostTitle: string;
      lostBody: string;
    };
    account: {
      signedInAs: string;
      signOut: string;
      exportData: string;
      exportDone: string;
      deleteData: string;
      deleteConfirm: string;
      deleteDone: string;
      loginTitle: string;
      loginBody: string;
      emailLabel: string;
      emailPlaceholder: string;
      sendCode: string;
      codeSentTitle: string;
      codeLabel: string;
      verify: string;
      resend: string;
      invalidEmail: string;
      invalidCode: string;
      genericError: string;
    };
    participate: {
      title: string;
      intro: string;
      ctaEnter: string;
      openTelegram: string;
      openTelegramAgain: string;
      telegramExpiredHint: string;
      statusAwaitingContact: string;
      statusVerified: string;
      statusEligible: string;
      statusFunding: string;
      statusSubmitted: string;
      statusConfirmed: string;
      statusFailed: string;
      txLabel: string;
      full: string;
      notOpen: string;
      walletGapNotice: string;
    };
    prize: {
      title: string;
      requiresOwnWallet: string;
      belowThreshold: string;
      expiresOn: string;
      destinationLabel: string;
      destinationPlaceholder: string;
      proposeCta: string;
      confirmCta: string;
      confirmExplainer: string;
      confirmed: string;
      invalidAddress: string;
    };
    /** SPEC-BLOCO-03 piece 6: entering and claiming with a Keptra account (A4, 6.2.3, 6.2.5). */
    keptra: {
      passkeyNeeded: string;
      setUpCta: string;
      wrongOrigin: string;
      confirmEntryBody: string;
      confirmEntryCta: string;
      claimBody: string;
      claimCta: string;
      claimed: string;
      voucherBody: string;
      voucherCta: string;
      notice: string;
    };
  };
  create: {
    metaTitle: string;
    metaDescription: string;
    title: string;
    intro: string;
    connectPrompt: string;
    pausedBanner: string;
    moduleNotRegistered: string;
    /** Rótulos das três etapas do formulário de criação. Também uma sequência. */
    stages: { prize: string; rules: string; funding: string };
    prizeType: { label: string; token: string; nft721: string; nft1155: string };
    token: { addressLabel: string; addressHint: string; amountLabel: string };
    nft721: { collectionLabel: string; idsLabel: string; idsHint: string };
    nft1155: { collectionLabel: string; itemsLabel: string; itemsHint: string; idLabel: string; amountLabel: string; addRow: string; removeRow: string };
    declaredValueLabel: string;
    declaredValueHint: string;
    durationLabel: string;
    durationHours: string;
    durationDays: string;
    winnersLabel: string;
    winnersAutoNft: string;
    slotCapLabel: string;
    slotCapHint: string;
    costTitle: string;
    costFee: string;
    costSlots: string;
    costTotal: string;
    approveModuleCta: string;
    approveModuleDone: string;
    approveFeeCta: string;
    approveFeeDone: string;
    approveSlotsCta: string;
    approveSlotsDone: string;
    submitCta: string;
    submitting: string;
    success: string;
    viewEvent: string;
  };
  /**
   * O formulário de identidade, na criação e no painel do criador (§17). Os
   * `{max}`, `{maxMb}` e afins são preenchidos com os limites de
   * lib/campaign-identity.ts, para que o texto não diga um número e a ponte
   * aplique outro.
   */
  identity: {
    stageTitle: string;
    intro: string;
    laterHint: string;
    dashboardTitle: string;
    nameLabel: string;
    nameHint: string;
    messageLabel: string;
    messageHint: string;
    brandLabel: string;
    brandHint: string;
    linkLabel: string;
    linkHint: string;
    bannerLabel: string;
    bannerHint: string;
    logoLabel: string;
    logoHint: string;
    optional: string;
    chooseImage: string;
    replaceImage: string;
    removeImage: string;
    signExplainer: string;
    publishCta: string;
    skipCta: string;
    createdPrompt: string;
    addCta: string;
    editCta: string;
    cancelCta: string;
    errors: {
      name: string;
      message: string;
      brand: string;
      link: string;
      bannerRequired: string;
      imageType: string;
      imageTooLarge: string;
      imageDimensions: string;
      notCreator: string;
      expired: string;
      rejected: string;
      stale: string;
      tooMany: string;
      generic: string;
    };
  };
  dashboard: {
    metaTitle: string;
    title: string;
    intro: string;
    connectPrompt: string;
    empty: string;
    loading: string;
    actions: {
      reload: string;
      close: string;
      requestDraw: string;
      finalize: string;
      cancelStuckDraw: string;
      expireDrawRequest: string;
      cancelByCreator: string;
      claimRefund: string;
      reclaimSurplus: string;
      reclaimUnclaimed: string;
    };
    reloadPrompt: string;
    /** O painel do criador lidera com o que falta fazer, não com o estado. */
    nextStep: string;
    noActions: string;
  };
}

const en: EventsCopy = {
  nav: { link: 'Event Center' },
  list: {
    metaTitle: 'Event Center — Instant Win',
    metaDescription: 'Live giveaways on GiveawayManagerV2, Arbitrum One. Enter by email and Telegram, or connect a wallet.',
    eyebrow: 'Event Center',
    title: 'Giveaways, live on Arbitrum',
    intro: 'Every campaign here is a real GiveawayManagerV2 contract. Prize, winners, slots and the draw are all on-chain and verifiable.',
    createCta: 'Create a giveaway',
    myEventsCta: 'My giveaways',
    empty: 'No giveaways yet. Be the first to create one.',
    loading: 'Reading campaigns from the chain…',
    error: 'Could not read campaigns from the chain. Try again in a moment.',
    contractLabel: 'GiveawayManagerV2 contract',
    card: {
      prize: 'Prize',
      winners: 'Winners',
      slots: 'Slots',
      view: 'View event',
      slotsLeft: 'places left',
      full: 'Full',
      byBrand: 'by',
    },
    status: {
      OPEN: 'Open',
      CLOSED: 'Closing',
      DRAW_REQUESTED: 'Drawing',
      SEED_RECEIVED: 'Drawing',
      SETTLED: 'Settled',
      CANCELLED: 'Cancelled',
    },
    trust: {
      draw: 'Winners are drawn by Chainlink VRF',
      custody: 'The creator deposits the prize into the contracts when creating the campaign',
      free: 'Entering is free — the creator funds the prize',
    },
  },
  detail: {
    back: '← All events',
    loading: 'Reading this campaign from the chain…',
    notFound: 'This campaign does not exist.',
    contractLabel: 'Contract',
    prizeLabel: 'Prize',
    winnersLabel: 'Winners',
    slotsLabel: 'Slots',
    timeLeftLabel: 'Entries close',
    endedLabel: 'Entries closed',
    pausedBanner: 'The platform is paused right now. Entries and new campaigns are on hold; claims and refunds are not affected.',
    byCreator: 'Campaign by',
    identity: {
      byBrand: 'by',
      messageFrom: 'A message from',
      creatorProof: 'Created on-chain by',
      opensNewTab: 'opens in a new tab',
    },
    freeToEnter: 'There is no entry fee. If you enter through our bridge, it pays the gas for you; if you enter with your own wallet, you pay the gas yourself. Whoever created this campaign deposited the prize into the contracts when they created it.',
    entriesLabel: 'Places taken',
    yourEntry: 'Your entry',
    steps: {
      identity: 'Identify yourself',
      entry: 'Enter the draw',
      prize: 'Where your prize goes',
    },
    proofLine: 'Winners are drawn by Chainlink VRF, and no function in the contract lets anyone choose or change them — not the creator, and not us. Only a drawn address can claim its prize, and only within 90 days of the draw; after that, the creator can take back whatever was never claimed. If the campaign is cancelled, the creator can take the prize back. In an NFT campaign with fewer winners than items, the creator can also take back the items nobody won. If you entered through our bridge, the drawn address is one of the bridge’s wallets: only the bridge can claim that prize, and it sends it on only to a wallet you have confirmed.',
    previousWinners: { title: 'Winners', empty: 'No winners drawn yet.', you: 'This is you' },
    proof: { markCampaign: 'Proof shape of campaign', vrfSeed: 'VRF seed', vrfRequest: 'VRF request', settled: 'Settled on-chain' },
    outcome: {
      pending: 'The draw is done. Confirming what it means for your entry…',
      wonTitle: 'You won',
      wonBody:
        'Your entry was drawn. Set the wallet your prize should go to below — we have also emailed you.',
      wonBodySelf:
        'Your entry was drawn. You entered with your own wallet, so the prize is yours to collect directly: call claimPrize on the contract from that wallet. We hold no key for it and cannot collect for you. The contract closes claims 90 days after the draw.',
      lostTitle: 'Not this time',
      lostBody:
        'The draw is done and your entry was not among the winners. Nothing is owed and nothing is pending. The winners are listed above and the result is on Arbitrum, so you can check it yourself.',
    },
    account: {
      signedInAs: 'Signed in as',
      signOut: 'Sign out',
      exportData: 'Export my data',
      exportDone: 'Downloaded.',
      deleteData: 'Delete my data',
      deleteConfirm: 'This erases your email and releases your phone number. It cannot be undone. Delete anyway?',
      deleteDone: 'Your data was erased.',
      loginTitle: 'Sign in to enter',
      loginBody: 'We only need your email to start. Phone verification happens next, over Telegram.',
      emailLabel: 'Email',
      emailPlaceholder: 'you@example.com',
      sendCode: 'Send code',
      codeSentTitle: 'Check your email',
      codeLabel: '6-digit code',
      verify: 'Verify',
      resend: 'Send a new code',
      invalidEmail: 'Enter a valid email address.',
      invalidCode: 'That code is not valid.',
      genericError: 'Something went wrong. Please try again.',
    },
    participate: {
      title: 'Enter this event',
      intro: 'Verification happens over Telegram — a bot asks only for your phone number, once. It never mentions the prize.',
      ctaEnter: 'Enter with email',
      openTelegram: 'Open Telegram to verify',
      openTelegramAgain: 'Open Telegram again',
      telegramExpiredHint: 'Link expired? Tap the button to get a new one — the old one only works once.',
      statusAwaitingContact: 'Waiting for you to verify your phone number on Telegram.',
      statusVerified: 'Phone verified. Waiting for your entry to be admitted.',
      statusEligible: 'Admitted. Your entry is queued to go on-chain.',
      statusFunding: 'Submitting your entry on-chain…',
      statusSubmitted: 'Entry broadcast. Waiting for confirmation.',
      statusConfirmed: "You're entered.",
      statusFailed: 'Your entry could not be completed. You can try again.',
      txLabel: 'Transaction',
      full: 'This event is full.',
      notOpen: 'This event is not open for entries.',
      walletGapNotice: 'Connecting a wallet here does not make it the address that enters — every entry is admitted through the bridge under one of its own custodial wallets, so your identity stays verified without your wallet ever signing an entry. Once you win, you can send your connected wallet below as the prize destination.',
    },
    prize: {
      title: 'Your prize',
      requiresOwnWallet: 'This prize must go to a wallet you own — it cannot stay in custody.',
      belowThreshold: 'This prize may rest in temporary custody for up to 30 days, or you can name your own wallet now.',
      expiresOn: 'Temporary custody ends on',
      destinationLabel: 'Destination wallet',
      destinationPlaceholder: '0x…',
      proposeCta: 'Use this address',
      confirmCta: 'Confirm this address',
      confirmExplainer: "Check it carefully — this is exactly where your prize will be sent, and it can't be changed once confirmed.",
      confirmed: 'Confirmed. Your prize will be sent here.',
      invalidAddress: 'Enter a valid wallet address.',
    },
    keptra: {
      passkeyNeeded: 'Entering needs your Keptra account and its passkey. Set it up first — it takes a minute — then come back to this page.',
      setUpCta: 'Set up my Keptra account',
      wrongOrigin: 'Passkeys work only on keptra.io. Open this page on keptra.io to continue.',
      confirmEntryBody: 'Your place is ready. One step is left: confirm your entry with your passkey. Until you do, you are not entered.',
      confirmEntryCta: 'Confirm my entry with my passkey',
      claimBody: 'Claim it with your passkey. It stays in the contract until you do, and claims close 90 days after the draw.',
      claimCta: 'Claim my prize with my passkey',
      claimed: 'Claimed. The prize is in your Keptra account.',
      voucherBody: 'Your prize is a voucher for a physical product. Redeem it with a delivery address within 30 days of claiming it.',
      voucherCta: 'Redeem my voucher',
      notice: 'You enter with your own Keptra account: your passkey signs the entry, and a prize stays in the contract until you claim it.',
    },
  },
  create: {
    metaTitle: 'Create a giveaway — Instant Win',
    metaDescription: 'Create a giveaway on GiveawayManagerV2: deposit an ERC-20, ERC-721 or ERC-1155 prize and buy entry slots.',
    title: 'Create a giveaway',
    intro: 'You sign the creation and the deposit yourself, with your own gas. The prize never passes through the platform.',
    connectPrompt: 'Connect a wallet to create a giveaway.',
    pausedBanner: 'Campaign creation opens at launch. The contract is live and verified on Arbiscan; the entry flow is being finished.',
    moduleNotRegistered: 'This prize module is not registered on the contract yet. Creation is disabled.',
    stages: { prize: 'The prize', rules: 'The rules', funding: 'Fund and launch' },
    prizeType: { label: 'Prize type', token: 'Token (ERC-20 / USDC)', nft721: 'NFT (ERC-721)', nft1155: 'NFT (ERC-1155)' },
    token: { addressLabel: 'Token address', addressHint: 'USDC by default. Paste another ERC-20 address to use it instead.', amountLabel: 'Prize amount' },
    nft721: { collectionLabel: 'Collection address', idsLabel: 'Token IDs', idsHint: 'One per line. Each becomes one winner’s prize.' },
    nft1155: {
      collectionLabel: 'Collection address',
      itemsLabel: 'Items',
      itemsHint: 'One winner per unit across every row.',
      idLabel: 'Token ID',
      amountLabel: 'Units',
      addRow: 'Add item',
      removeRow: 'Remove',
    },
    declaredValueLabel: 'Declared value (USDC)',
    declaredValueHint: 'Your public valuation of this NFT prize. It sets the platform fee and is shown on the event page — the fee is charged on this number, not a market price nobody can verify.',
    durationLabel: 'Entry window',
    durationHours: 'hours',
    durationDays: 'days',
    winnersLabel: 'Winners',
    winnersAutoNft: 'Fixed to the number of items deposited — one winner per item.',
    slotCapLabel: 'Entry slot cap',
    slotCapHint: 'You buy this many entry slots up front, at the current price per slot.',
    costTitle: 'Cost to create',
    costFee: 'Platform fee',
    costSlots: 'Entry slots',
    costTotal: 'Total',
    approveModuleCta: 'Approve prize module',
    approveModuleDone: 'Prize module approved',
    approveFeeCta: 'Approve fee',
    approveFeeDone: 'Fee approved',
    approveSlotsCta: 'Approve slots (USDC)',
    approveSlotsDone: 'Slots approved',
    submitCta: 'Create giveaway',
    submitting: 'Creating…',
    success: 'Giveaway created.',
    viewEvent: 'View event',
  },
  identity: {
    stageTitle: 'Campaign identity',
    intro: 'How participants will recognise your campaign: its name, your message to them, a banner and your brand. They appear on the campaign page, in the list, in every email and whenever the link is shared.',
    laterHint: 'You can also add or change this later, from My giveaways.',
    dashboardTitle: 'Campaign identity',
    nameLabel: 'Campaign name',
    nameHint: 'Up to {max} characters. No links.',
    messageLabel: 'Your message to participants',
    messageHint: 'Up to {max} characters. Shown next to the prize.',
    brandLabel: 'Brand or creator name',
    brandHint: 'Shown as “by …”. Up to {max} characters.',
    linkLabel: 'Link',
    linkHint: 'Your site or social profile. Must start with https://',
    bannerLabel: 'Banner',
    bannerHint: 'PNG, JPEG or WebP, up to {maxMb} MB, landscape, at least {minWidth}×{minHeight} px. 1200×630 fits link previews best.',
    logoLabel: 'Brand logo',
    logoHint: 'PNG, JPEG or WebP, up to {maxKb} KB. Square works best.',
    optional: 'optional',
    chooseImage: 'Choose image',
    replaceImage: 'Replace',
    removeImage: 'Remove',
    signExplainer: 'Publishing asks your wallet for a signature. It is free and sends no transaction. Only the wallet that created the campaign can sign.',
    publishCta: 'Sign and publish',
    skipCta: 'Skip for now',
    createdPrompt: 'Your campaign is live on-chain. Sign once more to publish its name, message and banner.',
    addCta: 'Add campaign identity',
    editCta: 'Edit campaign identity',
    cancelCta: 'Cancel',
    errors: {
      name: 'Give the campaign a name of up to {max} characters, without links.',
      message: 'Write a message of up to {max} characters and {lines} lines.',
      brand: 'Add a brand or creator name of up to {max} characters, without links.',
      link: 'Use a full https:// address, without a port or a password.',
      bannerRequired: 'Add a banner.',
      imageType: 'Use a PNG, JPEG or WebP image.',
      imageTooLarge: 'This image is larger than allowed.',
      imageDimensions: 'This image is outside the allowed size or shape.',
      notCreator: 'Only the wallet that created this campaign can change its identity. Connect that wallet.',
      expired: 'That signature can no longer be used. Sign again.',
      rejected: 'The signature was cancelled in your wallet.',
      stale: 'A newer identity was already published for this campaign. Reload to see it.',
      tooMany: 'Too many attempts. Wait a minute and try again.',
      generic: 'Something went wrong. Please try again.',
    },
  },
  dashboard: {
    metaTitle: 'My giveaways — Instant Win',
    title: 'My giveaways',
    intro: 'Every campaign you created, and what it needs next.',
    connectPrompt: 'Connect a wallet to see your giveaways.',
    empty: "You haven't created a giveaway yet.",
    loading: 'Reading your campaigns from the chain…',
    actions: {
      reload: 'Buy more slots',
      close: 'Close entries',
      requestDraw: 'Request the draw',
      finalize: 'Finalize winners',
      cancelStuckDraw: 'Cancel stuck draw',
      expireDrawRequest: 'Expire draw request',
      cancelByCreator: 'Cancel (no entrants)',
      claimRefund: 'Claim refund',
      reclaimSurplus: 'Reclaim surplus items',
      reclaimUnclaimed: 'Reclaim unclaimed prize',
    },
    reloadPrompt: 'Additional slots to buy',
    nextStep: 'Next step',
    noActions: 'No pending step to show right now.',
  },
};

const pt: EventsCopy = {
  nav: { link: 'Event Center' },
  list: {
    metaTitle: 'Event Center — Instant Win',
    metaDescription: 'Sorteios ao vivo no GiveawayManagerV2, Arbitrum One. Participe por email e Telegram, ou ligue uma carteira.',
    eyebrow: 'Event Center',
    title: 'Sorteios, ao vivo na Arbitrum',
    intro: 'Cada campanha aqui é um contrato GiveawayManagerV2 real. Prémio, vencedores, slots e o sorteio estão todos on-chain e são verificáveis.',
    createCta: 'Criar um sorteio',
    myEventsCta: 'Os meus sorteios',
    empty: 'Ainda não há sorteios. Seja o primeiro a criar um.',
    loading: 'A ler campanhas da cadeia…',
    error: 'Não foi possível ler as campanhas da cadeia. Tente novamente daqui a pouco.',
    contractLabel: 'Contrato GiveawayManagerV2',
    card: {
      prize: 'Prémio',
      winners: 'Vencedores',
      slots: 'Slots',
      view: 'Ver evento',
      slotsLeft: 'lugares livres',
      full: 'Esgotado',
      byBrand: 'de',
    },
    status: {
      OPEN: 'Aberto',
      CLOSED: 'A fechar',
      DRAW_REQUESTED: 'A sortear',
      SEED_RECEIVED: 'A sortear',
      SETTLED: 'Liquidado',
      CANCELLED: 'Cancelado',
    },
    trust: {
      draw: 'Os vencedores são sorteados pela Chainlink VRF',
      custody: 'Quem cria a campanha deposita o prémio nos contratos ao criá-la',
      free: 'Participar é grátis — o prémio é pago por quem criou',
    },
  },
  detail: {
    back: '← Todos os eventos',
    loading: 'A ler esta campanha da cadeia…',
    notFound: 'Esta campanha não existe.',
    contractLabel: 'Contrato',
    prizeLabel: 'Prémio',
    winnersLabel: 'Vencedores',
    slotsLabel: 'Slots',
    timeLeftLabel: 'As entradas fecham',
    endedLabel: 'Entradas fechadas',
    pausedBanner: 'A plataforma está pausada neste momento. Entradas e novas campanhas estão suspensas; resgates e reembolsos não são afectados.',
    byCreator: 'Campanha de',
    identity: {
      byBrand: 'de',
      messageFrom: 'Uma mensagem de',
      creatorProof: 'Criada on-chain por',
      opensNewTab: 'abre num novo separador',
    },
    freeToEnter: 'Não há taxa de participação. Se participar através da nossa ponte, é ela que paga o gas; se participar com a sua própria carteira, paga o gas você mesmo. Quem criou esta campanha depositou o prémio nos contratos ao criá-la.',
    entriesLabel: 'Lugares ocupados',
    yourEntry: 'A sua participação',
    steps: {
      identity: 'Identifique-se',
      entry: 'Entre no sorteio',
      prize: 'Para onde vai o seu prémio',
    },
    proofLine: 'Os vencedores são sorteados pela Chainlink VRF e nenhuma função do contrato permite que alguém os escolha ou troque — nem quem criou a campanha, nem nós. Só um endereço sorteado pode levantar o seu prémio, e só nos 90 dias após o sorteio; depois disso, quem criou a campanha pode recuperar o que nunca foi levantado. Se a campanha for cancelada, quem a criou pode recuperar o prémio. Numa campanha NFT com menos vencedores do que itens, pode também recuperar os itens que ninguém ganhou. Se participou através da nossa ponte, o endereço sorteado é uma das carteiras da ponte: só a ponte pode levantar esse prémio, e só o envia para uma carteira que tenha confirmado.',
    previousWinners: { title: 'Vencedores', empty: 'Ainda não há vencedores sorteados.', you: 'É você' },
    proof: { markCampaign: 'Forma da prova da campanha', vrfSeed: 'Semente do VRF', vrfRequest: 'Pedido ao VRF', settled: 'Liquidada on-chain' },
    outcome: {
      pending: 'O sorteio foi feito. A confirmar o que significa para a sua participação…',
      wonTitle: 'Ganhou',
      wonBody:
        'A sua participação foi sorteada. Indique abaixo a carteira para onde enviar o prémio — também lhe enviámos um email.',
      wonBodySelf:
        'A sua participação foi sorteada. Entrou com a sua própria carteira, por isso o prémio é seu para levantar directamente: chame claimPrize no contrato a partir dessa carteira. Não temos a chave dela e não podemos levantar por si. O contrato fecha os resgates 90 dias após o sorteio.',
      lostTitle: 'Não foi desta',
      lostBody:
        'O sorteio foi feito e a sua participação não saiu premiada. Não há nada em dívida nem nada pendente. Os vencedores estão listados acima e o resultado está na Arbitrum, por isso pode confirmá-lo por si.',
    },
    account: {
      signedInAs: 'Sessão iniciada como',
      signOut: 'Terminar sessão',
      exportData: 'Exportar os meus dados',
      exportDone: 'Transferido.',
      deleteData: 'Apagar os meus dados',
      deleteConfirm: 'Isto apaga o seu email e liberta o seu número de telemóvel. Não pode ser desfeito. Apagar mesmo assim?',
      deleteDone: 'Os seus dados foram apagados.',
      loginTitle: 'Inicie sessão para participar',
      loginBody: 'Só precisamos do seu email para começar. A verificação do telemóvel acontece a seguir, pelo Telegram.',
      emailLabel: 'Email',
      emailPlaceholder: 'voce@exemplo.com',
      sendCode: 'Enviar código',
      codeSentTitle: 'Verifique o seu email',
      codeLabel: 'Código de 6 dígitos',
      verify: 'Verificar',
      resend: 'Enviar novo código',
      invalidEmail: 'Introduza um endereço de email válido.',
      invalidCode: 'Esse código não é válido.',
      genericError: 'Algo correu mal. Tente novamente.',
    },
    participate: {
      title: 'Participar neste evento',
      intro: 'A verificação acontece pelo Telegram — um bot pede apenas o seu número de telemóvel, uma vez. Nunca menciona o prémio.',
      ctaEnter: 'Participar com email',
      openTelegram: 'Abrir o Telegram para verificar',
      openTelegramAgain: 'Abrir o Telegram novamente',
      telegramExpiredHint: 'Link expirado? Toque no botão para obter um novo — o anterior só funciona uma vez.',
      statusAwaitingContact: 'A aguardar que verifique o seu número no Telegram.',
      statusVerified: 'Telemóvel verificado. A aguardar que a entrada seja admitida.',
      statusEligible: 'Admitido. A sua entrada está em fila para ir on-chain.',
      statusFunding: 'A submeter a sua entrada on-chain…',
      statusSubmitted: 'Entrada transmitida. A aguardar confirmação.',
      statusConfirmed: 'Está inscrito.',
      statusFailed: 'A sua entrada não pôde ser concluída. Pode tentar novamente.',
      txLabel: 'Transacção',
      full: 'Este evento está esgotado.',
      notOpen: 'Este evento não está aberto a entradas.',
      walletGapNotice: 'Ligar uma carteira aqui não a torna o endereço que participa — toda a entrada é admitida através da ponte, sob uma das suas próprias carteiras de custódia, para que a sua identidade fique verificada sem que a sua carteira alguma vez assine uma entrada. Depois de ganhar, pode indicar a sua carteira ligada abaixo como destino do prémio.',
    },
    prize: {
      title: 'O seu prémio',
      requiresOwnWallet: 'Este prémio tem de ir para uma carteira sua — não pode ficar em custódia.',
      belowThreshold: 'Este prémio pode ficar em custódia temporária até 30 dias, ou pode indicar já a sua própria carteira.',
      expiresOn: 'A custódia temporária termina a',
      destinationLabel: 'Carteira de destino',
      destinationPlaceholder: '0x…',
      proposeCta: 'Usar este endereço',
      confirmCta: 'Confirmar este endereço',
      confirmExplainer: 'Verifique com atenção — é exactamente para aqui que o seu prémio será enviado, e não pode ser alterado depois de confirmado.',
      confirmed: 'Confirmado. O seu prémio será enviado para aqui.',
      invalidAddress: 'Introduza um endereço de carteira válido.',
    },
    keptra: {
      passkeyNeeded: 'Para participar precisa da sua conta Keptra e da respectiva passkey. Configure-a primeiro — demora um minuto — e volte a esta página.',
      setUpCta: 'Configurar a minha conta Keptra',
      wrongOrigin: 'As passkeys só funcionam em keptra.io. Abra esta página em keptra.io para continuar.',
      confirmEntryBody: 'O seu lugar está pronto. Falta um passo: confirmar a entrada com a sua passkey. Até o fazer, não está inscrito.',
      confirmEntryCta: 'Confirmar a entrada com a passkey',
      claimBody: 'Reclame-o com a sua passkey. Fica no contrato até o fazer, e as reclamações fecham 90 dias depois do sorteio.',
      claimCta: 'Reclamar o prémio com a passkey',
      claimed: 'Reclamado. O prémio está na sua conta Keptra.',
      voucherBody: 'O seu prémio é um voucher para um produto físico. Resgate-o com uma morada de entrega até 30 dias depois de o reclamar.',
      voucherCta: 'Resgatar o voucher',
      notice: 'Participa com a sua própria conta Keptra: a sua passkey assina a entrada, e um prémio fica no contrato até o reclamar.',
    },
  },
  create: {
    metaTitle: 'Criar um sorteio — Instant Win',
    metaDescription: 'Crie um sorteio no GiveawayManagerV2: deposite um prémio ERC-20, ERC-721 ou ERC-1155 e compre slots de entrada.',
    title: 'Criar um sorteio',
    intro: 'Assina a criação e o depósito você mesmo, com o seu próprio gas. O prémio nunca passa pela plataforma.',
    connectPrompt: 'Ligue uma carteira para criar um sorteio.',
    pausedBanner: 'A criação de campanhas abre no lançamento. O contrato está no ar e verificado no Arbiscan; o fluxo de entrada está a ser terminado.',
    moduleNotRegistered: 'Este módulo de prémio ainda não está registado no contrato. A criação está desactivada.',
    stages: { prize: 'O prémio', rules: 'As regras', funding: 'Financiar e lançar' },
    prizeType: { label: 'Tipo de prémio', token: 'Token (ERC-20 / USDC)', nft721: 'NFT (ERC-721)', nft1155: 'NFT (ERC-1155)' },
    token: { addressLabel: 'Endereço do token', addressHint: 'USDC por defeito. Cole outro endereço ERC-20 para usar esse.', amountLabel: 'Montante do prémio' },
    nft721: { collectionLabel: 'Endereço da colecção', idsLabel: 'IDs dos tokens', idsHint: 'Um por linha. Cada um torna-se o prémio de um vencedor.' },
    nft1155: {
      collectionLabel: 'Endereço da colecção',
      itemsLabel: 'Itens',
      itemsHint: 'Um vencedor por unidade, em todas as linhas.',
      idLabel: 'ID do token',
      amountLabel: 'Unidades',
      addRow: 'Adicionar item',
      removeRow: 'Remover',
    },
    declaredValueLabel: 'Valor declarado (USDC)',
    declaredValueHint: 'A sua avaliação pública deste prémio NFT. Define a taxa da plataforma e aparece na página do evento — a taxa é cobrada sobre este número, não sobre um preço de mercado que ninguém pode verificar.',
    durationLabel: 'Janela de inscrição',
    durationHours: 'horas',
    durationDays: 'dias',
    winnersLabel: 'Vencedores',
    winnersAutoNft: 'Fixo no número de itens depositados — um vencedor por item.',
    slotCapLabel: 'Teto de slots de entrada',
    slotCapHint: 'Compra já este número de slots de entrada, ao preço por slot actual.',
    costTitle: 'Custo de criação',
    costFee: 'Taxa da plataforma',
    costSlots: 'Slots de entrada',
    costTotal: 'Total',
    approveModuleCta: 'Aprovar módulo de prémio',
    approveModuleDone: 'Módulo de prémio aprovado',
    approveFeeCta: 'Aprovar taxa',
    approveFeeDone: 'Taxa aprovada',
    approveSlotsCta: 'Aprovar slots (USDC)',
    approveSlotsDone: 'Slots aprovados',
    submitCta: 'Criar sorteio',
    submitting: 'A criar…',
    success: 'Sorteio criado.',
    viewEvent: 'Ver evento',
  },
  identity: {
    stageTitle: 'Identidade da campanha',
    intro: 'Como os participantes vão reconhecer a sua campanha: o nome, a sua mensagem para eles, um banner e a sua marca. Aparecem na página da campanha, na lista, em todos os emails e sempre que o link é partilhado.',
    laterHint: 'Também pode acrescentar ou alterar isto mais tarde, em Os meus sorteios.',
    dashboardTitle: 'Identidade da campanha',
    nameLabel: 'Nome da campanha',
    nameHint: 'Até {max} caracteres. Sem links.',
    messageLabel: 'A sua mensagem aos participantes',
    messageHint: 'Até {max} caracteres. Aparece junto do prémio.',
    brandLabel: 'Nome da marca ou de quem cria',
    brandHint: 'Aparece como «de …». Até {max} caracteres.',
    linkLabel: 'Link',
    linkHint: 'O seu site ou perfil numa rede social. Tem de começar por https://',
    bannerLabel: 'Banner',
    bannerHint: 'PNG, JPEG ou WebP, até {maxMb} MB, horizontal, com pelo menos {minWidth}×{minHeight} px. 1200×630 é o que melhor encaixa nas pré-visualizações de links.',
    logoLabel: 'Logótipo da marca',
    logoHint: 'PNG, JPEG ou WebP, até {maxKb} KB. Quadrado funciona melhor.',
    optional: 'opcional',
    chooseImage: 'Escolher imagem',
    replaceImage: 'Substituir',
    removeImage: 'Remover',
    signExplainer: 'Publicar pede uma assinatura à sua carteira. É gratuito e não envia nenhuma transacção. Só a carteira que criou a campanha pode assinar.',
    publishCta: 'Assinar e publicar',
    skipCta: 'Agora não',
    createdPrompt: 'A sua campanha já está on-chain. Assine mais uma vez para publicar o nome, a mensagem e o banner.',
    addCta: 'Adicionar identidade da campanha',
    editCta: 'Editar identidade da campanha',
    cancelCta: 'Cancelar',
    errors: {
      name: 'Dê à campanha um nome com até {max} caracteres, sem links.',
      message: 'Escreva uma mensagem com até {max} caracteres e {lines} linhas.',
      brand: 'Indique o nome da marca ou de quem cria, com até {max} caracteres, sem links.',
      link: 'Use um endereço https:// completo, sem porta nem palavra-passe.',
      bannerRequired: 'Acrescente um banner.',
      imageType: 'Use uma imagem PNG, JPEG ou WebP.',
      imageTooLarge: 'Esta imagem é maior do que o permitido.',
      imageDimensions: 'Esta imagem está fora do tamanho ou da proporção permitidos.',
      notCreator: 'Só a carteira que criou esta campanha pode alterar a identidade. Ligue essa carteira.',
      expired: 'Essa assinatura já não pode ser usada. Assine de novo.',
      rejected: 'A assinatura foi cancelada na sua carteira.',
      stale: 'Já foi publicada uma identidade mais recente para esta campanha. Recarregue para a ver.',
      tooMany: 'Demasiadas tentativas. Aguarde um minuto e tente de novo.',
      generic: 'Algo correu mal. Tente novamente.',
    },
  },
  dashboard: {
    metaTitle: 'Os meus sorteios — Instant Win',
    title: 'Os meus sorteios',
    intro: 'Cada campanha que criou, e o que precisa a seguir.',
    connectPrompt: 'Ligue uma carteira para ver os seus sorteios.',
    empty: 'Ainda não criou nenhum sorteio.',
    loading: 'A ler as suas campanhas da cadeia…',
    actions: {
      reload: 'Comprar mais slots',
      close: 'Fechar entradas',
      requestDraw: 'Pedir o sorteio',
      finalize: 'Finalizar vencedores',
      cancelStuckDraw: 'Cancelar sorteio bloqueado',
      expireDrawRequest: 'Expirar pedido de sorteio',
      cancelByCreator: 'Cancelar (sem participantes)',
      claimRefund: 'Reclamar reembolso',
      reclaimSurplus: 'Recuperar itens excedentes',
      reclaimUnclaimed: 'Recuperar prémio não reclamado',
    },
    reloadPrompt: 'Slots adicionais a comprar',
    nextStep: 'Próximo passo',
    noActions: 'Nenhum passo pendente para mostrar agora.',
  },
};

const es: EventsCopy = {
  nav: { link: 'Event Center' },
  list: {
    metaTitle: 'Event Center — Instant Win',
    metaDescription: 'Sorteos en vivo en GiveawayManagerV2, Arbitrum One. Participa por email y Telegram, o conecta una wallet.',
    eyebrow: 'Event Center',
    title: 'Sorteos, en vivo en Arbitrum',
    intro: 'Cada campaña aquí es un contrato GiveawayManagerV2 real. Premio, ganadores, cupos y el sorteo están todos on-chain y son verificables.',
    createCta: 'Crear un sorteo',
    myEventsCta: 'Mis sorteos',
    empty: 'Todavía no hay sorteos. Sé el primero en crear uno.',
    loading: 'Leyendo campañas de la cadena…',
    error: 'No se pudieron leer las campañas de la cadena. Intenta de nuevo en un momento.',
    contractLabel: 'Contrato GiveawayManagerV2',
    card: {
      prize: 'Premio',
      winners: 'Ganadores',
      slots: 'Cupos',
      view: 'Ver evento',
      slotsLeft: 'lugares libres',
      full: 'Completo',
      byBrand: 'de',
    },
    status: {
      OPEN: 'Abierto',
      CLOSED: 'Cerrando',
      DRAW_REQUESTED: 'Sorteando',
      SEED_RECEIVED: 'Sorteando',
      SETTLED: 'Liquidado',
      CANCELLED: 'Cancelado',
    },
    trust: {
      draw: 'Los ganadores los sortea Chainlink VRF',
      custody: 'Quien crea la campaña deposita el premio en los contratos al crearla',
      free: 'Participar es gratis — el premio lo paga quien creó la campaña',
    },
  },
  detail: {
    back: '← Todos los eventos',
    loading: 'Leyendo esta campaña de la cadena…',
    notFound: 'Esta campaña no existe.',
    contractLabel: 'Contrato',
    prizeLabel: 'Premio',
    winnersLabel: 'Ganadores',
    slotsLabel: 'Cupos',
    timeLeftLabel: 'Las entradas cierran',
    endedLabel: 'Entradas cerradas',
    pausedBanner: 'La plataforma está pausada en este momento. Las entradas y las campañas nuevas están suspendidas; los reclamos y reembolsos no se ven afectados.',
    byCreator: 'Campaña de',
    identity: {
      byBrand: 'de',
      messageFrom: 'Un mensaje de',
      creatorProof: 'Creada on-chain por',
      opensNewTab: 'se abre en una pestaña nueva',
    },
    freeToEnter: 'No hay tarifa de participación. Si participas a través de nuestro puente, él paga el gas por ti; si participas con tu propia wallet, pagas el gas tú. Quien creó esta campaña depositó el premio en los contratos al crearla.',
    entriesLabel: 'Lugares ocupados',
    yourEntry: 'Tu participación',
    steps: {
      identity: 'Identifícate',
      entry: 'Entra en el sorteo',
      prize: 'Adónde va tu premio',
    },
    proofLine: 'Los ganadores los sortea Chainlink VRF y ninguna función del contrato permite que alguien los elija o los cambie — ni quien creó la campaña, ni nosotros. Solo una dirección sorteada puede cobrar su premio, y solo dentro de los 90 días después del sorteo; pasado ese plazo, quien creó la campaña puede recuperar lo que nunca se cobró. Si la campaña se cancela, quien la creó puede recuperar el premio. En una campaña NFT con menos ganadores que ítems, también puede recuperar los ítems que nadie ganó. Si participaste a través de nuestro puente, la dirección sorteada es una de las wallets del puente: solo el puente puede cobrar ese premio, y solo lo envía a una wallet que hayas confirmado.',
    previousWinners: { title: 'Ganadores', empty: 'Todavía no hay ganadores sorteados.', you: 'Eres tú' },
    proof: { markCampaign: 'Forma de la prueba de la campaña', vrfSeed: 'Semilla del VRF', vrfRequest: 'Solicitud al VRF', settled: 'Liquidada on-chain' },
    outcome: {
      pending: 'El sorteo ya se hizo. Confirmando qué significa para tu participación…',
      wonTitle: 'Has ganado',
      wonBody:
        'Tu participación fue sorteada. Indica abajo la wallet a la que enviar el premio — también te hemos enviado un correo.',
      wonBodySelf:
        'Tu participación fue sorteada. Entraste con tu propia wallet, así que el premio es tuyo para reclamarlo directamente: llama a claimPrize en el contrato desde esa wallet. No tenemos su clave y no podemos reclamarlo por ti. El contrato cierra los reclamos 90 días después del sorteo.',
      lostTitle: 'Esta vez no',
      lostBody:
        'El sorteo ya se hizo y tu participación no resultó premiada. No se debe nada y no hay nada pendiente. Los ganadores están arriba y el resultado está en Arbitrum, así que puedes comprobarlo tú mismo.',
    },
    account: {
      signedInAs: 'Sesión iniciada como',
      signOut: 'Cerrar sesión',
      exportData: 'Exportar mis datos',
      exportDone: 'Descargado.',
      deleteData: 'Eliminar mis datos',
      deleteConfirm: 'Esto elimina tu email y libera tu número de teléfono. No se puede deshacer. ¿Eliminar de todas formas?',
      deleteDone: 'Tus datos fueron eliminados.',
      loginTitle: 'Inicia sesión para participar',
      loginBody: 'Solo necesitamos tu email para empezar. La verificación del teléfono ocurre después, por Telegram.',
      emailLabel: 'Email',
      emailPlaceholder: 'tu@ejemplo.com',
      sendCode: 'Enviar código',
      codeSentTitle: 'Revisa tu email',
      codeLabel: 'Código de 6 dígitos',
      verify: 'Verificar',
      resend: 'Enviar un código nuevo',
      invalidEmail: 'Introduce una dirección de email válida.',
      invalidCode: 'Ese código no es válido.',
      genericError: 'Algo salió mal. Inténtalo de nuevo.',
    },
    participate: {
      title: 'Participar en este evento',
      intro: 'La verificación ocurre por Telegram — un bot pide solo tu número de teléfono, una vez. Nunca menciona el premio.',
      ctaEnter: 'Participar con email',
      openTelegram: 'Abrir Telegram para verificar',
      openTelegramAgain: 'Abrir Telegram de nuevo',
      telegramExpiredHint: '¿Enlace vencido? Toca el botón para obtener uno nuevo — el anterior solo funciona una vez.',
      statusAwaitingContact: 'Esperando que verifiques tu número en Telegram.',
      statusVerified: 'Teléfono verificado. Esperando que la entrada sea admitida.',
      statusEligible: 'Admitido. Tu entrada está en cola para ir on-chain.',
      statusFunding: 'Enviando tu entrada on-chain…',
      statusSubmitted: 'Entrada transmitida. Esperando confirmación.',
      statusConfirmed: 'Estás inscrito.',
      statusFailed: 'Tu entrada no pudo completarse. Puedes intentarlo de nuevo.',
      txLabel: 'Transacción',
      full: 'Este evento está lleno.',
      notOpen: 'Este evento no está abierto a entradas.',
      walletGapNotice: 'Conectar una wallet aquí no la convierte en la dirección que participa — toda entrada se admite a través del puente, bajo una de sus propias wallets de custodia, para que tu identidad quede verificada sin que tu wallet firme jamás una entrada. Cuando ganes, puedes indicar tu wallet conectada abajo como destino del premio.',
    },
    prize: {
      title: 'Tu premio',
      requiresOwnWallet: 'Este premio debe ir a una wallet tuya — no puede quedar en custodia.',
      belowThreshold: 'Este premio puede quedar en custodia temporal hasta 30 días, o puedes indicar ya tu propia wallet.',
      expiresOn: 'La custodia temporal termina el',
      destinationLabel: 'Wallet de destino',
      destinationPlaceholder: '0x…',
      proposeCta: 'Usar esta dirección',
      confirmCta: 'Confirmar esta dirección',
      confirmExplainer: 'Revísala con cuidado — es exactamente adónde se enviará tu premio, y no se puede cambiar una vez confirmada.',
      confirmed: 'Confirmada. Tu premio se enviará aquí.',
      invalidAddress: 'Introduce una dirección de wallet válida.',
    },
    keptra: {
      passkeyNeeded: 'Para participar necesitas tu cuenta Keptra y su passkey. Configúrala primero — lleva un minuto — y vuelve a esta página.',
      setUpCta: 'Configurar mi cuenta Keptra',
      wrongOrigin: 'Las passkeys solo funcionan en keptra.io. Abre esta página en keptra.io para continuar.',
      confirmEntryBody: 'Tu plaza está lista. Falta un paso: confirmar tu entrada con tu passkey. Hasta que lo hagas, no estás inscrito.',
      confirmEntryCta: 'Confirmar mi entrada con la passkey',
      claimBody: 'Reclámalo con tu passkey. Se queda en el contrato hasta que lo hagas, y las reclamaciones cierran 90 días después del sorteo.',
      claimCta: 'Reclamar mi premio con la passkey',
      claimed: 'Reclamado. El premio está en tu cuenta Keptra.',
      voucherBody: 'Tu premio es un vale para un producto físico. Canjéalo con una dirección de entrega en los 30 días siguientes a reclamarlo.',
      voucherCta: 'Canjear mi vale',
      notice: 'Participas con tu propia cuenta Keptra: tu passkey firma la entrada, y un premio se queda en el contrato hasta que lo reclames.',
    },
  },
  create: {
    metaTitle: 'Crear un sorteo — Instant Win',
    metaDescription: 'Crea un sorteo en GiveawayManagerV2: deposita un premio ERC-20, ERC-721 o ERC-1155 y compra cupos de entrada.',
    title: 'Crear un sorteo',
    intro: 'Firmas la creación y el depósito tú mismo, con tu propio gas. El premio nunca pasa por la plataforma.',
    connectPrompt: 'Conecta una wallet para crear un sorteo.',
    pausedBanner: 'La creación de campañas abre en el lanzamiento. El contrato está activo y verificado en Arbiscan; el flujo de entrada se está terminando.',
    moduleNotRegistered: 'Este módulo de premio aún no está registrado en el contrato. La creación está desactivada.',
    stages: { prize: 'El premio', rules: 'Las reglas', funding: 'Financiar y lanzar' },
    prizeType: { label: 'Tipo de premio', token: 'Token (ERC-20 / USDC)', nft721: 'NFT (ERC-721)', nft1155: 'NFT (ERC-1155)' },
    token: { addressLabel: 'Dirección del token', addressHint: 'USDC por defecto. Pega otra dirección ERC-20 para usar esa.', amountLabel: 'Monto del premio' },
    nft721: { collectionLabel: 'Dirección de la colección', idsLabel: 'IDs de los tokens', idsHint: 'Uno por línea. Cada uno se convierte en el premio de un ganador.' },
    nft1155: {
      collectionLabel: 'Dirección de la colección',
      itemsLabel: 'Ítems',
      itemsHint: 'Un ganador por unidad, en todas las filas.',
      idLabel: 'ID del token',
      amountLabel: 'Unidades',
      addRow: 'Añadir ítem',
      removeRow: 'Quitar',
    },
    declaredValueLabel: 'Valor declarado (USDC)',
    declaredValueHint: 'Tu valoración pública de este premio NFT. Define la tarifa de la plataforma y se muestra en la página del evento — la tarifa se cobra sobre este número, no sobre un precio de mercado que nadie puede verificar.',
    durationLabel: 'Ventana de inscripción',
    durationHours: 'horas',
    durationDays: 'días',
    winnersLabel: 'Ganadores',
    winnersAutoNft: 'Fijado al número de ítems depositados — un ganador por ítem.',
    slotCapLabel: 'Tope de cupos de entrada',
    slotCapHint: 'Compras ya este número de cupos de entrada, al precio por cupo actual.',
    costTitle: 'Costo de creación',
    costFee: 'Tarifa de la plataforma',
    costSlots: 'Cupos de entrada',
    costTotal: 'Total',
    approveModuleCta: 'Aprobar módulo de premio',
    approveModuleDone: 'Módulo de premio aprobado',
    approveFeeCta: 'Aprobar tarifa',
    approveFeeDone: 'Tarifa aprobada',
    approveSlotsCta: 'Aprobar cupos (USDC)',
    approveSlotsDone: 'Cupos aprobados',
    submitCta: 'Crear sorteo',
    submitting: 'Creando…',
    success: 'Sorteo creado.',
    viewEvent: 'Ver evento',
  },
  identity: {
    stageTitle: 'Identidad de la campaña',
    intro: 'Cómo reconocerán tu campaña los participantes: el nombre, tu mensaje para ellos, un banner y tu marca. Aparecen en la página de la campaña, en la lista, en cada correo y siempre que se comparte el enlace.',
    laterHint: 'También puedes añadirla o cambiarla más tarde, desde Mis sorteos.',
    dashboardTitle: 'Identidad de la campaña',
    nameLabel: 'Nombre de la campaña',
    nameHint: 'Hasta {max} caracteres. Sin enlaces.',
    messageLabel: 'Tu mensaje para los participantes',
    messageHint: 'Hasta {max} caracteres. Se muestra junto al premio.',
    brandLabel: 'Nombre de la marca o de quien crea',
    brandHint: 'Se muestra como «de …». Hasta {max} caracteres.',
    linkLabel: 'Enlace',
    linkHint: 'Tu sitio o tu perfil en una red social. Debe empezar por https://',
    bannerLabel: 'Banner',
    bannerHint: 'PNG, JPEG o WebP, hasta {maxMb} MB, horizontal, de al menos {minWidth}×{minHeight} px. 1200×630 es lo que mejor encaja en las vistas previas de enlaces.',
    logoLabel: 'Logo de la marca',
    logoHint: 'PNG, JPEG o WebP, hasta {maxKb} KB. Cuadrado funciona mejor.',
    optional: 'opcional',
    chooseImage: 'Elegir imagen',
    replaceImage: 'Reemplazar',
    removeImage: 'Quitar',
    signExplainer: 'Publicar pide una firma a tu wallet. Es gratis y no envía ninguna transacción. Solo la wallet que creó la campaña puede firmar.',
    publishCta: 'Firmar y publicar',
    skipCta: 'Ahora no',
    createdPrompt: 'Tu campaña ya está on-chain. Firma una vez más para publicar el nombre, el mensaje y el banner.',
    addCta: 'Añadir identidad de la campaña',
    editCta: 'Editar identidad de la campaña',
    cancelCta: 'Cancelar',
    errors: {
      name: 'Ponle a la campaña un nombre de hasta {max} caracteres, sin enlaces.',
      message: 'Escribe un mensaje de hasta {max} caracteres y {lines} líneas.',
      brand: 'Indica el nombre de la marca o de quien crea, de hasta {max} caracteres, sin enlaces.',
      link: 'Usa una dirección https:// completa, sin puerto ni contraseña.',
      bannerRequired: 'Añade un banner.',
      imageType: 'Usa una imagen PNG, JPEG o WebP.',
      imageTooLarge: 'Esta imagen supera el tamaño permitido.',
      imageDimensions: 'Esta imagen está fuera del tamaño o de la proporción permitidos.',
      notCreator: 'Solo la wallet que creó esta campaña puede cambiar su identidad. Conecta esa wallet.',
      expired: 'Esa firma ya no se puede usar. Firma de nuevo.',
      rejected: 'La firma se canceló en tu wallet.',
      stale: 'Ya se publicó una identidad más reciente para esta campaña. Recarga para verla.',
      tooMany: 'Demasiados intentos. Espera un minuto y vuelve a intentarlo.',
      generic: 'Algo salió mal. Inténtalo de nuevo.',
    },
  },
  dashboard: {
    metaTitle: 'Mis sorteos — Instant Win',
    title: 'Mis sorteos',
    intro: 'Cada campaña que creaste, y qué necesita a continuación.',
    connectPrompt: 'Conecta una wallet para ver tus sorteos.',
    empty: 'Todavía no has creado ningún sorteo.',
    loading: 'Leyendo tus campañas de la cadena…',
    actions: {
      reload: 'Comprar más cupos',
      close: 'Cerrar entradas',
      requestDraw: 'Pedir el sorteo',
      finalize: 'Finalizar ganadores',
      cancelStuckDraw: 'Cancelar sorteo bloqueado',
      expireDrawRequest: 'Expirar pedido de sorteo',
      cancelByCreator: 'Cancelar (sin participantes)',
      claimRefund: 'Reclamar reembolso',
      reclaimSurplus: 'Recuperar ítems excedentes',
      reclaimUnclaimed: 'Recuperar premio no reclamado',
    },
    reloadPrompt: 'Cupos adicionales a comprar',
    nextStep: 'Próximo paso',
    noActions: 'Ningún paso pendiente que mostrar ahora.',
  },
};

const eventsTranslations = { en, pt, es };

export function useEventsCopy(): EventsCopy {
  const [lang] = useLang();
  return eventsTranslations[lang];
}
