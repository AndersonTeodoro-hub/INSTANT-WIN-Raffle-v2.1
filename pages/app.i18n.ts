import { useLang } from './landing.i18n.js';
import type { Lang } from './landing.i18n.js';

// i18n partilhado fora da landing: a carteira (ConnectWallet, no Event Center) e
// a leitura da cadeia na /roadmap. Mesmo padrão do landing.i18n.ts: objecto de
// lookup por idioma, sem biblioteca. O `Lang`, o `useLang` e a persistência vêm
// de lá — há um só idioma escolhido para todo o site.

export interface AppCopy {
  wallet: {
    connect: string;
    wrongNet: string;
    selectWallet: string;
    cancel: string;
    ariaDisconnect: string;
  };
  winners: {
    reading: string;
  };
}

const en: AppCopy = {
  wallet: {
    connect: 'CONNECT',
    wrongNet: 'Wrong Net',
    selectWallet: 'Select Wallet',
    cancel: 'Cancel',
    ariaDisconnect: 'Disconnect wallet',
  },
  winners: {
    reading: 'Reading the chain…',
  },
};

const pt: AppCopy = {
  wallet: {
    connect: 'LIGAR',
    wrongNet: 'Rede errada',
    selectWallet: 'Escolha a carteira',
    cancel: 'Cancelar',
    ariaDisconnect: 'Desligar carteira',
  },
  winners: {
    reading: 'A ler a blockchain…',
  },
};

const es: AppCopy = {
  wallet: {
    connect: 'CONECTAR',
    wrongNet: 'Red incorrecta',
    selectWallet: 'Elige la wallet',
    cancel: 'Cancelar',
    ariaDisconnect: 'Desconectar wallet',
  },
  winners: {
    reading: 'Leyendo la blockchain…',
  },
};

export const appTranslations: Record<Lang, AppCopy> = { en, pt, es };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useAppCopy(): AppCopy {
  const [lang] = useLang();
  return appTranslations[lang];
}
