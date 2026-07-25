import { useEffect, useState } from 'react';

// Landing-only i18n. Scope is deliberately the marketing page; the game
// (/play/*) stays English for now. No i18n library — a plain lookup object
// keyed by language plus a tiny persistence hook is all this needs.

export type Lang = 'en' | 'pt' | 'es';
export const LANGS: Lang[] = ['en', 'pt', 'es'];
const STORAGE_KEY = 'iw-lang';

// Technical terms kept in English across all languages (industry convention):
// Chainlink VRF, USDC, Arbitrum One, on-chain, wallet, smart contract, open-source.
export interface LandingCopy {
  header: { enterApp: string };
  hero: { badge: string; headlineTop: string; headlineBottom: string; sub: string; cta: string };
  how: {
    eyebrow: string;
    title: string;
    steps: { title: string; body: string }[]; // order matches STEP_ICONS in Landing.tsx
  };
  why: {
    eyebrow: string;
    title: string;
    colInstant: string;
    colTraditional: string;
    rows: { label: string; instant: string; traditional: string }[];
  };
  transparency: { eyebrow: string; title: string; vrfPre: string; vrfPost: string };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  finalCta: { title: string };
  footer: { contractsLabel: string; responsible: string; disclaimer: string };
}

const en: LandingCopy = {
  header: { enterApp: 'Enter App' },
  hero: {
    badge: 'Powered by Chainlink VRF',
    headlineTop: 'Provably fair.',
    headlineBottom: 'Instantly paid.',
    sub: '3 winners every 30 minutes. Tickets from 1 USDC. Live on Arbitrum One.',
    cta: 'PLAY NOW',
  },
  how: {
    eyebrow: 'How it works',
    title: "Three steps. That's it.",
    steps: [
      { title: 'Connect & grab tickets', body: 'Connect your wallet and buy tickets. 1 ticket = 1 USDC.' },
      { title: 'VRF draws 3 winners', body: 'Chainlink VRF draws 3 winners every 30 minutes — pure verifiable randomness, no human hands.' },
      { title: 'Paid automatically', body: "Prizes hit winners' wallets automatically. No claims, no waiting." },
    ],
  },
  why: {
    eyebrow: "Why it's different",
    title: 'On-chain, not on trust.',
    colInstant: 'Instant Win',
    colTraditional: 'Traditional lottery',
    rows: [
      { label: 'Draws', instant: 'Every 30 minutes', traditional: 'Weekly' },
      { label: 'Randomness', instant: 'Chainlink VRF, on-chain proof', traditional: 'Trust the operator' },
      { label: 'Payout', instant: 'Automatic smart contract', traditional: 'Manual claim process' },
      { label: 'Rules', instant: 'Open-source contracts anyone can read', traditional: 'Closed systems' },
    ],
  },
  transparency: {
    eyebrow: 'Transparency',
    title: "Don't trust. Verify.",
    vrfPre: 'Every draw is settled by ',
    vrfPost: ', which provides cryptographically verifiable randomness that no one — not even us — can predict or tamper with. This website is only an interface: the game itself lives on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Good questions.',
    items: [
      { q: 'What do I need to play?', a: 'An Arbitrum One wallet (such as MetaMask) with some USDC for tickets and a little ETH for gas.' },
      { q: 'What is USDC and where do I get it?', a: 'USDC is a US-dollar stablecoin. You can buy it on most exchanges and move it to the Arbitrum One network.' },
      { q: 'How are winners picked?', a: 'Chainlink VRF produces verifiable on-chain randomness. Each draw selects 3 winners and the proof is public — anyone can check it.' },
      { q: 'When do I get paid?', a: 'Automatically. When a round ends the smart contract sends prizes straight to the winning wallets. There is no claim step.' },
      { q: 'What are the odds?', a: 'Your chance in a round depends only on how many tickets you hold versus the total tickets in that round. It is luck, not strategy.' },
      { q: 'Is this available in my country?', a: 'Access depends on the rules of your own jurisdiction. It is your responsibility to check whether you are allowed to participate where you live.' },
      { q: 'Who runs this?', a: 'The game runs entirely on-chain through open-source smart contracts. This website is only an open interface to them.' },
    ],
  },
  finalCta: { title: 'The next draw is already running.' },
  footer: {
    contractsLabel: 'Verified Contracts · Arbitrum One',
    responsible: "18+. Play responsibly. This is a game of chance — never play with funds you can't afford to lose.",
    disclaimer: 'Nothing on this page is financial advice. This site is an open-source interface to on-chain smart contracts.',
  },
};

