import React from 'react';
import { clsx } from 'clsx';
import { FilmAnchor, FilmSection, useFilmMode, type KeySpec } from './Film';

/**
 * Um capítulo do filme: o texto num lado, a cena no outro (no telemóvel, a cena
 * em cima e o texto em baixo). Fixado enquanto a cena muda de forma.
 */
export function Chapter({
  id,
  keys,
  wide = false,
  label,
  children,
}: {
  id: string;
  keys: readonly KeySpec[];
  wide?: boolean;
  label: string;
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
        <FilmAnchor
          keys={keys}
          className={clsx(
            'mx-auto w-full lg:order-2',
            wide
              ? 'aspect-[4/3] max-w-[min(92vw,calc((100svh_-_27rem)_*_1.33))] lg:max-w-[min(40rem,calc(70svh_*_1.33))]'
              : 'aspect-square max-w-[min(80vw,calc(100svh_-_27rem))] lg:max-w-[min(32rem,70svh)]',
          )}
        />
        <div data-film-panel className="min-w-0 lg:order-1">
          {children}
        </div>
      </div>
    </FilmSection>
  );
}

/** O cabeçalho de um capítulo: a posição na sequência, o rótulo, o título. */
export function ChapterHead({ index, label, title }: { index: number; label: string; title: string }) {
  return (
    <>
      <p className="flex items-center gap-3 text-sm text-gray-400">
        <span className="font-mono text-gray-300 tabular-nums">{`0${index}`}</span>
        <span aria-hidden="true" className="h-px w-8 bg-dark-line" />
        {label}
      </p>
      <h2 className="mt-4 font-display text-[clamp(2.25rem,8vw,3.75rem)] font-bold leading-[1.02] tracking-tight text-white">{title}</h2>
    </>
  );
}

