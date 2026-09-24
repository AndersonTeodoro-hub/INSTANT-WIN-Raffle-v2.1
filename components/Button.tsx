import React from 'react';
import { twMerge } from 'tailwind-merge';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'success' | 'connect' | 'danger' | 'outline';
  isLoading?: boolean;
}

/*
 * Os nomes das variantes ficam (são usados em todo o jogo e no Event Center);
 * o aspecto segue a lógica única de botões de index.css:
 * - connect e success → o botão principal, âmbar (entrar na ronda, reclamar um prémio);
 * - primary e outline → secundário, de contorno. O azul deixou de ser acção: é luz ambiente;
 * - danger → contorno vermelho.
 */
const VARIANTS = {
  connect: 'iw-btn-primary font-bold disabled:!bg-dark-line disabled:!text-gray-400 disabled:!shadow-none disabled:!opacity-100',
  success: 'iw-btn-primary font-bold disabled:!bg-dark-line disabled:!text-gray-400 disabled:!shadow-none disabled:!opacity-100',
  primary: 'iw-btn-secondary',
  outline: 'iw-btn-secondary',
  danger: 'border border-red-500/50 bg-red-500/10 text-red-200 hover:border-red-400 hover:text-white',
} as const;

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  isLoading,
  className = '',
  disabled,
  ...props
}) => (
  <button
    className={twMerge(
      'iw-btn px-6 py-3 text-sm md:text-base disabled:cursor-not-allowed disabled:opacity-50',
      VARIANTS[variant],
      className,
    )}
    disabled={disabled || isLoading}
    {...props}
  >
    {isLoading && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
    {children}
  </button>
);
