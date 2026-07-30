import React from 'react';
import { cn } from '../../lib/cn';

type Variant = 'default' | 'primary' | 'crimson' | 'lime' | 'gold' | 'violet' | 'aqua' | 'teal' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  default: 'bg-panel-raised border border-line text-bone hover:bg-line hover:border-fog/40',
  primary: 'bg-crimson text-void hover:brightness-110 active:brightness-90',
  crimson: 'bg-crimson text-void hover:brightness-110 active:brightness-90',
  lime:    'bg-lime text-void hover:brightness-110 active:brightness-90',
  gold:    'bg-gold text-void hover:brightness-110 active:brightness-90',
  violet:  'bg-violet text-void hover:brightness-110 active:brightness-90',
  aqua:    'bg-aqua text-void hover:brightness-110 active:brightness-90',
  teal:    'bg-teal text-void hover:brightness-110 active:brightness-90',
  danger:  'bg-rust text-void hover:brightness-110 active:brightness-90',
  ghost:   'bg-transparent border border-line text-fog hover:text-bone hover:border-fog/50 hover:bg-white/[0.04]',
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({ variant = 'default', loading, children, className, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium',
        'transition-all duration-150 cursor-pointer whitespace-nowrap select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="btn-spinner" />}
      {children}
    </button>
  );
}
