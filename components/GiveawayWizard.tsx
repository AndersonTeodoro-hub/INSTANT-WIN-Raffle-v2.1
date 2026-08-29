import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Info, RotateCcw, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS, EARLY_ACCESS_FORM_URL, GIVEAWAY_LIMITS } from '../constants';
import { useGiveawaysCopy } from '../pages/giveaways.i18n';

/**
 * Preview do fluxo de criação de campanhas do GiveawayManager.
 *
 * PREVIEW: não há wagmi, não há wallet, não há transacção, não há fetch. Todo o
 * estado vive neste componente e morre com o refresh — de propósito. A criação
 * de campanhas abre depois do lançamento público da lottery; até lá isto é a
 * forma honesta de mostrar o produto: os passos reais, os limites reais do
 * contrato, e um fim que diz o que ainda não dá para fazer em vez de fingir um
 * submit.
 *
 * Os limites validados aqui vêm todos de GIVEAWAY_LIMITS — nenhum número é
 * escrito à mão neste ficheiro.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT_RE = /^(\d*)(?:\.(\d*))?$/;

/** Milhares com vírgula, como o resto dos números do site. */
const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * String decimal → unidades base do token. `null` quando não é um número ou
 * quando traz mais casas do que o token tem — o mesmo que uma wallet recusaria
 * antes de sequer construir a transacção.
 */
export function parseUnits(value: string, decimals: number): bigint | null {
  const m = AMOUNT_RE.exec(value.trim());
  if (!m) return null;
  const int = m[1] ?? '';
  const frac = m[2] ?? '';
  if (!int && !frac) return null;
  if (frac.length > decimals) return null;
  return BigInt((int || '0') + frac.padEnd(decimals, '0'));
}

/** Unidades base → string legível, sem zeros à direita. */
export function formatUnits(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, '0');
  const int = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  return frac ? `${group(int)}.${frac}` : group(int);
}

/**
 * Taxa da plataforma: a MESMA divisão inteira do contrato
 * (`prizeAmount * FEE_BPS / 10_000`), em BigInt e não em vírgula flutuante.
 * É daqui que sai o guard de pó: se a taxa arredonda a zero, o contrato reverte.
 */
export function feeOf(prizeUnits: bigint): bigint {
  return (prizeUnits * GIVEAWAY_LIMITS.FEE_BPS) / GIVEAWAY_LIMITS.BPS_DENOMINATOR;
}

/*
 * Auto-verificação da aritmética acima. Corre uma vez no arranque em dev e
 * desaparece do bundle de produção (`import.meta.env.DEV` é constante no build).
 * O projecto não tem test runner e não é este ecrã que o vai introduzir; isto é
 * o mínimo que falha alto se alguém mexer no parse ou na taxa.
 */
if (import.meta.env.DEV) {
  const eq = (got: unknown, want: unknown, what: string) => {
    if (String(got) !== String(want)) throw new Error(`GiveawayWizard: ${what} — got ${got}, want ${want}`);
  };
  eq(parseUnits('5000', 6), 5_000_000_000n, 'parseUnits inteiro');
  eq(parseUnits('0.5', 6), 500_000n, 'parseUnits fracção');
  eq(parseUnits('1.1234567', 6), null, 'parseUnits excesso de casas');
  eq(parseUnits('', 6), null, 'parseUnits vazio');
  eq(parseUnits('abc', 6), null, 'parseUnits lixo');
  eq(feeOf(5_000_000_000n), 250_000_000n, 'taxa de 5%');
  eq(feeOf(19n), 0n, 'guard de po: taxa arredonda a zero');
  eq(formatUnits(250_000_000n, 6), '250', 'formatUnits sem fracção');
  eq(formatUnits(1_234_567_890n, 6), '1,234.56789', 'formatUnits com milhares');
}

/** Rascunho da campanha. Só memória — nada é persistido nem enviado. */
interface Draft {
  token: 'usdc' | 'custom';
  address: string;
  decimals: string;
  amount: string;
  duration: string;
  unit: 'hours' | 'days';
  winners: string;
  eligibility: 'open' | 'allowlist';
  allowlist: string;
}

