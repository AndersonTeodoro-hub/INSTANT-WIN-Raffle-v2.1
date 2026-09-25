import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { SiteHeader } from '../SiteHeader';

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
      <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-control border-2 border-white font-display text-lg font-black leading-none text-white">
        K
      </span>
      <span className="font-display text-2xl font-bold tracking-tight text-white">Keptra</span>
      {area === 'business' && (
        <span className="ml-1 rounded-md border border-dark-line px-2 py-0.5 text-xs font-medium text-gray-300">Business</span>
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
    `inline-flex min-h-[44px] items-center rounded-control px-3 text-sm transition-colors duration-200 ${isActive ? 'bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'text-gray-400 hover:text-white'}`;

  return (
    <div className="iw-ground flex min-h-screen flex-col text-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-black">
        Skip to content
      </a>
      {/* The platform's one header (SiteHeader): the Keptra mark, the area's
          navigation, and the other area as the one secondary action. */}
      <SiteHeader
        lang={false}
        brand={<KeptraMark area={area === 'business' ? 'business' : undefined} />}
        actions={
          <>
            <nav aria-label={area === 'business' ? 'Business' : 'Main'} className="hidden items-center gap-1 lg:flex">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end ?? false} className={navClass}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <Link to={other.to} className="iw-btn iw-btn-secondary ml-2 hidden px-4 text-sm lg:inline-flex">
              {other.label}
            </Link>
            <button
              type="button"
              className="iw-btn iw-btn-secondary min-w-[44px] px-0 lg:hidden"
              aria-expanded={open}
              aria-controls="keptra-menu"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              <span className="sr-only">Menu</span>
            </button>
          </>
        }
      >
        {open && (
          <nav id="keptra-menu" aria-label="Menu" className="iw-swap border-t border-dark-border px-4 pb-4 pt-2 lg:hidden">
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
      </SiteHeader>
      <main id="main" className="iw-screen mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        {children}
      </main>
      <footer className="border-t border-dark-border bg-black/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-xs text-gray-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>Keptra — promises, kept. On-chain guarantee for brands, on Arbitrum One.</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="inline-flex min-h-[32px] items-center hover:text-white">
              Privacy
            </Link>
            <Link to="/pool" className="inline-flex min-h-[32px] items-center hover:text-white">
              Guarantee pool
            </Link>
            <span className="inline-flex min-h-[32px] items-center">© 2026 Keptra</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
