import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

/*
 * The frame of every Keptra screen. T0: one identity (the app's system, named
 * Keptra), and the business area apart from the customer's — its own label in
 * the header and its own navigation. T21: laid out for the computer first (a wide
 * container, nothing marooned in a narrow column), and complete on a phone (the
 * navigation folds into a menu of finger-sized links, nothing hidden).
 */

export function KeptraMark({ area }: { area?: 'business' }) {
  return (
    <Link to="/" className="flex min-h-[44px] items-center gap-2.5" aria-label="Keptra, home">
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg border-2 border-brand font-display text-lg font-black leading-none text-brand">
        K
      </span>
      <span className="font-display text-2xl font-bold tracking-tight text-white">Keptra</span>
      {area === 'business' && (
        <span className="ml-1 rounded-md border border-brand/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand">Business</span>
      )}
    </Link>
  );
}

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean;
}

const CUSTOMER_LINKS: readonly NavItem[] = [
  { to: '/orders', label: 'My orders' },
  { to: '/account', label: 'Account' },
  { to: '/pool', label: 'Guarantee pool' },
  { to: '/events', label: 'Event Center' },
  { to: '/play', label: 'Instant Win' },
];

const BUSINESS_LINKS: readonly NavItem[] = [
  { to: '/business', label: 'Console', end: true },
  { to: '/business/offers', label: 'Offers' },
  { to: '/business/obligations', label: 'Prize obligations' },
  { to: '/pool', label: 'Guarantee pool' },
  { to: '/account', label: 'Account' },
];

export function KeptraShell({ area = 'customer', children }: { area?: 'customer' | 'business'; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const links = area === 'business' ? BUSINESS_LINKS : CUSTOMER_LINKS;
  const other = area === 'business' ? { to: '/orders', label: 'Customer area' } : { to: '/business', label: 'For businesses' };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm transition-colors ${isActive ? 'bg-white/[0.06] text-white' : 'text-gray-400 hover:text-white'}`;

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-black">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-dark-border bg-black/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <KeptraMark area={area === 'business' ? 'business' : undefined} />
          <nav aria-label={area === 'business' ? 'Business' : 'Main'} className="hidden items-center gap-1 lg:flex">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end ?? false} className={navClass}>
                {link.label}
              </NavLink>
            ))}
            <Link to={other.to} className="ml-3 inline-flex min-h-[44px] items-center rounded-lg border border-dark-border px-3 text-sm text-gray-300 hover:border-gray-500 hover:text-white">
              {other.label}
            </Link>
          </nav>
          <button
            type="button"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-dark-border text-gray-300 lg:hidden"
            aria-expanded={open}
            aria-controls="keptra-menu"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            <span className="sr-only">Menu</span>
          </button>
        </div>
        {open && (
          <nav id="keptra-menu" aria-label="Menu" className="border-t border-dark-border px-4 pb-4 pt-2 lg:hidden">
            <ul className="flex flex-col">
              {[...links, other].map((link) => (
                <li key={link.to}>
                  <NavLink to={link.to} onClick={() => setOpen(false)} className={navClass}>
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-dark-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Keptra — promises, kept. On-chain guarantee for brands, on Arbitrum One.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="inline-flex min-h-[32px] items-center hover:text-white">
              Privacy
            </Link>
            <Link to="/pool" className="inline-flex min-h-[32px] items-center hover:text-white">
              Guarantee pool
            </Link>
            <span className="inline-flex min-h-[32px] items-center font-mono">© 2026 Keptra</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
