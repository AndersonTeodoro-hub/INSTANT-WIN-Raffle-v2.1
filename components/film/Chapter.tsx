import React from 'react';
import { clsx } from 'clsx';
import { FilmAnchor, FilmSection, useFilmMode, type KeySpec } from './Film';

/**
 * Um capítulo do filme: o texto num lado, a cena no outro (no telemóvel, a cena
 * em cima e o texto em baixo). Fixado enquanto a cena muda de forma.
 *
 * `figure`: um diagrama no lugar da cena (components/proof, commit B de
 * 27/09/2026). Desenhado no DOM, entra e sai com o texto do capítulo; a cena
 * espera por trás dele, escondida (chaves com alpha 0), e não tem legenda — os
 * rótulos do diagrama dizem o que ele mostra.
 */
export function Chapter({
  id,
  keys,
  wide = false,
  dense = false,
  label,
  caption,
  figure,
  figureClassName = 'max-w-[34rem]',
  children,
}: {
  id: string;
  keys: readonly KeySpec[];
  wide?: boolean;
  /** Muito texto ao lado: no telemóvel a forma encolhe, para o capítulo fixado caber no ecrã. */
  dense?: boolean;
  label: string;
  /** O que a forma representa neste capítulo, em linguagem simples (sem `figure`). */
  caption?: string;
  figure?: React.ReactNode;
  /** A largura do diagrama: no telemóvel, limitada pela altura do ecrã, como a forma que substitui. */
  figureClassName?: string;
  children: React.ReactNode;
}) {
  const live = useFilmMode() === 'live';
  return (
    <FilmSection id={id} label={label}>
      <div
        className={clsx(
          'container mx-auto grid max-w-6xl gap-8 px-5 sm:px-6 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:items-center lg:gap-16',
          live ? 'h-full content-center pb-16 pt-28 md:pt-24 lg:py-0' : 'py-16 sm:py-24',
        )}
      >
        <div className="min-w-0 lg:order-2">
          {figure ? (
            <div className={clsx('relative mx-auto w-full', figureClassName)}>
              <FilmAnchor keys={keys} ghost className="pointer-events-none absolute inset-0" />
              <div data-film-panel>{figure}</div>
            </div>
          ) : (
            <>
              <FilmAnchor
                keys={keys}
                className={clsx(
                  'mx-auto w-full',
                  wide
                    ? 'aspect-[4/3] max-w-[min(92vw,calc((100svh_-_27rem)_*_1.33))] lg:max-w-[min(40rem,calc(70svh_*_1.33))]'
                    : dense
                      ? 'aspect-square max-w-[min(64vw,max(11rem,calc(100svh_-_33rem)))] lg:max-w-[min(32rem,70svh)]'
                      : 'aspect-square max-w-[min(80vw,calc(100svh_-_27rem))] lg:max-w-[min(32rem,70svh)]',
                )}
              />
              <SceneCaption text={caption ?? ''} />
            </>
          )}
        </div>
        <div data-film-panel className="min-w-0 lg:order-1">
          {children}
        </div>
      </div>
    </FilmSection>
  );
}

/**
 * O cabeçalho de um capítulo: a posição na sequência, o rótulo, o título.
 * `sentence`: o título é uma frase inteira (os capítulos da página inicial), num
 * corpo menor para não passar de quatro ou cinco linhas; `center` para o fecho.
 */
export function ChapterHead({ index, label, title, sentence = false, center = false }: { index: number; label: string; title: string; sentence?: boolean; center?: boolean }) {
  return (
    <>
      <p className={clsx('flex items-center gap-3 text-sm text-gray-400', center && 'justify-center')}>
        <span className="font-mono text-gray-300 tabular-nums">{`0${index}`}</span>
        <span aria-hidden="true" className="h-px w-8 bg-dark-line" />
        {label}
      </p>
      <h2
        className={clsx(
          'mt-4 font-display font-bold tracking-tight text-white',
          sentence ? 'text-[clamp(1.85rem,6vw,2.6rem)] leading-[1.08]' : 'text-[clamp(2.25rem,8vw,3.75rem)] leading-[1.02]',
        )}
      >
        {title}
      </h2>
    </>
  );
}


/**
 * A legenda junto da forma: o que ela representa ali, para quem não conhece a
 * cadeia. Aparece e sai com o painel do capítulo; na versão parada, sempre.
 */
export function SceneCaption({ text, className }: { text: string; className?: string }) {
  return (
    <p data-film-panel className={clsx('mx-auto mt-3 max-w-[44ch] text-center text-xs leading-relaxed text-gray-300', className)}>
      {text}
    </p>
  );
}