const pt: LandingCopy = {
  header: { enterApp: 'Abrir app' },
  hero: {
    badge: 'Com tecnologia Chainlink VRF',
    headlineTop: 'Comprovadamente justo.',
    headlineBottom: 'Pago na hora.',
    sub: '3 ganhadores a cada 30 minutos. Bilhetes a partir de 1 USDC. Na Arbitrum One.',
    cta: 'JOGAR AGORA',
  },
  how: {
    eyebrow: 'Como funciona',
    title: 'Três passos. Só isso.',
    steps: [
      { title: 'Conecte e pegue bilhetes', body: 'Conecte sua wallet e compre bilhetes. 1 bilhete = 1 USDC.' },
      { title: 'O VRF sorteia 3 ganhadores', body: 'O Chainlink VRF sorteia 3 ganhadores a cada 30 minutos — aleatoriedade verificável, sem mãos humanas.' },
      { title: 'Pagamento automático', body: 'Os prêmios caem nas wallets dos ganhadores automaticamente. Sem resgates, sem espera.' },
    ],
  },
  why: {
    eyebrow: 'Por que é diferente',
    title: 'On-chain, não na confiança.',
    colInstant: 'Instant Win',
    colTraditional: 'Loteria tradicional',
    rows: [
      { label: 'Sorteios', instant: 'A cada 30 minutos', traditional: 'Semanal' },
      { label: 'Aleatoriedade', instant: 'Chainlink VRF, prova on-chain', traditional: 'Confie no operador' },
      { label: 'Pagamento', instant: 'Smart contract automático', traditional: 'Resgate manual' },
      { label: 'Regras', instant: 'Contratos open-source que qualquer um pode ler', traditional: 'Sistemas fechados' },
    ],
  },
  transparency: {
    eyebrow: 'Transparência',
    title: 'Não confie. Verifique.',
    vrfPre: 'Cada sorteio é definido pelo ',
    vrfPost: ', que fornece aleatoriedade verificável por criptografia que ninguém — nem mesmo nós — pode prever ou manipular. Este site é apenas uma interface: o jogo em si vive on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Boas perguntas.',
    items: [
      { q: 'O que eu preciso para jogar?', a: 'Uma wallet na Arbitrum One (como a MetaMask) com um pouco de USDC para os bilhetes e um pouco de ETH para o gas.' },
      { q: 'O que é USDC e onde consigo?', a: 'USDC é uma stablecoin atrelada ao dólar americano. Você pode comprá-la na maioria das exchanges e transferi-la para a rede Arbitrum One.' },
      { q: 'Como os ganhadores são escolhidos?', a: 'O Chainlink VRF gera aleatoriedade verificável on-chain. Cada sorteio escolhe 3 ganhadores e a prova é pública — qualquer um pode conferir.' },
      { q: 'Quando eu recebo?', a: 'Automaticamente. Quando uma rodada termina, o smart contract envia os prêmios direto para as wallets ganhadoras. Não existe etapa de resgate.' },
      { q: 'Quais são as chances?', a: 'Sua chance em uma rodada depende apenas de quantos bilhetes você tem em relação ao total de bilhetes daquela rodada. É sorte, não estratégia.' },
      { q: 'Está disponível no meu país?', a: 'O acesso depende das regras da sua própria jurisdição. É sua responsabilidade verificar se você tem permissão para participar no lugar onde vive.' },
      { q: 'Quem administra isto?', a: 'O jogo roda inteiramente on-chain por meio de smart contracts open-source. Este site é apenas uma interface aberta para eles.' },
    ],
  },
  finalCta: { title: 'O próximo sorteio já está rolando.' },
  footer: {
    contractsLabel: 'Contratos verificados · Arbitrum One',
    responsible: 'É preciso ter 18+. Jogue com responsabilidade. Este é um jogo de azar — nunca jogue com dinheiro que você não pode perder.',
    disclaimer: 'Nada nesta página constitui aconselhamento financeiro. Este site é uma interface open-source para smart contracts on-chain.',
  },
};

