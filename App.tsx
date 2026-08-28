import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { wagmiConfig, PRELAUNCH, TELEGRAM_URL } from './constants';

import { Navbar } from './components/Navbar';
import { Landing } from './pages/Landing';
import { Roadmap } from './pages/Roadmap';
import { Dashboard } from './pages/Dashboard';
import { Raffle } from './pages/Raffle';
import { Username } from './pages/Username';
import { useLang, translations } from './pages/landing.i18n';
import { useAppCopy } from './pages/app.i18n';

const queryClient = new QueryClient();

/**
 * Aviso de pré-lançamento no topo de /play.
 *
 * Deliberadamente neutro e discreto — sem âmbar, que aqui pertence ao prémio e
 * ao CTA de compra. Não bloqueia nada: o jogo continua todo acessível por baixo.
 * A mensagem vem do mesmo sítio que a da landing, para não haver duas versões.
 */
const PrelaunchBanner: React.FC = () => {
  const [lang] = useLang();
  const t = translations[lang];
  const isExternal = /^https?:\/\//i.test(TELEGRAM_URL);

  return (
    <div className="relative z-10 border-b border-dark-border bg-dark-card/80 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
        <p className="text-sm font-medium text-gray-300">{t.prelaunch.headline}</p>
        <a
          href={TELEGRAM_URL}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-gray-600 transition-colors"
        >
          {t.prelaunch.cta}
        </a>
      </div>
    </div>
  );
};

// Shell for the game routes (/play/*): navbar, ambient glows, footer.
const GameLayout: React.FC = () => (
  <div className="min-h-screen bg-black relative flex flex-col font-sans text-white overflow-hidden selection:bg-brand/30 selection:text-white">

    {/* Premium Ambient Background Glows (Gold & Blue) */}
    <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />
    <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-brand/5 rounded-full blur-[120px] pointer-events-none z-0" />

    <Navbar />

    {PRELAUNCH && <PrelaunchBanner />}

    <main className="flex-1 container mx-auto px-4 py-6 sm:py-12 relative z-10">
      <Outlet />
    </main>

    <GameFooter />
  </div>
);

/**
 * Rodapé das páginas do jogo. O aviso de jogo responsável segue o idioma que o
 * visitante escolheu na landing (persistido em localStorage), para não voltar a
 * inglês assim que se entra no app.
 */
const GameFooter: React.FC = () => {
  const [lang] = useLang();
  const t = translations[lang];
  const c = useAppCopy();

  return (
    <footer className="border-t border-dark-border py-6 sm:py-8 mt-8 bg-black/80 backdrop-blur-sm relative z-10">
      <div className="container mx-auto px-4 text-center space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">
          {t.footer.responsibleShort}
        </p>
        <div className="flex justify-center items-center gap-2 font-mono text-[11px] text-gray-600">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          {c.footer.liveOn}
        </div>
        <p className="font-mono text-[10px] text-gray-700">© 2026 Instant Win Protocol</p>
      </div>
    </footer>
  );
};

const App: React.FC = () => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />

            {/* Página pública, sem wallet e sem layout do jogo — como a landing. */}
            <Route path="/roadmap" element={<Roadmap />} />

            <Route path="/play" element={<GameLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="raffle" element={<Raffle />} />
              <Route path="identity" element={<Username />} />
            </Route>

            {/* Legacy routes → new equivalents (keep old links alive) */}
            <Route path="/raffle" element={<Navigate to="/play/raffle" replace />} />
            <Route path="/username" element={<Navigate to="/play/identity" replace />} />
            {/* /shares e /play/shares foram removidos com a camada de investidores do V3;
                caem no catch-all abaixo. */}

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

export default App;
