import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Inbox, Loader2 } from 'lucide-react';
import { shortAddress } from '../../lib/keptra/format';
import { ProofSeal } from '../Proof';

/*
 * The Keptra building blocks. The same system as the rest of the app — the dark
 * ground, Big Shoulders for headings, IBM Plex Mono for every figure, Inter for
 * text (T0: the current system with the Keptra name) — and every state spelled
 * out: loading, empty, error (T0: no blank screen, no technical message).
 *
 * V2: every text colour here reaches 4.5:1 on the ground it sits on — gray-400 is
 * the dimmest grey used for text (gray-500 measured about 4:1 on the cards), and a
 * disabled control changes colour instead of fading.
 */

export const ARBISCAN = 'https://arbiscan.io';

export function Card({ children, className = '', as: Tag = 'section' }: { children: React.ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <Tag className={`iw-surface p-5 sm:p-6 ${className}`}>{children}</Tag>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-medium text-gray-400">{children}</p>;
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

/* The platform's one button logic (index.css): primary is the screen's main action, in amber; secondary is outlined. */
const TONES: Record<ButtonTone, string> = {
  primary: 'iw-btn iw-btn-primary disabled:bg-dark-input disabled:text-gray-400 disabled:shadow-none',
  secondary: 'iw-btn iw-btn-secondary disabled:text-gray-400',
  danger: 'iw-btn border border-red-500/40 text-red-300 hover:border-red-400 hover:text-red-200 disabled:border-dark-border disabled:text-gray-400',
  quiet: 'iw-btn text-gray-300 underline underline-offset-4 hover:text-white disabled:text-gray-400',
};

/**
 * While `busy` the button keeps its focus and ignores presses (aria-disabled, not
 * disabled): a disabled button loses the focus, and V5 (B1) gives it back to the
 * button that opened the signing sheet when the sheet closes.
 */
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone; busy?: boolean }
>(function Button({ tone = 'primary', busy = false, className = '', children, onClick, ...rest }, ref) {
  const shape = tone === 'quiet' ? 'min-h-[44px] px-1 font-normal' : 'min-h-[48px] px-5';
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (busy) return event.preventDefault();
        onClick?.(event);
      }}
      className={`text-sm disabled:cursor-not-allowed aria-busy:cursor-wait ${shape} ${TONES[tone]} ${className}`}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
});

export function ButtonLink({ to, children, tone = 'secondary' }: { to: string; children: React.ReactNode; tone?: ButtonTone }) {
  return (
    <Link to={to} className={`min-h-[48px] px-5 text-sm ${TONES[tone]}`}>
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
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-dark-line bg-dark-card/40 p-6 text-sm text-gray-400">
      <Inbox className="h-5 w-5 text-gray-400" aria-hidden="true" />
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
    // Amber is only a prize's value and the main button: a warning is the light neutral, with its triangle.
    warning: 'border-gray-400/40 bg-white/[0.045] text-gray-100',
  }[tone];
  // A notice arrives with a short settle; a success is something now proven on-chain, so its seal draws itself.
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`iw-swap flex gap-3 rounded-card border p-4 text-sm leading-relaxed ${style}`}>
      {tone !== 'info' && tone !== 'success' && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      {tone === 'success' && <ProofSeal className="mt-0.5 h-4 w-4 text-success" />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-1' : ''}>{children}</div>
      </div>
    </div>
  );
}

/**
 * A signed action the chain has confirmed (the relay answered CONFIRMED): the
 * seal draws itself with one ring going out, and the transaction that proves it
 * is one tap away. A transaction still confirming is never shown this way.
 */
export function DoneOnChain({ text, txHash }: { text: string; txHash?: string }) {
  return (
    <div role="status" className="iw-swap flex items-start gap-3 rounded-card border border-success/40 bg-success/[0.06] p-4 text-sm leading-relaxed">
      <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-success/40 bg-black/50">
        <span aria-hidden="true" className="iw-done-ring absolute inset-0 rounded-full border border-success/60" />
        <ProofSeal className="h-4 w-4 text-success" />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-white">{text}</p>
        {txHash && (
          <a
            href={`${ARBISCAN}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex min-h-[32px] items-center gap-1.5 text-xs text-gray-300 hover:text-success"
          >
            Transaction <span className="font-mono text-success">{`${txHash.slice(0, 6)}…${txHash.slice(-4)}`}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">(opens Arbiscan)</span>
          </a>
        )}
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
      {hint && <dd className="mt-1 text-xs text-gray-400">{hint}</dd>}
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
    warning: 'border-gray-400/50 text-gray-200',
    danger: 'border-red-500/40 text-red-300',
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${style}`}>{children}</span>;
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; id: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm text-gray-300">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
      {error && (
        <p className="mt-1.5 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  'w-full min-h-[48px] rounded-control border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-400 transition-colors duration-200 hover:border-dark-line focus:border-gray-400';

/**
 * V3 (A3): a read that failed — the chain's or the bridge's — shown as what it is,
 * with the way to read it again. Never an empty list, never a sentence about what
 * was not read. `error` is the bridge's own sentence, or reads.ts CHAIN_FAILED.
 */
export function ReadError({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <Notice tone="error" title={`${what} could not be read.`}>
      <p>{error}</p>
      <Button tone="secondary" className="mt-3" onClick={onRetry}>
        Try again
      </Button>
    </Notice>
  );
}

/**
 * P6-11: the bridge lists at most a number of vouchers at once (account/vouchers
 * answers complete: false past it). The page says so, rather than let a missing
 * voucher read as one the account does not hold.
 */
/** V3 and P6-16: the words a figure the chain did not give shows in its place. */
export const NOT_READ = 'Not read';

export const VOUCHERS_INCOMPLETE = 'Not every voucher could be listed: the account holds more than the page reads at once, so some may be missing here.';

/** Q1 and U35: the contracts are not configured yet. */
export function NotAvailable() {
  return (
    <Notice title="Not available yet">
      Keptra orders, offers and the guarantee pool open once their contracts are deployed on Arbitrum One. Nothing here can be paid or signed until then.
    </Notice>
  );
}
