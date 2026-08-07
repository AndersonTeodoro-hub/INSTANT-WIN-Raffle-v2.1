import React from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { wagmiConfig } from './constants';

import { Navbar } from './components/Navbar';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { Raffle } from './pages/Raffle';
import { Username } from './pages/Username';

const queryClient = new QueryClient();

// Shell for the game routes (/play/*): navbar, ambient glows, footer.
const GameLayout: React.FC = () => (
  <div className="min-h-screen bg-black relative flex flex-col font-sans text-white overflow-hidden selection:bg-brand/30 selection:text-white">

    {/* Premium Ambient Background Glows (Gold & Blue) */}
    <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />
    <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-brand/5 rounded-full blur-[120px] pointer-events-none z-0" />

    <Navbar />

    <main className="flex-1 container mx-auto px-4 py-12 relative z-10">
      <Outlet />
    </main>

    <footer className="border-t border-dark-border py-8 mt-12 bg-black/80 backdrop-blur-sm relative z-10">
      <div className="container mx-auto px-4 text-center">
         <p className="text-gray-600 text-sm font-medium">© 2024 Instant Win Protocol. All rights reserved.</p>
         <div className="flex justify-center items-center gap-2 mt-3 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_5px_#22c55e]"></span>
            Live on Arbitrum One
         </div>
      </div>
    </footer>
  </div>
);

const App: React.FC = () => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />

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
