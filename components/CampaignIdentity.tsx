import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';
import { arbitrum } from 'viem/chains';
import { ExternalLink, ImagePlus } from 'lucide-react';
import { clsx } from 'clsx';
import { CONTRACTS } from '../constants';
import { campaignIdentities, saveCampaignIdentity, type IdentitySaveResult } from '../lib/eventcenter';
import {
  BRAND_MAX,
  canonicalContent,
  checkImage,
  checkText,
  displayHost,
  IMAGE_LIMITS,
  identityMessage,
  LINK_MAX,
  MESSAGE_MAX,
  MESSAGE_MAX_LINES,
  NAME_MAX,
  sha256Hex,
  type ImageProblem,
  type ImageSlot,
  type PublicIdentity,
  type SignedImage,
} from '../lib/campaign-identity';
import { useEventsCopy, type EventsCopy } from '../pages/events.i18n';
import { Banner } from './Banner';
import { Button } from './Button';

/**
 * Identidade de campanha no browser — SPEC-BRIDGE-V2 §17.
 *
 * Três coisas, e só três: ler a identidade publicada (com fallback silencioso
 * quando não há nenhuma, L9), mostrá-la, e deixar o criador escrevê-la com uma
 * assinatura da carteira. As validações e a mensagem assinada vêm de
 * lib/campaign-identity.ts, o mesmo ficheiro que o servidor usa, para que o que
 * a página aceita e o que a ponte aceita não possam divergir.
 */

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ''));

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

/*
 * Um pedido por lote. A lista monta trinta cartões no mesmo instante e o painel
 * do criador um cartão por campanha; cada um pede a sua identidade, e os pedidos
 * que chegam dentro da mesma janela curta seguem juntos. O eixo IP do limitador
 * da ponte é partilhado por todas as rotas, e trinta pedidos soltos gastavam-no.
 */
