import React from 'react';
import { clsx } from 'clsx';
import { ConnectWallet } from './ConnectWallet';
import { SiteHeader, KeptraBrand } from './SiteHeader';
import { PublicNavLinks, PublicFooterNav, MODULES } from './PublicNav';

/**
 * Moldura das quatro páginas do Event Center.
 *
 * Antes do redesenho havia quatro cópias à mão do mesmo header, do mesmo glow e
 * do mesmo rodapé — uma por página — e alterar a aparência do Event Center
 * significava alterar as quatro e esperar que não divergissem. Passa a haver um
 * sítio.
 *
 * O cabeçalho é o da plataforma (SiteHeader) e o chão é o comum (`.iw-ground`):
 * a luz é fria, porque o âmbar pertence ao valor do prémio e ao único CTA cheio.
 * À esquerda, "Keptra / Event Center": o nome do módulo leva à lista de
 * campanhas, o regresso que as páginas de detalhe tinham à parte.
 */
export const EventShell: React.FC<{
  children: React.ReactNode;
  /** Largura da coluna de conteúdo. A lista respira mais do que um formulário. */
  width?: 'wide' | 'regular' | 'narrow';
  /** Páginas do criador precisam de wallet ligada; as do participante não. */
  wallet?: boolean;
  /** A acção do contexto, à direita do header (ex.: "Criar um sorteio"). */
  actions?: React.ReactNode;
  /** Secundários do header (ex.: "Os meus sorteios"); descem para a linha da navegação no telemóvel. */
  extras?: React.ReactNode;
}> = ({ children, width = 'regular', wallet = false, actions, extras }) => (
  <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-hidden">
    <SiteHeader
      brand={<KeptraBrand module={MODULES.eventCenter} />}
      nav={<PublicNavLinks />}
      extras={extras}
      actions={
        actions || wallet ? (
          <>
            {actions}
            {wallet && <ConnectWallet />}
          </>
        ) : undefined
      }
    />

    <main
      className={clsx(
        'iw-screen flex-1 container mx-auto px-4 sm:px-6 py-10 sm:py-14',
        width === 'wide' && 'max-w-6xl',
        width === 'regular' && 'max-w-3xl',
        width === 'narrow' && 'max-w-2xl',
      )}
    >
      {children}
    </main>

    <footer className="border-t border-dark-border py-8 bg-black/80">
      <div className="container mx-auto px-4 space-y-3 text-center">
        <PublicFooterNav />
        <p className="text-xs text-gray-400">&copy; 2026 Keptra</p>
      </div>
    </footer>
  </div>
);
