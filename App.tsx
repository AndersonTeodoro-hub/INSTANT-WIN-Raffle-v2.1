import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { wagmiConfig, PRELAUNCH, TELEGRAM_URL } from './constants';

import { Navbar } from './components/Navbar';
import { PublicFooterNav } from './components/PublicNav';
import { Landing } from './pages/Landing';
import { Roadmap } from './pages/Roadmap';
import { Giveaways } from './pages/Giveaways';
import { EventCenter } from './pages/EventCenter';
import { EventDetail } from './pages/EventDetail';
import { EventCreate } from './pages/EventCreate';
import { EventDashboard } from './pages/EventDashboard';
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
    <div className="relative z-10 border-b border-dark-border bg-dark-card/70 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
        <p className="text-sm text-gray-300">{t.prelaunch.headline}</p>
        <a
          href={TELEGRAM_URL}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg border border-dark-border text-sm font-medium text-gray-200 hover:text-white hover:border-gray-600 transition-colors"
        >
          {t.prelaunch.cta}
        </a>
      </div>
    </div>
  );
};

/*
 * Shell das rotas do jogo (/play/*): navbar, um halo de fundo, rodapé.
 *
 * Um só halo, e frio. Havia dois — um azul e um âmbar — e o âmbar competia com
 * o valor do prémio e com o CTA do bilhete, que são os dois únicos sítios onde
 * o âmbar significa algo. A moldura do Event Center (components/EventShell.tsx)
 * usa exactamente o mesmo halo, para os dois módulos assentarem no mesmo chão.
 */
const GameLayout: React.FC = () => (
  <div className="min-h-screen bg-black relative flex flex-col font-sans text-white overflow-hidden selection:bg-brand/30 selection:text-white">

    <div
      aria-hidden="true"
      className="fixed top-[-25%] left-1/2 -translate-x-1/2 w-[80%] h-[45%] bg-action/[0.07] rounded-full blur-[130px] pointer-events-none z-0"
    />

    <Navbar />

    {PRELAUNCH && <PrelaunchBanner />}

    <main className="flex-1 container mx-auto px-4 py-8 sm:py-12 relative z-10">
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
    <footer className="border-t border-dark-border py-8 mt-10 bg-black relative z-10">
      <div className="container mx-auto px-4 text-center space-y-3">
        {/* Saída do jogo para o resto do Event Center. Mesmo componente do
            rodapé da landing, /roadmap e /giveaways — em app instalada, que
            corre sem barra de endereço, é isto e a marca do Navbar. */}
        <PublicFooterNav />
        {/* Aviso de jogo responsável em texto corrido: era caixa alta espaçada,
            que é decoração, e isto é para ser lido. */}
        <p className="mx-auto max-w-[62ch] text-xs leading-relaxed text-gray-400">
          {t.footer.responsibleShort}
        </p>
        <p className="flex justify-center items-center gap-2 font-mono text-[11px] text-success">
          <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-success" />
          {c.footer.liveOn}
        </p>
        <p className="font-mono text-[10px] text-gray-400">© 2026 Instant Win Protocol</p>
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

            {/* Páginas públicas, sem wallet e sem layout do jogo — como a landing. */}
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/giveaways" element={<Giveaways />} />

            {/* Event Center — GiveawayManagerV2 + Bridge V2, ao vivo. */}
            <Route path="/events" element={<EventCenter />} />
            <Route path="/events/create" element={<EventCreate />} />
            <Route path="/events/mine" element={<EventDashboard />} />
            <Route path="/events/:id" element={<EventDetail />} />

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
