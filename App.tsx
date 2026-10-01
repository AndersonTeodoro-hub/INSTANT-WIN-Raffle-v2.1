import React, { useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { wagmiConfig } from './constants';

import { PointerLight } from './components/PointerLight';
import { Landing } from './pages/Landing';
import { Roadmap } from './pages/Roadmap';
import { Giveaways } from './pages/Giveaways';
import { EventCenter } from './pages/EventCenter';
import { EventDetail } from './pages/EventDetail';
import { EventCreate } from './pages/EventCreate';
import { EventDashboard } from './pages/EventDashboard';
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
 * O URL canónico de cada rota, em keptra.io: junta num só endereço o site servido
 * também pelo alias da Vercel. Posto aqui e não no index.html, que é o mesmo para
 * todas as rotas — lá diria a todas que são a página inicial.
 */
const Canonical: React.FC = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = `https://keptra.io${pathname.replace(/(.)\/$/, '$1')}`;
  }, [pathname]);
  return null;
};

const App: React.FC = () => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PointerLight />
          <Canonical />
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

            {/* Páginas públicas, sem wallet — como a landing. */}
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/giveaways" element={<Giveaways />} />

            {/* Event Center — GiveawayManagerV2 + Bridge V2, ao vivo. */}
            <Route path="/events" element={<EventCenter />} />
            <Route path="/events/create" element={<EventCreate />} />
            <Route path="/events/mine" element={<EventDashboard />} />
            <Route path="/events/:id" element={<EventDetail />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </KeptraProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </WagmiProvider>
  );
};

export default App;