/*
 * Valores iniciais de uma campanha plausível, não campos vazios: quem abre a
 * página vê logo o passo 4 a fazer contas a sério em vez de ter de imaginar.
 */
const INITIAL: Draft = {
  token: 'usdc',
  address: '',
  decimals: '18',
  amount: '5000',
  duration: '7',
  unit: 'days',
  winners: '100',
  eligibility: 'open',
  allowlist: '',
};

const USDC_DECIMALS = 6;
const STEP_COUNT = 5;

const inputClass =
  'w-full min-h-[48px] rounded-lg border border-dark-border bg-dark-input px-4 text-white ' +
  'placeholder:text-gray-600 focus:outline-none focus:border-gray-500 transition-colors';

const Field: React.FC<{
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ label, hint, error, htmlFor, children, className = '' }) => (
  <div className={className}>
    <label htmlFor={htmlFor} className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">
      {label}
    </label>
    {children}
    {/* O erro substitui a dica: duas linhas por baixo do campo em mobile é ruído. */}
    {error ? (
      <p className="mt-2 text-sm text-red-400 leading-relaxed">{error}</p>
    ) : hint ? (
      <p className="mt-2 text-sm text-gray-500 leading-relaxed">{hint}</p>
    ) : null}
  </div>
);

/** Cartão-opção (token, elegibilidade). Alvo inteiro clicável, ≥44px. */
const OptionCard: React.FC<{
  selected: boolean;
  onSelect: () => void;
  title: string;
  body?: string;
}> = ({ selected, onSelect, title, body }) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={clsx(
      'w-full text-left rounded-xl border p-4 min-h-[48px] transition-colors',
      selected ? 'border-gray-500 bg-white/[0.04]' : 'border-dark-border bg-black/30 hover:border-gray-700',
    )}
  >
    <span className="flex items-center gap-3">
      <span
        className={clsx(
          'w-4 h-4 rounded-full border shrink-0',
          selected ? 'border-white bg-white' : 'border-gray-600',
        )}
      />
      <span className="font-bold text-white">{title}</span>
    </span>
    {body && <span className="block text-sm text-gray-400 leading-relaxed mt-2 pl-7 break-all">{body}</span>}
  </button>
);

/** Linha da revisão. `emphasis` reserva o âmbar aos valores de prémio. */
const ReviewRow: React.FC<{ label: string; value: string; emphasis?: boolean }> = ({
  label,
  value,
  emphasis = false,
}) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 border-b border-dark-border last:border-0">
    <span className="text-sm text-gray-400">{label}</span>
    <span
      className={clsx(
        'font-mono text-sm sm:text-base font-bold break-all text-right',
        emphasis ? 'text-brand' : 'text-white',
      )}
    >
      {value}
    </span>
  </div>
);