const es: LandingCopy = {
  header: { enterApp: 'Abrir app' },
  hero: {
    badge: 'Con tecnología Chainlink VRF',
    headlineTop: 'Demostrablemente justo.',
    headlineBottom: 'Pago al instante.',
    sub: '3 ganadores cada 30 minutos. Boletos desde 1 USDC. En Arbitrum One.',
    cta: 'JUGAR AHORA',
  },
  how: {
    eyebrow: 'Cómo funciona',
    title: 'Tres pasos. Nada más.',
    steps: [
      { title: 'Conecta y toma boletos', body: 'Conecta tu wallet y compra boletos. 1 boleto = 1 USDC.' },
      { title: 'El VRF sortea 3 ganadores', body: 'Chainlink VRF sortea 3 ganadores cada 30 minutos — aleatoriedad verificable, sin manos humanas.' },
      { title: 'Pago automático', body: 'Los premios llegan a las wallets de los ganadores automáticamente. Sin reclamos, sin esperas.' },
    ],
  },
  why: {
    eyebrow: 'Por qué es diferente',
    title: 'On-chain, no en la confianza.',
    colInstant: 'Instant Win',
    colTraditional: 'Lotería tradicional',
    rows: [
      { label: 'Sorteos', instant: 'Cada 30 minutos', traditional: 'Semanal' },
      { label: 'Aleatoriedad', instant: 'Chainlink VRF, prueba on-chain', traditional: 'Confía en el operador' },
      { label: 'Pago', instant: 'Smart contract automático', traditional: 'Reclamo manual' },
      { label: 'Reglas', instant: 'Contratos open-source que cualquiera puede leer', traditional: 'Sistemas cerrados' },
    ],
  },
  transparency: {
    eyebrow: 'Transparencia',
    title: 'No confíes. Verifica.',
    vrfPre: 'Cada sorteo se define con ',
    vrfPost: ', que aporta aleatoriedad verificable por criptografía que nadie — ni siquiera nosotros — puede predecir ni manipular. Este sitio es solo una interfaz: el juego en sí vive on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Buenas preguntas.',
    items: [
      { q: '¿Qué necesito para jugar?', a: 'Una wallet en Arbitrum One (como MetaMask) con algo de USDC para los boletos y un poco de ETH para el gas.' },
      { q: '¿Qué es USDC y dónde lo consigo?', a: 'USDC es una stablecoin ligada al dólar estadounidense. Puedes comprarla en la mayoría de los exchanges y moverla a la red Arbitrum One.' },
      { q: '¿Cómo se eligen los ganadores?', a: 'Chainlink VRF genera aleatoriedad verificable on-chain. Cada sorteo elige 3 ganadores y la prueba es pública — cualquiera puede verificarla.' },
      { q: '¿Cuándo me pagan?', a: 'Automáticamente. Cuando termina una ronda, el smart contract envía los premios directo a las wallets ganadoras. No hay paso de reclamo.' },
      { q: '¿Cuáles son las probabilidades?', a: 'Tu probabilidad en una ronda depende solo de cuántos boletos tienes frente al total de boletos de esa ronda. Es suerte, no estrategia.' },
      { q: '¿Está disponible en mi país?', a: 'El acceso depende de las normas de tu propia jurisdicción. Es tu responsabilidad verificar si tienes permiso para participar en el lugar donde vives.' },
      { q: '¿Quién administra esto?', a: 'El juego funciona por completo on-chain mediante smart contracts open-source. Este sitio es solo una interfaz abierta hacia ellos.' },
    ],
  },
  finalCta: { title: 'El próximo sorteo ya está en marcha.' },
  footer: {
    contractsLabel: 'Contratos verificados · Arbitrum One',
    responsible: 'Solo 18+. Juega con responsabilidad. Este es un juego de azar — nunca juegues con dinero que no puedas permitirte perder.',
    disclaimer: 'Nada en esta página constituye asesoramiento financiero. Este sitio es una interfaz open-source hacia smart contracts on-chain.',
  },
};

export const translations: Record<Lang, LandingCopy> = { en, pt, es };

export const LANG_LABEL: Record<Lang, string> = { en: 'EN', pt: 'PT', es: 'ES' };

function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'pt' || stored === 'es') return stored;
  } catch {
    /* localStorage unavailable (private mode) — fall through to navigator */
  }
  const nav = typeof navigator !== 'undefined' && navigator.language ? navigator.language.toLowerCase() : 'en';
  if (nav.startsWith('pt')) return 'pt';
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

// useState + localStorage. Persists the choice and reflects it on <html lang>.
export function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>(detectLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore persistence failure */
    }
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  return [lang, setLang];
}
