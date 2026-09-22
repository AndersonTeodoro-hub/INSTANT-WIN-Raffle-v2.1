import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Inbox, Loader2 } from 'lucide-react';
import { shortAddress } from '../../lib/keptra/format';

/*
 * The Keptra building blocks. The same system as the rest of the app — the dark
 * ground, Big Shoulders for headings, IBM Plex Mono for every figure, Inter for
 * text (T0: the current system with the Keptra name) — and every state spelled
 * out: loading, empty, error (T0: no blank screen, no technical message).
 */

export const ARBISCAN = 'https://arbiscan.io';

export function Card({ children, className = '', as: Tag = 'section' }: { children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={`rounded-2xl border border-dark-border bg-dark-card p-5 sm:p-6 ${className}`}>{children}</Tag>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-gray-400">{children}</p>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-3">{children}</div>}
    </header>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-2xl font-bold tracking-tight text-white">{children}</h2>
      {aside}
    </div>
  );
}

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'quiet';

const TONES: Record<ButtonTone, string> = {
  primary: 'bg-brand text-black hover:bg-amber-400 disabled:bg-brand/40',
  secondary: 'border border-dark-border bg-dark-input text-white hover:border-gray-500 disabled:text-gray-500',
  danger: 'border border-red-500/40 text-red-300 hover:border-red-400 hover:text-red-200 disabled:opacity-50',
  quiet: 'text-gray-300 underline underline-offset-4 hover:text-white disabled:opacity-50',
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; busy?: boolean }
>(function Button({ tone = 'primary', busy = false, className = '', children, ...rest }, ref) {
  const shape = tone === 'quiet' ? 'min-h-[44px] px-1' : 'min-h-[48px] rounded-xl px-5 font-semibold';
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 text-sm transition-colors duration-150 disabled:cursor-not-allowed ${shape} ${TONES[tone]} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

export function ButtonLink({ to, children, tone = 'secondary' }: { to: string; children: React.ReactNode; tone?: ButtonTone }) {
  return (
    <Link to={to} className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors ${TONES[tone]}`}>
      {children}
    </Link>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-3 py-6 text-sm text-gray-400">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> {label}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-dark-border p-6 text-sm text-gray-400">
      <Inbox className="h-5 w-5 text-gray-500" aria-hidden="true" />
      <p className="font-medium text-gray-200">{title}</p>
      {children}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'error' | 'success' | 'warning'; title?: string; children: React.ReactNode }) {
  const style = {
    info: 'border-dark-border bg-dark-input text-gray-300',
    error: 'border-red-500/40 bg-red-500/[0.06] text-red-200',
    success: 'border-success/40 bg-success/[0.06] text-green-200',
    warning: 'border-brand/40 bg-brand/[0.06] text-amber-100',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-xl border p-4 text-sm leading-relaxed ${style}`}>
      {tone !== 'info' && tone !== 'success' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-1' : ''}>{children}</div>
      </div>
    </div>
  );
}

/** A figure: the label above, the value in the data face. */
export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="mt-1 break-words font-mono text-lg font-semibold tabular-nums text-white">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-gray-500">{hint}</dd>}
    </div>
  );
}

/** Label and value rows, as a description list: the conditions, an order's facts. */
export function Facts({ rows }: { rows: readonly (readonly [string, React.ReactNode])[] }) {
  return (
    <dl className="divide-y divide-dark-border border-y border-dark-border">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[minmax(0,14rem)_1fr] sm:gap-6">
          <dt className="text-sm text-gray-400">{label}</dt>
          <dd className="min-w-0 break-words text-sm text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={`${ARBISCAN}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-[32px] items-center gap-1 font-mono text-sm text-gray-300 underline decoration-dark-border underline-offset-4 hover:text-white"
      title={address}
    >
      {label ?? shortAddress(address)}
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">(opens Arbiscan)</span>
    </a>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) {
  const style = {
    neutral: 'border-dark-border text-gray-300',
    success: 'border-success/40 text-success',
    warning: 'border-brand/40 text-brand',
    danger: 'border-red-500/40 text-red-300',
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${style}`}>{children}</span>;
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm text-gray-300">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-gray-500">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full min-h-[48px] rounded-xl border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-500 focus:border-gray-400';

/** Q1 and U35: the contracts are not configured yet. */
export function NotAvailable() {
  return (
    <Notice title="Not available yet">
      Keptra orders, offers and the guarantee pool open once their contracts are deployed on Arbitrum One. Nothing here can be paid or signed until then.
    </Notice>
  );
}
