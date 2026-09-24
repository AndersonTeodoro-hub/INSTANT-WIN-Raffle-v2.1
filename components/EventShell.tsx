import React from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { ConnectWallet } from './ConnectWallet';
import { SiteHeader } from './SiteHeader';
import { PublicNavLinks, PublicFooterNav } from './PublicNav';

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
 */
export const EventShell: React.FC<{
  children: React.ReactNode;
  /** Largura da coluna de conteúdo. A lista respira mais do que um formulário. */
  width?: 'wide' | 'regular' | 'narrow';
  /** Link de regresso à esquerda do header, em vez do wordmark. */
  back?: { to: string; label: string };
  /** Páginas do criador precisam de wallet ligada; as do participante não. */
  wallet?: boolean;
  /** A acção do contexto, à direita do header (ex.: "Criar um sorteio"). */
  actions?: React.ReactNode;
  /** Secundários do header (ex.: "Os meus sorteios"); descem para a linha da navegação no telemóvel. */
  extras?: React.ReactNode;
}> = ({ children, width = 'regular', back, wallet = false, actions, extras }) => (
  <div className="iw-ground min-h-screen text-white font-sans flex flex-col overflow-x-hidden">
    <SiteHeader
      brand={
        back ? (
          <Link
            to={back.to}
            className="inline-flex items-center gap-2 min-h-[44px] text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            {back.label}
          </Link>
        ) : undefined
      }
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
        'flex-1 container mx-auto px-4 sm:px-6 py-10 sm:py-14',
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
        <p className="font-mono text-[10px] text-gray-400">&copy; 2026 Instant Win Protocol</p>
      </div>
    </footer>
  </div>
);