type Waiter = { id: string; resolve: (identity: PublicIdentity | null) => void; reject: (error: Error) => void };
let waiting: Waiter[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_WINDOW_MS = 25;
const BATCH_MAX = 30;

async function flush() {
  const batch = waiting;
  waiting = [];
  flushTimer = null;
  const ids = [...new Set(batch.map((waiter) => waiter.id))];
  for (let start = 0; start < ids.length; start += BATCH_MAX) {
    const chunk = ids.slice(start, start + BATCH_MAX);
    const result = await campaignIdentities(chunk.map((id) => BigInt(id)));
    for (const waiter of batch.filter((w) => chunk.includes(w.id))) {
      if (result.ok) waiter.resolve(result.identities[waiter.id] ?? null);
      else waiter.reject(new Error(result.error));
    }
  }
}

function loadIdentity(id: bigint): Promise<PublicIdentity | null> {
  return new Promise((resolve, reject) => {
    waiting.push({ id: id.toString(), resolve, reject });
    flushTimer ??= setTimeout(flush, BATCH_WINDOW_MS);
  });
}

/** A identidade publicada de uma campanha: `null` se não houver, `undefined` enquanto não se sabe. */
export function useCampaignIdentity(giveawayId: bigint | null) {
  return useQuery({
    queryKey: ['campaign-identity', giveawayId?.toString() ?? ''],
    queryFn: () => loadIdentity(giveawayId as bigint),
    enabled: giveawayId !== null,
    staleTime: 60_000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// apresentação
// ---------------------------------------------------------------------------

/** O banner, sempre na proporção das pré-visualizações de links. Decorativo: o nome está ao lado. */
export const IdentityBanner: React.FC<{ identity: PublicIdentity; className?: string }> = ({ identity, className }) => (
  <img
    src={identity.banner.url}
    alt=""
    width={identity.banner.width}
    height={identity.banner.height}
    loading="lazy"
    decoding="async"
    className={clsx('block w-full max-w-full aspect-[1200/630] object-cover bg-dark-card', className)}
  />
);

/**
 * "de Acme", com o logótipo e, quando o criador o deu, o link. `plain` tira o
 * link: dentro de um cartão que já é um link, um segundo link é HTML inválido.
 */
export const BrandByline: React.FC<{ identity: PublicIdentity; by: string; newTab: string; plain?: boolean }> = ({
  identity,
  by,
  newTab,
  plain = false,
}) => {
  const body = (
    <>
      {identity.logo && (
        <img
          src={identity.logo.url}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          className="h-5 w-5 shrink-0 rounded object-cover bg-dark-card"
        />
      )}
      <span className="min-w-0 truncate">
        {by} <span className="text-gray-200">{identity.brand}</span>
      </span>
    </>
  );

  if (plain || identity.link === null) {
    return <span className="flex items-center gap-2 min-w-0 text-sm text-gray-400">{body}</span>;
  }
  return (
    <a
      href={identity.link}
      target="_blank"
      rel="noopener noreferrer nofollow ugc"
      aria-label={`${by} ${identity.brand} — ${displayHost(identity.link)} (${newTab})`}
      className="inline-flex max-w-full items-center gap-2 min-h-[44px] text-sm text-gray-400 hover:text-white transition-colors"
    >
      {body}
      {/* Em telemóvel o domínio cortava o nome da marca; a marca é o que importa, o domínio fica no aria-label. */}
      <span className="hidden sm:inline shrink-0 font-mono text-xs text-gray-400">{displayHost(identity.link)}</span>
      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
};

// ---------------------------------------------------------------------------
// escrita
// ---------------------------------------------------------------------------

export interface ImagePick {
  readonly descriptor: SignedImage;
  /** Os bytes a enviar. `null` para uma imagem que já está publicada e se mantém. */
  readonly file: File | null;
  readonly previewUrl: string;
}

export interface IdentityDraft {
  readonly name: string;
  readonly message: string;
  readonly brand: string;
  readonly link: string;
  readonly banner: ImagePick | null;
  readonly logo: ImagePick | null;
}

export const emptyDraft = (): IdentityDraft => ({ name: '', message: '', brand: '', link: '', banner: null, logo: null });

export function draftFrom(identity: PublicIdentity): IdentityDraft {
  const kept = (image: PublicIdentity['logo']): ImagePick | null =>
    image === null
      ? null
      : {
          descriptor: { sha256: image.sha256, type: image.type, width: image.width, height: image.height },
          file: null,
          previewUrl: image.url,
        };
  return {
    name: identity.name,
    message: identity.message,
    brand: identity.brand,
    link: identity.link ?? '',
    banner: kept(identity.banner),
    logo: kept(identity.logo),
  };
}

/** O criador escreveu alguma coisa? Decide se a criação pede a segunda assinatura. */
export const draftTouched = (draft: IdentityDraft) =>
  [draft.name, draft.message, draft.brand, draft.link].some((value) => value.trim() !== '') ||
  draft.banner !== null ||
  draft.logo !== null;

export type IdentityProblem =
  | 'name'
  | 'message'
  | 'brand'
  | 'link'
  | 'bannerRequired'
  | 'imageType'
  | 'imageTooLarge'
  | 'imageDimensions'
  | 'notCreator'
  | 'expired'
  | 'rejected'
  | 'stale'
  | 'tooMany'
  | 'generic';

function problemFor(result: Extract<IdentitySaveResult, { ok: false }>): IdentityProblem {
  if (result.status === 429) return 'tooMany';
  switch (result.reason) {
    case 'INVALID_NAME':
      return 'name';
    case 'INVALID_MESSAGE':
      return 'message';
    case 'INVALID_BRAND':
      return 'brand';
    case 'INVALID_LINK':
      return 'link';
    case 'IMAGE_TYPE':
      return 'imageType';
    case 'IMAGE_TOO_LARGE':
      return 'imageTooLarge';
    case 'IMAGE_DIMENSIONS':
      return 'imageDimensions';
    case 'NOT_CREATOR':
      return 'notCreator';
    case 'SIGNATURE_EXPIRED':
    case 'SIGNATURE_USED':
      return 'expired';
    case 'STALE':
      return 'stale';
    default:
      return 'generic';
  }
}

export function problemText(copy: EventsCopy['identity'], problem: IdentityProblem): string {
  const errors = copy.errors;
  switch (problem) {
    case 'name':
      return fill(errors.name, { max: NAME_MAX });
    case 'message':
      return fill(errors.message, { max: MESSAGE_MAX, lines: MESSAGE_MAX_LINES });
    case 'brand':
      return fill(errors.brand, { max: BRAND_MAX });
    default:
      return errors[problem];
  }
}

const randomNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Assina e grava. A mensagem é construída aqui com a mesma função que o servidor
 * usa para a reconstruir (L3); o texto enviado é o já normalizado, para que a
 * normalização do servidor não o mude uma segunda vez.
 */
export function usePublishIdentity() {
  const { signMessageAsync } = useSignMessage();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<IdentityProblem | null>(null);

  const publish = async (giveawayId: bigint, draft: IdentityDraft): Promise<boolean> => {
    setProblem(null);
    const text = checkText({ name: draft.name, message: draft.message, brand: draft.brand, link: draft.link });
    if (!text.ok) {
      setProblem(text.field);
      return false;
    }
    if (draft.banner === null) {
      setProblem('bannerRequired');
      return false;
    }

    setBusy(true);
    try {
      const id = giveawayId.toString();
      const banner = draft.banner.descriptor;
      const logo = draft.logo?.descriptor ?? null;
      const issuedAt = new Date().toISOString();
      const nonce = randomNonce();
      const message = identityMessage({
        giveawayId: id,
        name: text.value.name,
        brand: text.value.brand,
        contentHash: await sha256Hex(canonicalContent({ giveawayId: id, ...text.value, banner, logo })),
        contract: CONTRACTS.GIVEAWAY_MANAGER_V2,
        chainId: arbitrum.id,
        issuedAt,
        nonce,
      });

      let signature: string;
      try {
        signature = await signMessageAsync({ message });
      } catch {
        setProblem('rejected');
        return false;
      }

      const form = new FormData();
      form.set('payload', JSON.stringify({ giveawayId: id, ...text.value, banner, logo, issuedAt, nonce, signature }));
      if (draft.banner.file) form.set('banner', draft.banner.file);
      if (draft.logo?.file) form.set('logo', draft.logo.file);

      const result = await saveCampaignIdentity(form);
      if (!result.ok) {
        setProblem(problemFor(result));
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: ['campaign-identity', id] });
      return true;
    } finally {
      setBusy(false);
    }
  };

  return { publish, busy, problem };
}

// ---------------------------------------------------------------------------
// formulário
// ---------------------------------------------------------------------------

const inputClass =
  'w-full min-h-[52px] rounded-xl border bg-dark-input px-4 text-white placeholder:text-gray-400 focus:border-gray-500';
const labelClass = 'flex items-baseline justify-between gap-3 text-sm text-gray-400 mb-2';

const IMAGE_PROBLEM: Record<ImageProblem, IdentityProblem> = {
  size: 'imageTooLarge',
  type: 'imageType',
  dimensions: 'imageDimensions',
};

function ImageField({
  slot,
  label,
  hint,
  optional,
  value,
  onChange,
  invalid,
}: {
  slot: ImageSlot;
  label: string;
  hint: string;
  optional?: string;
  value: ImagePick | null;
  onChange: (pick: ImagePick | null) => void;
  invalid: boolean;
}) {
  const copy = useEventsCopy().identity;
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<IdentityProblem | null>(null);
  const id = `identity-${slot}`;

  // Um URL de pré-visualização criado aqui é libertado quando deixa de ser usado.
  useEffect(() => {
    const url = value?.previewUrl;
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [value?.previewUrl]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkImage(slot, bytes);
    if (!checked.ok) {
      setProblem(IMAGE_PROBLEM[checked.problem]);
      return;
    }
    setProblem(null);
    onChange({
      descriptor: { ...checked.meta, sha256: await sha256Hex(bytes) },
      file,
      previewUrl: URL.createObjectURL(file),
    });
  };

  const isBanner = slot === 'banner';

  return (
    <div>
      <p className={labelClass}>
        <label htmlFor={id}>{label}</label>
        {optional && <span className="text-xs">{optional}</span>}
      </p>
      <div className={clsx('flex gap-4', isBanner ? 'flex-col' : 'items-center')}>
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-describedby={`${id}-hint`}
          className={clsx(
            'relative overflow-hidden rounded-xl border border-dashed bg-dark-card text-gray-400 hover:text-white transition-colors',
            isBanner ? 'w-full max-w-full aspect-[1200/630]' : 'h-20 w-20 shrink-0',
            invalid || problem ? 'border-red-500/50' : 'border-dark-border hover:border-gray-500',
          )}
        >
          {value ? (
            <img src={value.previewUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm">
              <ImagePlus className="w-5 h-5" aria-hidden="true" />
              {isBanner && copy.chooseImage}
            </span>
          )}
          <span className="sr-only">{value ? copy.replaceImage : copy.chooseImage}</span>
        </button>
        <div className="min-w-0 space-y-2">
          <p id={`${id}-hint`} className="text-xs leading-relaxed text-gray-400">
            {hint}
          </p>
          {value && (
            <div className="flex gap-4 text-sm">
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="min-h-[44px] text-gray-300 hover:text-white underline underline-offset-2"
              >
                {copy.replaceImage}
              </button>
              {optional && (
                <button
                  type="button"
                  onClick={() => onChange(null)}
                  className="min-h-[44px] text-gray-400 hover:text-white underline underline-offset-2"
                >
                  {copy.removeImage}
                </button>
              )}
            </div>
          )}
          {problem && (
            <p role="alert" className="text-xs text-red-300">
              {problemText(copy, problem)}
            </p>
          )}
        </div>
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/** Os seis campos. Controlado: quem o usa guarda o rascunho. */
export function IdentityFields({
  draft,
  onChange,
  problem,
}: {
  draft: IdentityDraft;
  onChange: (draft: IdentityDraft) => void;
  problem: IdentityProblem | null;
}) {
  const copy = useEventsCopy().identity;
  const set = <K extends keyof IdentityDraft>(key: K, value: IdentityDraft[K]) => onChange({ ...draft, [key]: value });
  const border = (field: IdentityProblem) => (problem === field ? 'border-red-500/50' : 'border-dark-border');
  const messageLength = Array.from(draft.message).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className={labelClass}>
            <label htmlFor="identity-name">{copy.nameLabel}</label>
          </p>
          <input
            id="identity-name"
            value={draft.name}
            maxLength={NAME_MAX * 2}
            onChange={(event) => set('name', event.target.value)}
            aria-invalid={problem === 'name'}
            aria-describedby="identity-name-hint"
            className={clsx(inputClass, border('name'))}
          />
          <p id="identity-name-hint" className="mt-2 text-xs text-gray-400">
            {fill(copy.nameHint, { max: NAME_MAX })}
          </p>
        </div>
        <div>
          <p className={labelClass}>
            <label htmlFor="identity-brand">{copy.brandLabel}</label>
          </p>
          <input
            id="identity-brand"
            value={draft.brand}
            maxLength={BRAND_MAX * 2}
            onChange={(event) => set('brand', event.target.value)}
            aria-invalid={problem === 'brand'}
            aria-describedby="identity-brand-hint"
            className={clsx(inputClass, border('brand'))}
          />
          <p id="identity-brand-hint" className="mt-2 text-xs text-gray-400">
            {fill(copy.brandHint, { max: BRAND_MAX })}
          </p>
        </div>
      </div>

      <div>
        <p className={labelClass}>
          <label htmlFor="identity-message">{copy.messageLabel}</label>
          <span
            className={clsx('font-mono text-xs tabular-nums', messageLength > MESSAGE_MAX ? 'text-red-300' : '')}
            aria-hidden="true"
          >
            {messageLength}/{MESSAGE_MAX}
          </span>
        </p>
        <textarea
          id="identity-message"
          rows={4}
          value={draft.message}
          onChange={(event) => set('message', event.target.value)}
          aria-invalid={problem === 'message'}
          aria-describedby="identity-message-hint"
          className={clsx(inputClass, 'py-3 leading-relaxed', border('message'))}
        />
        <p id="identity-message-hint" className="mt-2 text-xs text-gray-400">
          {fill(copy.messageHint, { max: MESSAGE_MAX })}
        </p>
      </div>

      <ImageField
        slot="banner"
        label={copy.bannerLabel}
        hint={fill(copy.bannerHint, {
          maxMb: IMAGE_LIMITS.banner.maxBytes / (1024 * 1024),
          minWidth: IMAGE_LIMITS.banner.minWidth,
          minHeight: IMAGE_LIMITS.banner.minHeight,
        })}
        value={draft.banner}
        onChange={(pick) => set('banner', pick)}
        invalid={problem === 'bannerRequired' || problem === 'imageDimensions' || problem === 'imageType'}
      />

      <ImageField
        slot="logo"
        label={copy.logoLabel}
        optional={copy.optional}
        hint={fill(copy.logoHint, { maxKb: IMAGE_LIMITS.logo.maxBytes / 1024 })}
        value={draft.logo}
        onChange={(pick) => set('logo', pick)}
        invalid={false}
      />

      <div>
        <p className={labelClass}>
          <label htmlFor="identity-link">{copy.linkLabel}</label>
          <span className="text-xs">{copy.optional}</span>
        </p>
        <input
          id="identity-link"
          type="url"
          inputMode="url"
          value={draft.link}
          maxLength={LINK_MAX}
          placeholder="https://"
          onChange={(event) => set('link', event.target.value)}
          aria-invalid={problem === 'link'}
          aria-describedby="identity-link-hint"
          className={clsx(inputClass, 'font-mono text-sm', border('link'))}
        />
        <p id="identity-link-hint" className="mt-2 text-xs text-gray-400">
          {copy.linkHint}
        </p>
      </div>
    </div>
  );
}

/** O editor completo do painel do criador: campos, assinatura, gravar. */
export function IdentityEditor({
  giveawayId,
  identity,
  onDone,
  onCancel,
}: {
  giveawayId: bigint;
  identity: PublicIdentity | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const copy = useEventsCopy().identity;
  const [draft, setDraft] = useState<IdentityDraft>(() => (identity ? draftFrom(identity) : emptyDraft()));
  const { publish, busy, problem } = usePublishIdentity();

  return (
    <div className="space-y-5">
      <h2 className="font-display text-xl font-bold tracking-tight text-white">{copy.dashboardTitle}</h2>
      <IdentityFields draft={draft} onChange={setDraft} problem={problem} />
      <p className="max-w-[58ch] text-xs leading-relaxed text-gray-400">{copy.signExplainer}</p>
      {problem && <Banner message={problemText(copy, problem)} />}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="connect"
          isLoading={busy}
          onClick={async () => {
            if (await publish(giveawayId, draft)) onDone();
          }}
          className="min-h-[48px] rounded-xl px-6 text-sm"
        >
          {copy.publishCta}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy} className="min-h-[48px] rounded-xl px-6 text-sm">
          {copy.cancelCta}
        </Button>
      </div>
    </div>
  );
}