export const GiveawayWizard: React.FC = () => {
  const { wizard: w } = useGiveawaysCopy();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(INITIAL);

  /*
   * Instante base do "entries close". Fixado à montagem em vez de Date.now() a
   * cada render, senão a data da revisão saltava um segundo a cada tecla.
   */
  const [mountedAt] = useState(() => Date.now());

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const decimals = draft.token === 'usdc' ? USDC_DECIMALS : Number(draft.decimals);
  const symbol = draft.token === 'usdc' ? 'USDC' : 'TOKEN';
  const decimalsValid = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36;

  const prize = decimalsValid ? parseUnits(draft.amount, decimals) : null;
  const fee = prize === null ? null : feeOf(prize);

  const hours = useMemo(() => {
    const n = Number(draft.duration);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return draft.unit === 'days' ? n * 24 : n;
  }, [draft.duration, draft.unit]);

  const winners = Number(draft.winners);

  /** Uma entrada por linha; linhas em branco ignoradas, como um paste real. */
  const allowLines = useMemo(
    () => draft.allowlist.split('\n').map((l) => l.trim()).filter(Boolean),
    [draft.allowlist],
  );
  const allowValid = allowLines.filter((l) => ADDRESS_RE.test(l)).length;

  const endsAt = useMemo(() => {
    if (!Number.isFinite(hours)) return '—';
    // Locale vindo do i18n: em inglês continua a ser en-GB, como antes.
    return new Intl.DateTimeFormat(w.dateLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(mountedAt + hours * 3_600_000),
    );
  }, [hours, mountedAt, w.dateLocale]);

  /*
   * Erros do passo actual. É o que trava o "Continue" — as mesmas condições que
   * o contrato reverteria, verificadas aqui só para o visitante as ver.
   */
  const errors = useMemo(() => {
    const e: Partial<Record<'address' | 'decimals' | 'amount' | 'duration' | 'winners' | 'allowlist', string>> = {};

    if (step === 0) {
      if (draft.token === 'custom') {
        if (!ADDRESS_RE.test(draft.address.trim())) e.address = w.errors.addressInvalid;
        if (!decimalsValid) e.decimals = w.errors.decimalsInvalid;
      }
      if (prize === null || prize === 0n) e.amount = w.errors.amountInvalid;
      else if (fee === 0n) e.amount = w.errors.amountDust;
    }

    if (step === 1) {
      if (
        !Number.isFinite(hours) ||
        hours < GIVEAWAY_LIMITS.MIN_DURATION_HOURS ||
        hours > GIVEAWAY_LIMITS.MAX_DURATION_HOURS
      ) {
        e.duration = w.errors.durationRange;
      }
      if (!Number.isInteger(winners) || winners < 1 || winners > GIVEAWAY_LIMITS.MAX_WINNERS) {
        e.winners = w.errors.winnersRange;
      }
    }

    if (step === 2 && draft.eligibility === 'allowlist') {
      if (allowLines.length === 0) e.allowlist = w.errors.allowEmpty;
      else if (allowLines.length > GIVEAWAY_LIMITS.MAX_PARTICIPANTS) e.allowlist = w.errors.allowTooMany;
      else if (allowValid !== allowLines.length) e.allowlist = w.errors.allowInvalid;
    }

    return e;
  }, [step, draft, prize, fee, hours, winners, allowLines, allowValid, decimalsValid, w]);

  const blocked = Object.keys(errors).length > 0;

  const share = prize !== null && Number.isInteger(winners) && winners > 0 ? prize / BigInt(winners) : null;
  const hasDust = prize !== null && share !== null && prize % BigInt(winners) !== 0n;
  const isExternalForm = /^https?:\/\//i.test(EARLY_ACCESS_FORM_URL);

  const money = (units: bigint | null) => (units === null ? '—' : `${formatUnits(units, decimals)} ${symbol}`);
  const durationLabel = Number.isFinite(hours)
    ? `${draft.duration} ${draft.unit === 'days' ? w.timing.unitDays : w.timing.unitHours}`
    : '—';

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-card overflow-hidden">

      {/*
        Aviso permanente de preview. Discreto por desenho — cinzento, mono, sem
        ícone de alarme: informa que nada aqui toca na blockchain, não assusta.
      */}
      <div className="flex items-center gap-2.5 border-b border-dark-border bg-black/40 px-4 sm:px-8 py-3">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" aria-hidden="true" />
        <p className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-gray-500">
          {w.banner}
        </p>
      </div>

      {/* Progresso. A linha de texto serve mobile; as barras dão a forma. */}
      <div className="px-4 sm:px-8 pt-6">
        <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-3">
          {`${step + 1} ${w.stepOf} ${STEP_COUNT} · ${w.stepNames[step]}`}
        </p>
        <ol className="flex gap-1.5" aria-hidden="true">
          {w.stepNames.map((name, i) => (
            <li
              key={name}
              className={clsx('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-gray-400' : 'bg-dark-border')}
            />
          ))}
        </ol>
      </div>

      <div className="px-4 sm:px-8 py-6 sm:py-8">

        {/* 1 — PRÉMIO */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">{w.prize.title}</h3>
              <p className="text-gray-400 leading-relaxed">{w.prize.hint}</p>
            </div>

            <Field label={w.prize.tokenLabel}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <OptionCard
                  selected={draft.token === 'usdc'}
                  onSelect={() => set('token', 'usdc')}
                  title={w.prize.tokenUsdc}
                  body={CONTRACTS.USDC}
                />
                <OptionCard
                  selected={draft.token === 'custom'}
                  onSelect={() => set('token', 'custom')}
                  title={w.prize.tokenCustom}
                />
              </div>
            </Field>

            {draft.token === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                <Field label={w.prize.addressLabel} htmlFor="gw-address" error={errors.address}>
                  <input
                    id="gw-address"
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0x…"
                    value={draft.address}
                    onChange={(ev) => set('address', ev.target.value)}
                    className={`${inputClass} font-mono text-sm`}
                  />
                </Field>
                <Field label={w.prize.decimalsLabel} htmlFor="gw-decimals" error={errors.decimals}>
                  <input
                    id="gw-decimals"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={36}
                    value={draft.decimals}
                    onChange={(ev) => set('decimals', ev.target.value)}
                    className={`${inputClass} font-mono sm:w-28`}
                  />
                </Field>
              </div>
            )}

            <Field label={w.prize.amountLabel} htmlFor="gw-amount" hint={w.prize.amountHint} error={errors.amount}>
              <div className="relative">
                <input
                  id="gw-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.amount}
                  onChange={(ev) => set('amount', ev.target.value)}
                  className={`${inputClass} font-mono text-lg pr-20`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-gray-500 pointer-events-none">
                  {symbol}
                </span>
              </div>
            </Field>
          </div>
        )}

        {/* 2 — DURAÇÃO E VENCEDORES */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">{w.timing.title}</h3>
              <p className="text-gray-400 leading-relaxed">{w.timing.hint}</p>
            </div>

            <Field label={w.timing.durationLabel} htmlFor="gw-duration" error={errors.duration}>
              <div className="flex gap-3">
                <input
                  id="gw-duration"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={draft.duration}
                  onChange={(ev) => set('duration', ev.target.value)}
                  className={`${inputClass} font-mono text-lg flex-1`}
                />
                <select
                  aria-label={w.timing.durationLabel}
                  value={draft.unit}
                  onChange={(ev) => set('unit', ev.target.value as Draft['unit'])}
                  className={`${inputClass} w-32 shrink-0`}
                >
                  <option value="hours">{w.timing.unitHours}</option>
                  <option value="days">{w.timing.unitDays}</option>
                </select>
              </div>
            </Field>

            <div className="rounded-lg border border-dark-border bg-black/30 px-4 py-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="font-mono text-[11px] uppercase tracking-widest text-gray-500">
                {w.timing.endsLabel}
              </span>
              <span className="font-mono text-sm text-white">{endsAt}</span>
            </div>

            <Field
              label={w.timing.winnersLabel}
              htmlFor="gw-winners"
              hint={w.timing.winnersHint}
              error={errors.winners}
            >
              <input
                id="gw-winners"
                type="number"
                inputMode="numeric"
                min={1}
                max={GIVEAWAY_LIMITS.MAX_WINNERS}
                value={draft.winners}
                onChange={(ev) => set('winners', ev.target.value)}
                className={`${inputClass} font-mono text-lg`}
              />
            </Field>
          </div>
        )}

        {/* 3 — ELEGIBILIDADE */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">{w.eligibility.title}</h3>
              <p className="text-gray-400 leading-relaxed">{w.eligibility.hint}</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <OptionCard
                selected={draft.eligibility === 'open'}
                onSelect={() => set('eligibility', 'open')}
                title={w.eligibility.openTitle}
                body={w.eligibility.openBody}
              />
              <OptionCard
                selected={draft.eligibility === 'allowlist'}
                onSelect={() => set('eligibility', 'allowlist')}
                title={w.eligibility.allowTitle}
                body={w.eligibility.allowBody}
              />
            </div>

            {draft.eligibility === 'allowlist' && (
              <>
                <Field label={w.eligibility.allowLabel} htmlFor="gw-allowlist" error={errors.allowlist}>
                  <textarea
                    id="gw-allowlist"
                    rows={5}
                    spellCheck={false}
                    placeholder={w.eligibility.allowPlaceholder}
                    value={draft.allowlist}
                    onChange={(ev) => set('allowlist', ev.target.value)}
                    className={`${inputClass} font-mono text-sm py-3 resize-y leading-relaxed`}
                  />
                </Field>

                <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-gray-500">
                  <Users className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {`${group(String(allowValid))} ${w.eligibility.allowCount}`}
                </div>

                <p className="flex gap-3 text-sm text-gray-500 leading-relaxed">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  {w.eligibility.merkleNote}
                </p>
              </>
            )}
          </div>
        )}

        {/* 4 — REVISÃO */}
        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl text-white mb-2">{w.review.title}</h3>
              <p className="text-gray-400 leading-relaxed">{w.review.hint}</p>
            </div>

            <div className="rounded-xl border border-dark-border bg-black/30 px-4 sm:px-6 py-2">
              <ReviewRow
                label={w.review.rowToken}
                value={draft.token === 'usdc' ? 'USDC' : draft.address.trim() || '—'}
              />
              <ReviewRow label={w.review.rowPrize} value={money(prize)} emphasis />
              <ReviewRow label={w.review.rowFee} value={money(fee)} emphasis />
              <ReviewRow
                label={w.review.rowTotal}
                value={prize !== null && fee !== null ? money(prize + fee) : '—'}
                emphasis
              />
              <ReviewRow label={w.review.rowDuration} value={durationLabel} />
              <ReviewRow label={w.review.rowEnds} value={endsAt} />
              <ReviewRow label={w.review.rowWinners} value={group(String(winners || 0))} />
              <ReviewRow label={w.review.rowShare} value={money(share)} emphasis />
              <ReviewRow
                label={w.review.rowEligibility}
                value={
                  draft.eligibility === 'open'
                    ? w.review.openValue
                    : `${w.review.allowValue} · ${group(String(allowValid))}`
                }
              />
            </div>

            <div className="space-y-3">
              {hasDust && (
                <p className="flex gap-3 text-sm text-gray-500 leading-relaxed">
                  <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  {w.review.dustNote}
                </p>
              )}
              <p className="flex gap-3 text-sm text-gray-500 leading-relaxed">
                <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                {w.review.clampNote}
              </p>
            </div>
          </div>
        )}

        {/* 5 — EARLY ACCESS (em vez de submit) */}
        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h3 className="font-display font-bold text-2xl sm:text-3xl text-white mb-3">{w.submit.title}</h3>
              <p className="text-gray-400 leading-relaxed">{w.submit.body}</p>
            </div>

            {/*
              Único CTA âmbar do wizard, e o único do ecrã abaixo do herói: é o
              passo que interessa a quem chegou até aqui.
            */}
            <a
              href={EARLY_ACCESS_FORM_URL}
              {...(isExternalForm ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-3 bg-brand hover:bg-amber-400 text-black font-extrabold px-10 h-14 rounded-lg transition-colors"
            >
              {w.submit.cta}
              <ExternalLink className="w-5 h-5" />
            </a>

            <p className="text-sm text-gray-500 leading-relaxed">{w.submit.note}</p>
          </div>
        )}
      </div>

      {/* Navegação */}
      <div className="flex items-center justify-between gap-3 border-t border-dark-border px-4 sm:px-8 py-4">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="inline-flex items-center gap-2 min-h-[48px] px-4 rounded-lg border border-dark-border text-sm font-bold text-gray-300 hover:text-white hover:border-gray-600 transition-colors disabled:opacity-30 disabled:pointer-events-none"
        >
          <ArrowLeft className="w-4 h-4" />
          {w.back}
        </button>

        {step === STEP_COUNT - 1 ? (
          <button
            type="button"
            onClick={() => {
              setDraft(INITIAL);
              setStep(0);
            }}
            className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-lg border border-dark-border text-sm font-bold text-gray-300 hover:text-white hover:border-gray-600 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            {w.restart}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
            disabled={blocked}
            className="inline-flex items-center gap-2 min-h-[48px] px-6 rounded-lg bg-white text-black text-sm font-extrabold hover:bg-gray-200 transition-colors disabled:opacity-30 disabled:pointer-events-none"
          >
            {w.next}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};
