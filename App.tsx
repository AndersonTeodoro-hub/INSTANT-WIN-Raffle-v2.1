import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { wagmiConfig, PRELAUNCH, TELEGRAM_URL } from './constants';

import { Navbar, GameTabs } from './components/Navbar';
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
// SPEC-BLOCO-03 piece 6 — Keptra: the customer's and the business's screens, the pool, privacy.
import { KeptraProvider } from './components/keptra/KeptraProvider';
import { AccountPage } from './pages/keptra/AccountPage';
import { OrdersPage } from './pages/keptra/OrdersPage';
import { OrderPage } from './pages/keptra/OrderPage';
import { OfferPage } from './pages/keptra/OfferPage';
import { VoucherPage } from './pages/keptra/VoucherPage';
import { BusinessPage } from './pages/keptra/BusinessPage';
import { PoolPage } from './pages/keptra/PoolPage';
import { PrivacyPage } from './pages/keptra/PrivacyPage';

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
    <div className="border-b border-dark-border bg-dark-card/70">
      <div className="container mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
        <p className="text-sm text-gray-300">{t.prelaunch.headline}</p>
        <a
          href={TELEGRAM_URL}
          {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="iw-btn iw-btn-secondary px-5 text-sm"
        >
          {t.prelaunch.cta}
        </a>
      </div>
    </div>
  );
};

/*
 * Shell das rotas do jogo (/play/*): o cabeçalho da plataforma, os separadores
 * do jogo, o chão comum (luz fria de cima e grelha, index.css `.iw-ground`) e o
 * rodapé. O âmbar fica para o valor do prémio e o CTA do bilhete.
 */
const GameLayout: React.FC = () => (
  <div className="iw-ground min-h-screen flex flex-col font-sans text-white overflow-x-hidden">
    <Navbar />

    {PRELAUNCH && <PrelaunchBanner />}

    <main className="flex-1 container mx-auto px-4 py-8 sm:py-10">
      <GameTabs />
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
    <footer className="border-t border-dark-border py-8 mt-10 bg-black/80">
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
          <span aria-hidden="true" className="iw-live" />
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
          <KeptraProvider>
          <Routes>
            <Route path="/" element={<Landing />} />

            {/* Keptra (SPEC-BLOCO-03 piece 6). The notices link to /account, /orders/:id and /store/orders/:id (mail.ts). */}
            <Route path="/account" element={<AccountPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:id" element={<OrderPage />} />
            <Route path="/offers/:termsId" element={<OfferPage />} />
            <Route path="/vouchers/:id" element={<VoucherPage />} />
            <Route path="/business" element={<BusinessPage section="orders" />} />
            <Route path="/business/offers" element={<BusinessPage section="offers" />} />
            <Route path="/business/obligations" element={<BusinessPage section="obligations" />} />
            <Route path="/store/orders/:id" element={<BusinessPage section="orders" />} />
            <Route path="/pool" element={<PoolPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />

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
          </KeptraProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

export default App;
