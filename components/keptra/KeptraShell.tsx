import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { SiteHeader, KeptraBrand } from '../SiteHeader';
import { LangSwitch } from '../LangSwitch';
import { useKeptraCopy, type KeptraCopy } from '../../pages/keptra.i18n';

/*
 * The frame of every Keptra screen. T0: one identity (the app's system, named
 * Keptra), and the business area apart from the customer's — its own label in
 * the header and its own navigation. T21: laid out for the computer first (a wide
 * container, nothing marooned in a narrow column), and complete on a phone (the
 * navigation folds into a menu of finger-sized links, nothing hidden). The core
 * (orders, the pool, the console) is Keptra itself, so the header shows the logo
 * alone, with no module name.
 */

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly end?: boolean;
}

// The module's name (Event Center) is not translated.
const customerLinks = (t: KeptraCopy): readonly NavItem[] => [
  { to: '/orders', label: t.shell.myOrders },
  { to: '/account', label: t.shell.account },
  { to: '/pool', label: t.shell.pool },
  { to: '/events', label: 'Event Center' },
];

const businessLinks = (t: KeptraCopy): readonly NavItem[] => [
  { to: '/business', label: t.shell.console, end: true },
  { to: '/business/offers', label: t.shell.offers },
  { to: '/business/obligations', label: t.shell.obligations },
  { to: '/pool', label: t.shell.pool },
  { to: '/account', label: t.shell.account },
];

export function KeptraShell({ area = 'customer', children }: { area?: 'customer' | 'business'; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { t } = useKeptraCopy();
  const links = area === 'business' ? businessLinks(t) : customerLinks(t);
  const other = area === 'business' ? { to: '/orders', label: t.shell.customerArea } : { to: '/business', label: t.shell.forBusinesses };

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex min-h-[44px] items-center rounded-control px-3 text-sm transition-colors duration-200 ${isActive ? 'bg-white/[0.06] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'text-gray-400 hover:text-white'}`;

  return (
    <div className="iw-ground flex min-h-screen flex-col text-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-black">
        {t.shell.skip}
      </a>
      {/* The platform's one header (SiteHeader): the Keptra mark, the area's
          navigation, the language — the home page's switch, in the same place,
          after the navigation — and the other area as the one secondary action.
          The switch translates these screens as it does the rest of the site
          (T17, revised by the owner on 27/09/2026: the Keptra screens in the
          chosen language). */}
      <SiteHeader
        lang={false}
        brand={<KeptraBrand tag={area === 'business' ? t.shell.business : undefined} />}
        actions={
          <>
            <nav aria-label={area === 'business' ? t.shell.business : t.shell.main} className="hidden items-center gap-1 lg:flex">
              {links.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end ?? false} className={navClass}>
                  {link.label}
                </NavLink>
              ))}
            </nav>
            <LangSwitch />
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
              <span className="sr-only">{t.shell.menu}</span>
            </button>
          </>
        }
      >
        {open && (
          <nav id="keptra-menu" aria-label={t.shell.menu} className="iw-swap border-t border-dark-border px-4 pb-4 pt-2 lg:hidden">
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
          <p>{t.shell.tagline}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Link to="/privacy" className="inline-flex min-h-[32px] items-center hover:text-white">
              {t.shell.privacy}
            </Link>
            <Link to="/pool" className="inline-flex min-h-[32px] items-center hover:text-white">
              {t.shell.pool}
            </Link>
            <span className="inline-flex min-h-[32px] items-center">© 2026 Keptra</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
