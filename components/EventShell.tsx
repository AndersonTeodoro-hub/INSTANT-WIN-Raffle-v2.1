import React from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { ConnectWallet } from './ConnectWallet';
import { LangSwitch } from './LangSwitch';
import { PublicNavLinks, PublicFooterNav } from './PublicNav';

/**
 * Moldura das quatro páginas do Event Center.
 *
 * Antes do redesenho havia quatro cópias à mão do mesmo header, do mesmo glow e
 * do mesmo rodapé — uma por página — e alterar a aparência do Event Center
 * significava alterar as quatro e esperar que não divergissem. Passa a haver um
 * sítio.
 *
 * O glow é um só e fica frio (azul): o âmbar da casa pertence ao valor do prémio
 * e ao único CTA cheio de cada ecrã, e um halo âmbar por trás competia com ele.
 */
export const EventShell: React.FC<{
  children: React.ReactNode;
  /** Largura da coluna de conteúdo. A lista respira mais do que um formulário. */
  width?: 'wide' | 'regular' | 'narrow';
  /** Link de regresso à esquerda do header, em vez do wordmark. */
  back?: { to: string; label: string };
  /** Páginas do criador precisam de wallet ligada; as do participante não. */
  wallet?: boolean;
  /** CTAs à direita do header (ex.: "Os meus sorteios" / "Criar um sorteio"). */
  actions?: React.ReactNode;
}> = ({ children, width = 'regular', back, wallet = false, actions }) => (
  <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">
    <div
      aria-hidden="true"
      className="fixed top-[-25%] left-1/2 -translate-x-1/2 w-[80%] h-[45%] bg-action/[0.07] rounded-full blur-[130px] pointer-events-none z-0"
    />

    <header className="sticky top-0 z-20 border-b border-dark-border/70 bg-black/80 backdrop-blur-md">
      <div className="container mx-auto px-4 sm:px-6 min-h-[64px] md:h-[72px] flex flex-wrap md:flex-nowrap items-center gap-x-4 gap-y-1">
        {back ? (
          <Link
            to={back.to}
            className="inline-flex items-center gap-2 min-h-[44px] text-sm text-gray-400 hover:text-white transition-colors md:mr-auto"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            {back.label}
          </Link>
        ) : (
          <Link to="/" className="flex items-baseline gap-2 min-w-0 min-h-[44px] py-2 md:mr-auto">
            <span className="font-display font-bold text-xl sm:text-2xl tracking-tight leading-none truncate">
              Instant Win
            </span>
          </Link>
        )}

        <PublicNavLinks />

        <div className="flex items-center gap-2 shrink-0">
          <LangSwitch />
          {actions}
          {wallet && <ConnectWallet />}
        </div>
      </div>
    </header>

    <main
      className={clsx(
        'flex-1 relative z-10 container mx-auto px-4 sm:px-6 py-10 sm:py-14',
        width === 'wide' && 'max-w-6xl',
        width === 'regular' && 'max-w-3xl',
        width === 'narrow' && 'max-w-2xl',
      )}
    >
      {children}
    </main>

    <footer className="border-t border-dark-border py-8 bg-black relative z-10">
      <div className="container mx-auto px-4 space-y-3 text-center">
        <PublicFooterNav />
        <p className="font-mono text-[10px] text-gray-400">&copy; 2026 Instant Win Protocol</p>
      </div>
    </footer>
  </div>
);
