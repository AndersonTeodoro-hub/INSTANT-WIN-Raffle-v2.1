import React from 'react';
import { Check } from 'lucide-react';

/**
 * Um passo de uma sequência, com marcador numerado e trilho vertical.
 *
 * Numerar só se justifica quando o conteúdo é mesmo uma sequência, e estes dois
 * casos são: a participação no Event Center (identificar-se, entrar, indicar a
 * carteira do prémio, na ordem em que a ponte os executa) e a criação de uma
 * campanha (o prémio, as regras, financiar e lançar). Em nenhum outro sítio do
 * produto se numeram secções.
 *
 * O marcador fecha em verde quando o passo está feito — verde é a cor da prova
 * em toda a casa, e um passo concluído é exactamente isso.
 */
export const Step: React.FC<{
  index: number;
  title: string;
  done?: boolean;
  /** Sem trilho a seguir, e sem espaço em baixo. */
  last?: boolean;
  /**
   * Nível do cabeçalho. `h2` quando os passos são as secções da página (a
   * criação de campanha), `h3` quando vivem dentro de uma secção que já tem o
   * seu `h2` (a espinha de participação). Sem isto, uma das duas páginas salta
   * um nível e um leitor de ecrã perde a estrutura.
   */
  headingLevel?: 2 | 3;
  children: React.ReactNode;
}> = ({ index, title, done, last = false, headingLevel = 3, children }) => {
  const Heading = (headingLevel === 2 ? 'h2' : 'h3') as 'h2' | 'h3';

  return (
  <li className={`relative pl-12 ${last ? '' : 'pb-8'}`}>
    {!last && (
      <span aria-hidden="true" className="absolute left-[15px] top-9 bottom-0 w-px bg-dark-border" />
    )}
    <span
      aria-hidden="true"
      className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs tabular-nums ${
        done
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-dark-border bg-dark-card text-gray-400'
      }`}
    >
      {done ? <Check className="w-4 h-4" strokeWidth={3} /> : index}
      </span>
      <Heading className="pt-1.5 font-display text-xl font-bold tracking-tight text-white">
        {title}
      </Heading>
      <div className="mt-3">{children}</div>
    </li>
  );
};
